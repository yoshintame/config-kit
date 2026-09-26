import { describe, expect, test, vi } from 'vitest'
import z from 'zod'

import { resolvePublicConfig } from '../browser'
import { liveView, parseOrThrow } from '../core'
import { jsonSchemaOf } from '../core/standard-schema'
import { resolveSettings } from './config-file'
import {
  buildConfigModule,
  buildModule,
  devModule,
  validatorModule,
} from './virtual-modules'

interface HotStub {
  data: Record<string, unknown>
  accept: () => void
}

const definition = {
  schemas: {
    public: z.object({ a: z.number(), flag: z.boolean().default(false) }),
    server: z.object({
      a: z.number(),
      url: z.string().transform((url) => url.toUpperCase()),
    }),
  },
}
const settings = resolveSettings(definition)
const target = { configFile: '/app/config-kit.config.ts', settings }

function runModule(code: string, hot?: HotStub): Record<string, unknown> {
  const exported = [...code.matchAll(/^export const (\w+)/gm)].map(
    (match) => match[1],
  )
  const body = code
    .replace(/^import .*$/gm, '')
    .replaceAll('import.meta.hot', 'hot')
    .replaceAll('export const', 'const')
  return new Function(
    'config',
    'resolvePublicConfig',
    'parseOrThrow',
    'liveView',
    'hot',
    `${body}\nreturn { ${exported.join(', ')} }`,
  )(definition, resolvePublicConfig, parseOrThrow, liveView, hot)
}

describe('devModule', () => {
  test('imports the config file and validates the public section', () => {
    const code = devModule({
      ...target,
      kind: 'public',
      loaded: { raw: { a: 1 }, origin: 'yaml' },
      hmr: false,
    })
    expect(code).toContain('import config from "/app/config-kit.config.ts"')
    expect(code).not.toContain('import.meta.hot')
    expect(runModule(code).publicConfig).toEqual({ a: 1, flag: false })
  })

  test('validates the server section with the server schema', () => {
    const code = devModule({
      ...target,
      kind: 'server',
      loaded: { raw: { a: 1, url: 'x' }, origin: 'yaml' },
      hmr: false,
    })
    expect(runModule(code).serverConfig).toEqual({ a: 1, url: 'X' })
  })

  test('with hmr keeps one live view across updates', () => {
    const hot: HotStub = { data: {}, accept: vi.fn() }
    const first = runModule(
      devModule({
        ...target,
        kind: 'public',
        loaded: { raw: { a: 1 }, origin: 'yaml' },
        hmr: true,
      }),
      hot,
    ).publicConfig as { a: number }
    runModule(
      devModule({
        ...target,
        kind: 'public',
        loaded: { raw: { a: 2 }, origin: 'yaml' },
        hmr: true,
      }),
      hot,
    )
    expect(first.a).toBe(2)
    expect(hot.accept).toHaveBeenCalledTimes(2)
  })
})

describe('buildModule', () => {
  test('client public module reads the JSON script', () => {
    const code = buildModule({ ...target, kind: 'public', ssr: false })
    expect(code).toContain(
      'read: () => readConfigScript("__CONFIG__", "APP_PUBLIC_CONFIG")',
    )
    expect(code).toContain('knownKeys: ["a","flag"], unknownKeys: "strict"')
  })

  test('ssr public module reads the public env var', () => {
    const code = buildModule({ ...target, kind: 'public', ssr: true })
    expect(code).toContain(
      'resolveEnvConfig({ schema: config.schemas.public, name: "public", envVar: "APP_PUBLIC_CONFIG"',
    )
  })

  test('server module layers the private env var over the public one', () => {
    const code = buildModule({ ...target, kind: 'server', ssr: true })
    expect(code).toContain(
      'envVar: "APP_PUBLIC_CONFIG", overlayEnvVar: "APP_PRIVATE_CONFIG"',
    )
    expect(code).toContain('export const serverConfig')
  })

  test('omits key checks when unknown keys are ignored', () => {
    const code = buildModule({
      ...target,
      settings: resolveSettings({ ...definition, unknownKeys: 'ignore' }),
      kind: 'public',
      ssr: false,
    })
    expect(code).not.toContain('knownKeys')
  })
})

describe('buildConfigModule', () => {
  test('inlines the value', () => {
    expect(buildConfigModule({ msw: false }, undefined)).toBe(
      'export const buildConfig = {"msw":false}',
    )
  })

  test('spells out absent optional fields from the schema shape', () => {
    const schema = z.object({
      msw: z.boolean(),
      token: z.string().optional(),
      nested: z.object({ actAs: z.string().optional() }).prefault({}),
    })
    expect(
      buildConfigModule(
        { msw: true, nested: {} },
        jsonSchemaOf(schema, 'output'),
      ),
    ).toBe(
      'export const buildConfig = {"msw":true,"nested":{"actAs":undefined},"token":undefined}',
    )
  })
})

test('validatorModule checks the public env var', () => {
  const code = validatorModule(target)
  expect(code).toContain('envVar: "APP_PUBLIC_CONFIG"')
  expect(code).toContain('knownKeys: ["a","flag"]')
  expect(code).toContain('process.exit(1)')
})
