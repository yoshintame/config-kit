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
