import { type ZodType, z } from 'zod'

type JsonSchema = {
  type?: string | string[]
  enum?: unknown[]
  const?: unknown
  anyOf?: JsonSchema[]
  properties?: Record<string, JsonSchema>
  required?: string[]
}

function tsType(schema: JsonSchema): string {
  if (schema.const !== undefined) return JSON.stringify(schema.const)
  if (schema.enum) return schema.enum.map((v) => JSON.stringify(v)).join(' | ')
  if (schema.anyOf) return schema.anyOf.map(tsType).join(' | ')
  const types = Array.isArray(schema.type) ? schema.type : [schema.type]
  const mapped = types.map((type) => {
    switch (type) {
      case 'string':
        return 'string'
      case 'number':
      case 'integer':
        return 'number'
      case 'boolean':
        return 'boolean'
      case 'null':
        return 'null'
      default:
        return 'unknown'
    }
  })
  return [...new Set(mapped)].join(' | ')
}

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
