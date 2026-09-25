import { expect, test } from 'vitest'
import z from 'zod'

import { renderEnvDts } from './env-dts'

test('renders ImportMetaEnv from build env schema', () => {
  const schema = z.object({
    VITE_API_URL: z.url(),
    VITE_DEBUG: z.stringbool().default(false),
    VITE_PORT: z.coerce.number(),
    VITE_MODE: z.enum(['a', 'b']),
    VITE_OPTIONAL: z.string().optional(),
  })
  expect(renderEnvDts(schema)).toBe(
    [
      'interface ImportMetaEnv {',
      '  readonly VITE_API_URL: string',
      '  readonly VITE_DEBUG: boolean',
      '  readonly VITE_PORT: number',
      '  readonly VITE_MODE: "a" | "b"',
      '  readonly VITE_OPTIONAL?: string',
      '}',
      '',
      'interface ImportMeta {',
      '  readonly env: ImportMetaEnv',
      '}',
      '',
    ].join('\n'),
  )
})

test('renders literals, unions, nullables, integers and unknowns', () => {
  const schema = z.object({
    VITE_CONST: z.literal('fixed'),
    VITE_UNION: z.union([z.literal('a'), z.number()]),
    VITE_NULLABLE: z.string().nullable(),
    VITE_INT: z.int(),
    VITE_ANY: z.any(),
  })
  expect(renderEnvDts(schema)).toContain(
    [
      '  readonly VITE_CONST: "fixed"',
      '  readonly VITE_UNION: "a" | number',
      '  readonly VITE_NULLABLE: string | null',
      '  readonly VITE_INT: number',
      '  readonly VITE_ANY: unknown',
    ].join('\n'),
  )
})

test('marks every field optional when nothing is required', () => {
  expect(renderEnvDts(z.object({ VITE_A: z.string().optional() }))).toContain(
    '  readonly VITE_A?: string',
  )
})
