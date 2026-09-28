import { match } from 'ts-pattern'

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
  return match(toEnum(Section, section))
    .with(Section.Public, () => schemas.public)
    .with(Section.Server, () => schemas.server ?? schemas.public)
    .with(Section.Build, () => {
      if (!schemas.build) throw new Error('The config defines no schemas.build')
      return schemas.build
    })
    .exhaustive()
}
