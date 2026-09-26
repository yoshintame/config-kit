import { existsSync } from 'node:fs'
import path from 'node:path'

import { type AliasOptions, runnerImport } from 'vite'

import { DEFAULT_CONFIG_ELEMENT_ID } from '../browser'
import type {
  ConfigKitDefinition,
  DevOptions,
  ObjectSchema,
  UnknownKeys,
} from '../core'
import {
  type JsonSchema,
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

export type Section = 'public' | 'server' | 'build'

export interface ConfigKitSettings {
  definition: ConfigKitDefinition
  envVars: { public: string; private: string; build: string }
  elementId: string
  unknownKeys: UnknownKeys
  sensitive: string[]
  docker: boolean
  dev: Required<Omit<DevOptions, 'yamlPath'>> & { yamlPath?: string }
  knownKeys: Partial<Record<Section, string[]>>
  buildShape: JsonSchema | undefined
}

export interface ConfigFile {
  file: string
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
  const file = path.resolve(root, configFile)
  if (!existsSync(file)) {
    throw new Error(
      `config-kit: ${file} not found. Create it with defineConfigKit or point the configFile option at it`,
    )
  }
  const { module, dependencies } = await runnerImport<{ default?: unknown }>(
    file,
    { root, logLevel: 'silent', resolve: { alias } },
  )
  return {
    file,
    settings: resolveSettings(module.default, file),
    dependencies: [
      file,
      ...dependencies.map((dependency) => path.resolve(root, dependency)),
    ],
  }
}

export function resolveSettings(
  definition: unknown,
  file = 'config-kit config',
): ConfigKitSettings {
  assertDefinition(definition, file)
  const { schemas, envVars, dev = {} } = definition
  const unknownKeys = definition.unknownKeys ?? 'strict'
  const sensitive = definition.sensitive ?? []
  const outside = sensitive.filter((entry) => !entry.startsWith('build.'))
  if (outside.length > 0) {
    throw new Error(
      `${file}: sensitive paths must be under build (public config ships to the browser, private config never does): ${outside.join(', ')}`,
    )
  }
  if (sensitive.length > 0 && !schemas.build) {
    throw new Error(`${file}: sensitive paths need schemas.build`)
  }
  return {
    definition,
    envVars: {
      public: envVars?.public ?? PUBLIC_ENV_VAR,
      private: envVars?.private ?? PRIVATE_ENV_VAR,
      build: envVars?.build ?? BUILD_ENV_VAR,
    },
    elementId: definition.elementId ?? DEFAULT_CONFIG_ELEMENT_ID,
    unknownKeys,
    sensitive,
    docker: definition.docker ?? false,
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
    knownKeys:
      unknownKeys === 'ignore'
        ? {}
        : {
            public: topLevelKeys(schemas.public, 'public'),
            server: topLevelKeys(schemas.server ?? schemas.public, 'server'),
            build: schemas.build
              ? topLevelKeys(schemas.build, 'build')
              : undefined,
          },
    buildShape: schemas.build ? buildShapeOf(schemas.build, file) : undefined,
  }
}

function buildShapeOf(schema: ObjectSchema, file: string): JsonSchema {
  const shape = jsonSchemaOf(schema, 'output')
  if (!shape) {
    throw new Error(
      `${file}: schemas.build needs ~standard.jsonSchema (Zod >= 4.2, ArkType, Valibot through toStandardJsonSchema) to list its keys in the buildConfig literal`,
    )
  }
  return shape
}

function assertDefinition(
  value: unknown,
  file: string,
): asserts value is ConfigKitDefinition {
  const schemas = (value as { schemas?: Record<string, unknown> } | undefined)
    ?.schemas
  if (!schemas) {
    throw new Error(`${file} must default-export defineConfigKit({ schemas })`)
  }
  for (const [name, schema] of Object.entries(schemas)) {
    if (schema !== undefined && !isStandardSchema(schema)) {
      throw new Error(
        `${file}: schemas.${name} is not a Standard Schema (Zod, Valibot, ArkType)`,
      )
    }
  }
  if (!schemas.public) throw new Error(`${file}: schemas.public is required`)
}

function isStandardSchema(value: unknown): value is ObjectSchema {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    '~standard' in value
  )
}
