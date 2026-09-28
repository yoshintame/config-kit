import { existsSync, readFileSync } from 'node:fs'

import { type Parser, parseWith, type SyncConfigSource } from '../core'

export interface FileSourceOptions {
  path: string
  parser: Parser
}

export function createFileSource({
  path,
  parser,
}: FileSourceOptions): SyncConfigSource {
  const source = `file ${path}`

  return {
    loadSync: () =>
      existsSync(path)
        ? parseWith({ parser, input: readFileSync(path, 'utf-8'), source })
        : undefined,
    describe: () => source,
  }
}
