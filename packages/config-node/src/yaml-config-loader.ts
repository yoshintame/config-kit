import {
  createSyncConfigLoader,
  type SyncConfigLoader,
} from '@senate/config-core'

import {
  createYamlEnvSource,
  type YamlEnvSourceOptions,
} from './yaml-env-source'

export function createYamlConfigLoader(
  options: YamlEnvSourceOptions,
): SyncConfigLoader {
  return createSyncConfigLoader(createYamlEnvSource(options))
}
