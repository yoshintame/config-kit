import { type ZodType, z } from 'zod'

import type { SyncConfigSource } from './source'

export type SyncConfigLoader = {
  defineConfig: <T extends ZodType>(schema: T) => z.infer<T>
  loadRaw: () => unknown
  reset: () => void
  validateAll: () => void
  assertOnlyKnownTopKeys: () => void
  onChange: (cb: () => void) => () => void
}

type RegisteredSchema = {
  schema: ZodType
  load: () => unknown
  reset: () => void
}

function schemaName(schema: ZodType): string | undefined {
  return schema.meta()?.id ?? schema.description
}

function topKeysOf(schema: ZodType): string[] | undefined {
  const def = schema._zod.def as {
    type: string
    shape?: Record<string, unknown>
    in?: ZodType
  }
  if (def.type === 'object' && def.shape) return Object.keys(def.shape)
  if (def.type === 'pipe' && def.in) return topKeysOf(def.in)
  return undefined
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function createSyncConfigLoader(
  source: SyncConfigSource,
): SyncConfigLoader {
  let rawCache: { value: unknown } | undefined
  const registered: RegisteredSchema[] = []
  const listeners = new Set<() => void>()
  let unwatch: (() => void) | undefined

  function loadRaw(): unknown {
    if (!rawCache) rawCache = { value: source.loadSync() }
    return rawCache.value
  }

  function defineConfig<T extends ZodType>(schema: T): z.infer<T> {
    let validated: { value: z.infer<T> } | undefined

    function load(): z.infer<T> {
      if (!validated) {
        const result = schema.safeParse(loadRaw())
        if (!result.success) {
          const name = schemaName(schema)
          const target = name ? ` for schema '${name}'` : ''
          throw new Error(
            `Config validation failed${target} (loaded from ${source.describe()}):\n${z.prettifyError(result.error)}`,
          )
        }
        validated = { value: result.data as z.infer<T> }
      }
      return validated.value
    }

    registered.push({
      schema,
      load,
      reset: () => {
        validated = undefined
      },
    })

    return new Proxy({} as z.infer<T> & object, {
      get: (_t, prop, recv) => Reflect.get(load() as object, prop, recv),
      has: (_t, prop) => Reflect.has(load() as object, prop),
      ownKeys: () => Reflect.ownKeys(load() as object),
      getOwnPropertyDescriptor: (_t, prop) =>
        Reflect.getOwnPropertyDescriptor(load() as object, prop),
    }) as z.infer<T>
  }

  function reset(): void {
    rawCache = undefined
    for (const entry of registered) entry.reset()
  }

  function validateAll(): void {
    const messages: string[] = []
    for (const entry of registered) {
      try {
        entry.load()
      } catch (err) {
        messages.push((err as Error).message)
      }
    }
    if (messages.length > 0) throw new Error(messages.join('\n\n'))
  }

  function assertOnlyKnownTopKeys(): void {
    const raw = loadRaw()
    if (!isPlainObject(raw)) {
      throw new Error(
        `Config root is not an object (loaded from ${source.describe()})`,
      )
    }

    const known = new Set<string>()
    for (const { schema } of registered) {
      const keys = topKeysOf(schema)
      if (!keys) {
        const name = schemaName(schema)
        throw new Error(
          `assertOnlyKnownTopKeys supports only object schemas${name ? `, got '${name}'` : ''}`,
        )
      }
      for (const key of keys) known.add(key)
    }

    const unknown = Object.keys(raw).filter((key) => !known.has(key))
    if (unknown.length > 0) {
      throw new Error(
        `Unknown top-level config keys (loaded from ${source.describe()}): ${unknown.join(', ')}`,
      )
    }
  }

  function onChange(cb: () => void): () => void {
    listeners.add(cb)
    if (!unwatch && source.watch) {
      unwatch = source.watch(() => {
        reset()
        for (const listener of listeners) listener()
      })
    }
    return () => {
      listeners.delete(cb)
      if (listeners.size === 0 && unwatch) {
        unwatch()
        unwatch = undefined
      }
    }
  }

  return {
    defineConfig,
    loadRaw,
    reset,
    validateAll,
    assertOnlyKnownTopKeys,
    onChange,
  }
}
