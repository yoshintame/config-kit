import { ConfigErrorKind, ConfigKitError } from './errors'

export interface RawConfig {
  raw: unknown
  source: string
}

export interface SyncConfigSource {
  loadSync(): RawConfig | undefined
  describe(): string
  watch?(onChange: () => void): () => void
}

export type ConfigSource = SyncConfigSource

export interface Parser<T = unknown> {
  parse(input: string): T
}

export const jsonParser: Parser = {
  parse: (input) => JSON.parse(input),
}

export function parseWith({
  parser,
  input,
  source,
}: {
  parser: Parser
  input: string
  source: string
}): RawConfig {
  try {
    return { raw: parser.parse(input), source }
  } catch (error) {
    throw new ConfigKitError(
      `Failed to parse ${source}: ${errorMessage(error)}`,
      { kind: ConfigErrorKind.Parse, section: undefined, source },
      { cause: error },
    )
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
