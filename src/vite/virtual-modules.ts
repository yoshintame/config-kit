import { isPlainObject, union } from 'es-toolkit'
import { match } from 'ts-pattern'
import type { ZodType } from 'zod'

import { PACKAGE_NAME } from './constants'
import type { LoadedConfig } from './dev-reader'

export type ConfigModuleKind = 'public' | 'server'

export interface ConfigModuleTarget {
  kind: ConfigModuleKind
  schemaFile: string
  schemaExport: string
}

const CONFIG_EXPORTS: Record<ConfigModuleKind, string> = {
  public: 'publicConfig',
  server: 'serverConfig',
}

export function devModule({
  loaded: { raw, origin },
  hmr,
  ...target
}: ConfigModuleTarget & { loaded: LoadedConfig; hmr: boolean }): string {
  return [
    `import { createInMemorySource, createSyncConfigLoader } from '${PACKAGE_NAME}'`,
    schemaImport(target),
    `const raw = ${JSON.stringify(raw)}`,
    'function create() {',
    `  const source = createInMemorySource(raw, ${JSON.stringify(origin)})`,
    '  const loader = createSyncConfigLoader(source)',
    '  return { source, loader, config: loader.defineConfig(schema) }',
    '}',
    ...(hmr
      ? [
          'const previous = import.meta.hot?.data.state',
          'const state = previous ?? create()',
          'previous?.source.set(raw)',
          'if (import.meta.hot) {',
          '  import.meta.hot.data.state = state',
          '  import.meta.hot.accept()',
          '}',
        ]
      : ['const state = create()']),
    'export const { source, loader } = state',
    `export const ${CONFIG_EXPORTS[target.kind]} = state.config`,
  ].join('\n')
}

export function buildModule({
  ssr,
  elementId,
  publicEnvVar,
  privateEnvVar,
  ...target
}: ConfigModuleTarget & {
  ssr: boolean
  elementId: string
  publicEnvVar: string
  privateEnvVar: string
}): string {
  const envSource = (envVar: string) =>
    `createProcessEnvSource({ envVar: ${JSON.stringify(envVar)} })`
  const source = match({ kind: target.kind, ssr })
    .with({ kind: 'public', ssr: false }, () => [
      `import { createJsonScriptSource } from '${PACKAGE_NAME}/browser'`,
      `const source = createJsonScriptSource({ elementId: ${JSON.stringify(elementId)} })`,
    ])
    .with({ kind: 'public', ssr: true }, () => [
      `import { createProcessEnvSource } from '${PACKAGE_NAME}/node'`,
      `const source = ${envSource(publicEnvVar)}`,
    ])
    .with({ kind: 'server' }, () => [
      `import { mergeAll } from '${PACKAGE_NAME}'`,
      `import { createProcessEnvSource } from '${PACKAGE_NAME}/node'`,
      `const source = mergeAll([${envSource(publicEnvVar)}, ${envSource(privateEnvVar)}])`,
    ])
    .exhaustive()
  return [
    `import { createSyncConfigLoader } from '${PACKAGE_NAME}'`,
    schemaImport(target),
    ...source,
    'const loader = createSyncConfigLoader(source)',
    `export const ${CONFIG_EXPORTS[target.kind]} = loader.defineConfig(schema)`,
    'export { source, loader }',
  ].join('\n')
}

export function buildConfigModule(
  value: unknown,
  schema: ZodType | undefined,
): string {
  return `export const buildConfig = ${literal(value ?? {}, schema)}`
}

function literal(value: unknown, schema: ZodType | undefined): string {
  if (value === undefined) return 'undefined'
  if (!isPlainObject(value)) return JSON.stringify(value)
  const shape = schema ? objectShape(schema) : undefined
  const keys = union(Object.keys(value), Object.keys(shape ?? {}))
  const entries = keys.map(
    (key) => `${JSON.stringify(key)}:${literal(value[key], shape?.[key])}`,
  )
  return `{${entries.join(',')}}`
}

interface SchemaDef {
  type: string
  shape?: Record<string, ZodType>
  in?: ZodType
  innerType?: ZodType
}

function objectShape(schema: ZodType): Record<string, ZodType> | undefined {
  const def = schema._zod.def as SchemaDef
  if (def.type === 'object') return def.shape
  const inner = def.innerType ?? def.in
  return inner ? objectShape(inner) : undefined
}

export function validatorModule({
  schemaFile,
  envVar,
}: {
  schemaFile: string
  envVar: string
}): string {
  return [
    `import { createSyncConfigLoader } from '${PACKAGE_NAME}'`,
    `import { createProcessEnvSource } from '${PACKAGE_NAME}/node'`,
    schemaImport({ schemaFile, schemaExport: 'publicSchema' }),
    `const envVar = ${JSON.stringify(envVar)}`,
    'function fail(message) {',
    '  console.error(message)',
    '  process.exit(1)',
    '}',
    "if (!process.env[envVar]) fail(envVar + ' is not set')",
    'const loader = createSyncConfigLoader(createProcessEnvSource({ envVar }))',
    'loader.defineConfig(schema)',
    'try {',
    '  loader.validateAll()',
    '  loader.assertOnlyKnownTopKeys()',
    '} catch (error) {',
    '  fail(error instanceof Error ? error.message : String(error))',
    '}',
    "console.log(envVar + ' is valid')",
  ].join('\n')
}

function schemaImport({
  schemaFile,
  schemaExport,
}: Pick<ConfigModuleTarget, 'schemaFile' | 'schemaExport'>): string {
  return `import { ${schemaExport} as schema } from ${JSON.stringify(schemaFile)}`
}
