import {
  ConfigKitError,
  deepMerge,
  parseOrThrow,
  type StandardSchemaV1,
  type UnknownKeys,
} from '../core'
import { createProcessEnvSource } from './process-env-source'

export interface ResolveEnvConfigOptions<S extends StandardSchemaV1> {
  schema: S
  name: string
  envVar: string
  overlayEnvVar?: string
  knownKeys?: readonly string[]
  unknownKeys?: UnknownKeys
}

export function resolveEnvConfig<S extends StandardSchemaV1>({
  schema,
  name,
  envVar,
  overlayEnvVar,
  knownKeys,
  unknownKeys,
}: ResolveEnvConfigOptions<S>): StandardSchemaV1.InferOutput<S> {
  const base = createProcessEnvSource({ envVar })
  const raw = base.loadSync()
  if (raw === undefined) {
    throw new ConfigKitError(`${envVar} is not set`, {
      kind: 'missing',
      section: name,
      source: base.describe(),
    })
  }
  const overlay = overlayEnvVar
    ? createProcessEnvSource({ envVar: overlayEnvVar })
    : undefined
  const overlayRaw = overlay?.loadSync()
  const merged = overlayRaw === undefined ? raw : deepMerge(raw, overlayRaw)
  const origin =
    overlayRaw === undefined
      ? base.describe()
      : `${base.describe()} + ${overlay?.describe()}`
  return parseOrThrow(schema, merged, origin, { name, knownKeys, unknownKeys })
}
