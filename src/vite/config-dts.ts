import path from 'node:path'

import { PACKAGE_NAME } from './constants'
import type { Schemas } from './schema-module'

export function renderConfigDts({
  dtsFile,
  schemaFile,
  schemas,
}: {
  dtsFile: string
  schemaFile: string
  schemas: Schemas
}): string {
  const relative = path
    .relative(path.dirname(dtsFile), schemaFile)
    .split(path.sep)
    .join('/')
    .replace(/\.tsx?$/, '')
  const specifier = relative.startsWith('.') ? relative : `./${relative}`
  const output = (name: string) =>
    `import('zod').z.output<typeof import('${specifier}')['${name}']>`
  const loaderModule = (id: string, configExport: string, schema: string) => [
    `declare module '${id}' {`,
    `  import type { SyncConfigLoader, SyncConfigSource } from '${PACKAGE_NAME}'`,
    '',
    '  export const source: SyncConfigSource',
    '  export const loader: SyncConfigLoader',
    `  export const ${configExport}: ${output(schema)}`,
    '}',
  ]
  return [
    ...loaderModule('virtual:config-kit', 'publicConfig', 'publicSchema'),
    '',
    ...loaderModule(
      'virtual:config-kit/private',
      'serverConfig',
      schemas.serverSchema ? 'serverSchema' : 'publicSchema',
    ),
    ...(schemas.buildSchema
      ? [
          '',
          "declare module 'virtual:config-kit/build' {",
          `  export const buildConfig: ${output('buildSchema')}`,
          '}',
        ]
      : []),
    '',
  ].join('\n')
}
