import { describe, expect, test, vi } from 'vitest'
import z from 'zod'

import { createInMemorySource } from './in-memory-source'
import { createSyncConfigLoader } from './loader'

describe('createSyncConfigLoader', () => {
  test('validates lazily on first access', () => {
    const source = createInMemorySource({ db: { host: 'x' } })
    const loadSync = vi.spyOn(source, 'loadSync')
    const loader = createSyncConfigLoader(source)
    const config = loader.defineConfig(
      z.object({ db: z.object({ host: z.string() }) }),
    )
    expect(loadSync).not.toHaveBeenCalled()
    expect(config.db.host).toBe('x')
    expect(loadSync).toHaveBeenCalledOnce()
  })

  test('multiple consumers share one source', () => {
    const loader = createSyncConfigLoader(
      createInMemorySource({ a: 1, b: 2, c: 3 }),
    )
    const first = loader.defineConfig(z.object({ a: z.number() }))
    const second = loader.defineConfig(z.object({ b: z.number() }))
    expect(first.a).toBe(1)
    expect(second.b).toBe(2)
  })

  test('validation error names schema via meta id and source', () => {
    const loader = createSyncConfigLoader(
      createInMemorySource({ db: { host: 1 } }),
    )
    const config = loader.defineConfig(
      z
        .object({ db: z.object({ host: z.string() }) })
        .meta({ id: 'db-toolkit' }),
    )
    expect(() => config.db).toThrow(
      /Config validation failed for schema 'db-toolkit' \(loaded from in-memory\):\n.*db\.host/s,
    )
  })

  test('validation error names schema via meta title', () => {
    const loader = createSyncConfigLoader(createInMemorySource({}))
    const config = loader.defineConfig(
      z.object({ a: z.number() }).meta({ title: 'crm-public' }),
    )
    expect(() => config.a).toThrow(/for schema 'crm-public'/)
  })

  test('validation error falls back to schema description', () => {
    const loader = createSyncConfigLoader(createInMemorySource({}))
    const config = loader.defineConfig(
      z.object({ a: z.number() }).describe('tg-helpers'),
    )
    expect(() => config.a).toThrow(/for schema 'tg-helpers'/)
  })

  test('validation error without schema name', () => {
    const loader = createSyncConfigLoader(createInMemorySource({}))
    const config = loader.defineConfig(z.object({ a: z.number() }))
    expect(() => config.a).toThrow(
      /^Config validation failed \(loaded from in-memory\)/,
    )
  })

  test('reset clears caches', () => {
    const source = createInMemorySource({ a: 1 })
    const loader = createSyncConfigLoader(source)
    const config = loader.defineConfig(z.object({ a: z.number() }))
    expect(config.a).toBe(1)

    source.set({ a: 99 })
    expect(config.a).toBe(1)

    loader.reset()
    expect(config.a).toBe(99)
  })

  test('proxy supports Object.keys and spread', () => {
    const loader = createSyncConfigLoader(createInMemorySource({ x: 1, y: 2 }))
    const config = loader.defineConfig(
      z.object({ x: z.number(), y: z.number() }),
    )
    expect(Object.keys(config).sort()).toEqual(['x', 'y'])
    expect({ ...config }).toEqual({ x: 1, y: 2 })
  })

  test('loadRaw returns unvalidated value', () => {
    const raw = { anything: [1, 2] }
    const loader = createSyncConfigLoader(createInMemorySource(raw))
    expect(loader.loadRaw()).toBe(raw)
  })

  describe('validateAll', () => {
    test('passes when every schema is valid', () => {
      const loader = createSyncConfigLoader(
        createInMemorySource({ a: 1, b: 's' }),
      )
      loader.defineConfig(z.object({ a: z.number() }))
      loader.defineConfig(z.object({ b: z.string() }))
      expect(() => loader.validateAll()).not.toThrow()
    })

    test('reports every failing schema', () => {
      const loader = createSyncConfigLoader(createInMemorySource({}))
      loader.defineConfig(z.object({ a: z.number() }).meta({ id: 'first' }))
      loader.defineConfig(z.object({ b: z.string() }).meta({ id: 'second' }))
      expect(() => loader.validateAll()).toThrow(
        /schema 'first'.*schema 'second'/s,
      )
    })
  })

  describe('assertOnlyKnownTopKeys', () => {
    test('passes when keys are covered by registered schemas', () => {
      const loader = createSyncConfigLoader(
        createInMemorySource({ a: 1, b: 2 }),
      )
      loader.defineConfig(z.object({ a: z.number() }))
      loader.defineConfig(
        z.object({ b: z.number() }).transform(({ b }) => ({ b: b * 2 })),
      )
      expect(() => loader.assertOnlyKnownTopKeys()).not.toThrow()
    })

    test('throws on unknown keys', () => {
      const loader = createSyncConfigLoader(
        createInMemorySource({ a: 1, typo: 2 }),
      )
      loader.defineConfig(z.object({ a: z.number() }))
      expect(() => loader.assertOnlyKnownTopKeys()).toThrow(
        /Unknown top-level config keys \(loaded from in-memory\): typo/,
      )
    })

    test('throws on non-object schema', () => {
      const loader = createSyncConfigLoader(createInMemorySource({ a: 1 }))
      loader.defineConfig(
        z.record(z.string(), z.number()).meta({ id: 'records' }),
      )
      expect(() => loader.assertOnlyKnownTopKeys()).toThrow(
        /only object schemas, got 'records'/,
      )
    })

    test('throws on non-object root', () => {
      const loader = createSyncConfigLoader(createInMemorySource([1]))
      expect(() => loader.assertOnlyKnownTopKeys()).toThrow(/not an object/)
    })
  })

  describe('onChange', () => {
    test('resets caches before notifying subscribers', () => {
      const source = createInMemorySource({ a: 1 })
      const loader = createSyncConfigLoader(source)
      const config = loader.defineConfig(z.object({ a: z.number() }))
      expect(config.a).toBe(1)

      const seen: number[] = []
      loader.onChange(() => seen.push(config.a))
      source.set({ a: 2 })

      expect(seen).toEqual([2])
      expect(config.a).toBe(2)
    })

    test('stops watching after last unsubscribe', () => {
      const source = createInMemorySource({ a: 1 })
      const loader = createSyncConfigLoader(source)
      const cb = vi.fn()
      const unsubscribe = loader.onChange(cb)
      unsubscribe()
      source.set({ a: 2 })
      expect(cb).not.toHaveBeenCalled()
    })

    test('is a no-op for sources without watch', () => {
      const loader = createSyncConfigLoader({
        loadSync: () => ({}),
        describe: () => 'static',
      })
      const unsubscribe = loader.onChange(() => {})
      expect(() => unsubscribe()).not.toThrow()
    })
  })
})
