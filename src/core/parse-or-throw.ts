import { isPlainObject } from 'es-toolkit'

import { ConfigKitError } from './errors'
import {
  formatIssues,
  type StandardSchemaV1,
  schemaTitle,
  validateSync,
} from './standard-schema'

export type UnknownKeys = 'strict' | 'warn' | 'ignore'

export interface ParseOptions {
  name?: string
  knownKeys?: readonly string[]
  unknownKeys?: UnknownKeys
  warn?: (message: string) => void
}

export function parseOrThrow<S extends StandardSchemaV1>(
  schema: S,
  raw: unknown,
  origin: string,
  {
    name,
    knownKeys,
    unknownKeys = 'ignore',
    warn = console.warn,
  }: ParseOptions = {},
): StandardSchemaV1.InferOutput<S> {
  const section = () => name ?? schemaTitle(schema)
  const forSection = () => {
    const resolved = section()
    return resolved ? ` for '${resolved}'` : ''
  }
  const result = validateSync(schema, raw, () => `Config${forSection()}`)
  if (result.issues) {
    throw new ConfigKitError(
      `Config validation failed${forSection()} (loaded from ${origin}):\n${formatIssues(result.issues)}`,
      { kind: 'schema', section: section(), source: origin },
    )
  }
  if (knownKeys && unknownKeys !== 'ignore') {
    const unknown = isPlainObject(raw)
      ? Object.keys(raw).filter((key) => !knownKeys.includes(key))
      : []
    if (unknown.length > 0) {
      const message = `Unknown top-level config keys${forSection()} (loaded from ${origin}): ${unknown.join(', ')}`
      if (unknownKeys === 'warn') warn(message)
      else {
        throw new ConfigKitError(message, {
          kind: 'schema',
          section: section(),
          source: origin,
        })
      }
    }
  }
  return result.value
}
