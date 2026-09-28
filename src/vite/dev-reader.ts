import path from 'node:path'

import { isNotNil, isPlainObject } from 'es-toolkit'
import { get } from 'es-toolkit/compat'
import { findUpSync } from 'find-up'
import { match, P } from 'ts-pattern'

import {
  type ConfigKitDefinition,
  type ConfigKitSchemas,
  createInMemorySource,
  firstNonEmpty,
  mergeAll,
  parseOrThrow,
  type RawConfig,
  requireConfig,
  Section,
  type ServerConfigOf,
  type SyncConfigSource,
} from '../core'
import { schemaFor } from '../core/resolve-config'
import { createFileSource, createProcessEnvSource, yamlParser } from '../node'
import { type ConfigKitSettings, resolveSettings } from './config-file'
import { YamlSection } from './constants'

export interface DevState {
  public: RawConfig
  server: RawConfig
  serverConfig: unknown
  build: RawConfig | undefined
  buildConfig: unknown
}

export interface DevReader {
  load(): DevState
  watchedFiles: string[]
}

type Warn = (message: string) => void

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
  warn: Warn = console.warn,
): DevReader {
  const { yaml, watchedFiles } = yamlSource(settings, root)
  const { envVars } = settings

  function load(): DevState {
    const document = yamlDocument(yaml)
    const sectionSource = (section: YamlSection, envVar: string) =>
      firstNonEmpty([
        createProcessEnvSource({ envVar }),
        yamlSectionSource(document, section),
      ])
    const publicSource = sectionSource(YamlSection.Public, envVars.public)
    const serverSource = mergeAll([
      publicSource,
      sectionSource(YamlSection.Private, envVars.private),
    ])
    const publicConfig = requireConfig(publicSource, Section.Public)
    const server = requireConfig(serverSource, Section.Server)
    const build = sectionSource(YamlSection.Build, envVars.build).loadSync()

    parseSection({
      settings,
      section: Section.Public,
      loaded: publicConfig,
      warn,
    })
    return {
      public: publicConfig,
      server,
      serverConfig: parseSection({
        settings,
        section: Section.Server,
        loaded: server,
        warn,
      }),
      build,
      buildConfig: parseBuild({ settings, loaded: build, warn }),
    }
  }

  return { load, watchedFiles }
}

export function loadBuildConfig(
  settings: ConfigKitSettings,
  warn: Warn = console.warn,
): unknown {
  const loaded = createProcessEnvSource({
    envVar: settings.envVars.build,
  }).loadSync()
  const buildConfig = parseBuild({ settings, loaded, warn })
  const leaked = settings.sensitive
    .filter((entry) => entry.startsWith(BUILD_PREFIX))
    .filter(
      (entry) =>
        get(buildConfig, entry.slice(BUILD_PREFIX.length)) !== undefined,
    )
  if (leaked.length > 0) {
    throw new Error(
      `Sensitive build config is set in env ${settings.envVars.build}: ${leaked.join(', ')}. Sensitive values are allowed only in vite serve, a build would inline them into the bundle`,
    )
  }
  return buildConfig
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
    .filter(isNotNil)
    .map((file) => path.resolve(path.dirname(configPath), file))
  const watchedFiles = [configPath, ...overlays]
  const yaml = mergeAll(
    watchedFiles.map((file) =>
      createFileSource({ path: file, parser: yamlParser }),
    ),
  )
  return { yaml, watchedFiles }
}

export interface YamlDocument {
  sections: Record<string, unknown>
  source: string
}

export function yamlDocument(yaml: SyncConfigSource): YamlDocument {
  const loaded = yaml.loadSync()
  const sections = isPlainObject(loaded?.raw) ? loaded.raw : {}
  const source = loaded?.source ?? yaml.describe()
  const known: string[] = Object.values(YamlSection)
  const unknown = Object.keys(sections).filter((key) => !known.includes(key))
  if (unknown.length > 0) {
    throw new Error(
      `Unknown sections in ${source}: ${unknown.join(', ')} (expected ${known.join(', ')})`,
    )
  }
  return { sections, source }
}

export function yamlSectionSource(
  { sections, source }: YamlDocument,
  section: YamlSection,
): SyncConfigSource {
  return createInMemorySource(sections[section], `${source} (${section})`)
}

const BUILD_PREFIX = 'build.'

function parseSection({
  settings: { definition, knownKeysBySection, unknownKeys },
  section,
  loaded,
  warn,
}: {
  settings: ConfigKitSettings
  section: Section
  loaded: RawConfig
  warn: Warn
}): unknown {
  return parseOrThrow(schemaFor(definition.schemas, section), loaded, {
    name: section,
    knownKeys: knownKeysBySection[section],
    unknownKeys,
    warn,
  })
}

function parseBuild({
  settings,
  loaded,
  warn,
}: {
  settings: ConfigKitSettings
  loaded: RawConfig | undefined
  warn: Warn
}): unknown {
  return match({ schema: settings.definition.schemas.build, loaded })
    .with({ schema: P.nullish, loaded: P.nullish }, () => undefined)
    .with({ schema: P.nullish, loaded: P.nonNullable }, ({ loaded }) => {
      throw new Error(
        `Build config found in ${loaded.source}, but the config file defines no schemas.build`,
      )
    })
    .otherwise(() =>
      parseSection({
        settings,
        section: Section.Build,
        loaded: loaded ?? { raw: {}, source: 'schemas.build defaults' },
        warn,
      }),
    )
}
