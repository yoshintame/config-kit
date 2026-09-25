import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import {
  createSyncConfigLoader,
  firstNonEmpty,
  type SyncConfigSource,
} from '@senate/config-core'
import {
  createFileSource,
  createProcessEnvSource,
  yamlParser,
} from '@senate/config-node'
import { findUpSync } from 'find-up'
import {
  loadEnv,
  type ModuleNode,
  type Plugin,
  type ResolvedConfig,
  type ViteDevServer,
} from 'vite'
import { type ZodType, z } from 'zod'

import { changedPaths, matchesAny } from './changed-paths'
import { renderEnvDts } from './env-dts'

export const PUBLIC_MODULE_ID = '@senate/config'
export const PRIVATE_MODULE_ID = '@senate/config/private'
const RESOLVED_PUBLIC_ID = '\0senate-config:public'
const RESOLVED_PRIVATE_ID = '\0senate-config:private'

export type SenateConfigOptions = {
  schema?: ZodType
  serverSchema?: ZodType
  buildEnvSchema?: ZodType
  publicEnvVar?: string
  privateEnvVar?: string
  yamlFile?: string
  yamlPath?: string
  globalKey?: string
  watch?: boolean
  serverRestart?: string[]
  fullReload?: string[]
  envDts?: string | false
}

type DevState = {
  public: unknown
  server: unknown
  origin: string
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function section(source: SyncConfigSource, key: string): SyncConfigSource {
  return {
    loadSync() {
      const value = source.loadSync()
      return isPlainObject(value) ? value[key] : undefined
    },
    describe: () => `${source.describe()} (${key})`,
  }
}

function validate(schema: ZodType | undefined, raw: unknown, origin: string) {
  if (!schema) return
  const loader = createSyncConfigLoader({
    loadSync: () => raw,
    describe: () => origin,
  })
  loader.defineConfig(schema)
  loader.validateAll()
}

function staticSourceModule(raw: unknown, origin: string): string {
  return [
    `const raw = ${JSON.stringify(raw)}`,
    `export const source = { loadSync: () => raw, describe: () => ${JSON.stringify(origin)} }`,
  ].join('\n')
}

export function senateConfig(options: SenateConfigOptions = {}): Plugin {
  const publicEnvVar = options.publicEnvVar ?? 'APP_PUBLIC_CONFIG'
  const privateEnvVar = options.privateEnvVar ?? 'APP_PRIVATE_CONFIG'
  const yamlFile = options.yamlFile ?? 'config.yaml'
  const globalKey = options.globalKey ?? '__CONFIG__'

  let resolved: ResolvedConfig
  let yamlPath: string | undefined
  let state: DevState | undefined

  function loadState(): DevState {
    const yaml = yamlPath
      ? createFileSource({ path: yamlPath, parser: yamlParser })
      : undefined
    const publicSource = firstNonEmpty([
      createProcessEnvSource({ envVar: publicEnvVar }),
      ...(yaml ? [section(yaml, 'public')] : []),
    ])
    const publicRaw = publicSource.loadSync()
    const origin = publicSource.describe()
    validate(options.schema, publicRaw, origin)

    const privateRaw =
      createProcessEnvSource({ envVar: privateEnvVar }).loadSync() ??
      (yaml ? section(yaml, 'private').loadSync() : undefined)
    const serverRaw = { ...(publicRaw as object), ...(privateRaw as object) }
    validate(options.serverSchema, serverRaw, origin)

    return { public: publicRaw, server: serverRaw, origin }
  }

  function configModules(server: ViteDevServer): ModuleNode[] {
    return [RESOLVED_PUBLIC_ID, RESOLVED_PRIVATE_ID]
      .map((id) => server.moduleGraph.getModuleById(id))
      .filter((mod): mod is ModuleNode => mod !== undefined)
  }

  async function handleChange(server: ViteDevServer) {
    const prev = state
    try {
      state = loadState()
    } catch (err) {
      const message = (err as Error).message
      server.config.logger.error(message, { timestamp: true })
      server.ws.send({ type: 'error', err: { message, stack: '' } })
      return
    }

    const paths = changedPaths(prev?.server, state.server)
    if (paths.length === 0) return

    if (paths.some((p) => matchesAny(p, options.serverRestart ?? []))) {
      await server.restart()
      return
    }

    const modules = configModules(server)
    if (paths.some((p) => matchesAny(p, options.fullReload ?? []))) {
      for (const mod of modules) server.moduleGraph.invalidateModule(mod)
      server.ws.send({ type: 'full-reload' })
      return
    }

    for (const mod of modules) await server.reloadModule(mod)
  }

  return {
    name: 'senate-config',

    config(userConfig, env) {
      const schema = options.buildEnvSchema
      if (!schema) return

      const root = path.resolve(userConfig.root ?? process.cwd())
      const envDir =
        typeof userConfig.envDir === 'string'
          ? path.resolve(root, userConfig.envDir)
          : root
      const result = schema.safeParse(loadEnv(env.mode, envDir, ''))
      if (!result.success) {
        throw new Error(
          `Build env validation failed:\n${z.prettifyError(result.error)}`,
        )
      }

      if (options.envDts) {
        const file = path.resolve(root, options.envDts)
        const content = renderEnvDts(schema)
        if (!existsSync(file) || readFileSync(file, 'utf-8') !== content) {
          writeFileSync(file, content)
        }
      }

      return {
        define: Object.fromEntries(
          Object.entries(result.data as Record<string, unknown>).map(
            ([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)],
          ),
        ),
      }
    },

    configResolved(config) {
      resolved = config
      if (config.command !== 'serve') return
      yamlPath = options.yamlPath
        ? path.resolve(config.root, options.yamlPath)
        : findUpSync(yamlFile, { cwd: config.root })
      state = loadState()
    },

    configureServer(server) {
      if (options.watch === false || !yamlPath) return
      const watched = yamlPath
      server.watcher.add(watched)
      server.watcher.on('change', (file) => {
        if (path.resolve(file) === watched) void handleChange(server)
      })
    },

    resolveId(id, _importer, resolveOptions) {
      if (id === PUBLIC_MODULE_ID) return RESOLVED_PUBLIC_ID
      if (id === PRIVATE_MODULE_ID) {
        if (!resolveOptions?.ssr) {
          this.error(`${PRIVATE_MODULE_ID} is server-only`)
        }
        return RESOLVED_PRIVATE_ID
      }
    },

    load(id) {
      if (id === RESOLVED_PUBLIC_ID) {
        if (resolved.command === 'serve' && state) {
          return staticSourceModule(state.public, state.origin)
        }
        return [
          'export const source = {',
          `  loadSync: () => globalThis[${JSON.stringify(globalKey)}],`,
          `  describe: () => ${JSON.stringify(`window.${globalKey}`)},`,
          '}',
        ].join('\n')
      }

      if (id === RESOLVED_PRIVATE_ID) {
        if (resolved.command === 'serve' && state) {
          return staticSourceModule(state.server, state.origin)
        }
        return [
          'const read = (name) => {',
          '  const value = process.env[name]',
          '  return value ? JSON.parse(value) : undefined',
          '}',
          'export const source = {',
          '  loadSync() {',
          `    const pub = read(${JSON.stringify(publicEnvVar)})`,
          `    const priv = read(${JSON.stringify(privateEnvVar)})`,
          '    return pub === undefined && priv === undefined ? undefined : { ...pub, ...priv }',
          '  },',
          `  describe: () => ${JSON.stringify(`env ${publicEnvVar} + ${privateEnvVar}`)},`,
          '}',
        ].join('\n')
      }
    },

    transformIndexHtml() {
      if (resolved.command !== 'build') return
      return [
        {
          tag: 'script',
          children: `window.${globalKey} = \${${publicEnvVar}}`,
          injectTo: 'head-prepend',
        },
      ]
    },
  }
}
