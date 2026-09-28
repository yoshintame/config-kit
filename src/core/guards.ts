import { isNil, isPlainObject } from 'es-toolkit'
import type { Node } from 'estree'

import type { RawConfig } from './source'
import type { StandardSchemaV1 } from './standard-schema'

export function isLoaded(loaded: RawConfig | undefined): loaded is RawConfig {
  return loaded === undefined ? false : !isNil(loaded.raw)
}

export function isStandardSchema(value: unknown): value is StandardSchemaV1 {
  return isNil(value) ? false : '~standard' in Object(value)
}

export function toEnum<E extends Record<string, string>>(
  enumObject: E,
  value: `${E[keyof E]}`,
): E[keyof E] {
  const member = Object.values(enumObject).find((entry) => entry === value)
  if (member === undefined) {
    throw new Error(
      `Expected one of ${Object.values(enumObject).join(', ')}, got '${value}'`,
    )
  }
  return member as E[keyof E]
}

export function isAstNode(value: unknown): value is Node {
  return isPlainObject(value) ? typeof value.type === 'string' : false
}
