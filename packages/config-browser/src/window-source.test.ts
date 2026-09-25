import { createSyncConfigLoader } from '@senate/config-core'
import { afterEach, describe, expect, test, vi } from 'vitest'
import z from 'zod'

import { createWindowSource } from './window-source'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createWindowSource', () => {
  test('reads window.__CONFIG__ by default', () => {
    vi.stubGlobal('__CONFIG__', { a: 1 })
    const source = createWindowSource()
    expect(source.loadSync()).toEqual({ a: 1 })
    expect(source.describe()).toBe('window.__CONFIG__')
  })

  test('reads custom global key', () => {
    vi.stubGlobal('__APP__', { b: 2 })
    const source = createWindowSource({ globalKey: '__APP__' })
    expect(source.loadSync()).toEqual({ b: 2 })
    expect(source.describe()).toBe('window.__APP__')
  })

  test('returns undefined when global is missing', () => {
    expect(createWindowSource({ globalKey: '__MISSING__' }).loadSync()).toBe(
      undefined,
    )
  })

  test('feeds loader with fail-fast SPA validation', () => {
    vi.stubGlobal('__CONFIG__', {
      backend: { apiUrl: 'https://api.example.com' },
      extra: true,
    })
    const loader = createSyncConfigLoader(createWindowSource())
    const config = loader.defineConfig(
      z
        .object({ backend: z.object({ apiUrl: z.url() }) })
        .meta({ id: 'public' }),
    )
    expect(() => loader.validateAll()).not.toThrow()
    expect(config.backend.apiUrl).toBe('https://api.example.com')
    expect(() => loader.assertOnlyKnownTopKeys()).toThrow(
      /\(loaded from window.__CONFIG__\): extra/,
    )
  })
})
