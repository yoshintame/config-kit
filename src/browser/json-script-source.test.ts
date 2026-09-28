import { afterEach, describe, expect, test, vi } from 'vitest'

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
    expect(source.loadSync()).toEqual({
      raw: { a: 1 },
      source: 'script#__CONFIG__',
    })
    expect(source.describe()).toBe('script#__CONFIG__')
  })

  test('reads a custom element id', () => {
    stubScript('app-config', '{"b":2}')
    const source = createJsonScriptSource({ elementId: 'app-config' })
    expect(source.loadSync()).toEqual({
      raw: { b: 2 },
      source: 'script#app-config',
    })
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

  test('reports an unsubstituted placeholder', () => {
    const envVar = 'APP_PUBLIC_CONFIG'
    const placeholder = `\${${envVar}}`
    stubScript('__CONFIG__', ` ${placeholder} `)
    expect(() => createJsonScriptSource({ placeholder }).loadSync()).toThrow(
      expect.objectContaining({ kind: 'placeholder' }),
    )
  })
})
