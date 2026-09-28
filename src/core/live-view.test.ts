import { describe, expect, test } from 'vitest'

import { liveConfig } from './live-view'

describe('liveConfig', () => {
  test('returns the value as is without hot context', () => {
    const value = { a: 1 }
    expect(liveConfig(undefined, value)).toBe(value)
  })

  test('keeps earlier views in sync across updates', () => {
    const hot = { data: {} }
    const first = liveConfig(hot, { a: 1 })
    const second = liveConfig(hot, { a: 2 })
    expect(first.a).toBe(2)
    expect({ ...second }).toEqual({ a: 2 })
  })

  test('rejects writes', () => {
    const view = liveConfig({ data: {} }, { a: 1 })
    expect(() => {
      ;(view as { a: number }).a = 2
    }).toThrow(TypeError)
  })
})
