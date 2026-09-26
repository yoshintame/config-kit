import { describe, expect, test, vi } from 'vitest'
import z from 'zod'

import {
  createInMemorySource,
  createSyncConfigLoader,
  type InMemorySource,
  type SyncConfigLoader,
} from '../core'
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

interface DevExports {
  source: InMemorySource
  loader: SyncConfigLoader
  publicConfig: { a: number }
}

const schema = z.object({ a: z.number() })
const target = {
  kind: 'public' as const,
  schemaFile: '/app/src/schema.ts',
  schemaExport: 'publicSchema',
}

function runDevModule(code: string, hot: HotStub | undefined): DevExports {
  const body = code
    .replace(/^import .*$/gm, '')
    .replaceAll('import.meta.hot', 'hot')
    .replaceAll('export const', 'const')
  return new Function(
    'createInMemorySource',
    'createSyncConfigLoader',
    'schema',
    'hot',
    `${body}\nreturn { source, loader, publicConfig }`,
  )(createInMemorySource, createSyncConfigLoader, schema, hot)
}

describe('devModule', () => {
  test('imports the schema export from the schema module', () => {
    const code = devModule({
      ...target,
      loaded: { raw: {}, origin: 'yaml' },
      hmr: false,
    })
    expect(code).toContain(
      'import { publicSchema as schema } from "/app/src/schema.ts"',
    )
    expect(code).not.toContain('import.meta.hot')
  })

  test('exposes a validated config over the yaml value', () => {
    const { publicConfig, source } = runDevModule(
      devModule({
        ...target,
        loaded: { raw: { a: 1 }, origin: 'file x' },
        hmr: false,
      }),
      undefined,
    )
    expect(publicConfig.a).toBe(1)
    expect(source.describe()).toBe('file x')
  })

  test('with hmr keeps one loader across updates and pushes the new value', () => {
    const hot: HotStub = { data: {}, accept: vi.fn() }
    const first = runDevModule(
      devModule({
        ...target,
        loaded: { raw: { a: 1 }, origin: 'y' },
        hmr: true,
      }),
      hot,
    )
    const onChange = vi.fn()
    first.loader.onChange(onChange)
    expect(first.publicConfig.a).toBe(1)

    const second = runDevModule(
      devModule({
        ...target,
        loaded: { raw: { a: 2 }, origin: 'y' },
        hmr: true,
      }),
      hot,
    )

    expect(second.loader).toBe(first.loader)
    expect(first.publicConfig.a).toBe(2)
    expect(onChange).toHaveBeenCalledOnce()
    expect(hot.accept).toHaveBeenCalledTimes(2)
  })
})

describe('buildModule', () => {
  const names = {
    elementId: 'cfg',
    publicEnvVar: 'PUB',
    privateEnvVar: 'PRIV',
  }

  test('client public module reads the JSON script', () => {
    const code = buildModule({ ...target, ssr: false, ...names })
    expect(code).toContain('createJsonScriptSource({ elementId: "cfg" })')
    expect(code).toContain(
      'export const publicConfig = loader.defineConfig(schema)',
    )
  })

  test('ssr public module reads the public env var', () => {
    expect(buildModule({ ...target, ssr: true, ...names })).toContain(
      'createProcessEnvSource({ envVar: "PUB" })',
    )
  })

  test('server module merges both env vars', () => {
    const code = buildModule({
      ...target,
      kind: 'server',
      schemaExport: 'serverSchema',
      ssr: true,
      ...names,
    })
    expect(code).toContain(
      'mergeAll([createProcessEnvSource({ envVar: "PUB" }), createProcessEnvSource({ envVar: "PRIV" })])',
    )
    expect(code).toContain('import { serverSchema as schema }')
    expect(code).toContain('export const serverConfig')
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
    expect(buildConfigModule({ msw: true, nested: {} }, schema)).toBe(
      'export const buildConfig = {"msw":true,"nested":{"actAs":undefined},"token":undefined}',
    )
  })
})

test('validatorModule checks the public env var', () => {
  const code = validatorModule({ schemaFile: '/s.ts', envVar: 'PUB' })
  expect(code).toContain('const envVar = "PUB"')
  expect(code).toContain('loader.assertOnlyKnownTopKeys()')
})
