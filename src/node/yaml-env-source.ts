import { findUpSync } from 'find-up'

import { firstNonEmpty, type SyncConfigSource } from '../core'
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
      : createFindUpFileSource(yamlFile),
  ])
}

function createFindUpFileSource(fileName: string): SyncConfigSource {
  return {
    loadSync() {
      const path = findUpSync(fileName)
      return path
        ? createFileSource({ path, parser: yamlParser }).loadSync()
        : undefined
    },
    describe: () => `file ${fileName} (searched up from ${process.cwd()})`,
  }
}
