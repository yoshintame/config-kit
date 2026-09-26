import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { isEqual } from 'es-toolkit'
import { match } from 'ts-pattern'
import type { ModuleNode, Plugin, ResolvedConfig, ViteDevServer } from 'vite'

import { DEFAULT_CONFIG_ELEMENT_ID } from '../browser'
import { changedPaths, matchesAny } from './changed-paths'
import { renderConfigDts } from './config-dts'
import {
  BUILD_ENV_VAR,
  BUILD_MODULE_ID,
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
  loadBuildConfig,
} from './dev-reader'
import { writeDockerArtifacts } from './docker'
import { importSchemaModule, type SchemaModule } from './schema-module'
import {
  buildConfigModule,
  buildModule,
  type ConfigModuleKind,
  devModule,
} from './virtual-modules'

export interface ConfigKitOptions extends DevConfigOptions {
  schemaModule: string
  dts?: string | false
  docker?: boolean
  hmr?: boolean
  elementId?: string
  watch?: boolean
  serverRestart?: string[]
  fullReload?: string[]
}

type Reaction = 'none' | 'restart' | 'full-reload' | 'hmr'
type ModuleKind = ConfigModuleKind | 'build'

const RESOLVED_IDS: Record<ModuleKind, string> = {
  public: '\0config-kit:public',
  server: '\0config-kit:private',
  build: '\0config-kit:build',
}
const PLUGIN_FILE = fileURLToPath(import.meta.url)

export function configKit({
  schemaModule,
  dts = 'src/config-kit.d.ts',
  docker = false,
  hmr = false,
  elementId = DEFAULT_CONFIG_ELEMENT_ID,
  watch = true,
  serverRestart = [],
  fullReload = [],
  publicEnvVar = PUBLIC_ENV_VAR,
  privateEnvVar = PRIVATE_ENV_VAR,
  buildEnvVar = BUILD_ENV_VAR,
  ...devOptions
}: ConfigKitOptions): Plugin {
  let schema: SchemaModule
  let resolved: ResolvedConfig
  let dev: { reader: DevReader; state: DevState } | undefined
  let buildConfig: unknown
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
      hmr,
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

  function schemaTarget(kind: ConfigModuleKind) {
    return {
      kind,
      schemaFile: schema.file,
      schemaExport:
        kind === 'server' && schema.schemas.serverSchema
          ? 'serverSchema'
          : 'publicSchema',
    }
  }

  return {
    name: 'config-kit',
    enforce: 'pre',

    async config(userConfig, env) {
      const root = path.resolve(userConfig.root ?? process.cwd())
      schema = await importSchemaModule({
        file: path.resolve(root, schemaModule),
        root,
        alias: userConfig.resolve?.alias,
      })
      if (dts) {
        const dtsFile = path.resolve(root, dts)
        writeIfChanged(
          dtsFile,
          renderConfigDts({
            dtsFile,
            schemaFile: schema.file,
            schemas: schema.schemas,
          }),
        )
      }
      if (env.command === 'serve') {
        const reader = createDevReader(
          { ...devOptions, publicEnvVar, privateEnvVar, buildEnvVar },
          schema.schemas,
          root,
        )
        dev = { reader, state: reader.load() }
      } else {
        buildConfig = loadBuildConfig(schema.schemas.buildSchema, buildEnvVar)
      }
    },

    configResolved(config) {
      resolved = config
    },

    configureServer(server) {
      if (!watch || !dev) return
      const configFiles = new Set(dev.reader.watchedFiles)
      const schemaFiles = new Set(schema.dependencies)
      server.watcher.add([...configFiles, ...schemaFiles])
      const onFile = (file: string) => {
        const changed = path.resolve(file)
        if (schemaFiles.has(changed)) void server.restart()
        else if (configFiles.has(changed)) void handleChange(server)
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
        .with(BUILD_MODULE_ID, () =>
          schema.schemas.buildSchema
            ? RESOLVED_IDS.build
            : this.error(
                `${BUILD_MODULE_ID} needs a 'buildSchema' export in ${schema.file}`,
              ),
        )
        .when(
          () => isVirtualModule(importer),
          () =>
            id === schema.file
              ? id
              : this.resolve(id, PLUGIN_FILE, { ...options, skipSelf: true }),
        )
        .otherwise(() => null)
    },

    load(id, options) {
      const kind = moduleKindOf(id)
      if (!kind) return
      if (kind === 'build') {
        return buildConfigModule(
          dev ? dev.state.buildConfig : buildConfig,
          schema.schemas.buildSchema,
        )
      }
      return dev
        ? devModule({
            ...schemaTarget(kind),
            loaded: dev.state[kind],
            hmr,
          })
        : buildModule({
            ...schemaTarget(kind),
            ssr: options?.ssr === true,
            elementId,
            publicEnvVar,
            privateEnvVar,
          })
    },

    transformIndexHtml() {
      if (dev) return
      return [
        {
          tag: 'script',
          attrs: { type: 'application/json', id: elementId },
          children: `\${${publicEnvVar}}`,
          injectTo: 'head-prepend',
        },
      ]
    },

    async closeBundle() {
      if (!docker || dev || resolved.build.ssr) return
      await writeDockerArtifacts({
        root: resolved.root,
        mode: resolved.mode,
        alias: resolved.resolve.alias,
        schemaFile: schema.file,
        publicEnvVar,
        pluginFile: PLUGIN_FILE,
      })
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
  hmr,
}: {
  previous: DevState
  next: DevState
  recovered: boolean
  serverRestart: string[]
  fullReload: string[]
  hmr: boolean
}): Reaction {
  const paths = changedPaths(previous.server.raw, next.server.raw)
  const touches = (patterns: string[]) =>
    paths.some((changed) => matchesAny(changed, patterns))
  return match({
    buildChanged: !isEqual(previous.build.raw, next.build.raw),
    restart: touches(serverRestart),
    reload: !hmr || touches(fullReload),
    changed: paths.length > 0 || recovered,
  })
    .returnType<Reaction>()
    .with({ buildChanged: true }, { restart: true }, () => 'restart')
    .with({ changed: false }, () => 'none')
    .with({ reload: true }, () => 'full-reload')
    .otherwise(() => 'hmr')
}

function configModules(server: ViteDevServer): ModuleNode[] {
  return [RESOLVED_IDS.public, RESOLVED_IDS.server]
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

function writeIfChanged(file: string, content: string) {
  const current = existsSync(file) ? readFileSync(file, 'utf-8') : undefined
  if (current === content) return
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, content)
}
