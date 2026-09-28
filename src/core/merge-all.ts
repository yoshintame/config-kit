import { isPlainObject } from 'es-toolkit'

import { isLoaded } from './guards'
import type { RawConfig, SyncConfigSource } from './source'
import { watchAll } from './watch-all'

export function mergeAll(sources: SyncConfigSource[]): SyncConfigSource {
  return {
    loadSync: () => mergeLoaded(sources.map((source) => source.loadSync())),
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

function mergeLoaded(loaded: (RawConfig | undefined)[]): RawConfig | undefined {
  const present = loaded.filter(isLoaded)
  return present.length === 0
    ? undefined
    : {
        raw: present.map(({ raw }) => raw).reduce(deepMerge),
        source: present.map(({ source }) => source).join(' + '),
      }
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
