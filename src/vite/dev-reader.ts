import path from 'node:path'

import { isNil, isPlainObject } from 'es-toolkit'
import { findUpSync } from 'find-up'
import type { AliasOptions } from 'vite'
import type { ZodType } from 'zod'

import {
  deepMerge,
  mergeAll,
  parseOrThrow,
  type SyncConfigSource,
} from '../core'
import { createFileSource, createProcessEnvSource, yamlParser } from '../node'
import {
  BUILD_ENV_VAR,
  OVERLAY_ENV_VAR,
  PRIVATE_ENV_VAR,
  PUBLIC_ENV_VAR,
} from './constants'
import { importSchemaModule, type Schemas } from './schema-module'

export interface DevConfigOptions {
  publicEnvVar?: string
  privateEnvVar?: string
  buildEnvVar?: string
  yamlFile?: string
  yamlPath?: string
  localYamlFile?: string | false
  overlayEnvVar?: string
}

export interface LoadedConfig {
  raw: unknown
  origin: string
}

export interface DevState {
  public: LoadedConfig
  server: LoadedConfig
  serverConfig: unknown
  build: LoadedConfig
  buildConfig: unknown
}

export interface DevReader {
  load(): DevState
  watchedFiles: string[]
}

const SECTIONS = ['public', 'private', 'build']

export async function loadDevConfig<T = unknown>({
  schemaModule,
  root = process.cwd(),
  alias,
  ...options
}: DevConfigOptions & {
  schemaModule: string
  root?: string
  alias?: AliasOptions
}): Promise<T> {
  const { schemas } = await importSchemaModule({
    file: path.resolve(root, schemaModule),
    root,
    alias,
  })
  return createDevReader(options, schemas, root).load().serverConfig as T
}

export function createDevReader(
  {
    publicEnvVar = PUBLIC_ENV_VAR,
    privateEnvVar = PRIVATE_ENV_VAR,
    buildEnvVar = BUILD_ENV_VAR,
    yamlFile = 'config.yaml',
    yamlPath,
    localYamlFile = 'config.local.yaml',
    overlayEnvVar = OVERLAY_ENV_VAR,
  }: DevConfigOptions,
  { publicSchema, serverSchema, buildSchema }: Schemas,
  root: string,
): DevReader {
  const configPath = yamlPath
    ? path.resolve(root, yamlPath)
    : (findUpSync(yamlFile, { cwd: root }) ?? path.resolve(root, yamlFile))
  const overlays = [
    localYamlFile === false ? undefined : localYamlFile,
    process.env[overlayEnvVar],
  ]
    .filter((file) => !isNil(file))
    .map((file) => path.resolve(path.dirname(configPath), file))
  const watchedFiles = [configPath, ...overlays]
  const yaml = mergeAll(
    watchedFiles.map((file) =>
      createFileSource({ path: file, parser: yamlParser }),
    ),
  )
  const publicEnv = createProcessEnvSource({ envVar: publicEnvVar })
  const privateEnv = createProcessEnvSource({ envVar: privateEnvVar })
  const buildEnv = createProcessEnvSource({ envVar: buildEnvVar })

  function load(): DevState {
    const document = yaml.loadSync()
    const sections = isPlainObject(document) ? document : {}
    const unknown = Object.keys(sections).filter(
      (key) => !SECTIONS.includes(key),
    )
    if (unknown.length > 0) {
      throw new Error(
        `Unknown sections in ${yaml.describe()}: ${unknown.join(', ')} (expected ${SECTIONS.join(', ')})`,
      )
    }
    const inYaml = (key: string): LoadedConfig => ({
      raw: sections[key],
      origin: `${yaml.describe()} (${key})`,
    })

    const publicConfig = fromEnvOr(publicEnv, inYaml('public'))
    if (publicConfig.raw === undefined) {
      throw new Error(
        `Config not found in any source: ${publicEnv.describe()}, ${publicConfig.origin}`,
      )
    }
    parseOrThrow(publicSchema, publicConfig.raw, publicConfig.origin)

    const privateConfig = fromEnvOr(privateEnv, inYaml('private'))
    const server: LoadedConfig =
      privateConfig.raw === undefined
        ? publicConfig
        : {
            raw: deepMerge(publicConfig.raw, privateConfig.raw),
            origin: `${publicConfig.origin} + ${privateConfig.origin}`,
          }

    const build = fromEnvOr(buildEnv, inYaml('build'))

    return {
      public: publicConfig,
      server,
      serverConfig: parseOrThrow(
        serverSchema ?? publicSchema,
        server.raw,
        server.origin,
      ),
      build,
      buildConfig: parseBuildConfig(buildSchema, build),
    }
  }

  return { load, watchedFiles }
}

export function loadBuildConfig(
  schema: ZodType | undefined,
  envVar = BUILD_ENV_VAR,
): unknown {
  const env = createProcessEnvSource({ envVar })
  return parseBuildConfig(schema, {
    raw: env.loadSync(),
    origin: env.describe(),
  })
}

function parseBuildConfig(
  schema: ZodType | undefined,
  { raw, origin }: LoadedConfig,
): unknown {
  if (schema) return parseOrThrow(schema, raw ?? {}, origin)
  if (raw !== undefined) {
    throw new Error(
      `Build config found in ${origin}, but the schema module exports no 'buildSchema'`,
    )
  }
  return undefined
}

function fromEnvOr(
  env: SyncConfigSource,
  fallback: LoadedConfig,
): LoadedConfig {
  const raw = env.loadSync()
  return raw === undefined ? fallback : { raw, origin: env.describe() }
}
