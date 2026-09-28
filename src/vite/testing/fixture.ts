import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { build, createServer, type Plugin, type ViteDevServer } from 'vite'
import { afterEach, beforeEach, vi } from 'vitest'

import { configKit } from '../plugin'

export type ConfigModule = {
  publicConfig?: unknown
  serverConfig?: unknown
  buildConfig?: unknown
}

export const repoDir = fileURLToPath(new URL('../../..', import.meta.url))
const srcDir = join(repoDir, 'src/')

export const sourceResolve = {
  alias: [
    {
      find: /^@yoshintame\/config-kit\/(node|browser)$/,
      replacement: `${srcDir}$1/index.ts`,
    },
    {
      find: /^@yoshintame\/config-kit$/,
      replacement: `${srcDir}core/index.ts`,
    },
  ],
}

export const SERVER_SCHEMA =
  'server: publicSchema.extend({ db: z.object({ url: z.string().transform((url) => url.toUpperCase()) }) })'
export const BUILD_SCHEMA =
  'build: z.object({ devtools: z.boolean().default(false), actAs: z.string().optional() })'

export let root: string
export let yamlPath: string
export let configPath: string
let server: ViteDevServer | undefined

export function trackServer(dev: ViteDevServer): ViteDevServer {
  server = dev
  return dev
}

export function writeYaml(apiUrl: unknown, extra = '', tail = '') {
  writeFileSync(
    yamlPath,
    `public:\n  backend:\n    apiUrl: ${apiUrl}\n${extra}private:\n  db:\n    url: postgres://local\n${tail}`,
  )
}

export function writeConfig({
  schemas = [SERVER_SCHEMA],
  options = [],
  top = [],
}: {
  schemas?: string[]
  options?: string[]
  top?: string[]
} = {}) {
  writeFileSync(
    configPath,
    [
      "import { defineConfigKit } from '@yoshintame/config-kit'",
      "import { z } from 'zod'",
      ...top,
      'const publicSchema = z.object({ backend: z.object({ apiUrl: z.url() }) })',
      'export default defineConfigKit({',
      `  schemas: { public: publicSchema, ${schemas.join(', ')} },`,
      ...options.map((option) => `  ${option},`),
      '})',
      '',
    ].join('\n'),
  )
}

export function writeMain(...lines: string[]) {
  writeFileSync(join(root, 'src/main.ts'), `${lines.join('\n')}\n`)
}

export async function startDev(plugins: Plugin[] = []) {
  server = await createServer({
    root,
    configFile: false,
    resolve: sourceResolve,
    logLevel: 'silent',
    server: { middlewareMode: true, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true },
    plugins: [configKit(), ...plugins],
  })
  return server
}

export async function loadModule(dev: ViteDevServer, id: string) {
  return (await dev.ssrLoadModule(id)) as ConfigModule
}

export async function publicConfig(dev: ViteDevServer) {
  return {
    ...((await loadModule(dev, 'virtual:config-kit')).publicConfig as object),
  }
}

export async function changeFile(
  dev: ViteDevServer,
  apply: () => void,
  file = yamlPath,
  event = 'change',
) {
  apply()
  dev.watcher.emit(event, file)
  await vi.waitFor(() => {})
  await new Promise((resolve) => setTimeout(resolve, 20))
}

export async function runBuild(plugins: Plugin[] = []) {
  await build({
    root,
    configFile: false,
    resolve: sourceResolve,
    logLevel: 'silent',
    build: { minify: false },
    plugins: [configKit(), ...plugins],
  })
  const dist = join(root, 'dist')
  const assets = join(dist, 'assets')
  const js = readdirSync(assets)
    .filter((file) => file.endsWith('.js'))
    .map((file) => readFileSync(join(assets, file), 'utf-8'))
    .join('\n')
  return { html: readFileSync(join(dist, 'index.html'), 'utf-8'), js }
}

export function useFixture(): void {
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'vite-plugin-config-')))
    symlinkSync(join(repoDir, 'node_modules'), join(root, 'node_modules'))
    yamlPath = join(root, 'config.yaml')
    configPath = join(root, 'config-kit.config.ts')
    mkdirSync(join(root, 'src'))
    writeFileSync(
      join(root, 'index.html'),
      '<!doctype html><html><head></head><body><script type="module" src="/src/main.ts"></script></body></html>',
    )
    writeMain(
      "import { publicConfig } from 'virtual:config-kit'",
      'console.log(publicConfig.backend.apiUrl)',
    )
    writeConfig()
    writeYaml('https://api.local')
    delete process.env.APP_PUBLIC_CONFIG
    delete process.env.APP_PRIVATE_CONFIG
  })

  afterEach(async () => {
    await server?.close()
    server = undefined
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    delete process.env.APP_PUBLIC_CONFIG
    delete process.env.APP_PRIVATE_CONFIG
    rmSync(root, { recursive: true, force: true })
  })
}
