import path from 'node:path'

import {
  createSyncConfigLoader,
  firstNonEmpty,
  mergeAll,
  type SyncConfigSource,
} from '@senate/config-core'
import {
  createFileSource,
  createProcessEnvSource,
  yamlParser,
} from '@senate/config-node'
import { findUpSync } from 'find-up'
import type { ZodType, z } from 'zod'

export type DevConfigOptions = {
  schema?: ZodType
  serverSchema?: ZodType
  publicEnvVar?: string
  privateEnvVar?: string
  yamlFile?: string
  yamlPath?: string
  localYamlFile?: string
}

export type DevState = {
  public: unknown
  server: unknown
  env: Record<string, string>
  origin: string
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function section(source: SyncConfigSource, key: string): SyncConfigSource {
  return {
    loadSync() {
      const value = source.loadSync()
      return isPlainObject(value) ? value[key] : undefined
    },
    describe: () => `${source.describe()} (${key})`,
  }
}

function stringifyEnv(value: unknown): Record<string, string> {
  if (!isPlainObject(value)) return {}
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([key, v]) => [
        key,
        typeof v === 'object' ? JSON.stringify(v) : String(v),
      ]),
  )
}

export function parseConfig<S extends ZodType>(
  schema: S,
  raw: unknown,
  origin: string,
): z.output<S> {
  const loader = createSyncConfigLoader({
    loadSync: () => raw,
    describe: () => origin,
  })
  const config = loader.defineConfig(schema)
  loader.validateAll()
  return config
}

export function createDevReader(options: DevConfigOptions, root: string) {
  const publicEnvVar = options.publicEnvVar ?? 'APP_PUBLIC_CONFIG'
  const privateEnvVar = options.privateEnvVar ?? 'APP_PRIVATE_CONFIG'
  const yamlPath = options.yamlPath
    ? path.resolve(root, options.yamlPath)
    : findUpSync(options.yamlFile ?? 'config.yaml', { cwd: root })
  const localYamlPath = path.resolve(
    yamlPath ? path.dirname(yamlPath) : root,
    options.localYamlFile ?? 'config.local.yaml',
  )
  const yaml = mergeAll([
    ...(yamlPath
      ? [createFileSource({ path: yamlPath, parser: yamlParser })]
      : []),
    createFileSource({ path: localYamlPath, parser: yamlParser }),
  ])

  function load(): DevState {
    const publicSource = firstNonEmpty([
      createProcessEnvSource({ envVar: publicEnvVar }),
      section(yaml, 'public'),
    ])
    const publicRaw = publicSource.loadSync()
    const origin = publicSource.describe()
    if (options.schema) parseConfig(options.schema, publicRaw, origin)

    const privateRaw =
      createProcessEnvSource({ envVar: privateEnvVar }).loadSync() ??
      section(yaml, 'private').loadSync()
    const serverRaw = { ...(publicRaw as object), ...(privateRaw as object) }
    if (options.serverSchema) {
      parseConfig(options.serverSchema, serverRaw, origin)
    }

    return {
      public: publicRaw,
      server: serverRaw,
      env: stringifyEnv(section(yaml, 'env').loadSync()),
      origin,
    }
  }

  return {
    load,
    watchedFiles: [...(yamlPath ? [yamlPath] : []), localYamlPath],
  }
}

export function loadDevConfig<S extends ZodType>(
  options: DevConfigOptions & { serverSchema: S; root?: string },
): z.output<S> {
  const state = createDevReader(options, options.root ?? process.cwd()).load()
  return parseConfig(options.serverSchema, state.server, state.origin)
}
