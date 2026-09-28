import { isLoaded } from './guards'
import type { RawConfig, SyncConfigSource } from './source'
import { watchAll } from './watch-all'

export function firstNonEmpty(sources: SyncConfigSource[]): SyncConfigSource {
  return {
    loadSync: () => firstLoaded(sources),
    describe: () =>
      `first non-empty of [${sources.map((source) => source.describe()).join(', ')}]`,
    ...watchAll(sources),
  }
}

function firstLoaded(sources: SyncConfigSource[]): RawConfig | undefined {
  for (const source of sources) {
    const loaded = source.loadSync()
    if (isLoaded(loaded)) return loaded
  }
  return undefined
}
