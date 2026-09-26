import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { isEqual } from 'es-toolkit'
import { match } from 'ts-pattern'
import type { ModuleNode, Plugin, ResolvedConfig, ViteDevServer } from 'vite'

import { changedPaths, matchesAny } from './changed-paths'
import { transformConfigFile } from './client-split'
import { type ConfigFile, importConfigFile } from './config-file'
import {
  BUILD_MODULE_ID,
  PRIVATE_MODULE_ID,
  PUBLIC_MODULE_ID,
} from './constants'
import {
  createDevReader,
  type DevReader,
  type DevState,
  loadBuildConfig,
} from './dev-reader'
import { writeDockerArtifacts } from './docker'
import { collectSecrets, findLeaks, type Secret } from './leaks'
import {
  buildConfigModule,
  buildModule,
  type ConfigModuleKind,
  devModule,
} from './virtual-modules'

export interface ConfigKitOptions {
  configFile?: string
}

type Reaction = 'none' | 'restart' | 'full-reload' | 'hmr'
type ModuleKind = ConfigModuleKind | 'build'

const RESOLVED_IDS: Record<ModuleKind, string> = {
  public: '\0config-kit:public',
  server: '\0config-kit:private',
  build: '\0config-kit:build',
}
const PLUGIN_FILE = fileURLToPath(import.meta.url)

export function configKit({ configFile }: ConfigKitOptions = {}): Plugin {
  let loaded: ConfigFile
  let resolved: ResolvedConfig
  let dev: { reader: DevReader; state: DevState } | undefined
  let buildConfig: unknown
  let secrets: Secret[] = []
  let failed = false

  async function handleChange(server: ViteDevServer) {
    if (!dev) return
    const next = tryLoad(dev.reader, server)
    if (!next) {
      failed = true
      return
    }
    const { serverRestart, fullReload, hmr } = loaded.settings.dev
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

  function isClientBuild() {
    return !dev && !resolved.build.ssr
  }

  return {
    name: 'config-kit',
    enforce: 'pre',

    async config(userConfig, env) {
      const root = path.resolve(userConfig.root ?? process.cwd())
      loaded = await importConfigFile({
        root,
        configFile,
        alias: userConfig.resolve?.alias,
      })
      if (env.command === 'serve') {
        const reader = createDevReader(loaded.settings, root)
        dev = { reader, state: reader.load() }
      } else {
        buildConfig = loadBuildConfig(loaded.settings)
        secrets = collectSecrets(loaded.settings, root)
      }
    },

    configResolved(config) {
      resolved = config
    },

    configureServer(server) {
      if (!loaded.settings.dev.watch || !dev) return
      const configFiles = new Set(dev.reader.watchedFiles)
      const schemaFiles = new Set(loaded.dependencies)
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
          loaded.settings.definition.schemas.build
            ? RESOLVED_IDS.build
            : this.error(
                `${BUILD_MODULE_ID} needs schemas.build in ${loaded.file}`,
              ),
        )
        .when(
          () => isVirtualModule(importer),
          () =>
            id === loaded.file
              ? id
              : this.resolve(id, PLUGIN_FILE, { ...options, skipSelf: true }),
        )
        .otherwise(() => null)
    },

    load(id, options) {
      const kind = moduleKindOf(id)
      if (!kind) return
      const { settings } = loaded
      if (kind === 'build') {
        return buildConfigModule(
          dev ? dev.state.buildConfig : buildConfig,
          settings.buildShape,
        )
      }
      const target = { kind, configFile: loaded.file, settings }
      return dev
        ? devModule({
            ...target,
            loaded: dev.state[kind],
            hmr: settings.dev.hmr,
          })
        : buildModule({ ...target, ssr: options?.ssr === true })
    },

    transform: {
      order: 'post',
      handler(code, id, options) {
        if (options?.ssr || id.split('?')[0] !== loaded.file) return
        return transformConfigFile(this, code, { keepOnInvalid: true })
      },
    },

    transformIndexHtml() {
      if (dev) return
      return [
        {
          tag: 'script',
          attrs: { type: 'application/json', id: loaded.settings.elementId },
          children: placeholder(loaded.settings.envVars.public),
          injectTo: 'head-prepend',
        },
      ]
    },

    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        if (!isClientBuild()) return
        const expected = placeholder(loaded.settings.envVars.public)
        const pages = Object.values(bundle).filter(
          (output) =>
            output.type === 'asset' && output.fileName.endsWith('.html'),
        )
        const missing = pages.filter(
          (page) =>
            page.type === 'asset' && !String(page.source).includes(expected),
        )
        if (missing.length > 0) {
          this.error(
            `${missing.map((page) => page.fileName).join(', ')} lost the ${expected} placeholder: the container cannot inject the config. Check plugins that rewrite index.html`,
          )
        }
        const leaks = findLeaks(bundle, secrets)
        if (leaks.length > 0) {
          this.error(
            `Private or sensitive config values found in the bundle: ${leaks.join(', ')}`,
          )
        }
      },
    },

    async closeBundle() {
      if (!loaded.settings.docker || !isClientBuild()) return
      await writeDockerArtifacts({
        root: resolved.root,
        mode: resolved.mode,
        alias: resolved.resolve.alias,
        configFile: loaded.file,
        settings: loaded.settings,
        pluginFile: PLUGIN_FILE,
      })
    },
  }
}

function placeholder(envVar: string): string {
  return `\${${envVar}}`
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
