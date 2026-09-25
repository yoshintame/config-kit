import type { SyncConfigSource } from './source'

export type InMemorySource = SyncConfigSource & {
  set(value: unknown): void
}

export function createInMemorySource(initial: unknown): InMemorySource {
  let value = initial
  const listeners = new Set<() => void>()

  return {
    loadSync: () => value,
    describe: () => 'in-memory',
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
