import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { jsonParser } from '@senate/config-core'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import z from 'zod'

import {
  createFileSource,
  createProcessEnvSource,
  createYamlConfigLoader,
  createYamlEnvSource,
  yamlParser,
} from '.'

const ENV_VAR = 'TEST_CONFIG_LOADER_VAR'
const YAML_FILE = 'test-loader.config.yaml'

let tmpDir: string
let yamlPath: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'config-loader-'))
  yamlPath = join(tmpDir, YAML_FILE)
  delete process.env[ENV_VAR]
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(tmpDir, { recursive: true, force: true })
  delete process.env[ENV_VAR]
})

describe('createProcessEnvSource', () => {
  test('parses JSON by default', () => {
    process.env[ENV_VAR] = '{"a":1}'
    expect(createProcessEnvSource({ envVar: ENV_VAR }).loadSync()).toEqual({
      a: 1,
    })
  })

  test('returns undefined when unset or empty', () => {
    const source = createProcessEnvSource({ envVar: ENV_VAR })
    expect(source.loadSync()).toBeUndefined()
    process.env[ENV_VAR] = ''
    expect(source.loadSync()).toBeUndefined()
  })

  test('uses custom parser', () => {
    process.env[ENV_VAR] = 'a: 1'
    const source = createProcessEnvSource({
      envVar: ENV_VAR,
      parser: yamlParser,
    })
    expect(source.loadSync()).toEqual({ a: 1 })
  })

  test('throws with origin on parse failure', () => {
    process.env[ENV_VAR] = 'not-json'
    expect(() =>
      createProcessEnvSource({ envVar: ENV_VAR }).loadSync(),
    ).toThrow(`Failed to parse env ${ENV_VAR}`)
  })
})

describe('createFileSource', () => {
  test('reads and parses file', () => {
    const path = join(tmpDir, 'config.json')
    writeFileSync(path, '{"a":1}')
    const source = createFileSource({ path, parser: jsonParser })
    expect(source.loadSync()).toEqual({ a: 1 })
    expect(source.describe()).toBe(`file ${path}`)
  })

  test('returns undefined for missing file', () => {
    const source = createFileSource({
      path: join(tmpDir, 'missing.yaml'),
      parser: yamlParser,
    })
    expect(source.loadSync()).toBeUndefined()
  })

  test('throws with origin on parse failure', () => {
    writeFileSync(yamlPath, 'a: [')
    const source = createFileSource({ path: yamlPath, parser: yamlParser })
    expect(() => source.loadSync()).toThrow(`Failed to parse file ${yamlPath}`)
  })
})

describe('createYamlEnvSource', () => {
  test('loads yaml via explicit yamlPath', () => {
    writeFileSync(yamlPath, 'db:\n  host: 127.0.0.1\n  port: 5432\n')
    const source = createYamlEnvSource({
      envVar: ENV_VAR,
      yamlFile: YAML_FILE,
      yamlPath,
    })
    expect(source.loadSync()).toEqual({ db: { host: '127.0.0.1', port: 5432 } })
  })

  test('env variable wins over yaml', () => {
    writeFileSync(yamlPath, 'db:\n  host: from-yaml\n')
    process.env[ENV_VAR] = JSON.stringify({ db: { host: 'from-env' } })
    const source = createYamlEnvSource({
      envVar: ENV_VAR,
      yamlFile: YAML_FILE,
      yamlPath,
    })
    expect(source.loadSync()).toEqual({ db: { host: 'from-env' } })
    expect(source.describe()).toBe(`env ${ENV_VAR}`)
  })

  test('finds yaml up from cwd', () => {
    writeFileSync(yamlPath, 'a: 1\n')
    const nested = join(tmpDir, 'nested', 'deeper')
    mkdirSync(nested, { recursive: true })
    vi.spyOn(process, 'cwd').mockReturnValue(nested)
    const source = createYamlEnvSource({ envVar: ENV_VAR, yamlFile: YAML_FILE })
    expect(source.loadSync()).toEqual({ a: 1 })
    expect(source.describe()).toBe(`file ${yamlPath}`)
  })

  test('reports the search location when yaml is not found up the tree', () => {
    vi.spyOn(process, 'cwd').mockReturnValue(tmpDir)
    const source = createYamlEnvSource({ envVar: ENV_VAR, yamlFile: YAML_FILE })
    expect(() => source.loadSync()).toThrow(
      `Config not found in any source: env ${ENV_VAR}, file ${YAML_FILE} (searched up from ${tmpDir})`,
    )
  })

  test('throws when neither env nor yaml available', () => {
    const missing = join(tmpDir, 'does-not-exist.yaml')
    const source = createYamlEnvSource({
      envVar: ENV_VAR,
      yamlFile: YAML_FILE,
      yamlPath: missing,
    })
    expect(() => source.loadSync()).toThrow(
      `Config not found in any source: env ${ENV_VAR}, file ${missing}`,
    )
  })
})

describe('createYamlConfigLoader', () => {
  test('validates yaml section and reports file origin', () => {
    writeFileSync(yamlPath, 'db:\n  host: 1\n')
    const loader = createYamlConfigLoader({
      envVar: ENV_VAR,
      yamlFile: YAML_FILE,
      yamlPath,
    })
    const config = loader.defineConfig(
      z.object({ db: z.object({ host: z.string() }) }).meta({ id: 'db' }),
    )
    expect(() => config.db).toThrow(
      `Config validation failed for schema 'db' (loaded from file ${yamlPath})`,
    )
  })

  test('reset rereads the file', () => {
    writeFileSync(yamlPath, 'a: 1\n')
    const loader = createYamlConfigLoader({
      envVar: ENV_VAR,
      yamlFile: YAML_FILE,
      yamlPath,
    })
    const config = loader.defineConfig(z.object({ a: z.number() }))
    expect(config.a).toBe(1)

    writeFileSync(yamlPath, 'a: 99\n')
    expect(config.a).toBe(1)

    loader.reset()
    expect(config.a).toBe(99)
  })
})
