import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import * as v from 'valibot'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import z from 'zod'

import type { ConfigKitDefinition, ConfigKitSchemas } from '../core'
import { resolveSettings } from './config-file'
import { createDevReader, loadBuildConfig } from './dev-reader'

const schemas = { public: z.looseObject({}) }

function devReader(
  extra: Partial<ConfigKitSchemas> = {},
  options: Omit<ConfigKitDefinition, 'schemas'> = {},
) {
  return createDevReader(
    resolveSettings({ schemas: { ...schemas, ...extra }, ...options }),
    root,
  )
}

let root: string

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'dev-reader-')))
  writeFileSync(
    join(root, 'config.yaml'),
    'public:\n  a: 1\nprivate:\n  secret: s\n',
  )
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(root, { recursive: true, force: true })
})

describe('createDevReader', () => {
  test('watches config.yaml at the root before it exists', () => {
    rmSync(join(root, 'config.yaml'))
    expect(devReader().watchedFiles).toEqual([
      join(root, 'config.yaml'),
      join(root, 'config.local.yaml'),
    ])
  })

  test('applies the overlay file from the overlay env var last', () => {
    writeFileSync(join(root, 'config.local.yaml'), 'public:\n  a: 2\n')
    writeFileSync(join(root, 'config.dev-local.yaml'), 'public:\n  a: 3\n')
    vi.stubEnv('APP_CONFIG_OVERLAY', 'config.dev-local.yaml')
    const reader = devReader()
    expect(reader.load().public.raw).toEqual({ a: 3 })
    expect(reader.watchedFiles).toContain(join(root, 'config.dev-local.yaml'))
  })

  test('localYamlFile: false ignores config.local.yaml', () => {
    writeFileSync(join(root, 'config.local.yaml'), 'public:\n  a: 2\n')
    const reader = devReader({}, { dev: { localYamlFile: false } })
    expect(reader.load().public.raw).toEqual({ a: 1 })
    expect(reader.watchedFiles).toEqual([join(root, 'config.yaml')])
  })

  test('deep merges private over public for the server view', () => {
    writeFileSync(
      join(root, 'config.yaml'),
      'public:\n  db:\n    host: h\nprivate:\n  db:\n    password: p\n',
    )
    expect(devReader().load().server.raw).toEqual({
      db: { host: 'h', password: 'p' },
    })
  })

  test('attributes server schema errors to the private source', () => {
    vi.stubEnv('APP_PRIVATE_CONFIG', JSON.stringify({ secret: 1 }))
    const reader = devReader({ server: z.object({ secret: z.string() }) })
    expect(() => reader.load()).toThrow(
      /loaded from file .*config\.yaml \(public\) \+ env APP_PRIVATE_CONFIG\)/,
    )
  })

  test('attributes server schema errors to public alone without private', () => {
    writeFileSync(join(root, 'config.yaml'), 'public:\n  secret: 1\n')
    const reader = devReader({ server: z.object({ secret: z.string() }) })
    expect(() => reader.load()).toThrow(/\(public\)\):\n/)
  })

  test('throws when no public config is found', () => {
    rmSync(join(root, 'config.yaml'))
    expect(() => devReader().load()).toThrow(
      /^Config not found in first non-empty of \[env APP_PUBLIC_CONFIG, merge of \[.*\] \(public\)\]/,
    )
  })

  test('rejects unknown sections', () => {
    writeFileSync(
      join(root, 'config.yaml'),
      'public:\n  a: 1\nenv:\n  VITE_FLAG: true\n',
    )
    expect(() => devReader().load()).toThrow(
      /Unknown sections in .*: env \(expected public, private, build\)/,
    )
  })
})

describe('build section', () => {
  const buildSchema = z.object({
    msw: z.boolean().default(false),
    token: z.string().optional(),
  })

  test('is parsed with buildSchema defaults', () => {
    writeFileSync(
      join(root, 'config.yaml'),
      'public:\n  a: 1\nbuild:\n  token: t\n',
    )
    const state = devReader({ build: buildSchema }).load()
    expect(state.buildConfig).toEqual({ msw: false, token: 't' })
  })

  test('defaults apply without the section', () => {
    const state = devReader({ build: buildSchema }).load()
    expect(state.buildConfig).toEqual({ msw: false })
  })

  test('build env var wins over yaml', () => {
    writeFileSync(
      join(root, 'config.yaml'),
      'public:\n  a: 1\nbuild:\n  msw: false\n',
    )
    vi.stubEnv('APP_BUILD_CONFIG', JSON.stringify({ msw: true }))
    const state = devReader({ build: buildSchema }).load()
    expect(state.buildConfig).toEqual({ msw: true })
  })

  test('requires buildSchema when the section is present', () => {
    writeFileSync(
      join(root, 'config.yaml'),
      'public:\n  a: 1\nbuild:\n  msw: true\n',
    )
    expect(() => devReader().load()).toThrow(/defines no schemas.build/)
  })

  test('loadBuildConfig reads only the build env var', () => {
    const settings = resolveSettings({
      schemas: { ...schemas, build: buildSchema },
    })
    expect(loadBuildConfig(settings)).toEqual({ msw: false })
    vi.stubEnv('APP_BUILD_CONFIG', JSON.stringify({ msw: 'yes' }))
    expect(() => loadBuildConfig(settings)).toThrow(
      /loaded from env APP_BUILD_CONFIG/,
    )
  })

  test('loadBuildConfig rejects set sensitive values', () => {
    const settings = resolveSettings({
      schemas: { ...schemas, build: buildSchema },
      sensitive: ['build.token'],
    })
    vi.stubEnv('APP_BUILD_CONFIG', JSON.stringify({ token: 't' }))
    expect(() => loadBuildConfig(settings)).toThrow(
      /^Sensitive build config is set in env APP_BUILD_CONFIG: build\.token/,
    )
  })
})

describe('unknown keys', () => {
  const strictPublic = { public: z.object({ a: z.number() }) }

  test('are rejected in every section by default', () => {
    writeFileSync(join(root, 'config.yaml'), 'public:\n  a: 1\n  typo: 2\n')
    expect(() => devReader(strictPublic).load()).toThrow(
      "Unknown top-level config keys for 'public'",
    )
  })

  test('private keys unknown to the server schema are rejected', () => {
    expect(() => devReader(strictPublic).load()).toThrow(
      /Unknown top-level config keys for 'server' .*: secret/,
    )
  })

  test('warn mode logs and continues', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(
      devReader(strictPublic, { unknownKeys: 'warn' }).load().public.raw,
    ).toEqual({
      a: 1,
    })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(': secret'))
  })

  test('ignore mode needs no JSON Schema', () => {
    const settings = resolveSettings({
      schemas: { public: v.object({ a: v.number() }) },
      unknownKeys: 'ignore',
    })
    expect(createDevReader(settings, root).load().public.raw).toEqual({ a: 1 })
  })
})

describe('resolveSettings', () => {
  test('rejects sensitive paths outside build', () => {
    expect(() =>
      resolveSettings({
        schemas: { ...schemas, build: z.object({}) },
        sensitive: ['public.token' as 'build.token'],
      }),
    ).toThrow(/sensitive paths must be under build.*: public\.token/)
  })

  test('requires a JSON Schema for unknown key checks', () => {
    expect(() =>
      resolveSettings({ schemas: { public: v.object({ a: v.number() }) } }),
    ).toThrow(
      "'public': checking unknown keys needs a schema with ~standard.jsonSchema",
    )
  })
})
