import { type ConfigKitSchemas, Section } from './define-config-kit'
import { toEnum } from './guards'
import type { ObjectSchema } from './loader'
import { type ParseOptions, parseOrThrow } from './parse-or-throw'
import { requireConfig } from './require-config'
import type { SyncConfigSource } from './source'
import type { StandardSchemaV1 } from './standard-schema'

export interface ResolveSectionOptions extends Omit<ParseOptions, 'name'> {
  source: SyncConfigSource
}

export function resolveSection(
  { schemas }: { schemas: ConfigKitSchemas },
  section: `${Section}`,
  { source, ...options }: ResolveSectionOptions,
): unknown {
  return resolveConfig(schemaFor(schemas, section), {
    ...options,
    source,
    name: section,
  })
}

export function resolveConfig<S extends StandardSchemaV1>(
  schema: S,
  { source, name, ...options }: ResolveSectionOptions & { name: string },
): StandardSchemaV1.InferOutput<S> {
  return parseOrThrow(schema, requireConfig(source, name), {
    ...options,
    name,
  })
}

export function schemaFor(
  schemas: ConfigKitSchemas,
  section: `${Section}`,
): ObjectSchema {
  const schemasBySection = {
    [Section.Public]: schemas.public,
    [Section.Server]: schemas.server ?? schemas.public,
    [Section.Build]: schemas.build,
  } satisfies Record<Section, ObjectSchema | undefined>
  const schema = schemasBySection[toEnum(Section, section)]
  if (!schema) throw new Error(`The config defines no schemas.${section}`)
  return schema
}
