export interface SyncConfigSource {
  loadSync(): unknown
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

export function parseWith(parser: Parser, input: string, origin: string) {
  try {
    return parser.parse(input)
  } catch (error) {
    throw new Error(`Failed to parse ${origin}: ${errorMessage(error)}`, {
      cause: error,
    })
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
