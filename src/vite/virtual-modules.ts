import { isJSONValue, isPlainObject, union } from 'es-toolkit'
import { match, P } from 'ts-pattern'

import { type RawConfig, Section } from '../core'
import { type JsonSchema, objectProperties } from '../core/standard-schema'
import type { ConfigKitSettings } from './config-file'
import {
  configModulesBySection,
  envPlaceholder,
  PACKAGE_NAME,
} from './constants'

export type ConfigSection = Section.Public | Section.Server

interface ModuleTarget {
  section: ConfigSection
  configPath: string
  settings: ConfigKitSettings
}

export function devModule({
  section,
  configPath,
  settings,
  loaded: { raw, source },
  hmr,
}: ModuleTarget & { loaded: RawConfig; hmr: boolean }): string {
  const sourceCode = call('createInMemorySource', raw, source)
  const value = match(section)
    .with(Section.Public, () => publicValue(settings, sourceCode))
    .with(Section.Server, () => sectionValue(settings, section, sourceCode))
    .exhaustive()
  return moduleCode({
    configPath,
    section,
    imports: {
      [PACKAGE_NAME]: [
        'createInMemorySource',
        ...(section === Section.Server ? ['resolveSection'] : []),
        ...(hmr ? ['liveConfig'] : []),
      ],
      ...(section === Section.Public
        ? { [`${PACKAGE_NAME}/browser`]: ['resolvePublicConfig'] }
        : {}),
    },
    value: hmr ? `liveConfig(import.meta.hot, ${value})` : value,
    footer: hmr ? ['if (import.meta.hot) import.meta.hot.accept()'] : [],
  })
}

export function buildModule({
  section,
  configPath,
  settings,
  ssr,
}: ModuleTarget & { ssr: boolean }): string {
  const { elementId, envVars } = settings
  return match({ section, ssr })
    .with({ section: Section.Public, ssr: false }, () =>
      moduleCode({
        configPath,
        section,
        imports: {
          [`${PACKAGE_NAME}/browser`]: [
            'createJsonScriptSource',
            'resolvePublicConfig',
          ],
        },
        value: publicValue(
          settings,
          call('createJsonScriptSource', {
            elementId,
            placeholder: envPlaceholder(envVars.public),
          }),
        ),
      }),
    )
    .with({ section: Section.Public, ssr: true }, () =>
      moduleCode({
        configPath,
        section,
        imports: {
          [PACKAGE_NAME]: ['resolveSection'],
          [`${PACKAGE_NAME}/node`]: ['createProcessEnvSource'],
        },
        value: sectionValue(
          settings,
          section,
          call('createProcessEnvSource', { envVar: envVars.public }),
        ),
      }),
    )
    .with({ section: Section.Server }, () =>
      moduleCode({
        configPath,
        section,
        imports: {
          [PACKAGE_NAME]: ['resolveSection'],
          [`${PACKAGE_NAME}/node`]: ['createServerEnvSource'],
        },
        value: sectionValue(
          settings,
          section,
          call('createServerEnvSource', {
            publicEnvVar: envVars.public,
            privateEnvVar: envVars.private,
          }),
        ),
      }),
    )
    .exhaustive()
}

export function validatorModule({
  configPath,
  settings,
}: {
  configPath: string
  settings: ConfigKitSettings
}): string {
  return [
    configImport(configPath),
    `import { runValidator } from '${PACKAGE_NAME}/node'`,
    call('runValidator', CONFIG, {
      envVar: settings.envVars.public,
      ...keyOptions(settings, Section.Public),
    }).code,
  ].join('\n')
}

export function buildConfigModule(
  value: unknown,
  shape: JsonSchema | undefined,
): string {
  return `export const ${configModulesBySection[Section.Build].exportName} = ${literal({ value: value ?? {}, shape, root: shape, path: 'buildConfig' })}`
}

class Code {
  public constructor(public readonly code: string) {}
}

const CONFIG = new Code('config')

function publicValue(settings: ConfigKitSettings, sourceCode: Code): string {
  return call('resolvePublicConfig', CONFIG, {
    source: sourceCode,
    ...keyOptions(settings, Section.Public),
  }).code
}

function sectionValue(
  settings: ConfigKitSettings,
  section: ConfigSection,
  sourceCode: Code,
): string {
  return call('resolveSection', CONFIG, section, {
    source: sourceCode,
    ...keyOptions(settings, section),
  }).code
}

function keyOptions(
  { knownKeysBySection, unknownKeys }: ConfigKitSettings,
  section: Section,
): Record<string, unknown> {
  const knownKeys = knownKeysBySection[section]
  return knownKeys ? { knownKeys, unknownKeys } : {}
}

function moduleCode({
  configPath,
  section,
  imports,
  value,
  footer = [],
}: {
  configPath: string
  section: ConfigSection
  imports: Record<string, string[]>
  value: string
  footer?: string[]
}): string {
  return [
    configImport(configPath),
    ...Object.entries(imports).map(
      ([specifier, names]) =>
        `import { ${names.join(', ')} } from '${specifier}'`,
    ),
    `export const ${configModulesBySection[section].exportName} = ${value}`,
    ...footer,
  ].join('\n')
}

function configImport(configPath: string): string {
  return `import ${CONFIG.code} from ${JSON.stringify(configPath)}`
}

function call(name: string, ...args: unknown[]): Code {
  return new Code(`${name}(${args.map(serialize).join(', ')})`)
}

function serialize(value: unknown): string {
  return match(value)
    .with(P.instanceOf(Code), ({ code }) => code)
    .when(
      isPlainObject,
      (object) =>
        `{ ${Object.entries(object)
          .map(([key, item]) => `${JSON.stringify(key)}: ${serialize(item)}`)
          .join(', ')} }`,
    )
    .otherwise((json) => JSON.stringify(json))
}

function literal({
  value,
  shape,
  root,
  path,
}: {
  value: unknown
  shape: JsonSchema | undefined
  root: JsonSchema | undefined
  path: string
}): string {
  return match(value)
    .with(undefined, () => 'undefined')
    .when(isPlainObject, (object) => {
      const properties = shape
        ? objectProperties(shape, root ?? shape)
        : undefined
      const keys = union(Object.keys(object), Object.keys(properties ?? {}))
      const entries = keys.map(
        (key) =>
          `${JSON.stringify(key)}:${literal({
            value: object[key],
            shape: properties?.[key],
            root,
            path: `${path}.${key}`,
          })}`,
      )
      return `{${entries.join(',')}}`
    })
    .when(isJSONValue, (json) => JSON.stringify(json))
    .otherwise(() => {
      throw new Error(
        `${path} is not a JSON value: buildConfig is inlined into the bundle, so the build schema must output JSON`,
      )
    })
}
