import { spawnSync } from 'node:child_process'
import {
  existsSync,
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
import { fileURLToPath, pathToFileURL } from 'node:url'

import { build, createServer, type Plugin, type ViteDevServer } from 'vite'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { z } from 'zod'

import { defineConfigKit } from '../core'
import { loadDevConfig } from './dev-reader'
import { INJECT_HOOK_FILE, VALIDATOR_FILE } from './docker'
import { configKit } from './plugin'

type ConfigModule = {
  publicConfig?: unknown
  serverConfig?: unknown
  buildConfig?: unknown
}

const repoDir = fileURLToPath(new URL('../..', import.meta.url))
const srcDir = join(repoDir, 'src/')

const sourceResolve = {
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

const SERVER_SCHEMA =
  'server: publicSchema.extend({ db: z.object({ url: z.string().transform((url) => url.toUpperCase()) }) })'
const BUILD_SCHEMA =
  'build: z.object({ devtools: z.boolean().default(false), actAs: z.string().optional() })'

let root: string
let yamlPath: string
let configPath: string
let server: ViteDevServer | undefined

function writeYaml(apiUrl: unknown, extra = '', tail = '') {
  writeFileSync(
    yamlPath,
    `public:\n  backend:\n    apiUrl: ${apiUrl}\n${extra}private:\n  db:\n    url: postgres://local\n${tail}`,
  )
}

function writeConfig({
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

function writeMain(...lines: string[]) {
  writeFileSync(join(root, 'src/main.ts'), `${lines.join('\n')}\n`)
}

async function startDev(plugins: Plugin[] = []) {
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

async function loadModule(dev: ViteDevServer, id: string) {
  return (await dev.ssrLoadModule(id)) as ConfigModule
}

async function publicConfig(dev: ViteDevServer) {
  return {
    ...((await loadModule(dev, 'virtual:config-kit')).publicConfig as object),
  }
}

async function changeFile(
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

async function runBuild(plugins: Plugin[] = []) {
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

describe('config file', () => {
  test('fails without the config file', async () => {
    rmSync(configPath)
    await expect(startDev()).rejects.toThrow(
      /config-kit\.config\.ts not found\. Create it with defineConfigKit/,
    )
  })

  test('fails without a default export', async () => {
    writeFileSync(configPath, 'export const other = 1\n')
    await expect(startDev()).rejects.toThrow(
      /must default-export defineConfigKit\(\{ schemas \}\)/,
    )
  })

  test('fails on a non-schema section', async () => {
    writeConfig({ schemas: ['build: {}'] })
    await expect(startDev()).rejects.toThrow(
      /schemas\.build is not a Standard Schema/,
    )
  })

  test('configFile points at another path', async () => {
    const other = join(root, 'config/app.config.ts')
    mkdirSync(join(root, 'config'))
    writeFileSync(other, readFileSync(configPath, 'utf-8'))
    rmSync(configPath)
    server = await createServer({
      root,
      configFile: false,
      resolve: sourceResolve,
      logLevel: 'silent',
      server: { middlewareMode: true, ws: false, watch: null },
      plugins: [configKit({ configFile: 'config/app.config.ts' })],
    })
    expect(await publicConfig(server)).toEqual({
      backend: { apiUrl: 'https://api.local' },
    })
  })

  test('change restarts the server', async () => {
    const dev = await startDev()
    const restart = vi.spyOn(dev, 'restart').mockResolvedValue()

    await changeFile(
      dev,
      () => writeConfig({ top: ['// changed'] }),
      configPath,
    )

    expect(restart).toHaveBeenCalledOnce()
  })
})

describe('dev', () => {
  test('public module exposes the validated public section', async () => {
    const dev = await startDev()
    expect(await publicConfig(dev)).toEqual({
      backend: { apiUrl: 'https://api.local' },
    })
  })

  test('private module merges public and private sections', async () => {
    const dev = await startDev()
    const mod = await loadModule(dev, 'virtual:config-kit/private')
    expect(mod.serverConfig).toEqual({
      backend: { apiUrl: 'https://api.local' },
      db: { url: 'POSTGRES://LOCAL' },
    })
  })

  test('env var wins over yaml', async () => {
    process.env.APP_PUBLIC_CONFIG = JSON.stringify({
      backend: { apiUrl: 'https://api.env' },
    })
    const dev = await startDev()
    expect(await publicConfig(dev)).toEqual({
      backend: { apiUrl: 'https://api.env' },
    })
  })

  test('an empty env var is a value, not a fallback to yaml', async () => {
    process.env.APP_PUBLIC_CONFIG = ''
    await expect(startDev()).rejects.toThrow(
      /Failed to parse env APP_PUBLIC_CONFIG/,
    )
  })

  test('fails to start on invalid runtime config', async () => {
    writeYaml('not-a-url')
    await expect(startDev()).rejects.toThrow(
      /Config validation failed for 'public' \(loaded from merge of \[file .*config\.yaml, file .*config\.local\.yaml\] \(public\)\)/,
    )
  })

  test('fails to start on unknown keys', async () => {
    writeYaml('https://api.local', '  typo: 1\n')
    await expect(startDev()).rejects.toThrow(
      /Unknown top-level config keys for 'public' .*: typo/,
    )
  })

  test('unknownKeys: warn starts with a warning', async () => {
    writeConfig({ options: ["unknownKeys: 'warn'"] })
    writeYaml('https://api.local', '  typo: 1\n')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await startDev()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(': typo'))
  })

  test('private env var wins over yaml private section', async () => {
    process.env.APP_PRIVATE_CONFIG = JSON.stringify({ db: { url: 'from-env' } })
    const dev = await startDev()
    expect(
      (await loadModule(dev, 'virtual:config-kit/private')).serverConfig,
    ).toMatchObject({ db: { url: 'FROM-ENV' } })
  })

  test('fails to start on invalid server config', async () => {
    writeConfig({
      schemas: ['server: z.object({ db: z.object({ url: z.number() }) })'],
    })
    await expect(startDev()).rejects.toThrow(
      /Config validation failed for 'server'/,
    )
  })

  test('fails to start on an unknown yaml section', async () => {
    writeYaml('https://api.local', '', 'env:\n  VITE_FLAG: true\n')
    await expect(startDev()).rejects.toThrow(/Unknown sections in .*: env/)
  })

  test('runs from env var alone without config.yaml', async () => {
    writeConfig({ schemas: [] })
    rmSync(yamlPath)
    process.env.APP_PUBLIC_CONFIG = JSON.stringify({
      backend: { apiUrl: 'https://api.env' },
    })
    const dev = await startDev()
    expect(await publicConfig(dev)).toEqual({
      backend: { apiUrl: 'https://api.env' },
    })
  })

  test('client code resolves the public module and the config file', async () => {
    const dev = await startDev()
    expect((await dev.transformRequest('/src/main.ts'))?.code).toContain(
      'config-kit:public',
    )
    expect((await dev.transformRequest('virtual:config-kit'))?.code).toContain(
      '/config-kit.config.ts',
    )
  })

  test('client code resolves regular imports', async () => {
    writeFileSync(join(root, 'src/value.ts'), 'export const value = 1\n')
    writeFileSync(
      join(root, 'src/app.ts'),
      "import { value } from './value'\nconsole.log(value)\n",
    )
    const dev = await startDev()
    const result = await dev.transformRequest('/src/app.ts')
    expect(result?.code).toContain('/src/value.ts')
  })

  test('client copy of the config file keeps only the public schema and onInvalid', async () => {
    writeConfig({
      schemas: [SERVER_SCHEMA, BUILD_SCHEMA],
      options: [
        "onInvalid() { console.log('ON_INVALID') }",
        "dev: { serverRestart: ['DEV_OPTION'] }",
      ],
    })
    const dev = await startDev()
    const code = (await dev.transformRequest('/config-kit.config.ts'))?.code
    expect(code).toContain('ON_INVALID')
    expect(code).not.toContain('DEV_OPTION')
    expect(code).not.toContain('server:')
  })

  test('watches config.yaml found above the root', async () => {
    const appRoot = join(root, 'app')
    mkdirSync(join(appRoot, 'src'), { recursive: true })
    writeFileSync(
      join(appRoot, 'config-kit.config.ts'),
      readFileSync(configPath, 'utf-8'),
    )
    server = await createServer({
      root: appRoot,
      configFile: false,
      resolve: sourceResolve,
      logLevel: 'silent',
      server: { middlewareMode: true, ws: false },
      plugins: [configKit()],
    })
    expect(server.watcher.getWatched()[root]).toContain('config.yaml')
  })

  test('does not inject the placeholder script', async () => {
    const dev = await startDev()
    const html = await dev.transformIndexHtml(
      '/index.html',
      readFileSync(join(root, 'index.html'), 'utf-8'),
    )
    expect(html).not.toContain('__CONFIG__')
  })

  test('private module is rejected in client code', async () => {
    writeFileSync(
      join(root, 'src/leak.ts'),
      "export { serverConfig } from 'virtual:config-kit/private'\n",
    )
    const dev = await startDev()
    await expect(dev.transformRequest('/src/leak.ts')).rejects.toThrow(
      /server-only/,
    )
  })
})

describe('local yaml', () => {
  test('overrides committed yaml', async () => {
    writeFileSync(
      join(root, 'config.local.yaml'),
      'public:\n  backend:\n    apiUrl: https://api.mine\n',
    )
    const dev = await startDev()
    expect(await publicConfig(dev)).toEqual({
      backend: { apiUrl: 'https://api.mine' },
    })
  })

  test('creating it at runtime reloads config', async () => {
    const dev = await startDev()
    await publicConfig(dev)
    const localPath = join(root, 'config.local.yaml')

    await changeFile(
      dev,
      () =>
        writeFileSync(
          localPath,
          'public:\n  backend:\n    apiUrl: https://api.mine\n',
        ),
      localPath,
      'add',
    )

    expect(await publicConfig(dev)).toEqual({
      backend: { apiUrl: 'https://api.mine' },
    })
  })

  test('reverts overrides when the local yaml is deleted', async () => {
    const localPath = join(root, 'config.local.yaml')
    writeFileSync(
      localPath,
      'public:\n  backend:\n    apiUrl: https://api.mine\n',
    )
    const dev = await startDev()
    await publicConfig(dev)

    await changeFile(dev, () => rmSync(localPath), localPath, 'unlink')

    expect(await publicConfig(dev)).toEqual({
      backend: { apiUrl: 'https://api.local' },
    })
  })
})

describe('build section', () => {
  beforeEach(() => writeConfig({ schemas: [SERVER_SCHEMA, BUILD_SCHEMA] }))

  test('feeds the build module in dev', async () => {
    writeYaml('https://api.local', '', 'build:\n  actAs: e2e-super\n')
    const dev = await startDev()
    expect(
      (await loadModule(dev, 'virtual:config-kit/build')).buildConfig,
    ).toEqual({ devtools: false, actAs: 'e2e-super' })
  })

  test('change restarts the server', async () => {
    writeYaml('https://api.local', '', 'build:\n  devtools: false\n')
    const dev = await startDev()
    const restart = vi.spyOn(dev, 'restart').mockResolvedValue()

    await changeFile(dev, () =>
      writeYaml('https://api.local', '', 'build:\n  devtools: true\n'),
    )

    expect(restart).toHaveBeenCalledOnce()
  })

  test('build module needs schemas.build', async () => {
    writeConfig()
    writeFileSync(
      join(root, 'src/flags.ts'),
      "export { buildConfig } from 'virtual:config-kit/build'\n",
    )
    const dev = await startDev()
    await expect(dev.transformRequest('/src/flags.ts')).rejects.toThrow(
      /needs schemas\.build in .*config-kit\.config\.ts/,
    )
  })

  test('is ignored in build and dead branches are removed', async () => {
    writeYaml(
      'https://api.local',
      '',
      'build:\n  devtools: true\n  actAs: e2e-super\n',
    )
    writeMain(
      "import { buildConfig } from 'virtual:config-kit/build'",
      "if (buildConfig.devtools) console.log('DEVTOOLS_ON')",
      "console.log(buildConfig.actAs ?? 'NO_ACT_AS')",
      "if (buildConfig.actAs) console.log('ACT_AS_ON')",
    )
    const { js } = await runBuild()
    expect(js).not.toContain('DEVTOOLS_ON')
    expect(js).not.toContain('e2e-super')
    expect(js).toContain('NO_ACT_AS')
    expect(js).not.toContain('ACT_AS_ON')
    expect(js).not.toContain('buildConfig')
  })

  test('build env var sets values in build', async () => {
    vi.stubEnv('APP_BUILD_CONFIG', JSON.stringify({ devtools: true }))
    writeMain(
      "import { buildConfig } from 'virtual:config-kit/build'",
      "if (buildConfig.devtools) console.log('DEVTOOLS_ON')",
    )
    const { js } = await runBuild()
    expect(js).toContain('DEVTOOLS_ON')
  })

  test('fails the build on an invalid build env var', async () => {
    vi.stubEnv('APP_BUILD_CONFIG', JSON.stringify({ devtools: 'maybe' }))
    await expect(runBuild()).rejects.toThrow(
      /Config validation failed for 'build' \(loaded from env APP_BUILD_CONFIG\)/,
    )
  })
})

describe('sensitive', () => {
  beforeEach(() =>
    writeConfig({
      schemas: [SERVER_SCHEMA, BUILD_SCHEMA],
      options: ["sensitive: ['build.actAs']"],
    }),
  )

  test('is allowed in dev', async () => {
    writeYaml('https://api.local', '', 'build:\n  actAs: e2e-super\n')
    const dev = await startDev()
    expect(
      (await loadModule(dev, 'virtual:config-kit/build')).buildConfig,
    ).toMatchObject({ actAs: 'e2e-super' })
  })

  test('fails the build when set', async () => {
    vi.stubEnv('APP_BUILD_CONFIG', JSON.stringify({ actAs: 'e2e-super' }))
    await expect(runBuild()).rejects.toThrow(
      /Sensitive build config is set in env APP_BUILD_CONFIG: build\.actAs/,
    )
  })

  test('fails the build when its dev value reaches a chunk', async () => {
    writeYaml('https://api.local', '', 'build:\n  actAs: e2e-super-token\n')
    writeMain("console.log('e2e-super-token')")
    await expect(runBuild()).rejects.toThrow(
      /Private or sensitive config values found in the bundle: build\.actAs in assets\/index-.*\.js/,
    )
  })
})

describe('leak scan', () => {
  test('fails the build when a private value reaches a chunk', async () => {
    writeMain("console.log('postgres://local')")
    await expect(runBuild()).rejects.toThrow(
      /found in the bundle: private\.db\.url in assets\/index-.*\.js/,
    )
  })

  test('checks private values from the env var', async () => {
    vi.stubEnv(
      'APP_PRIVATE_CONFIG',
      JSON.stringify({ db: { url: 'postgres://from-env' } }),
    )
    writeMain("console.log('postgres://from-env')")
    await expect(runBuild()).rejects.toThrow(/private\.db\.url/)
  })

  test('skips private values that are also public', async () => {
    writeYaml('https://api.local', '', 'build:\n  x: 1\n'.replace(/.*/s, ''))
    writeFileSync(
      yamlPath,
      'public:\n  backend:\n    apiUrl: https://api.local\nprivate:\n  db:\n    url: https://api.local\n',
    )
    writeMain("console.log('https://api.local')")
    await expect(runBuild()).resolves.toBeDefined()
  })

  test('skips short values', async () => {
    writeFileSync(
      yamlPath,
      'public:\n  backend:\n    apiUrl: https://api.local\nprivate:\n  db:\n    url: pg\n',
    )
    writeMain("console.log('pg')")
    await expect(runBuild()).resolves.toBeDefined()
  })
})

describe('loadDevConfig', () => {
  const definition = defineConfigKit({
    schemas: {
      public: z.object({ backend: z.object({ apiUrl: z.url() }) }),
      server: z.object({
        backend: z.object({ apiUrl: z.url() }),
        db: z.object({ url: z.string().transform((url) => url.toUpperCase()) }),
      }),
    },
  })

  test('returns validated server config', () => {
    const config = loadDevConfig(definition, { root })
    expect(config).toEqual({
      backend: { apiUrl: 'https://api.local' },
      db: { url: 'POSTGRES://LOCAL' },
    })
    expect(config.db.url).toBe('POSTGRES://LOCAL')
  })

  test('throws on invalid config', () => {
    writeYaml('broken')
    expect(() => loadDevConfig(definition, { root })).toThrow(
      /Config validation failed/,
    )
  })
})

describe('watch', () => {
  test('runtime change reloads the page by default', async () => {
    const dev = await startDev()
    await publicConfig(dev)
    const send = vi.spyOn(dev.ws, 'send')
    const reloadModule = vi.spyOn(dev, 'reloadModule')

    await changeFile(dev, () => writeYaml('https://api.changed'))

    expect(send).toHaveBeenCalledWith({ type: 'full-reload' })
    expect(reloadModule).not.toHaveBeenCalled()
    expect(await publicConfig(dev)).toEqual({
      backend: { apiUrl: 'https://api.changed' },
    })
  })

  test('with hmr runtime change hot-reloads config modules', async () => {
    writeConfig({ options: ['dev: { hmr: true }'] })
    const dev = await startDev()
    await publicConfig(dev)
    const reloadModule = vi.spyOn(dev, 'reloadModule')

    await changeFile(dev, () => writeYaml('https://api.changed'))

    expect(reloadModule).toHaveBeenCalled()
    expect(await publicConfig(dev)).toEqual({
      backend: { apiUrl: 'https://api.changed' },
    })
  })

  test('serverRestart paths restart the server', async () => {
    writeConfig({ options: ["dev: { serverRestart: ['backend.*'] }"] })
    const dev = await startDev()
    const restart = vi.spyOn(dev, 'restart').mockResolvedValue()

    await changeFile(dev, () => writeYaml('https://api.changed'))

    expect(restart).toHaveBeenCalledOnce()
  })

  test('with hmr fullReload paths trigger a full page reload', async () => {
    writeConfig({
      options: ["dev: { hmr: true, fullReload: ['backend.*'] }"],
    })
    const dev = await startDev()
    await publicConfig(dev)
    const send = vi.spyOn(dev.ws, 'send')

    await changeFile(dev, () => writeYaml('https://api.changed'))

    expect(send).toHaveBeenCalledWith({ type: 'full-reload' })
  })

  test('invalid change reports error and keeps previous config', async () => {
    writeConfig({ options: ['dev: { hmr: true }'] })
    const dev = await startDev()
    await publicConfig(dev)
    const send = vi.spyOn(dev.ws, 'send')
    const reloadModule = vi.spyOn(dev, 'reloadModule')

    await changeFile(dev, () => writeYaml('broken'))

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        err: expect.objectContaining({
          message: expect.stringMatching(/for 'public'/),
        }),
      }),
    )
    expect(reloadModule).not.toHaveBeenCalled()
    expect(await publicConfig(dev)).toEqual({
      backend: { apiUrl: 'https://api.local' },
    })
  })

  test('ignores changes reported for unrelated files', async () => {
    const dev = await startDev()
    await publicConfig(dev)
    const send = vi.spyOn(dev.ws, 'send')

    await changeFile(
      dev,
      () => writeYaml('https://api.changed'),
      join(root, 'src/main.ts'),
    )

    expect(send).not.toHaveBeenCalledWith({ type: 'full-reload' })
  })

  test('watch: false disables reactions', async () => {
    writeConfig({ options: ['dev: { watch: false }'] })
    const dev = await startDev()
    await publicConfig(dev)
    const send = vi.spyOn(dev.ws, 'send')

    await changeFile(dev, () => writeYaml('https://api.changed'))

    expect(send).not.toHaveBeenCalled()
  })

  test('recovering from an error clears the overlay with an update', async () => {
    writeConfig({ options: ['dev: { hmr: true }'] })
    const dev = await startDev()
    await publicConfig(dev)
    const reloadModule = vi.spyOn(dev, 'reloadModule')

    await changeFile(dev, () => writeYaml('broken'))
    expect(reloadModule).not.toHaveBeenCalled()

    await changeFile(dev, () => writeYaml('https://api.local'))
    expect(reloadModule).toHaveBeenCalled()

    reloadModule.mockClear()
    await changeFile(dev, () => writeYaml('https://api.local'))
    expect(reloadModule).not.toHaveBeenCalled()
  })

  test('only hmr dev modules self-accept', async () => {
    const dev = await startDev()
    expect(
      (await dev.transformRequest('virtual:config-kit'))?.code,
    ).not.toContain('import.meta.hot.accept()')
    await dev.close()

    writeConfig({ options: ['dev: { hmr: true }'] })
    const hot = await startDev()
    expect((await hot.transformRequest('virtual:config-kit'))?.code).toContain(
      'import.meta.hot.accept()',
    )
  })

  test('unchanged content is a no-op', async () => {
    writeConfig({ options: ["dev: { serverRestart: ['backend.*'] }"] })
    const dev = await startDev()
    await publicConfig(dev)
    const restart = vi.spyOn(dev, 'restart').mockResolvedValue()
    const send = vi.spyOn(dev.ws, 'send')

    await changeFile(dev, () => writeYaml('https://api.local'))

    expect(restart).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })
})

describe('build', () => {
  test('injects the JSON placeholder and validates config on import', async () => {
    const { html, js } = await runBuild()
    expect(html).toMatch(
      /<script type="application\/json" id="__CONFIG__">\$\{APP_PUBLIC_CONFIG\}<\/script>/,
    )
    expect(html.indexOf('__CONFIG__')).toBeLessThan(
      html.indexOf('type="module"'),
    )
    expect(js).toContain('getElementById')
    expect(js).toContain('knownKeys: ["backend"]')
    expect(js).not.toContain('api.local')
    expect(existsSync(join(root, 'dist-config'))).toBe(false)
  })

  test('keeps the server schema, build schema and dev options out of the client bundle', async () => {
    writeFileSync(
      join(root, 'src/config-error.ts'),
      "export function render() { document.body.textContent = 'CUSTOM_SCREEN' }\n",
    )
    writeConfig({
      schemas: [
        'server: publicSchema.extend({ PRIVATE_FIELD: z.string() })',
        'build: z.object({ BUILD_FIELD: z.boolean().default(false) })',
      ],
      options: [
        "onInvalid() { void import('./src/config-error').then((m) => m.render()) }",
        "dev: { serverRestart: ['DEV_OPTION'] }",
      ],
    })
    writeYaml('https://api.local', '', '')
    writeFileSync(
      yamlPath,
      'public:\n  backend:\n    apiUrl: https://api.local\nprivate:\n  PRIVATE_FIELD: x\n',
    )
    const { js } = await runBuild()
    expect(js).not.toContain('PRIVATE_FIELD')
    expect(js).not.toContain('BUILD_FIELD')
    expect(js).not.toContain('DEV_OPTION')
    expect(js).toContain('CUSTOM_SCREEN')
  })

  test('fails when a plugin drops the placeholder from index.html', async () => {
    const stripper: Plugin = {
      name: 'strip',
      transformIndexHtml: {
        order: 'post',
        handler: (html) => html.replace(/\$\{APP_PUBLIC_CONFIG\}/, ''),
      },
    }
    await expect(runBuild([stripper])).rejects.toThrow(
      /index\.html lost the \$\{APP_PUBLIC_CONFIG\} placeholder/,
    )
  })
})

describe.each([
  [
    'valibot',
    [
      "import * as v from 'valibot'",
      "import { toStandardJsonSchema } from '@valibot/to-json-schema'",
      'export default {',
      '  schemas: {',
      '    public: toStandardJsonSchema(v.object({ backend: v.object({ apiUrl: v.pipe(v.string(), v.url()) }) })),',
      '    build: toStandardJsonSchema(v.object({ msw: v.optional(v.boolean(), false), token: v.optional(v.string()) })),',
      '  },',
      '}',
    ],
  ],
  [
    'arktype',
    [
      "import { type } from 'arktype'",
      'export default {',
      '  schemas: {',
      "    public: type({ backend: { apiUrl: 'string.url' } }),",
      "    build: type({ msw: 'boolean = false', 'token?': 'string' }),",
      '  },',
      '}',
    ],
  ],
])('%s schemas', (_, lines) => {
  beforeEach(() => {
    writeFileSync(configPath, `${lines.join('\n')}\n`)
    writeFileSync(
      yamlPath,
      'public:\n  backend:\n    apiUrl: https://api.local\n',
    )
  })

  test('validate dev config', async () => {
    const dev = await startDev()
    expect(await publicConfig(dev)).toEqual({
      backend: { apiUrl: 'https://api.local' },
    })
    expect(
      (await loadModule(dev, 'virtual:config-kit/build')).buildConfig,
    ).toEqual({ msw: false })
  })

  test('reject invalid and unknown keys', async () => {
    writeFileSync(
      yamlPath,
      'public:\n  backend:\n    apiUrl: https://api.local\n  typo: 1\n',
    )
    await expect(startDev()).rejects.toThrow(/Unknown top-level config keys/)
    writeFileSync(yamlPath, 'public:\n  backend:\n    apiUrl: not a url\n')
    await expect(startDev()).rejects.toThrow(
      /Config validation failed for 'public'[\s\S]*→ at backend\.apiUrl/,
    )
  })

  test('spell out optional build fields', async () => {
    writeMain(
      "import { buildConfig } from 'virtual:config-kit/build'",
      "if (buildConfig.token) console.log('TOKEN_ON')",
    )
    const { js } = await runBuild()
    expect(js).not.toContain('TOKEN_ON')
  })
})

describe('docker', () => {
  function validate(env: Record<string, string | undefined>) {
    return spawnSync(
      process.execPath,
      [join(root, 'dist-config', VALIDATOR_FILE)],
      {
        encoding: 'utf-8',
        cwd: tmpdir(),
        env: { PATH: process.env.PATH, ...env },
      },
    )
  }

  test('builds a self-contained validator without onInvalid', async () => {
    writeConfig({
      options: ['docker: true', "onInvalid() { console.log('ON_INVALID') }"],
    })
    await runBuild()
    rmSync(join(root, 'node_modules'))
    expect(
      readFileSync(join(root, 'dist-config', VALIDATOR_FILE), 'utf-8'),
    ).not.toContain('ON_INVALID')

    const valid = validate({
      APP_PUBLIC_CONFIG: JSON.stringify({ backend: { apiUrl: 'https://a' } }),
    })
    expect(valid.status).toBe(0)
    expect(valid.stdout).toContain('APP_PUBLIC_CONFIG is valid')

    const invalid = validate({
      APP_PUBLIC_CONFIG: JSON.stringify({ backend: { apiUrl: 'nope' } }),
    })
    expect(invalid.status).toBe(1)
    expect(invalid.stderr).toMatch(
      /Config validation failed for 'public' \(loaded from env APP_PUBLIC_CONFIG\)/,
    )

    const unknown = validate({
      APP_PUBLIC_CONFIG: JSON.stringify({
        backend: { apiUrl: 'https://a' },
        extra: 1,
      }),
    })
    expect(unknown.status).toBe(1)
    expect(unknown.stderr).toContain('Unknown top-level config keys')

    const missing = validate({})
    expect(missing.status).toBe(1)
    expect(missing.stderr).toContain('APP_PUBLIC_CONFIG is not set')
  })

  test.skipIf(spawnSync('envsubst', ['--version']).status !== 0)(
    'entrypoint hook renders index.html on every start',
    async () => {
      writeConfig({ options: ['docker: true'] })
      await runBuild()
      const nginx = join(root, 'nginx')
      const docroot = join(nginx, 'html')
      mkdirSync(docroot, { recursive: true })
      writeFileSync(
        join(docroot, 'index.html'),
        readFileSync(join(root, 'dist/index.html'), 'utf-8'),
      )
      const hook = join(root, 'hook.sh')
      writeFileSync(
        hook,
        readFileSync(join(root, 'dist-config', INJECT_HOOK_FILE), 'utf-8')
          .replace('/usr/share/nginx/html', docroot)
          .replace('/usr/share/nginx/', `${nginx}/`),
      )
      const start = (config: string | undefined) =>
        spawnSync('sh', [hook], {
          encoding: 'utf-8',
          env: { PATH: process.env.PATH, APP_PUBLIC_CONFIG: config },
        })

      expect(start('{"html":"</script><b>"}').status).toBe(0)
      expect(readFileSync(join(docroot, 'index.html'), 'utf-8')).toContain(
        '<script type="application/json" id="__CONFIG__">{"html":"\\u003c/script>\\u003cb>"}</script>',
      )

      expect(start('{"a":1}').status).toBe(0)
      expect(readFileSync(join(docroot, 'index.html'), 'utf-8')).toContain(
        'id="__CONFIG__">{"a":1}</script>',
      )

      const missing = start(undefined)
      expect(missing.status).toBe(1)
      expect(missing.stderr).toContain('APP_PUBLIC_CONFIG is not set')
    },
  )
})

describe('ssr build', () => {
  test('virtual modules validate env on import', async () => {
    writeFileSync(
      configPath,
      [
        "import { z } from 'zod'",
        'export default {',
        '  schemas: {',
        '    public: z.looseObject({ a: z.number() }),',
        '    server: z.looseObject({ db: z.looseObject({ password: z.string() }) }),',
        '  },',
        '  docker: true,',
        '}',
        '',
      ].join('\n'),
    )
    writeFileSync(
      join(root, 'src/server.ts'),
      [
        "export { publicConfig } from 'virtual:config-kit'",
        "export { serverConfig } from 'virtual:config-kit/private'",
      ].join('\n'),
    )
    await build({
      root,
      configFile: false,
      resolve: sourceResolve,
      logLevel: 'silent',
      build: {
        ssr: 'src/server.ts',
        outDir: 'dist-ssr',
        rollupOptions: { output: { entryFileNames: 'server.mjs' } },
      },
      plugins: [configKit()],
    })
    expect(existsSync(join(root, 'dist-config'))).toBe(false)
    const url = pathToFileURL(join(root, 'dist-ssr/server.mjs')).href

    await expect(import(`${url}?missing`)).rejects.toThrow(
      'APP_PUBLIC_CONFIG is not set',
    )

    process.env.APP_PUBLIC_CONFIG = JSON.stringify({ a: 1, db: { host: 'h' } })
    process.env.APP_PRIVATE_CONFIG = JSON.stringify({ db: { password: 'p' } })
    const mod = (await import(`${url}?set`)) as ConfigModule
    expect(mod.publicConfig).toEqual({ a: 1, db: { host: 'h' } })
    expect(mod.serverConfig).toEqual({
      a: 1,
      db: { host: 'h', password: 'p' },
    })
  })
})
