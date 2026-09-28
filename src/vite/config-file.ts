import { existsSync } from 'node:fs'
import path from 'node:path'

import { isNil, isNotNil, isPlainObject } from 'es-toolkit'
import { match } from 'ts-pattern'
import { type AliasOptions, runnerImport } from 'vite'

import { DEFAULT_CONFIG_ELEMENT_ID } from '../browser'
import {
  type ConfigKitDefinition,
  type DevOptions,
  Section,
  type SensitivePath,
  UnknownKeys,
} from '../core'
import { isStandardSchema, toEnum } from '../core/guards'
import { schemaFor } from '../core/resolve-config'
import {
  type JsonSchema,
  JsonSchemaIo,
  jsonSchemaOf,
  topLevelKeys,
} from '../core/standard-schema'
import {
  BUILD_ENV_VAR,
  OVERLAY_ENV_VAR,
  PRIVATE_ENV_VAR,
  PUBLIC_ENV_VAR,
} from './constants'

export const DEFAULT_CONFIG_FILE = 'config-kit.config.ts'

export interface ConfigKitSettings {
  definition: ConfigKitDefinition
  envVars: { public: string; private: string; build: string }
  elementId: string
  unknownKeys: UnknownKeys
  sensitive: SensitivePath[]
  docker: boolean
  dev: Required<Omit<DevOptions, 'yamlPath'>> & { yamlPath?: string }
  knownKeysBySection: Partial<Record<Section, string[]>>
  buildShape: JsonSchema | undefined
}

export interface ConfigFile {
  configPath: string
  settings: ConfigKitSettings
  dependencies: string[]
}

export async function importConfigFile({
  root,
  configFile = DEFAULT_CONFIG_FILE,
  alias,
}: {
  root: string
  configFile?: string
  alias?: AliasOptions
}): Promise<ConfigFile> {
  const configPath = path.resolve(root, configFile)
  if (!existsSync(configPath)) {
    throw new Error(
      `config-kit: ${configPath} not found. Create it with defineConfigKit or point the configFile option at it`,
    )
  }
  const { module, dependencies } = await runnerImport<{ default?: unknown }>(
    configPath,
    { root, logLevel: 'silent', resolve: { alias } },
  )
  return {
    configPath,
    settings: resolveSettings(module.default, configPath),
    dependencies: [
      configPath,
      ...dependencies.map((dependency) => path.resolve(root, dependency)),
    ],
  }
}

export function resolveSettings(
  definition: unknown,
  file = 'config-kit config',
): ConfigKitSettings {
  assertDefinition(definition, file)
  const {
    schemas,
    envVars,
    dev = {},
    unknownKeys = UnknownKeys.Strict,
    sensitive = [],
    elementId = DEFAULT_CONFIG_ELEMENT_ID,
    docker = false,
  } = definition
  assertSensitive(sensitive, schemas.build !== undefined, file)
  const mode = toEnum(UnknownKeys, unknownKeys)

  return {
    definition,
    envVars: {
      public: envVars?.public ?? PUBLIC_ENV_VAR,
      private: envVars?.private ?? PRIVATE_ENV_VAR,
      build: envVars?.build ?? BUILD_ENV_VAR,
    },
    elementId,
    unknownKeys: mode,
    sensitive,
    docker,
    dev: {
      yamlFile: dev.yamlFile ?? 'config.yaml',
      yamlPath: dev.yamlPath,
      localYamlFile: dev.localYamlFile ?? 'config.local.yaml',
      overlayEnvVar: dev.overlayEnvVar ?? OVERLAY_ENV_VAR,
      watch: dev.watch ?? true,
      hmr: dev.hmr ?? false,
      serverRestart: dev.serverRestart ?? [],
      fullReload: dev.fullReload ?? [],
    },
    knownKeysBySection:
      mode === UnknownKeys.Ignore ? {} : knownKeysBySection(definition),
    buildShape: schemas.build ? buildShapeOf(definition, file) : undefined,
  }
}

function knownKeysBySection({
  schemas,
}: ConfigKitDefinition): Partial<Record<Section, string[]>> {
  const sections = Object.values(Section).filter((section) =>
    section === Section.Build ? schemas.build !== undefined : true,
  )
  return Object.fromEntries(
    sections.map((section) => [
      section,
      topLevelKeys(schemaFor(schemas, section), section),
    ]),
  )
}

function buildShapeOf(
  { schemas }: ConfigKitDefinition,
  file: string,
): JsonSchema {
  const shape = jsonSchemaOf(
    schemaFor(schemas, Section.Build),
    JsonSchemaIo.Output,
  )
  if (!shape) {
    throw new Error(
      `${file}: schemas.build needs ~standard.jsonSchema (Zod >= 4.2, ArkType, Valibot through toStandardJsonSchema) to list its keys in the buildConfig literal`,
    )
  }
  return shape
}

function assertSensitive(
  sensitive: string[],
  hasBuildSchema: boolean,
  file: string,
): void {
  const outside = sensitive.filter(
    (entry) => !SENSITIVE_PREFIXES.some((prefix) => entry.startsWith(prefix)),
  )
  const needsBuildSchema = sensitive.some((entry) => entry.startsWith('build.'))
  const problems = [
    outside.length > 0
      ? `sensitive paths must be under build. or private. (public config ships to the browser as a whole): ${outside.join(', ')}`
      : undefined,
    match({ needsBuildSchema, hasBuildSchema })
      .with(
        { needsBuildSchema: true, hasBuildSchema: false },
        () => 'sensitive build paths need schemas.build',
      )
      .otherwise(() => undefined),
  ].filter(isNotNil)
  if (problems.length > 0) throw new Error(`${file}: ${problems.join('; ')}`)
}

const SENSITIVE_PREFIXES = ['build.', 'private.']

function assertDefinition(
  value: unknown,
  file: string,
): asserts value is ConfigKitDefinition {
  const schemas = isPlainObject(value) ? value.schemas : undefined
  if (!isPlainObject(schemas)) {
    throw new Error(`${file} must default-export defineConfigKit({ schemas })`)
  }
  const invalid = Object.entries(schemas)
    .filter(([, schema]) => (isNil(schema) ? false : !isStandardSchema(schema)))
    .map(([name]) => `schemas.${name}`)
  const problems = [
    invalid.length > 0
      ? `${invalid.join(', ')} is not a Standard Schema (Zod, Valibot, ArkType)`
      : undefined,
    schemas.public ? undefined : 'schemas.public is required',
  ].filter(isNotNil)
  if (problems.length > 0) throw new Error(`${file}: ${problems.join('; ')}`)
}
