import type { SyncConfigSource } from './source'

export function staticSource(value: unknown, name: string): SyncConfigSource {
  return {
    loadSync: () =>
      value === undefined ? undefined : { raw: value, source: name },
    describe: () => name,
  }
}
