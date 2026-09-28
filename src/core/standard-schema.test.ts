import { toStandardJsonSchema } from '@valibot/to-json-schema'
import { type } from 'arktype'
import * as v from 'valibot'
import { describe, expect, test, vi } from 'vitest'
import { z } from 'zod'

import { parseOrThrow } from './parse-or-throw'
import {
  JsonSchemaIo,
  jsonSchemaOf,
  objectProperties,
  type StandardSchemaV1,
  topLevelKeys,
} from './standard-schema'

const libraries: [string, StandardSchemaV1][] = [
  [
    'zod',
    z.object({
      app: z.object({ title: z.string() }),
      flag: z.boolean().default(false),
    }),
  ],
  [
    'valibot',
    toStandardJsonSchema(
      v.object({
        app: v.object({ title: v.string() }),
        flag: v.optional(v.boolean(), false),
      }),
    ),
  ],
  ['arktype', type({ app: { title: 'string' }, flag: 'boolean = false' })],
]

describe.each(libraries)('%s', (_, schema) => {
  test('validates and applies defaults', () => {
    expect(
      parseOrThrow(schema, { raw: { app: { title: 'crm' } }, source: 'test' }),
    ).toEqual({
      app: { title: 'crm' },
      flag: false,
    })
  })

  test('reports issues with the section name, source and path', () => {
    expect(() =>
      parseOrThrow(
        schema,
        { raw: { app: { title: 1 } }, source: 'env APP' },
        {
          name: 'public',
        },
      ),
    ).toThrow(
      /^Config validation failed for 'public' \(loaded from env APP\):\n✖ .+\n {2}→ at app\.title$/,
    )
  })

  test('lists top-level keys from the JSON Schema', () => {
    expect(topLevelKeys(schema, 'public')?.sort()).toEqual(['app', 'flag'])
  })

  test('rejects unknown keys in strict mode', () => {
    expect(() =>
      parseOrThrow(
        schema,
        { raw: { app: { title: 'crm' }, typo: 1 }, source: 'test' },
        {
          name: 'public',
          knownKeys: ['app', 'flag'],
          unknownKeys: 'strict',
        },
      ),
    ).toThrow(
      "Unknown top-level config keys for 'public' (loaded from test): typo",
    )
  })
})

describe('parseOrThrow', () => {
  test('warns about unknown keys in warn mode', () => {
    const warn = vi.fn()
    parseOrThrow(
      z.object({ a: z.number() }),
      { raw: { a: 1, b: 2 }, source: 'test' },
      {
        knownKeys: ['a'],
        unknownKeys: 'warn',
        warn,
      },
    )
    expect(warn).toHaveBeenCalledWith(
      'Unknown top-level config keys (loaded from test): b',
    )
  })

  test('ignores unknown keys by default', () => {
    expect(
      parseOrThrow(
        z.object({ a: z.number() }),
        { raw: { a: 1, b: 2 }, source: 'test' },
        {
          knownKeys: ['a'],
        },
      ),
    ).toEqual({ a: 1 })
  })

  test('rejects asynchronous validation', () => {
    const schema = z.object({ a: z.string().refine(async () => true) })
    expect(() =>
      parseOrThrow(
        schema,
        { raw: { a: 'x' }, source: 'test' },
        { name: 'build' },
      ),
    ).toThrow(
      "Config for 'build': the schema validates asynchronously, config-kit needs a synchronous result",
    )
  })

  test('formats non-identifier keys and array indices', () => {
    const schema = z.object({ 'x-header': z.array(z.string()) })
    expect(() =>
      parseOrThrow(schema, { raw: { 'x-header': ['a', 1] }, source: 'test' }),
    ).toThrow(/→ at \["x-header"\]\[1\]$/)
  })
})

describe('topLevelKeys', () => {
  test('explains a schema without JSON Schema support', () => {
    expect(() => topLevelKeys(v.object({ a: v.string() }), 'public')).toThrow(
      "'public': checking unknown keys needs a schema with ~standard.jsonSchema",
    )
  })

  test('skips schemas that take arbitrary keys', () => {
    expect(topLevelKeys(z.looseObject({ a: z.string() }), 'public')).toBe(
      undefined,
    )
  })

  test('follows $ref to a named definition', () => {
    const schema = z.object({ a: z.string() }).meta({ id: 'named' })
    expect(topLevelKeys(schema, 'public')).toEqual(['a'])
  })
})

describe('objectProperties', () => {
  test('merges the properties of union variants', () => {
    const schema = z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('a'), left: z.string() }),
      z.object({ kind: z.literal('b'), right: z.string() }),
    ])
    expect(topLevelKeys(schema, 'public')?.sort()).toEqual([
      'kind',
      'left',
      'right',
    ])
  })

  test('finds nested object properties through optional and nullable', () => {
    const schema = z.object({
      nested: z.object({ token: z.string().optional() }).nullable(),
    })
    const root = jsonSchemaOf(schema, JsonSchemaIo.Output)!
    const nested = objectProperties(root)?.nested
    expect(Object.keys(objectProperties(nested!, root) ?? {})).toEqual([
      'token',
    ])
  })
})
