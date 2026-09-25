import type { SyncConfigSource } from './source'

export function firstNonEmpty(sources: SyncConfigSource[]): SyncConfigSource {
  let resolved: SyncConfigSource | undefined

  function describeAll(): string {
    return sources.map((source) => source.describe()).join(', ')
  }

  const watchable = sources.filter((source) => source.watch)

  return {
    loadSync() {
      for (const source of sources) {
        const value = source.loadSync()
        if (value !== undefined && value !== null) {
          resolved = source
          return value
        }
      }
      resolved = undefined
      throw new Error(`Config not found in any source: ${describeAll()}`)
    },
    describe: () =>
      resolved?.describe() ?? `first non-empty of [${describeAll()}]`,
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
