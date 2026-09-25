import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { isEqual } from 'es-toolkit'
import { match } from 'ts-pattern'
import { loadEnv, type ModuleNode, type Plugin, type ViteDevServer } from 'vite'
import type { ZodType } from 'zod'

import { DEFAULT_CONFIG_ELEMENT_ID } from '../browser'
import { parseOrThrow } from '../core'
import { changedPaths, matchesAny } from './changed-paths'
import {
  PRIVATE_ENV_VAR,
  PRIVATE_MODULE_ID,
  PUBLIC_ENV_VAR,
  PUBLIC_MODULE_ID,
} from './constants'
import {
  createDevReader,
  type DevConfigOptions,
  type DevReader,
  type DevState,
} from './dev-reader'
import { renderEnvDts } from './env-dts'
import { buildModule, devModule, type ModuleKind } from './virtual-modules'

export interface ConfigKitOptions extends DevConfigOptions {
  buildEnvSchema?: ZodType
  elementId?: string
  watch?: boolean
  serverRestart?: string[]
  fullReload?: string[]
  envDts?: string | false
}

type Reaction = 'none' | 'restart' | 'full-reload' | 'hmr'

const RESOLVED_IDS: Record<ModuleKind, string> = {
  public: '\0config-kit:public',
  server: '\0config-kit:private',
}
const PLUGIN_FILE = fileURLToPath(import.meta.url)

export function configKit({
  buildEnvSchema,
  elementId = DEFAULT_CONFIG_ELEMENT_ID,
  watch = true,
  serverRestart = [],
  fullReload = [],
  envDts = false,
  publicEnvVar = PUBLIC_ENV_VAR,
  privateEnvVar = PRIVATE_ENV_VAR,
  ...devOptions
}: ConfigKitOptions = {}): Plugin {
  let command: 'serve' | 'build' = 'serve'
  let dev: { reader: DevReader; state: DevState } | undefined
  let failed = false

  async function handleChange(server: ViteDevServer) {
    if (!dev) return
    const next = tryLoad(dev.reader, server)
    if (!next) {
      failed = true
      return
    }
    const reaction = reactionFor({
      previous: dev.state,
      next,
      recovered: failed,
      serverRestart,
      fullReload,
    })
    dev.state = next
    failed = false
    await match(reaction)
      .with('none', () => undefined)
      .with('restart', () => server.restart())
      .with('full-reload', () => fullReloadConfig(server))
      .with('hmr', () => hotReloadConfig(server))
      .exhaustive()
  }

  return {
    name: 'config-kit',
    enforce: 'pre',

    config(userConfig, env) {
      command = env.command
      const root = path.resolve(userConfig.root ?? process.cwd())
      if (command === 'serve') {
        const reader = createDevReader(
          { ...devOptions, publicEnvVar, privateEnvVar },
          root,
        )
        dev = { reader, state: reader.load() }
      }
      if (!buildEnvSchema) return
      return {
        define: defineBuildEnv({
          schema: buildEnvSchema,
          env: {
            ...dev?.state.env,
            ...loadEnv(env.mode, resolveEnvDir(root, userConfig.envDir), ''),
          },
          dtsFile: envDts ? path.resolve(root, envDts) : undefined,
        }),
      }
    },

    configureServer(server) {
      const files = new Set(watch ? (dev?.reader.watchedFiles ?? []) : [])
      if (files.size === 0) return
      server.watcher.add([...files])
      const onFile = (file: string) => {
        if (files.has(path.resolve(file))) void handleChange(server)
      }
      server.watcher.on('change', onFile)
      server.watcher.on('add', onFile)
      server.watcher.on('unlink', onFile)
    },

    resolveId(id, importer, options) {
      return match(id)
        .with(PUBLIC_MODULE_ID, () => RESOLVED_IDS.public)
        .with(PRIVATE_MODULE_ID, () =>
          options?.ssr
            ? RESOLVED_IDS.server
            : this.error(`${PRIVATE_MODULE_ID} is server-only`),
        )
        .when(
          () => isVirtualModule(importer),
          () => this.resolve(id, PLUGIN_FILE, { ...options, skipSelf: true }),
        )
        .otherwise(() => null)
    },

    load(id, options) {
      const kind = moduleKindOf(id)
      if (!kind) return
      return dev
        ? devModule(dev.state[kind])
        : buildModule({
            kind,
            ssr: options?.ssr === true,
            elementId,
            publicEnvVar,
            privateEnvVar,
          })
    },

    transformIndexHtml() {
      if (command !== 'build') return
      return [
        {
          tag: 'script',
          attrs: { type: 'application/json', id: elementId },
          children: `\${${publicEnvVar}}`,
          injectTo: 'head-prepend',
        },
      ]
    },
  }
}

function tryLoad(reader: DevReader, server: ViteDevServer) {
  try {
    return reader.load()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    server.config.logger.error(message, { timestamp: true })
    server.ws.send({ type: 'error', err: { message, stack: '' } })
    return undefined
  }
}

function reactionFor({
  previous,
  next,
  recovered,
  serverRestart,
  fullReload,
}: {
  previous: DevState
  next: DevState
  recovered: boolean
  serverRestart: string[]
  fullReload: string[]
}): Reaction {
  const paths = changedPaths(previous.server.raw, next.server.raw)
  const touches = (patterns: string[]) =>
    paths.some((changed) => matchesAny(changed, patterns))
  return match({
    envChanged: !isEqual(previous.env, next.env),
    restart: touches(serverRestart),
    reload: touches(fullReload),
    changed: paths.length > 0,
    recovered,
  })
    .returnType<Reaction>()
    .with({ envChanged: true }, { restart: true }, () => 'restart')
    .with({ reload: true }, () => 'full-reload')
    .with({ changed: true }, { recovered: true }, () => 'hmr')
    .otherwise(() => 'none')
}

function configModules(server: ViteDevServer): ModuleNode[] {
  return Object.values(RESOLVED_IDS)
    .map((id) => server.moduleGraph.getModuleById(id))
    .filter((mod) => mod !== undefined)
}

function fullReloadConfig(server: ViteDevServer) {
  for (const mod of configModules(server)) {
    server.moduleGraph.invalidateModule(mod)
  }
  server.ws.send({ type: 'full-reload' })
}

async function hotReloadConfig(server: ViteDevServer) {
  for (const mod of configModules(server)) await server.reloadModule(mod)
}

function isVirtualModule(id: string | undefined): boolean {
  return Object.values(RESOLVED_IDS).includes(id ?? '')
}

function moduleKindOf(id: string): ModuleKind | undefined {
  return (Object.keys(RESOLVED_IDS) as ModuleKind[]).find(
    (kind) => RESOLVED_IDS[kind] === id,
  )
}

function defineBuildEnv({
  schema,
  env,
  dtsFile,
}: {
  schema: ZodType
  env: Record<string, string>
  dtsFile: string | undefined
}): Record<string, string> {
  const parsed = parseOrThrow(schema, env, 'build env') as Record<
    string,
    unknown
  >
  if (dtsFile) writeIfChanged(dtsFile, renderEnvDts(schema))
  return Object.fromEntries(
    Object.entries(parsed).map(([key, value]) => [
      `import.meta.env.${key}`,
      JSON.stringify(value),
    ]),
  )
}

function resolveEnvDir(root: string, envDir: unknown): string {
  return typeof envDir === 'string' ? path.resolve(root, envDir) : root
}

function writeIfChanged(file: string, content: string) {
  const current = existsSync(file) ? readFileSync(file, 'utf-8') : undefined
  if (current !== content) writeFileSync(file, content)
}
