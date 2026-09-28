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
      /Config validation failed for 'db-toolkit' \(loaded from in-memory\):\n.*db\.host/s,
    )
  })

  test('validation error names schema via meta title', () => {
    const loader = createSyncConfigLoader(createInMemorySource({}))
    const config = loader.defineConfig(
      z.object({ a: z.number() }).meta({ title: 'crm-public' }),
    )
    expect(() => config.a).toThrow(/for 'crm-public'/)
  })

  test('validation error falls back to schema description', () => {
    const loader = createSyncConfigLoader(createInMemorySource({}))
    const config = loader.defineConfig(
      z.object({ a: z.number() }).describe('tg-helpers'),
    )
    expect(() => config.a).toThrow(/for 'tg-helpers'/)
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

  test('reads the source once and validates each schema once', () => {
    const source = createInMemorySource({ a: 1 })
    const loadSync = vi.spyOn(source, 'loadSync')
    const loader = createSyncConfigLoader(source)
    const parse = vi.fn((a: number) => a)
    const config = loader.defineConfig(
      z.object({ a: z.number().transform(parse) }),
    )

    loader.loadRaw()
    expect(config.a).toBe(1)
    expect(config.a).toBe(1)

    expect(loadSync).toHaveBeenCalledOnce()
    expect(parse).toHaveBeenCalledOnce()
  })

  test('proxy exposes frozen readonly results', () => {
    const loader = createSyncConfigLoader(createInMemorySource({ a: 1, b: 2 }))
    const config = loader.defineConfig(
      z.object({ a: z.number(), b: z.number() }).readonly(),
    )
    expect({ ...config }).toEqual({ a: 1, b: 2 })
    expect(Object.entries(config)).toEqual([
      ['a', 1],
      ['b', 2],
    ])
  })

  test('proxy rejects writes', () => {
    const loader = createSyncConfigLoader(createInMemorySource({ a: 1 }))
    const config = loader.defineConfig(z.object({ a: z.number() }))
    expect(() => {
      ;(config as { a: number }).a = 2
    }).toThrow(TypeError)
    expect(() => delete (config as { a?: number }).a).toThrow(TypeError)
    expect(() => Object.defineProperty(config, 'b', { value: 1 })).toThrow(
      TypeError,
    )
    expect(config.a).toBe(1)
  })

  test('loadRaw returns unvalidated value', () => {
    const raw = { anything: [1, 2] }
    const loader = createSyncConfigLoader(createInMemorySource(raw))
    expect(loader.loadRaw()).toBe(raw)
  })

  test('throws a missing error when the source is empty', () => {
    const loader = createSyncConfigLoader(
      createInMemorySource(undefined, 'env X'),
    )
    const config = loader.defineConfig(z.object({ a: z.number() }), {
      name: 'db',
    })
    expect(loader.loadRaw()).toBeUndefined()
    expect(() => config.a).toThrow(
      expect.objectContaining({ kind: 'missing', section: 'db' }),
    )
  })

  test('names the schema through the name option', () => {
    const loader = createSyncConfigLoader(createInMemorySource({ a: 'x' }))
    const config = loader.defineConfig(z.object({ a: z.number() }), {
      name: 'explicit',
    })
    expect(() => config.a).toThrow(/for 'explicit'/)
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

    test('unwatches the source only after the last unsubscribe', () => {
      const unwatch = vi.fn()
      const watch = vi.fn(() => unwatch)
      const loader = createSyncConfigLoader({
        loadSync: () => ({ raw: {}, source: 'watched' }),
        describe: () => 'watched',
        watch,
      })

      const first = loader.onChange(() => {})
      const second = loader.onChange(() => {})
      expect(watch).toHaveBeenCalledOnce()

      first()
      expect(unwatch).not.toHaveBeenCalled()
      second()
      expect(unwatch).toHaveBeenCalledOnce()
    })

    test('is a no-op for sources without watch', () => {
      const loader = createSyncConfigLoader({
        loadSync: () => ({ raw: {}, source: 'static' }),
        describe: () => 'static',
      })
      const unsubscribe = loader.onChange(() => {})
      expect(() => unsubscribe()).not.toThrow()
    })
  })
})
