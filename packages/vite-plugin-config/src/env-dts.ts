import { uniq } from 'es-toolkit'
import { match, P } from 'ts-pattern'
import { type ZodType, z } from 'zod'

export function renderEnvDts(schema: ZodType): string {
  const json = z.toJSONSchema(schema, {
    io: 'output',
    unrepresentable: 'any',
  }) as JsonSchema
  const required = new Set(json.required ?? [])
  const fields = Object.entries(json.properties ?? {}).map(
    ([key, value]) =>
      `  readonly ${key}${required.has(key) ? '' : '?'}: ${tsType(value)}`,
  )
  return [
    'interface ImportMetaEnv {',
    ...fields,
    '}',
    '',
    'interface ImportMeta {',
    '  readonly env: ImportMetaEnv',
    '}',
    '',
  ].join('\n')
}

interface JsonSchema {
  type?: string | string[]
  enum?: unknown[]
  const?: unknown
  anyOf?: JsonSchema[]
  properties?: Record<string, JsonSchema>
  required?: string[]
}

function tsType(schema: JsonSchema): string {
  return match(schema)
    .when(
      ({ const: value }) => value !== undefined,
      ({ const: value }) => JSON.stringify(value),
    )
    .with({ enum: P.array() }, ({ enum: values }) =>
      values.map((value) => JSON.stringify(value)).join(' | '),
    )
    .with({ anyOf: P.array() }, ({ anyOf }) => anyOf.map(tsType).join(' | '))
    .otherwise(({ type }) => uniq([type].flat().map(primitiveType)).join(' | '))
}

function primitiveType(type: string | undefined): string {
  return match(type)
    .with('string', () => 'string')
    .with(P.union('number', 'integer'), () => 'number')
    .with('boolean', () => 'boolean')
    .with('null', () => 'null')
    .otherwise(() => 'unknown')
}
