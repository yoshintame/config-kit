import { createSyncConfigLoader, type SyncConfigLoader } from '../core'
import {
  createYamlEnvSource,
  type YamlEnvSourceOptions,
} from './yaml-env-source'

export function createYamlConfigLoader(
  options: YamlEnvSourceOptions,
): SyncConfigLoader {
  return createSyncConfigLoader(createYamlEnvSource(options))
}
