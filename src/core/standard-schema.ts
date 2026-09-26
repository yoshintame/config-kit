import type {
  StandardJSONSchemaV1,
  StandardSchemaV1,
} from '@standard-schema/spec'

export type { StandardSchemaV1 }

export type JsonSchema = Record<string, unknown>

export function validateSync<S extends StandardSchemaV1>(
  schema: S,
  value: unknown,
  label: () => string,
): StandardSchemaV1.Result<StandardSchemaV1.InferOutput<S>> {
  const result = schema['~standard'].validate(value)
  if (result instanceof Promise) {
    throw new Error(
      `${label()}: the schema validates asynchronously, config-kit needs a synchronous result`,
    )
  }
  return result
}

export function formatIssues(
  issues: ReadonlyArray<StandardSchemaV1.Issue>,
): string {
  return issues
    .map((issue) => {
      const at = dotPath(issue.path ?? [])
      return at ? `✖ ${issue.message}\n  → at ${at}` : `✖ ${issue.message}`
    })
    .join('\n')
}

function dotPath(
  path: ReadonlyArray<PropertyKey | StandardSchemaV1.PathSegment>,
): string {
  return path
    .map((segment) => (typeof segment === 'object' ? segment.key : segment))
    .map((key, index) => {
      if (typeof key === 'number') return `[${key}]`
      const name = String(key)
      if (!/^[A-Za-z_$][\w$]*$/.test(name)) return `[${JSON.stringify(name)}]`
      return index === 0 ? name : `.${name}`
    })
    .join('')
}

const LENIENT_JSON_SCHEMA: Record<string, Record<string, unknown>> = {
  zod: { unrepresentable: 'any' },
  valibot: { errorMode: 'ignore' },
  arktype: { fallback: ({ base }: { base: unknown }) => base },
}

export function jsonSchemaOf(
  schema: StandardSchemaV1,
  io: 'input' | 'output',
): JsonSchema | undefined {
  const props = schema['~standard'] as StandardSchemaV1.Props &
    Partial<StandardJSONSchemaV1.Props>
  return props.jsonSchema?.[io]({
    target: 'draft-2020-12',
    libraryOptions: LENIENT_JSON_SCHEMA[props.vendor],
  })
}

export function schemaTitle(schema: StandardSchemaV1): string | undefined {
  const jsonSchema = jsonSchemaOf(schema, 'input')
  const ref = jsonSchema?.$ref
  const definition =
    typeof ref === 'string' && ref.startsWith(DEFS)
      ? ref.slice(DEFS.length)
      : undefined
  return [
    definition,
    jsonSchema?.$id,
    jsonSchema?.title,
    jsonSchema?.description,
  ].find((name): name is string => typeof name === 'string')
}

const DEFS = '#/$defs/'

export function objectProperties(
  jsonSchema: JsonSchema,
  root: JsonSchema = jsonSchema,
): Record<string, JsonSchema> | undefined {
  const resolved = resolveRef(jsonSchema, root)
  if (isObject(resolved.properties)) {
    return resolved.properties as Record<string, JsonSchema>
  }
  const variants = [resolved.anyOf, resolved.oneOf, resolved.allOf]
    .filter(Array.isArray)
    .flat()
    .filter(isObject)
    .map((variant) => objectProperties(variant, root))
    .filter((properties) => properties !== undefined)
  return variants.length === 1 ? variants[0] : undefined
}

export function allowsExtraKeys(
  jsonSchema: JsonSchema,
  root: JsonSchema = jsonSchema,
): boolean {
  const resolved = resolveRef(jsonSchema, root)
  return (
    Boolean(resolved.additionalProperties) ||
    resolved.patternProperties !== undefined
  )
}

function resolveRef(jsonSchema: JsonSchema, root: JsonSchema): JsonSchema {
  const ref = jsonSchema.$ref
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return jsonSchema
  const target = ref
    .slice(2)
    .split('/')
    .reduce<unknown>(
      (node, key) => (isObject(node) ? node[key] : undefined),
      root,
    )
  return isObject(target) ? resolveRef(target, root) : jsonSchema
}

function isObject(value: unknown): value is JsonSchema {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function topLevelKeys(
  schema: StandardSchemaV1,
  name: string,
): string[] | undefined {
  const jsonSchema = jsonSchemaOf(schema, 'input')
  if (!jsonSchema) {
    throw new Error(
      `'${name}': checking unknown keys needs a schema with ~standard.jsonSchema (Zod >= 4.2, ArkType, Valibot through toStandardJsonSchema)`,
    )
  }
  if (allowsExtraKeys(jsonSchema)) return undefined
  const properties = objectProperties(jsonSchema)
  if (!properties) {
    throw new Error(`'${name}': checking unknown keys needs an object schema`)
  }
  return Object.keys(properties)
}
