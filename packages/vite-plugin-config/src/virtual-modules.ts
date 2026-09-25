import { match } from 'ts-pattern'

import type { LoadedConfig } from './dev-reader'

export type ModuleKind = 'public' | 'server'

export interface BuildModuleOptions {
  kind: ModuleKind
  ssr: boolean
  elementId: string
  publicEnvVar: string
  privateEnvVar: string
}

export function devModule({ raw, origin }: LoadedConfig): string {
  return [
    "import { createInMemorySource } from '@senate/config-core'",
    `const raw = ${JSON.stringify(raw)}`,
    'const previous = import.meta.hot?.data.source',
    `export const source = previous ?? createInMemorySource(raw, ${JSON.stringify(origin)})`,
    'previous?.set(raw)',
    'if (import.meta.hot) {',
    '  import.meta.hot.data.source = source',
    '  import.meta.hot.accept()',
    '}',
  ].join('\n')
}

export function buildModule({
  kind,
  ssr,
  elementId,
  publicEnvVar,
  privateEnvVar,
}: BuildModuleOptions): string {
  const envSource = (envVar: string) =>
    `createProcessEnvSource({ envVar: ${JSON.stringify(envVar)} })`
  return match({ kind, ssr })
    .with({ kind: 'public', ssr: false }, () => [
      "import { createJsonScriptSource } from '@senate/config-browser'",
      `export const source = createJsonScriptSource({ elementId: ${JSON.stringify(elementId)} })`,
    ])
    .with({ kind: 'public', ssr: true }, () => [
      "import { createProcessEnvSource } from '@senate/config-node'",
      `export const source = ${envSource(publicEnvVar)}`,
    ])
    .with({ kind: 'server' }, () => [
      "import { mergeAll } from '@senate/config-core'",
      "import { createProcessEnvSource } from '@senate/config-node'",
      `export const source = mergeAll([${envSource(publicEnvVar)}, ${envSource(privateEnvVar)}])`,
    ])
    .exhaustive()
    .join('\n')
}
