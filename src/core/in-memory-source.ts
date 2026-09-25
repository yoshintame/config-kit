import type { SyncConfigSource } from './source'

export interface InMemorySource extends SyncConfigSource {
  set(value: unknown): void
}

export function createInMemorySource(
  initial: unknown,
  origin = 'in-memory',
): InMemorySource {
  let value = initial
  const listeners = new Set<() => void>()

  return {
    loadSync: () => value,
    describe: () => origin,
    watch(onChange) {
      listeners.add(onChange)
      return () => listeners.delete(onChange)
    },
    set(next) {
      value = next
      for (const listener of listeners) listener()
    },
  }
}
