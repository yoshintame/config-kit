import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import z from 'zod'

import { createDevReader } from './dev-reader'

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
    expect(createDevReader({}, root).watchedFiles).toEqual([
      join(root, 'config.yaml'),
      join(root, 'config.local.yaml'),
    ])
  })

  test('applies the overlay file from the overlay env var last', () => {
    writeFileSync(join(root, 'config.local.yaml'), 'public:\n  a: 2\n')
    writeFileSync(join(root, 'config.dev-local.yaml'), 'public:\n  a: 3\n')
    vi.stubEnv('APP_CONFIG_OVERLAY', 'config.dev-local.yaml')
    const reader = createDevReader({}, root)
    expect(reader.load().public.raw).toEqual({ a: 3 })
    expect(reader.watchedFiles).toContain(join(root, 'config.dev-local.yaml'))
  })

  test('localYamlFile: false ignores config.local.yaml', () => {
    writeFileSync(join(root, 'config.local.yaml'), 'public:\n  a: 2\n')
    const reader = createDevReader({ localYamlFile: false }, root)
    expect(reader.load().public.raw).toEqual({ a: 1 })
    expect(reader.watchedFiles).toEqual([join(root, 'config.yaml')])
  })

  test('deep merges private over public for the server view', () => {
    writeFileSync(
      join(root, 'config.yaml'),
      'public:\n  db:\n    host: h\nprivate:\n  db:\n    password: p\n',
    )
    expect(createDevReader({}, root).load().server.raw).toEqual({
      db: { host: 'h', password: 'p' },
    })
  })

  test('attributes server schema errors to the private source', () => {
    vi.stubEnv('APP_PRIVATE_CONFIG', JSON.stringify({ secret: 1 }))
    const reader = createDevReader(
      { serverSchema: z.object({ secret: z.string() }) },
      root,
    )
    expect(() => reader.load()).toThrow(
      /loaded from merge of \[.*\] \(public\) \+ env APP_PRIVATE_CONFIG/,
    )
  })

  test('attributes server schema errors to public alone without private', () => {
    writeFileSync(join(root, 'config.yaml'), 'public:\n  secret: 1\n')
    const reader = createDevReader(
      { serverSchema: z.object({ secret: z.string() }) },
      root,
    )
    expect(() => reader.load()).toThrow(/\(public\)\):\n/)
  })

  test('throws when no public config is found', () => {
    rmSync(join(root, 'config.yaml'))
    expect(() => createDevReader({}, root).load()).toThrow(
      /^Config not found in any source: env APP_PUBLIC_CONFIG, merge of/,
    )
  })
})
