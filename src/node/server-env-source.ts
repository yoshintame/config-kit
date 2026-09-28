import {
  mergeAll,
  requiredSource,
  Section,
  type SyncConfigSource,
} from '../core'
import { createProcessEnvSource } from './process-env-source'

export interface ServerEnvSourceOptions {
  publicEnvVar: string
  privateEnvVar: string
}

export function createServerEnvSource({
  publicEnvVar,
  privateEnvVar,
}: ServerEnvSourceOptions): SyncConfigSource {
  return mergeAll([
    requiredSource(
      createProcessEnvSource({ envVar: publicEnvVar }),
      Section.Public,
    ),
    createProcessEnvSource({ envVar: privateEnvVar }),
  ])
}
