import { isPlainObject } from 'es-toolkit'
import type { ZodType, z } from 'zod'

import { parseOrThrow, schemaName } from './parse-or-throw'
import { errorMessage, type SyncConfigSource } from './source'

export type ObjectSchema = ZodType<Record<string, unknown>>

export interface SyncConfigLoader {
  defineConfig<T extends ObjectSchema>(schema: T): z.infer<T>
  loadRaw(): unknown
  reset(): void
  validateAll(): void
  assertOnlyKnownTopKeys(): void
  onChange(cb: () => void): () => void
}

export function createSyncConfigLoader(
  source: SyncConfigSource,
): SyncConfigLoader {
  let rawCache: { value: unknown } | undefined
  const registered: RegisteredSchema[] = []
  const listeners = new Set<() => void>()
  let unwatch: (() => void) | undefined

  function loadRaw(): unknown {
    rawCache ??= { value: source.loadSync() }
    return rawCache.value
  }

  function defineConfig<T extends ObjectSchema>(schema: T): z.infer<T> {
    let validated: { value: z.infer<T> } | undefined

    function load(): z.infer<T> {
      validated ??= {
        value: parseOrThrow(schema, loadRaw(), source.describe()),
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

    return new Proxy({} as z.infer<T>, {
      get: (_target, prop) => Reflect.get(load(), prop),
      has: (_target, prop) => Reflect.has(load(), prop),
      ownKeys: () => Reflect.ownKeys(load()),
      getOwnPropertyDescriptor: (_target, prop) =>
        configurable(Reflect.getOwnPropertyDescriptor(load(), prop)),
      set: () => false,
      defineProperty: () => false,
      deleteProperty: () => false,
    })
  }

  function reset(): void {
    rawCache = undefined
    for (const entry of registered) entry.reset()
  }

  function validateAll(): void {
    loadRaw()
    const messages = registered.flatMap((entry) => {
      try {
        entry.load()
        return []
      } catch (error) {
        return [errorMessage(error)]
      }
    })
    if (messages.length > 0) throw new Error(messages.join('\n\n'))
  }

  function assertOnlyKnownTopKeys(): void {
    const raw = loadRaw()
    if (!isPlainObject(raw)) {
      throw new Error(
        `Config root is not an object (loaded from ${source.describe()})`,
      )
    }

    const known = new Set(
      registered.flatMap(({ schema }) => requireTopKeys(schema)),
    )
    const unknown = Object.keys(raw).filter((key) => !known.has(key))
    if (unknown.length > 0) {
      throw new Error(
        `Unknown top-level config keys (loaded from ${source.describe()}): ${unknown.join(', ')}`,
      )
    }
  }

  function onChange(cb: () => void): () => void {
    listeners.add(cb)
    unwatch ??= source.watch?.(() => {
      reset()
      for (const listener of listeners) listener()
    })
    return () => {
      listeners.delete(cb)
      if (listeners.size > 0) return
      unwatch?.()
      unwatch = undefined
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

interface RegisteredSchema {
  schema: ZodType
  load(): unknown
  reset(): void
}

interface SchemaDef {
  type: string
  shape?: Record<string, unknown>
  in?: ZodType
  innerType?: ZodType
  getter?: () => ZodType
}

function requireTopKeys(schema: ZodType): string[] {
  const keys = topKeysOf(schema)
  if (keys) return keys
  const name = schemaName(schema)
  throw new Error(
    `assertOnlyKnownTopKeys supports only object schemas${name ? `, got '${name}'` : ''}`,
  )
}

function topKeysOf(schema: ZodType): string[] | undefined {
  const def = schema._zod.def as SchemaDef
  if (def.type === 'object') return Object.keys(def.shape ?? {})
  const inner = def.in ?? def.innerType ?? def.getter?.()
  return inner ? topKeysOf(inner) : undefined
}

function configurable(
  descriptor: PropertyDescriptor | undefined,
): PropertyDescriptor | undefined {
  return descriptor ? { ...descriptor, configurable: true } : undefined
}
