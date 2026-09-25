import { describe, expect, test, vi } from 'vitest'

import { createInMemorySource } from './in-memory-source'
import { deepMerge, mergeAll } from './merge-all'
import type { SyncConfigSource } from './source'

function staticSource(value: unknown, name: string): SyncConfigSource {
  return { loadSync: () => value, describe: () => name }
}

describe('deepMerge', () => {
  test('merges nested objects and lets overlay win', () => {
    expect(
      deepMerge({ a: { b: 1, c: 2 }, d: 'x' }, { a: { c: 3, e: 4 }, f: true }),
    ).toEqual({ a: { b: 1, c: 3, e: 4 }, d: 'x', f: true })
  })

  test('replaces arrays and scalars', () => {
    expect(
      deepMerge({ a: [1, 2], b: { c: 1 } }, { a: [3], b: 'flat' }),
    ).toEqual({ a: [3], b: 'flat' })
  })

  test('keeps null from overlay as a literal value', () => {
    expect(deepMerge({ a: 1 }, { a: null })).toEqual({ a: null })
  })

  test('ignores undefined overlay keys', () => {
    expect(deepMerge({ a: 1 }, { a: undefined })).toEqual({ a: 1 })
  })

  test('does not mutate inputs', () => {
    const base = { a: { b: 1 } }
    deepMerge(base, { a: { b: 2 } })
    expect(base).toEqual({ a: { b: 1 } })
  })
})

describe('mergeAll', () => {
  test('merges sources left to right, skipping empty ones', () => {
    const source = mergeAll([
      staticSource({ a: { b: 1, c: 1 } }, 'base'),
      staticSource(undefined, 'missing'),
      staticSource(null, 'null'),
      staticSource({ a: { c: 2 } }, 'local'),
    ])
    expect(source.loadSync()).toEqual({ a: { b: 1, c: 2 } })
  })

  test('returns undefined when every source is empty', () => {
    const source = mergeAll([staticSource(undefined, 'a')])
    expect(source.loadSync()).toBeUndefined()
  })

  test('describe lists every source', () => {
    expect(
      mergeAll([staticSource(1, 'a'), staticSource(2, 'b')]).describe(),
    ).toBe('merge of [a, b]')
  })

  test('propagates source errors', () => {
    const source = mergeAll([
      {
        loadSync: () => {
          throw new Error('boom')
        },
        describe: () => 'broken',
      },
    ])
    expect(() => source.loadSync()).toThrow('boom')
  })

  test('watch fans out to watchable sources', () => {
    const first = createInMemorySource({ a: 1 })
    const source = mergeAll([first, staticSource({ b: 2 }, 'static')])
    const cb = vi.fn()
    const unwatch = source.watch!(cb)
    first.set({ a: 2 })
    expect(cb).toHaveBeenCalledOnce()
    unwatch()
    first.set({ a: 3 })
    expect(cb).toHaveBeenCalledOnce()
  })
})
