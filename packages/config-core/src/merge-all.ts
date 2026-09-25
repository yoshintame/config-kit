import type { SyncConfigSource } from './source'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function deepMerge(base: unknown, overlay: unknown): unknown {
  if (overlay === undefined) return base
  if (!isPlainObject(base) || !isPlainObject(overlay)) return overlay
  const result: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(overlay)) {
    result[key] = deepMerge(base[key], value)
  }
  return result
}

export function mergeAll(sources: SyncConfigSource[]): SyncConfigSource {
  const watchable = sources.filter((source) => source.watch)

  return {
    loadSync() {
      let merged: unknown
      for (const source of sources) {
        const value = source.loadSync()
        if (value !== undefined && value !== null) {
          merged = deepMerge(merged, value)
        }
      }
      return merged
    },
    describe: () =>
      `merge of [${sources.map((source) => source.describe()).join(', ')}]`,
    ...(watchable.length > 0 && {
      watch(onChange: () => void) {
        const unwatchers = watchable.map((source) => source.watch!(onChange))
        return () => {
          for (const unwatch of unwatchers) unwatch()
        }
      },
    }),
  }
}
