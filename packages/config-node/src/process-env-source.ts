import {
  jsonParser,
  type Parser,
  type SyncConfigSource,
} from '@senate/config-core'

import { parseWith } from './parse-with'

export type ProcessEnvSourceOptions = {
  envVar: string
  parser?: Parser
}

export function createProcessEnvSource({
  envVar,
  parser = jsonParser,
}: ProcessEnvSourceOptions): SyncConfigSource {
  const origin = `env ${envVar}`

  return {
    loadSync() {
      const value = process.env[envVar]
      if (!value) return undefined
      return parseWith(parser, value, origin)
    },
    describe: () => origin,
  }
}
