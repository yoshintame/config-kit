import { liveView } from './live-view'
import { parseOrThrow } from './parse-or-throw'
import { ensureLoaded } from './require-config'
import type { RawConfig, SyncConfigSource } from './source'
import type { StandardSchemaV1 } from './standard-schema'

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
  onChange(cb: () => void): () => void
}

export function createSyncConfigLoader(
  source: SyncConfigSource,
): SyncConfigLoader {
  let loadedCache: { value: RawConfig | undefined } | undefined
  const resets = new Set<() => void>()
  const listeners = new Set<() => void>()
  let unwatch: (() => void) | undefined

  function loaded(): RawConfig | undefined {
    loadedCache ??= { value: source.loadSync() }
    return loadedCache.value
  }

  function defineConfig<T extends ObjectSchema>(
    schema: T,
    { name }: DefineConfigOptions = {},
  ): StandardSchemaV1.InferOutput<T> {
    let validated: { value: StandardSchemaV1.InferOutput<T> } | undefined
    resets.add(() => {
      validated = undefined
    })

    return liveView({
      get value() {
        validated ??= {
          value: parseOrThrow(schema, ensureLoaded(loaded(), source, name), {
            name,
          }),
        }
        return validated.value
      },
    })
  }

  function reset(): void {
    loadedCache = undefined
    for (const resetSchema of resets) resetSchema()
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
    loadRaw: () => loaded()?.raw,
    reset,
    onChange,
  }
}
