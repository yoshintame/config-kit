import { describe, expect, test } from 'vitest'

import { createInMemorySource } from './in-memory-source'
import { jsonParser, parseWith } from './source'

describe('parseWith', () => {
  test('names the origin and keeps the parser error as cause', () => {
    let error: unknown
    try {
      parseWith(jsonParser, 'not json', 'env X')
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toMatch(/^Failed to parse env X: /)
    expect((error as Error).cause).toBeInstanceOf(SyntaxError)
  })

  test('stringifies non-error throws', () => {
    const parser = {
      parse: () => {
        throw 'nope'
      },
    }
    expect(() => parseWith(parser, '', 'file y')).toThrow(
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
