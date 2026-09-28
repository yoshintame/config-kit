import { parseAst } from 'vite'
import { describe, expect, test, vi } from 'vitest'

import { splitConfigModule, transformConfigFile } from './client-split'

function split(code: string, keepOnInvalid = true) {
  return splitConfigModule(code, parseAst(code), { keepOnInvalid })?.code
}

const CONFIG = [
  "import { defineConfigKit } from '@yoshintame/config-kit'",
  "import { readFileSync } from 'node:fs'",
  "import { z } from 'zod'",
  "import { Env } from './env'",
  'const isTest = process.env.VITEST',
  'const publicSchema = z.object({ env: z.enum(Env) })',
  'const serverSchema = publicSchema.extend({ secret: z.string() })',
  'function renderScreen() { return "SCREEN" }',
  'export default defineConfigKit({',
  '  schemas: { public: publicSchema, server: serverSchema },',
  '  onInvalid(error) { renderScreen() },',
  "  dev: { localYamlFile: isTest ? false : readFileSync('x', 'utf8') },",
  "  sensitive: ['build.token'],",
  '})',
].join('\n')

describe('splitConfigModule', () => {
  test('keeps the public schema and onInvalid', () => {
    expect(split(CONFIG)).toContain(
      'export default defineConfigKit({schemas: {public: publicSchema}, onInvalid(error) { renderScreen() }})',
    )
  })

  test('drops onInvalid and what only it uses for the validator', () => {
    const code = split(CONFIG, false)
    expect(code).toContain(
      'export default defineConfigKit({schemas: {public: publicSchema}})',
    )
    expect(code).not.toContain('renderScreen')
  })

  test('removes declarations and imports nothing kept reaches', () => {
    const code = split(CONFIG)
    expect(code).not.toContain('serverSchema')
    expect(code).not.toContain('process.env')
    expect(code).not.toContain('node:fs')
    expect(code).toContain("import { z } from 'zod'")
    expect(code).toContain("import { Env } from './env'")
    expect(code).toContain('const publicSchema')
  })

  test('follows a default-exported identifier', () => {
    const code = [
      'const s = 1',
      'const p = 2',
      'const config = defineConfigKit({ schemas: { public: p, server: s } })',
      'export default config',
    ].join('\n')
    const result = split(code)
    expect(result).toContain('{schemas: {public: p}}')
    expect(result).not.toContain('const s')
  })

  test('keeps top-level statements and named exports', () => {
    const code = [
      'const registry = create()',
      'registry.add(1)',
      'export const shared = 2',
      'export default { schemas: { public: p } }',
    ].join('\n')
    const result = split(code)
    expect(result).toContain('const registry')
    expect(result).toContain('export const shared')
  })

  test.each([
    ['spread', 'export default { ...base, schemas: { public: p } }'],
    ['schemas variable', 'export default { schemas }'],
    ['computed key', "export default { ['schemas']: { public: p } }"],
    ['no default export', 'export const config = {}'],
  ])('gives up on a %s', (_, code) => {
    expect(split(code)).toBeUndefined()
  })
})

describe('transformConfigFile', () => {
  const base = {
    configPath: '/app/config-kit.config.ts',
    keepOnInvalid: true,
    skipSsr: true,
  }

  test('warns when it cannot split', () => {
    const warn = vi.fn()
    transformConfigFile(
      { parse: parseAst, warn },
      {
        ...base,
        code: 'export default { schemas }',
        id: '/app/config-kit.config.ts?v=1',
        ssr: false,
      },
    )
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('could not split the config file'),
    )
  })

  test.each([
    ['another file', '/app/other.ts', false],
    ['an SSR copy', '/app/config-kit.config.ts', true],
  ])('leaves %s alone', (_, id, ssr) => {
    expect(
      transformConfigFile(
        { parse: parseAst, warn: vi.fn() },
        { ...base, code: CONFIG, id, ssr },
      ),
    ).toBeUndefined()
  })
})
