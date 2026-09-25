import { afterEach, describe, expect, test, vi } from 'vitest'
import z from 'zod'

import { createSyncConfigLoader } from '../core'
import { createJsonScriptSource } from './json-script-source'

function stubScript(id: string, textContent: string | null) {
  vi.stubGlobal('document', {
    getElementById: (requested: string) =>
      requested === id ? { textContent } : null,
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createJsonScriptSource', () => {
  test('parses JSON from script#__CONFIG__ by default', () => {
    stubScript('__CONFIG__', '{"a":1}')
    const source = createJsonScriptSource()
    expect(source.loadSync()).toEqual({ a: 1 })
    expect(source.describe()).toBe('script#__CONFIG__')
  })

  test('reads a custom element id', () => {
    stubScript('app-config', '{"b":2}')
    const source = createJsonScriptSource({ elementId: 'app-config' })
    expect(source.loadSync()).toEqual({ b: 2 })
    expect(source.describe()).toBe('script#app-config')
  })

  test.each([
    ['element is missing', 'other', '{}'],
    ['element is empty', '__CONFIG__', ''],
    ['element has no text', '__CONFIG__', null],
  ])('returns undefined when %s', (_, id, text) => {
    stubScript(id, text)
    expect(createJsonScriptSource().loadSync()).toBeUndefined()
  })

  test('returns undefined without a document', () => {
    expect(createJsonScriptSource().loadSync()).toBeUndefined()
  })

  test('names the element when JSON is invalid', () => {
    stubScript('__CONFIG__', 'not json')
    expect(() => createJsonScriptSource().loadSync()).toThrow(
      /^Failed to parse script#__CONFIG__: /,
    )
  })

  test('feeds loader with fail-fast SPA validation', () => {
    stubScript(
      '__CONFIG__',
      JSON.stringify({
        backend: { apiUrl: 'https://api.example.com' },
        extra: true,
      }),
    )
    const loader = createSyncConfigLoader(createJsonScriptSource())
    const config = loader.defineConfig(
      z
        .object({ backend: z.object({ apiUrl: z.url() }) })
        .meta({ id: 'public' }),
    )
    expect(() => loader.validateAll()).not.toThrow()
    expect(config.backend.apiUrl).toBe('https://api.example.com')
    expect(() => loader.assertOnlyKnownTopKeys()).toThrow(
      /\(loaded from script#__CONFIG__\): extra/,
    )
  })
})
