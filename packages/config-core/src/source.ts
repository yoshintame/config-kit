export interface SyncConfigSource {
  loadSync(): unknown
  describe(): string
  watch?(onChange: () => void): () => void
}

export type ConfigSource = SyncConfigSource

export type Parser<T = unknown> = {
  parse(input: string): T
}

export const jsonParser: Parser = {
  parse: (input) => JSON.parse(input),
}
