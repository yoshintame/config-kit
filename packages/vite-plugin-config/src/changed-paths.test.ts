import { describe, expect, test } from 'vitest'

import { changedPaths, matchesAny } from './changed-paths'

describe('changedPaths', () => {
  test('returns leaf paths that differ', () => {
    expect(
      changedPaths(
        { a: { b: 1, c: 2 }, d: [1] },
        { a: { b: 1, c: 3 }, d: [1, 2], e: true },
      ),
    ).toEqual(['a.c', 'd', 'e'])
  })

  test('returns nothing for equal values', () => {
    expect(changedPaths({ a: { b: [1] } }, { a: { b: [1] } })).toEqual([])
  })

  test('returns root when shape changes at the top', () => {
    expect(changedPaths(undefined, { a: 1 })).toEqual([''])
  })
})

describe('matchesAny', () => {
  test('matches exact path and descendants', () => {
    expect(matchesAny('backend.proxyUrl', ['backend.proxyUrl'])).toBe(true)
    expect(matchesAny('backend.proxyUrl.host', ['backend.proxyUrl'])).toBe(true)
    expect(matchesAny('backend.apiUrl', ['backend.proxyUrl'])).toBe(false)
  })

  test('matches wildcard subtree', () => {
    expect(matchesAny('otel.endpoint', ['otel.*'])).toBe(true)
    expect(matchesAny('otel', ['otel.*'])).toBe(true)
    expect(matchesAny('otelx', ['otel.*'])).toBe(false)
  })

  test('matches ancestor replaced as a whole', () => {
    expect(matchesAny('backend', ['backend.proxyUrl'])).toBe(true)
  })

  test('root change matches any pattern', () => {
    expect(matchesAny('', ['x'])).toBe(true)
    expect(matchesAny('', [])).toBe(false)
  })
})
