import path from 'node:path'

import { isNil, isPlainObject } from 'es-toolkit'
import { get } from 'es-toolkit/compat'
import { findUpSync } from 'find-up'

import {
  type ConfigKitDefinition,
  type ConfigKitSchemas,
  deepMerge,
  mergeAll,
  parseOrThrow,
  type ServerConfigOf,
  type StandardSchemaV1,
  type SyncConfigSource,
} from '../core'
import { createFileSource, createProcessEnvSource, yamlParser } from '../node'
import {
  type ConfigKitSettings,
  resolveSettings,
  type Section,
} from './config-file'

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

export function loadDevConfig<S extends ConfigKitSchemas>(
  definition: ConfigKitDefinition<S>,
  { root = process.cwd() }: { root?: string } = {},
): ServerConfigOf<S> {
  return createDevReader(resolveSettings(definition), root).load()
    .serverConfig as ServerConfigOf<S>
}

export function createDevReader(
  settings: ConfigKitSettings,
  root: string,
  warn: (message: string) => void = console.warn,
): DevReader {
  const { yaml, watchedFiles } = yamlSource(settings, root)
  const { envVars } = settings
  const publicEnv = createProcessEnvSource({ envVar: envVars.public })
  const privateEnv = createProcessEnvSource({ envVar: envVars.private })
  const buildEnv = createProcessEnvSource({ envVar: envVars.build })
  const parse = sectionParser(settings, warn)
  const { schemas } = settings.definition

  function load(): DevState {
    const sections = yamlSections(yaml)
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
    parse('public', schemas.public, publicConfig)

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
      serverConfig: parse('server', schemas.server ?? schemas.public, server),
      build,
      buildConfig: parseBuildConfig(settings, build, parse),
    }
  }

  return { load, watchedFiles }
}

export function yamlSource(
  {
    dev: { yamlFile, yamlPath, localYamlFile, overlayEnvVar },
  }: ConfigKitSettings,
  root: string,
): { yaml: SyncConfigSource; watchedFiles: string[] } {
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
  return { yaml, watchedFiles }
}

export function yamlSections(yaml: SyncConfigSource): Record<string, unknown> {
  const document = yaml.loadSync()
  const sections = isPlainObject(document) ? document : {}
  const unknown = Object.keys(sections).filter((key) => !SECTIONS.includes(key))
  if (unknown.length > 0) {
    throw new Error(
      `Unknown sections in ${yaml.describe()}: ${unknown.join(', ')} (expected ${SECTIONS.join(', ')})`,
    )
  }
  return sections
}

type SectionParser = (
  section: Section,
  schema: StandardSchemaV1,
  loaded: LoadedConfig,
) => unknown

function sectionParser(
  settings: ConfigKitSettings,
  warn: (message: string) => void,
): SectionParser {
  return (section, schema, { raw, origin }) =>
    parseOrThrow(schema, raw, origin, {
      name: section,
      knownKeys: settings.knownKeys[section],
      unknownKeys: settings.unknownKeys,
      warn,
    })
}

export function loadBuildConfig(
  settings: ConfigKitSettings,
  warn: (message: string) => void = console.warn,
): unknown {
  const env = createProcessEnvSource({ envVar: settings.envVars.build })
  const loaded = { raw: env.loadSync(), origin: env.describe() }
  const buildConfig = parseBuildConfig(
    settings,
    loaded,
    sectionParser(settings, warn),
  )
  const leaked = settings.sensitive.filter(
    (entry) => get(buildConfig, entry.slice('build.'.length)) !== undefined,
  )
  if (leaked.length > 0) {
    throw new Error(
      `Sensitive build config is set in ${loaded.origin}: ${leaked.join(', ')}. Sensitive values are allowed only in vite serve, a build would inline them into the bundle`,
    )
  }
  return buildConfig
}

function parseBuildConfig(
  { definition: { schemas } }: ConfigKitSettings,
  loaded: LoadedConfig,
  parse: SectionParser,
): unknown {
  if (schemas.build)
    return parse('build', schemas.build, { ...loaded, raw: loaded.raw ?? {} })
  if (loaded.raw !== undefined) {
    throw new Error(
      `Build config found in ${loaded.origin}, but the config file defines no schemas.build`,
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
