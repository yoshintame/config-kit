import { describe, expect, test, vi } from 'vitest'

import { firstNonEmpty } from './first-non-empty'
import { createInMemorySource } from './in-memory-source'
import type { SyncConfigSource } from './source'

function staticSource(value: unknown, name: string): SyncConfigSource {
  return { loadSync: () => value, describe: () => name }
}

describe('firstNonEmpty', () => {
  test('returns the first value that is not undefined or null', () => {
    const source = firstNonEmpty([
      staticSource(undefined, 'a'),
      staticSource(null, 'b'),
      staticSource({}, 'c'),
      staticSource({ d: 1 }, 'd'),
    ])
    expect(source.loadSync()).toEqual({})
  })

  test('describe reports the resolved source', () => {
    const source = firstNonEmpty([
      staticSource(undefined, 'a'),
      staticSource(1, 'b'),
    ])
    expect(source.describe()).toBe('first non-empty of [a, b]')
    source.loadSync()
    expect(source.describe()).toBe('b')
  })

  test('throws listing every source when all are empty', () => {
    const source = firstNonEmpty([
      staticSource(undefined, 'env X'),
      staticSource(null, 'file y.yaml'),
    ])
    expect(() => source.loadSync()).toThrow(
      'Config not found in any source: env X, file y.yaml',
    )
  })

  test('propagates source errors', () => {
    const source = firstNonEmpty([
      {
        loadSync: () => {
          throw new Error('boom')
        },
        describe: () => 'broken',
      },
      staticSource(1, 'fallback'),
    ])
    expect(() => source.loadSync()).toThrow('boom')
  })

  test('watch fans out to watchable sources only', () => {
    const first = createInMemorySource(1)
    const second = createInMemorySource(2)
    const source = firstNonEmpty([first, staticSource(3, 'static'), second])
    const cb = vi.fn()
    const unwatch = source.watch!(cb)

    first.set(10)
    second.set(20)
    expect(cb).toHaveBeenCalledTimes(2)

    unwatch()
    first.set(11)
    expect(cb).toHaveBeenCalledTimes(2)
  })

  test('has no watch when no source is watchable', () => {
    expect(firstNonEmpty([staticSource(1, 'a')]).watch).toBeUndefined()
  })
})
