import { parseAst } from 'vite'
import { describe, expect, test, vi } from 'vitest'

import { splitConfigModule, transformConfigFile } from './client-split'

function split(code: string, keepOnInvalid = true) {
  return splitConfigModule(code, parseAst(code), { keepOnInvalid })?.code
}

const CONFIG = [
  "import { defineConfigKit } from '@yoshintame/config-kit'",
  "import { z } from 'zod'",
  'const publicSchema = z.object({ a: z.string() })',
  'const serverSchema = publicSchema.extend({ secret: z.string() })',
  'export default defineConfigKit({',
  '  schemas: { public: publicSchema, server: serverSchema },',
  "  onInvalid(error) { console.log('HANDLER') },",
  "  dev: { serverRestart: ['DEV'] },",
  "  sensitive: ['build.token'],",
  '})',
].join('\n')

describe('splitConfigModule', () => {
  test('keeps the public schema and onInvalid', () => {
    expect(split(CONFIG)).toContain(
      "export default defineConfigKit({schemas: {public: publicSchema}, onInvalid(error) { console.log('HANDLER') }})",
    )
  })

  test('drops onInvalid for the validator', () => {
    expect(split(CONFIG, false)).toContain(
      'export default defineConfigKit({schemas: {public: publicSchema}})',
    )
  })

  test('marks top-level initializers as pure', () => {
    expect(split(CONFIG)).toContain(
      'const serverSchema = /*#__PURE__*/(() => (publicSchema.extend({ secret: z.string() })))()',
    )
  })

  test('follows a default-exported identifier', () => {
    const code = [
      'const config = defineConfigKit({ schemas: { public: p, server: s } })',
      'export default config',
    ].join('\n')
    expect(split(code)).toContain('{schemas: {public: p}}')
  })

  test('leaves initializers with top-level await alone', () => {
    const code = [
      'const p = await load()',
      'export default { schemas: { public: p } }',
    ].join('\n')
    expect(split(code)).toContain('const p = await load()')
  })

  test.each([
    ['spread', 'export default { ...base, schemas: { public: p } }'],
    ['schemas variable', 'export default { schemas }'],
    ['computed key', "export default { ['schemas']: { public: p } }"],
    ['no default export', 'export const config = {}'],
  ])('gives up on a %s', (_, code) => {
    expect(split(code)).toBeUndefined()
  })

  test('transformConfigFile warns when it cannot split', () => {
    const warn = vi.fn()
    transformConfigFile(
      { parse: parseAst, warn },
      'export default { schemas }',
      {
        keepOnInvalid: true,
      },
    )
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('could not split the config file'),
    )
  })
})
