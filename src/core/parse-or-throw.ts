import { isPlainObject, once } from 'es-toolkit'

import { ConfigErrorKind, ConfigKitError } from './errors'
import { toEnum } from './guards'
import type { RawConfig } from './source'
import {
  formatIssues,
  type StandardSchemaV1,
  schemaTitle,
  validateSync,
} from './standard-schema'

export enum UnknownKeys {
  Strict = 'strict',
  Warn = 'warn',
  Ignore = 'ignore',
}

export interface ParseOptions {
  name?: string
  knownKeys?: readonly string[]
  unknownKeys?: `${UnknownKeys}`
  warn?: (message: string) => void
}

export function parseOrThrow<S extends StandardSchemaV1>(
  schema: S,
  { raw, source }: RawConfig,
  {
    name,
    knownKeys,
    unknownKeys = UnknownKeys.Ignore,
    warn = console.warn,
  }: ParseOptions = {},
): StandardSchemaV1.InferOutput<S> {
  const section = once(() => name ?? schemaTitle(schema))
  const target = () => (section() ? ` for '${section()}'` : '')
  const fail = (message: string): never => {
    throw new ConfigKitError(message, {
      kind: ConfigErrorKind.Schema,
      section: section(),
      source,
    })
  }

  const result = validateSync(schema, raw, () => `Config${target()}`)
  if (result.issues) {
    return fail(
      `Config validation failed${target()} (loaded from ${source}):\n${formatIssues(result.issues)}`,
    )
  }

  const unknown = knownKeys ? unknownTopKeys(raw, knownKeys) : []
  if (unknown.length > 0) {
    const message = `Unknown top-level config keys${target()} (loaded from ${source}): ${unknown.join(', ')}`
    const reactionsByMode = {
      [UnknownKeys.Strict]: fail,
      [UnknownKeys.Warn]: warn,
      [UnknownKeys.Ignore]: () => undefined,
    } satisfies Record<UnknownKeys, (message: string) => void>
    reactionsByMode[toEnum(UnknownKeys, unknownKeys)](message)
  }
  return result.value
}

function unknownTopKeys(raw: unknown, knownKeys: readonly string[]): string[] {
  return isPlainObject(raw)
    ? Object.keys(raw).filter((key) => !knownKeys.includes(key))
    : []
}
