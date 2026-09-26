import { isPlainObject } from 'es-toolkit'

import { liveView } from './live-view'
import { parseOrThrow } from './parse-or-throw'
import { errorMessage, type SyncConfigSource } from './source'
import {
  type StandardSchemaV1,
  schemaTitle,
  topLevelKeys,
} from './standard-schema'

export type ObjectSchema = StandardSchemaV1<unknown, Record<string, unknown>>

export interface DefineConfigOptions {
  name?: string
}

export interface SyncConfigLoader {
  defineConfig<T extends ObjectSchema>(
    schema: T,
    options?: DefineConfigOptions,
  ): StandardSchemaV1.InferOutput<T>
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

  function defineConfig<T extends ObjectSchema>(
    schema: T,
    { name }: DefineConfigOptions = {},
  ): StandardSchemaV1.InferOutput<T> {
    type Output = StandardSchemaV1.InferOutput<T>
    let validated: { value: Output } | undefined

    function load(): Output {
      validated ??= {
        value: parseOrThrow(schema, loadRaw(), source.describe(), { name }),
      }
      return validated.value
    }

    registered.push({
      schema,
      name,
      load,
      reset: () => {
        validated = undefined
      },
    })

    return liveView({
      get value() {
        return load()
      },
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

    const keys = registered.map(({ schema, name }) =>
      topLevelKeys(schema, name ?? schemaTitle(schema) ?? 'schema'),
    )
    if (keys.includes(undefined)) return
    const known = new Set(keys.flat())
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
  schema: ObjectSchema
  name: string | undefined
  load(): unknown
  reset(): void
}
