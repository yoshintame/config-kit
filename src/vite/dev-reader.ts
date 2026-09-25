import path from 'node:path'

import { isNil, isPlainObject, mapValues, omitBy } from 'es-toolkit'
import { findUpSync } from 'find-up'
import type { ZodType, z } from 'zod'

import {
  deepMerge,
  mergeAll,
  parseOrThrow,
  type SyncConfigSource,
} from '../core'
import { createFileSource, createProcessEnvSource, yamlParser } from '../node'
import { OVERLAY_ENV_VAR, PRIVATE_ENV_VAR, PUBLIC_ENV_VAR } from './constants'

export interface DevConfigOptions {
  schema?: ZodType
  serverSchema?: ZodType
  publicEnvVar?: string
  privateEnvVar?: string
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
  env: Record<string, string>
}

export interface DevReader {
  load(): DevState
  watchedFiles: string[]
}

export function loadDevConfig<S extends ZodType>({
  root = process.cwd(),
  ...options
}: DevConfigOptions & { serverSchema: S; root?: string }): z.output<S> {
  return createDevReader(options, root).load().serverConfig as z.output<S>
}

export function createDevReader(
  {
    schema,
    serverSchema,
    publicEnvVar = PUBLIC_ENV_VAR,
    privateEnvVar = PRIVATE_ENV_VAR,
    yamlFile = 'config.yaml',
    yamlPath,
    localYamlFile = 'config.local.yaml',
    overlayEnvVar = OVERLAY_ENV_VAR,
  }: DevConfigOptions,
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

  function load(): DevState {
    const document = yaml.loadSync()
    const sections = isPlainObject(document) ? document : {}
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
    if (schema) parseOrThrow(schema, publicConfig.raw, publicConfig.origin)

    const privateConfig = fromEnvOr(privateEnv, inYaml('private'))
    const server: LoadedConfig =
      privateConfig.raw === undefined
        ? publicConfig
        : {
            raw: deepMerge(publicConfig.raw, privateConfig.raw),
            origin: `${publicConfig.origin} + ${privateConfig.origin}`,
          }

    return {
      public: publicConfig,
      server,
      serverConfig: serverSchema
        ? parseOrThrow(serverSchema, server.raw, server.origin)
        : server.raw,
      env: stringifyEnv(sections.env),
    }
  }

  return { load, watchedFiles }
}

function fromEnvOr(
  env: SyncConfigSource,
  fallback: LoadedConfig,
): LoadedConfig {
  const raw = env.loadSync()
  return raw === undefined ? fallback : { raw, origin: env.describe() }
}

function stringifyEnv(value: unknown): Record<string, string> {
  return isPlainObject(value)
    ? mapValues(omitBy(value, isNil), (entry) =>
        typeof entry === 'object' ? JSON.stringify(entry) : String(entry),
      )
    : {}
}
