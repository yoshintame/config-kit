import { describe, expect, test } from 'vitest'

import { ConfigKitError } from './errors'
import { createInMemorySource } from './in-memory-source'
import { requireConfig, requiredSource } from './require-config'
import { jsonParser, parseWith } from './source'
import { staticSource } from './test-sources'

describe('parseWith', () => {
  test('names the origin and keeps the parser error as cause', () => {
    let error: unknown
    try {
      parseWith({ parser: jsonParser, input: 'not json', source: 'env X' })
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(ConfigKitError)
    expect(error).toMatchObject({ kind: 'parse', source: 'env X' })
    expect((error as Error).message).toMatch(/^Failed to parse env X: /)
    expect((error as Error).cause).toBeInstanceOf(SyntaxError)
  })

  test('stringifies non-error throws', () => {
    const parser = {
      parse: () => {
        throw 'nope'
      },
    }
    expect(() => parseWith({ parser, input: '', source: 'file y' })).toThrow(
      'Failed to parse file y: nope',
    )
  })
})

describe('createInMemorySource', () => {
  test('describes itself with a custom origin', () => {
    expect(createInMemorySource({}, 'vite dev').describe()).toBe('vite dev')
    expect(createInMemorySource({}).describe()).toBe('in-memory')
  })
})

describe('requireConfig', () => {
  test('returns the loaded config', () => {
    expect(requireConfig(staticSource({ a: 1 }, 'a'))).toEqual({
      raw: { a: 1 },
      source: 'a',
    })
  })

  test.each([undefined, null])('throws a missing error for %s', (value) => {
    expect(() => requireConfig(staticSource(value, 'env X'), 'public')).toThrow(
      expect.objectContaining({
        kind: 'missing',
        section: 'public',
        message: 'Config not found in env X',
      }),
    )
  })

  test('requiredSource throws on load', () => {
    expect(() =>
      requiredSource(staticSource(undefined, 'a')).loadSync(),
    ).toThrow('Config not found in a')
  })
})

describe('createInMemorySource values', () => {
  test('is empty for undefined', () => {
    expect(createInMemorySource(undefined).loadSync()).toBeUndefined()
  })
})
