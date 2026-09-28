import {
  jsonParser,
  type Parser,
  parseWith,
  type SyncConfigSource,
} from '../core'

export interface ProcessEnvSourceOptions {
  envVar: string
  parser?: Parser
}

export function createProcessEnvSource({
  envVar,
  parser = jsonParser,
}: ProcessEnvSourceOptions): SyncConfigSource {
  const source = `env ${envVar}`

  return {
    loadSync() {
      const input = process.env[envVar]
      return input === undefined
        ? undefined
        : parseWith({ parser, input, source })
    },
    describe: () => source,
  }
}
