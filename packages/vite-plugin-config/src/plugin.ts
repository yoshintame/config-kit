import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { loadEnv, type ModuleNode, type Plugin, type ViteDevServer } from 'vite'
import { type ZodType, z } from 'zod'

import { changedPaths, matchesAny } from './changed-paths'
import {
  createDevReader,
  type DevConfigOptions,
  type DevState,
} from './dev-reader'
import { renderEnvDts } from './env-dts'

export const PUBLIC_MODULE_ID = '@senate/config'
export const PRIVATE_MODULE_ID = '@senate/config/private'
const RESOLVED_PUBLIC_ID = '\0senate-config:public'
const RESOLVED_PRIVATE_ID = '\0senate-config:private'

export type SenateConfigOptions = DevConfigOptions & {
  buildEnvSchema?: ZodType
  globalKey?: string
  watch?: boolean
  serverRestart?: string[]
  fullReload?: string[]
  envDts?: string | false
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
  const globalKey = options.globalKey ?? '__CONFIG__'

  let command: 'serve' | 'build'
  let reader: ReturnType<typeof createDevReader> | undefined
  let state: DevState | undefined

  function configModules(server: ViteDevServer): ModuleNode[] {
    return [RESOLVED_PUBLIC_ID, RESOLVED_PRIVATE_ID]
      .map((id) => server.moduleGraph.getModuleById(id))
      .filter((mod): mod is ModuleNode => mod !== undefined)
  }

  async function handleChange(server: ViteDevServer) {
    if (!reader) return
    const prev = state
    try {
      state = reader.load()
    } catch (err) {
      const message = (err as Error).message
      server.config.logger.error(message, { timestamp: true })
      server.ws.send({ type: 'error', err: { message, stack: '' } })
      return
    }

    const envChanged = changedPaths(prev?.env, state.env).length > 0
    const paths = changedPaths(prev?.server, state.server)
    if (!envChanged && paths.length === 0) return

    if (
      envChanged ||
      paths.some((p) => matchesAny(p, options.serverRestart ?? []))
    ) {
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
      command = env.command
      const root = path.resolve(userConfig.root ?? process.cwd())
      if (env.command === 'serve') {
        reader = createDevReader(options, root)
        state = reader.load()
      }

      const schema = options.buildEnvSchema
      if (!schema) return

      const envDir =
        typeof userConfig.envDir === 'string'
          ? path.resolve(root, userConfig.envDir)
          : root
      const result = schema.safeParse({
        ...state?.env,
        ...loadEnv(env.mode, envDir, ''),
      })
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

    configureServer(server) {
      if (options.watch === false || !reader) return
      const watched = new Set(reader.watchedFiles)
      server.watcher.add([...watched])
      const onFile = (file: string) => {
        if (watched.has(path.resolve(file))) void handleChange(server)
      }
      server.watcher.on('change', onFile)
      server.watcher.on('add', onFile)
      server.watcher.on('unlink', onFile)
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
        if (state) {
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
        if (state) {
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
      if (command !== 'build') return
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
