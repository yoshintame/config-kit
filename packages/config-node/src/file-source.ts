import { existsSync, readFileSync } from 'node:fs'

import type { Parser, SyncConfigSource } from '@senate/config-core'

import { parseWith } from './parse-with'

export type FileSourceOptions = {
  path: string
  parser: Parser
}

export function createFileSource({
  path,
  parser,
}: FileSourceOptions): SyncConfigSource {
  const origin = `file ${path}`

  return {
    loadSync() {
      if (!existsSync(path)) return undefined
      return parseWith(parser, readFileSync(path, 'utf-8'), origin)
    },
    describe: () => origin,
  }
}
