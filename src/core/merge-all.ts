import { isNil, isPlainObject } from 'es-toolkit'

import type { SyncConfigSource } from './source'
import { watchAll } from './watch-all'

export function mergeAll(sources: SyncConfigSource[]): SyncConfigSource {
  return {
    loadSync: () =>
      sources
        .map((source) => source.loadSync())
        .filter((value) => !isNil(value))
        .reduce<unknown>(deepMerge, undefined),
    describe: () =>
      `merge of [${sources.map((source) => source.describe()).join(', ')}]`,
    ...watchAll(sources),
  }
}

export function deepMerge(base: unknown, overlay: unknown): unknown {
  if (overlay === undefined) return base
  return isPlainObject(base) && isPlainObject(overlay)
    ? mergeObjects(base, overlay)
    : overlay
}

function mergeObjects(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
): Record<string, unknown> {
  const keys = new Set([...Object.keys(base), ...Object.keys(overlay)])
  return Object.fromEntries(
    [...keys].map((key) => [key, deepMerge(base[key], overlay[key])]),
  )
}
