import { ConfigErrorKind, ConfigKitError } from './errors'
import { isLoaded } from './guards'
import type { RawConfig, SyncConfigSource } from './source'

export function requireConfig(
  source: SyncConfigSource,
  section?: string,
): RawConfig {
  return ensureLoaded(source.loadSync(), source, section)
}

export function requiredSource(
  source: SyncConfigSource,
  section?: string,
): SyncConfigSource {
  return { ...source, loadSync: () => requireConfig(source, section) }
}

export function ensureLoaded(
  loaded: RawConfig | undefined,
  source: SyncConfigSource,
  section?: string,
): RawConfig {
  if (isLoaded(loaded)) return loaded
  throw new ConfigKitError(`Config not found in ${source.describe()}`, {
    kind: ConfigErrorKind.Missing,
    section,
    source: source.describe(),
  })
}
