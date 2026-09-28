import type {
  StandardJSONSchemaV1,
  StandardSchemaV1,
} from '@standard-schema/spec'
import { isPlainObject } from 'es-toolkit'
import { match, P } from 'ts-pattern'

export type { StandardSchemaV1 }

export type JsonSchema = Record<string, unknown>

export enum JsonSchemaIo {
  Input = 'input',
  Output = 'output',
}

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

export function jsonSchemaOf(
  schema: StandardSchemaV1,
  io: JsonSchemaIo,
): JsonSchema | undefined {
  const props = schema['~standard'] as StandardSchemaV1.Props &
    Partial<StandardJSONSchemaV1.Props>
  return props.jsonSchema?.[io]({
    target: 'draft-2020-12',
    libraryOptions: lenientOptionsByVendor[props.vendor],
  })
}

export function schemaTitle(schema: StandardSchemaV1): string | undefined {
  const jsonSchema = jsonSchemaOf(schema, JsonSchemaIo.Input)
  return [
    refPath(jsonSchema?.$ref, DEFS),
    jsonSchema?.$id,
    jsonSchema?.title,
    jsonSchema?.description,
  ].find((name): name is string => typeof name === 'string')
}

export function topLevelKeys(
  schema: StandardSchemaV1,
  name: string,
): string[] | undefined {
  const jsonSchema = jsonSchemaOf(schema, JsonSchemaIo.Input)
  if (!jsonSchema) {
    throw new Error(
      `'${name}': checking unknown keys needs a schema with ~standard.jsonSchema (Zod >= 4.2, ArkType, Valibot through toStandardJsonSchema)`,
    )
  }
  const properties = objectProperties(jsonSchema)
  return match({ extra: allowsExtraKeys(jsonSchema), properties })
    .with({ extra: true }, () => undefined)
    .with({ properties: undefined }, () => {
      throw new Error(`'${name}': checking unknown keys needs an object schema`)
    })
    .otherwise(({ properties }) => Object.keys(properties ?? {}))
}

export function objectProperties(
  jsonSchema: JsonSchema,
  root: JsonSchema = jsonSchema,
): Record<string, JsonSchema> | undefined {
  const resolved = resolveRef(jsonSchema, root)
  if (isPlainObject(resolved.properties)) {
    return resolved.properties as Record<string, JsonSchema>
  }
  const variants = [resolved.anyOf, resolved.oneOf, resolved.allOf]
    .filter(Array.isArray)
    .flat()
    .filter(isPlainObject)
    .map((variant) => objectProperties(variant, root))
    .filter((properties) => properties !== undefined)
  return variants.length === 0 ? undefined : Object.assign({}, ...variants)
}

const DEFS = '#/$defs/'

const lenientOptionsByVendor: Record<string, Record<string, unknown>> = {
  zod: { unrepresentable: 'any' },
  valibot: { errorMode: 'ignore' },
  arktype: { fallback: ({ base }: { base: unknown }) => base },
}

function allowsExtraKeys(jsonSchema: JsonSchema): boolean {
  const { additionalProperties, patternProperties } = resolveRef(
    jsonSchema,
    jsonSchema,
  )
  return [additionalProperties, patternProperties].some(Boolean)
}

function resolveRef(jsonSchema: JsonSchema, root: JsonSchema): JsonSchema {
  const path = refPath(jsonSchema.$ref, '#/')
  if (path === undefined) return jsonSchema
  const target = path
    .split('/')
    .reduce<unknown>(
      (node, key) => (isPlainObject(node) ? node[key] : undefined),
      root,
    )
  return isPlainObject(target) ? resolveRef(target, root) : jsonSchema
}

function dotPath(
  path: ReadonlyArray<PropertyKey | StandardSchemaV1.PathSegment>,
): string {
  return path
    .map((segment) => (typeof segment === 'object' ? segment.key : segment))
    .map((key, index) =>
      match(key)
        .with(P.number, (position) => `[${position}]`)
        .when(
          (name) => !IDENTIFIER.test(String(name)),
          (name) => `[${JSON.stringify(String(name))}]`,
        )
        .otherwise((name) => (index === 0 ? String(name) : `.${String(name)}`)),
    )
    .join('')
}

function refPath(ref: unknown, prefix: string): string | undefined {
  return match(ref)
    .with(P.string.startsWith(prefix), (value) => value.slice(prefix.length))
    .otherwise(() => undefined)
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/
