import path from 'node:path'

import { type AliasOptions, runnerImport } from 'vite'
import type { ZodType } from 'zod'

export interface Schemas {
  publicSchema: ZodType
  serverSchema?: ZodType
  buildSchema?: ZodType
}

export interface SchemaModule {
  file: string
  schemas: Schemas
  dependencies: string[]
}

const EXPORTS = ['publicSchema', 'serverSchema', 'buildSchema'] as const

export async function importSchemaModule({
  file,
  root,
  alias,
}: {
  file: string
  root: string
  alias?: AliasOptions
}): Promise<SchemaModule> {
  const { module, dependencies } = await runnerImport<Record<string, unknown>>(
    file,
    { root, logLevel: 'silent', resolve: { alias } },
  )
  for (const name of EXPORTS) {
    if (module[name] !== undefined && !isZodType(module[name])) {
      throw new Error(`${file}: export '${name}' is not a Zod schema`)
    }
  }
  if (!module.publicSchema) {
    throw new Error(`${file} must export 'publicSchema'`)
  }
  return {
    file,
    schemas: module as unknown as Schemas,
    dependencies: [
      file,
      ...dependencies.map((dependency) => path.resolve(root, dependency)),
    ],
  }
}

function isZodType(value: unknown): value is ZodType {
  return typeof value === 'object' && value !== null && '_zod' in value
}
