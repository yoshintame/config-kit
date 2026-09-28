import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { isEqual, union } from 'es-toolkit'
import { match, P } from 'ts-pattern'
import type { ModuleNode, Plugin, ResolvedConfig, ViteDevServer } from 'vite'

import { errorMessage, Section } from '../core'
import { collectSecrets, findBuildProblems, type Secret } from './build-checks'
import { changedPaths, matchesAny } from './changed-paths'
import { transformConfigFile } from './client-split'
import { type ConfigFile, importConfigFile } from './config-file'
import {
  configModulesBySection,
  envPlaceholder,
  PACKAGE_NAME,
} from './constants'
import {
  createDevReader,
  type DevReader,
  type DevState,
  loadBuildConfig,
} from './dev-reader'
import { writeDockerArtifacts } from './docker'
import { resolveGeneratedImport } from './generated-imports'
import { buildConfigModule, buildModule, devModule } from './virtual-modules'

export interface ConfigKitOptions {
  configFile?: string
}

interface ServeMode {
  command: 'serve'
  reader: DevReader
  state: DevState
  failed: boolean
}

interface BuildMode {
  command: 'build'
  buildConfig: unknown
  secrets: Secret[]
}

type Mode = ServeMode | BuildMode

enum Reaction {
  None = 'none',
  Restart = 'restart',
  FullReload = 'full-reload',
  Hmr = 'hmr',
}

const PLUGIN_FILE = fileURLToPath(import.meta.url)

export function configKit({ configFile }: ConfigKitOptions = {}): Plugin {
  let loaded: ConfigFile
  let resolved: ResolvedConfig
  let mode: Mode

  async function handleChange(server: ViteDevServer, dev: ServeMode) {
    const next = tryLoad(dev.reader, server)
    if (!next) {
      dev.failed = true
      return
    }
    const reaction = reactionFor({
      previous: dev.state,
      next,
      recovered: dev.failed,
      settings: loaded.settings.dev,
    })
    dev.state = next
    dev.failed = false
    await match(reaction)
      .with(Reaction.None, () => undefined)
      .with(Reaction.Restart, () => server.restart())
      .with(Reaction.FullReload, () => fullReloadConfig(server))
      .with(Reaction.Hmr, () => hotReloadConfig(server))
      .exhaustive()
  }

  function clientBuild(): BuildMode | undefined {
    return match(mode)
      .with({ command: 'build' }, (build) =>
        resolved.build.ssr ? undefined : build,
      )
      .otherwise(() => undefined)
  }

  function watchedServe(): ServeMode | undefined {
    return match(mode)
      .with({ command: 'serve' }, (serve) =>
        loaded.settings.dev.watch ? serve : undefined,
      )
      .otherwise(() => undefined)
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
      mode = match(env.command)
        .returnType<Mode>()
        .with('serve', () => {
          const reader = createDevReader(loaded.settings, root)
          return {
            command: 'serve',
            reader,
            state: reader.load(),
            failed: false,
          }
        })
        .with('build', () => ({
          command: 'build',
          buildConfig: loadBuildConfig(loaded.settings),
          secrets: collectSecrets(loaded.settings, root),
        }))
        .exhaustive()
      return {
        optimizeDeps: {
          include: [PACKAGE_NAME, `${PACKAGE_NAME}/browser`],
        },
      }
    },

    configResolved(config) {
      resolved = config
    },

    configureServer(server) {
      const dev = watchedServe()
      if (!dev) return
      const configFiles = new Set(dev.reader.watchedFiles)
      const schemaFiles = new Set(loaded.dependencies)
      server.watcher.add([...configFiles, ...schemaFiles])
      const onFile = (file: string) =>
        match(path.resolve(file))
          .when(
            (changed) => schemaFiles.has(changed),
            () => void server.restart(),
          )
          .when(
            (changed) => configFiles.has(changed),
            () => void handleChange(server, dev),
          )
          .otherwise(() => undefined)
      for (const event of ['change', 'add', 'unlink'] as const) {
        server.watcher.on(event, onFile)
      }
    },

    resolveId(id, importer, options) {
      const section = sectionOfId(id)
      return match({ section, fromGenerated: isGeneratedModule(importer) })
        .with({ section: Section.Server }, () =>
          options?.ssr
            ? configModulesBySection[Section.Server].resolvedId
            : this.error(
                `${configModulesBySection[Section.Server].id} is server-only`,
              ),
        )
        .with({ section: Section.Build }, () =>
          loaded.settings.definition.schemas.build
            ? configModulesBySection[Section.Build].resolvedId
            : this.error(
                `${configModulesBySection[Section.Build].id} needs schemas.build in ${loaded.configPath}`,
              ),
        )
        .with(
          { section: Section.Public },
          () => configModulesBySection[Section.Public].resolvedId,
        )
        .with({ fromGenerated: true }, () =>
          resolveGeneratedImport(this, {
            id,
            configPath: loaded.configPath,
            pluginFile: PLUGIN_FILE,
            options,
          }),
        )
        .otherwise(() => null)
    },

    load(id, options) {
      const section = sectionOfResolvedId(id)
      if (section === undefined) return undefined
      const { settings, configPath } = loaded
      return match({ section, mode })
        .with(
          { section: Section.Build, mode: { command: 'serve' } },
          ({ mode }) =>
            buildConfigModule(mode.state.buildConfig, settings.buildShape),
        )
        .with(
          { section: Section.Build, mode: { command: 'build' } },
          ({ mode }) =>
            buildConfigModule(mode.buildConfig, settings.buildShape),
        )
        .with(
          {
            section: P.union(Section.Public, Section.Server),
            mode: { command: 'serve' },
          },
          ({ section, mode }) =>
            devModule({
              section,
              configPath,
              settings,
              loaded:
                section === Section.Public
                  ? mode.state.public
                  : mode.state.server,
              hmr: settings.dev.hmr,
            }),
        )
        .with(
          {
            section: P.union(Section.Public, Section.Server),
            mode: { command: 'build' },
          },
          ({ section }) =>
            buildModule({
              section,
              configPath,
              settings,
              ssr: options?.ssr === true,
            }),
        )
        .exhaustive()
    },

    transform: {
      order: 'post',
      handler(code, id, options) {
        return transformConfigFile(this, {
          code,
          id,
          ssr: options?.ssr === true,
          configPath: loaded.configPath,
          keepOnInvalid: true,
          skipSsr: true,
        })
      },
    },

    transformIndexHtml() {
      if (mode.command === 'serve') return
      return [
        {
          tag: 'script',
          attrs: { type: 'application/json', id: loaded.settings.elementId },
          children: envPlaceholder(loaded.settings.envVars.public),
          injectTo: 'head-prepend',
        },
      ]
    },

    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const build = clientBuild()
        if (!build) return
        const problems = findBuildProblems(bundle, {
          secrets: build.secrets,
          publicEnvVar: loaded.settings.envVars.public,
        })
        if (problems.length > 0) this.error(problems.join('\n'))
      },
    },

    async writeBundle() {
      const build = loaded.settings.docker ? clientBuild() : undefined
      if (!build) return
      await writeDockerArtifacts({
        root: resolved.root,
        mode: resolved.mode,
        alias: resolved.resolve.alias,
        configPath: loaded.configPath,
        settings: loaded.settings,
        pluginFile: PLUGIN_FILE,
      })
    },
  }
}

function tryLoad(
  reader: DevReader,
  server: ViteDevServer,
): DevState | undefined {
  try {
    return reader.load()
  } catch (error) {
    const message = errorMessage(error)
    server.config.logger.error(message, { timestamp: true })
    server.ws.send({ type: 'error', err: { message, stack: '' } })
    return undefined
  }
}

function reactionFor({
  previous,
  next,
  recovered,
  settings: { serverRestart, fullReload, hmr },
}: {
  previous: DevState
  next: DevState
  recovered: boolean
  settings: { serverRestart: string[]; fullReload: string[]; hmr: boolean }
}): Reaction {
  const paths = union(
    changedPaths(previous.public.raw, next.public.raw),
    changedPaths(previous.server.raw, next.server.raw),
  )
  const touches = (patterns: string[]) =>
    paths.some((changed) => matchesAny(changed, patterns))
  return match({
    buildChanged: !isEqual(previous.build?.raw, next.build?.raw),
    restart: touches(serverRestart),
    reload: hmr ? touches(fullReload) : true,
    changed: paths.length > 0 ? true : recovered,
  })
    .returnType<Reaction>()
    .with({ buildChanged: true }, { restart: true }, () => Reaction.Restart)
    .with({ changed: false }, () => Reaction.None)
    .with({ reload: true }, () => Reaction.FullReload)
    .otherwise(() => Reaction.Hmr)
}

function configModules(server: ViteDevServer): ModuleNode[] {
  return [Section.Public, Section.Server]
    .map((section) =>
      server.moduleGraph.getModuleById(
        configModulesBySection[section].resolvedId,
      ),
    )
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

function sectionOfId(id: string): Section | undefined {
  return Object.values(Section).find(
    (section) => configModulesBySection[section].id === id,
  )
}

function sectionOfResolvedId(id: string): Section | undefined {
  return Object.values(Section).find(
    (section) => configModulesBySection[section].resolvedId === id,
  )
}

function isGeneratedModule(id: string | undefined): boolean {
  return sectionOfResolvedId(id ?? '') !== undefined
}
