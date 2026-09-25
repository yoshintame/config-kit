import type { SyncConfigSource } from '@senate/config-core'

export type WindowSourceOptions = {
  globalKey?: string
}

export function createWindowSource({
  globalKey = '__CONFIG__',
}: WindowSourceOptions = {}): SyncConfigSource {
  return {
    loadSync: () => (globalThis as Record<string, unknown>)[globalKey],
    describe: () => `window.${globalKey}`,
  }
}
