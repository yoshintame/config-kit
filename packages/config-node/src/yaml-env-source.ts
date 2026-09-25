import {
  firstNonEmpty,
  type Parser,
  type SyncConfigSource,
} from '@senate/config-core'
import { findUpSync } from 'find-up'

import { createFileSource } from './file-source'
import { createProcessEnvSource } from './process-env-source'
import { yamlParser } from './yaml-parser'

export interface YamlEnvSourceOptions {
  envVar: string
  yamlFile: string
  yamlPath?: string
}

export function createYamlEnvSource({
  envVar,
  yamlFile,
  yamlPath,
}: YamlEnvSourceOptions): SyncConfigSource {
  return firstNonEmpty([
    createProcessEnvSource({ envVar }),
    yamlPath
      ? createFileSource({ path: yamlPath, parser: yamlParser })
      : createFindUpFileSource(yamlFile, yamlParser),
  ])
}

function createFindUpFileSource(
  fileName: string,
  parser: Parser,
): SyncConfigSource {
  let found: SyncConfigSource | undefined

  return {
    loadSync() {
      const path = findUpSync(fileName)
      found = path ? createFileSource({ path, parser }) : undefined
      return found?.loadSync()
    },
    describe: () =>
      found?.describe() ??
      `file ${fileName} (searched up from ${process.cwd()})`,
  }
}
