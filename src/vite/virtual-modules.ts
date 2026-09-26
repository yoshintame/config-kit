import { isPlainObject, union } from 'es-toolkit'

import { type JsonSchema, objectProperties } from '../core/standard-schema'
import type { ConfigKitSettings, Section } from './config-file'
import { PACKAGE_NAME } from './constants'
import type { LoadedConfig } from './dev-reader'

export type ConfigModuleKind = 'public' | 'server'

const CONFIG_EXPORTS: Record<ConfigModuleKind, string> = {
  public: 'publicConfig',
  server: 'serverConfig',
}

interface ModuleTarget {
  kind: ConfigModuleKind
  configFile: string
  settings: ConfigKitSettings
}

export function devModule({
  loaded: { raw, origin },
  hmr,
  ...target
}: ModuleTarget & { loaded: LoadedConfig; hmr: boolean }): string {
  const read = `() => ({ raw: ${JSON.stringify(raw)}, source: ${JSON.stringify(origin)} })`
  const exported = CONFIG_EXPORTS[target.kind]
  return [
    configImport(target.configFile),
    ...(target.kind === 'public'
      ? [
          `import { resolvePublicConfig } from '${PACKAGE_NAME}/browser'`,
          `const value = ${resolvePublic(target.settings, read)}`,
        ]
      : [
          `import { parseOrThrow } from '${PACKAGE_NAME}'`,
          `const { raw, source } = (${read})()`,
          `const value = parseOrThrow(${serverSchema}, raw, source, ${parseOptions(target.settings, 'server')})`,
        ]),
    ...(hmr
      ? [
          `import { liveView } from '${PACKAGE_NAME}'`,
          'const state = import.meta.hot?.data.state ?? {}',
          'state.value = value',
          'if (import.meta.hot) {',
          '  import.meta.hot.data.state = state',
          '  import.meta.hot.accept()',
          '}',
          `export const ${exported} = liveView(state)`,
        ]
      : [`export const ${exported} = value`]),
  ].join('\n')
}

export function buildModule({
  ssr,
  ...target
}: ModuleTarget & { ssr: boolean }): string {
  const { settings } = target
  const exported = CONFIG_EXPORTS[target.kind]
  if (target.kind === 'public' && !ssr) {
    const read = `() => readConfigScript(${JSON.stringify(settings.elementId)}, ${JSON.stringify(settings.envVars.public)})`
    return [
      configImport(target.configFile),
      `import { readConfigScript, resolvePublicConfig } from '${PACKAGE_NAME}/browser'`,
      `export const ${exported} = ${resolvePublic(settings, read)}`,
    ].join('\n')
  }
  const server = target.kind === 'server'
  const options = [
    `schema: ${server ? serverSchema : 'config.schemas.public'}`,
    `name: ${JSON.stringify(target.kind)}`,
    `envVar: ${JSON.stringify(settings.envVars.public)}`,
    ...(server
      ? [`overlayEnvVar: ${JSON.stringify(settings.envVars.private)}`]
      : []),
    ...keyOptions(settings, target.kind),
  ]
  return [
    configImport(target.configFile),
    `import { resolveEnvConfig } from '${PACKAGE_NAME}/node'`,
    `export const ${exported} = resolveEnvConfig({ ${options.join(', ')} })`,
  ].join('\n')
}

export function validatorModule({
  configFile,
  settings,
}: {
  configFile: string
  settings: ConfigKitSettings
}): string {
  const envVar = JSON.stringify(settings.envVars.public)
  const options = [
    'schema: config.schemas.public',
    "name: 'public'",
    `envVar: ${envVar}`,
    ...keyOptions(settings, 'public'),
  ]
  return [
    configImport(configFile),
    `import { resolveEnvConfig } from '${PACKAGE_NAME}/node'`,
    'try {',
    `  resolveEnvConfig({ ${options.join(', ')} })`,
    '} catch (error) {',
    '  console.error(error instanceof Error ? error.message : String(error))',
    '  process.exit(1)',
    '}',
    `console.log(${envVar} + ' is valid')`,
  ].join('\n')
}

export function buildConfigModule(
  value: unknown,
  shape: JsonSchema | undefined,
): string {
  return `export const buildConfig = ${literal(value ?? {}, shape, shape)}`
}

function literal(
  value: unknown,
  shape: JsonSchema | undefined,
  root: JsonSchema | undefined,
): string {
  if (value === undefined) return 'undefined'
  if (!isPlainObject(value)) return JSON.stringify(value)
  const properties = shape && root ? objectProperties(shape, root) : undefined
  const keys = union(Object.keys(value), Object.keys(properties ?? {}))
  const entries = keys.map(
    (key) =>
      `${JSON.stringify(key)}:${literal(value[key], properties?.[key], root)}`,
  )
  return `{${entries.join(',')}}`
}

const serverSchema = '(config.schemas.server ?? config.schemas.public)'

function resolvePublic(settings: ConfigKitSettings, read: string): string {
  const options = ['config', `read: ${read}`, ...keyOptions(settings, 'public')]
  return `resolvePublicConfig({ ${options.join(', ')} })`
}

function parseOptions(settings: ConfigKitSettings, section: Section): string {
  return `{ ${[`name: ${JSON.stringify(section)}`, ...keyOptions(settings, section)].join(', ')} }`
}

function keyOptions(settings: ConfigKitSettings, section: Section): string[] {
  const knownKeys = settings.knownKeys[section]
  return knownKeys
    ? [
        `knownKeys: ${JSON.stringify(knownKeys)}`,
        `unknownKeys: ${JSON.stringify(settings.unknownKeys)}`,
      ]
    : []
}

function configImport(configFile: string): string {
  return `import config from ${JSON.stringify(configFile)}`
}
