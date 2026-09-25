import { isNil } from 'es-toolkit'

import type { SyncConfigSource } from './source'
import { watchAll } from './watch-all'

export function firstNonEmpty(sources: SyncConfigSource[]): SyncConfigSource {
  let resolved: SyncConfigSource | undefined

  return {
    loadSync() {
      for (const source of sources) {
        const value = source.loadSync()
        if (!isNil(value)) {
          resolved = source
          return value
        }
      }
      resolved = undefined
      throw new Error(`Config not found in any source: ${describeAll(sources)}`)
    },
    describe: () =>
      resolved?.describe() ?? `first non-empty of [${describeAll(sources)}]`,
    ...watchAll(sources),
  }
}

function describeAll(sources: SyncConfigSource[]): string {
  return sources.map((source) => source.describe()).join(', ')
}
