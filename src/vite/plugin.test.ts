import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { build, createServer, type ViteDevServer } from 'vite'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import z from 'zod'

import { loadDevConfig } from './dev-reader'
import { type ConfigKitOptions, configKit } from './plugin'

type SourceModule = {
  source: { loadSync(): unknown; describe(): string }
}

const srcDir = fileURLToPath(new URL('..', import.meta.url))

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

const publicSchema = z
  .object({ backend: z.object({ apiUrl: z.url() }) })
  .meta({ id: 'public' })

let root: string
let yamlPath: string
let server: ViteDevServer | undefined

function writeYaml(apiUrl: unknown, extra = '', tail = '') {
  writeFileSync(
    yamlPath,
    `public:\n  backend:\n    apiUrl: ${apiUrl}\n${extra}private:\n  db:\n    url: postgres://local\n${tail}`,
  )
}

async function startDev(options: ConfigKitOptions = {}) {
  server = await createServer({
    root,
    configFile: false,
    resolve: sourceResolve,
    logLevel: 'silent',
    server: { middlewareMode: true, ws: false, watch: null },
    plugins: [configKit({ schema: publicSchema, ...options })],
  })
  return server
}

async function loadSource(dev: ViteDevServer, id: string) {
  const mod = (await dev.ssrLoadModule(id)) as SourceModule
  return mod.source.loadSync()
}

async function changeYaml(
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

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'vite-plugin-config-')))
  yamlPath = join(root, 'config.yaml')
  mkdirSync(join(root, 'src'))
  writeFileSync(
    join(root, 'index.html'),
    '<!doctype html><html><head></head><body><script type="module" src="/src/main.ts"></script></body></html>',
  )
  writeFileSync(
    join(root, 'src/main.ts'),
    "import { source } from 'virtual:config-kit'\nconsole.log(source.loadSync(), import.meta.env.VITE_FLAG)\n",
  )
  writeYaml('https://api.local')
  delete process.env.APP_PUBLIC_CONFIG
  delete process.env.APP_PRIVATE_CONFIG
})

afterEach(async () => {
  await server?.close()
  server = undefined
  vi.restoreAllMocks()
  delete process.env.APP_PUBLIC_CONFIG
  delete process.env.APP_PRIVATE_CONFIG
  rmSync(root, { recursive: true, force: true })
})

describe('dev', () => {
  test('public module exposes yaml public section', async () => {
    const dev = await startDev()
    expect(await loadSource(dev, 'virtual:config-kit')).toEqual({
      backend: { apiUrl: 'https://api.local' },
    })
  })

  test('private module merges public and private sections', async () => {
    const dev = await startDev()
    expect(await loadSource(dev, 'virtual:config-kit/private')).toEqual({
      backend: { apiUrl: 'https://api.local' },
      db: { url: 'postgres://local' },
    })
  })

  test('env var wins over yaml', async () => {
    process.env.APP_PUBLIC_CONFIG = JSON.stringify({
      backend: { apiUrl: 'https://api.env' },
    })
    const dev = await startDev()
    expect(await loadSource(dev, 'virtual:config-kit')).toEqual({
      backend: { apiUrl: 'https://api.env' },
    })
  })

  test('fails to start on invalid runtime config', async () => {
    writeYaml('not-a-url')
    await expect(startDev()).rejects.toThrow(
      /Config validation failed for schema 'public' \(loaded from merge of \[file .*config\.yaml, file .*config\.local\.yaml\] \(public\)\)/,
    )
  })

  test('private env var wins over yaml private section', async () => {
    process.env.APP_PRIVATE_CONFIG = JSON.stringify({ db: { url: 'from-env' } })
    const dev = await startDev()
    expect(await loadSource(dev, 'virtual:config-kit/private')).toEqual({
      backend: { apiUrl: 'https://api.local' },
      db: { url: 'from-env' },
    })
  })

  test('fails to start on invalid server config', async () => {
    const serverSchema = z
      .object({ db: z.object({ url: z.number() }) })
      .meta({ title: 'server' })
    await expect(startDev({ serverSchema })).rejects.toThrow(
      /Config validation failed for schema 'server'/,
    )
  })

  test('runs from env var alone without config.yaml', async () => {
    rmSync(yamlPath)
    process.env.APP_PUBLIC_CONFIG = JSON.stringify({
      backend: { apiUrl: 'https://api.env' },
    })
    const dev = await startDev()
    expect(await loadSource(dev, 'virtual:config-kit')).toEqual({
      backend: { apiUrl: 'https://api.env' },
    })
  })

  test('client code resolves the public module', async () => {
    const dev = await startDev()
    const result = await dev.transformRequest('/src/main.ts')
    expect(result?.code).toContain('config-kit:public')
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

  test('watches config.yaml found above the root', async () => {
    const appRoot = join(root, 'app')
    mkdirSync(appRoot)
    server = await createServer({
      root: appRoot,
      configFile: false,
      resolve: sourceResolve,
      logLevel: 'silent',
      server: { middlewareMode: true, ws: false },
      plugins: [configKit({ schema: publicSchema })],
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
      "export { source } from 'virtual:config-kit/private'\n",
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
    expect(await loadSource(dev, 'virtual:config-kit/private')).toEqual({
      backend: { apiUrl: 'https://api.mine' },
      db: { url: 'postgres://local' },
    })
  })

  test('creating it at runtime hot-reloads config', async () => {
    const dev = await startDev()
    await loadSource(dev, 'virtual:config-kit')
    const localPath = join(root, 'config.local.yaml')

    await changeYaml(
      dev,
      () =>
        writeFileSync(
          localPath,
          'public:\n  backend:\n    apiUrl: https://api.mine\n',
        ),
      localPath,
      'add',
    )

    expect(await loadSource(dev, 'virtual:config-kit')).toEqual({
      backend: { apiUrl: 'https://api.mine' },
    })
  })
})

describe('local yaml removal', () => {
  test('reverts overrides when the local yaml is deleted', async () => {
    const localPath = join(root, 'config.local.yaml')
    writeFileSync(
      localPath,
      'public:\n  backend:\n    apiUrl: https://api.mine\n',
    )
    const dev = await startDev()
    await loadSource(dev, 'virtual:config-kit')

    await changeYaml(dev, () => rmSync(localPath), localPath, 'unlink')

    expect(await loadSource(dev, 'virtual:config-kit')).toEqual({
      backend: { apiUrl: 'https://api.local' },
    })
  })
})

describe('yaml env section', () => {
  const buildEnvSchema = z.object({
    VITE_FLAG: z.stringbool().default(false),
    VITE_NAME: z.string().optional(),
  })

  test('feeds build env in dev', async () => {
    writeYaml(
      'https://api.local',
      '',
      'env:\n  VITE_FLAG: true\n  VITE_NAME: yaml\n',
    )
    const dev = await startDev({ buildEnvSchema })
    expect(dev.config.define).toMatchObject({
      'import.meta.env.VITE_FLAG': 'true',
      'import.meta.env.VITE_NAME': '"yaml"',
    })
  })

  test('process env wins over yaml env section', async () => {
    writeYaml('https://api.local', '', 'env:\n  VITE_NAME: yaml\n')
    vi.stubEnv('VITE_NAME', 'process')
    const dev = await startDev({ buildEnvSchema })
    expect(dev.config.define).toMatchObject({
      'import.meta.env.VITE_NAME': '"process"',
    })
    vi.unstubAllEnvs()
  })

  test('drops null values and serializes objects', async () => {
    writeYaml(
      'https://api.local',
      '',
      'env:\n  VITE_NAME: null\n  VITE_JSON:\n    a: 1\n',
    )
    const dev = await startDev({
      buildEnvSchema: z.object({
        VITE_NAME: z.string().default('fallback'),
        VITE_JSON: z.string(),
      }),
    })
    expect(dev.config.define).toMatchObject({
      'import.meta.env.VITE_NAME': '"fallback"',
      'import.meta.env.VITE_JSON': JSON.stringify('{"a":1}'),
    })
  })

  test('change restarts the server', async () => {
    writeYaml('https://api.local', '', 'env:\n  VITE_FLAG: false\n')
    const dev = await startDev({ buildEnvSchema })
    const restart = vi.spyOn(dev, 'restart').mockResolvedValue()

    await changeYaml(dev, () =>
      writeYaml('https://api.local', '', 'env:\n  VITE_FLAG: true\n'),
    )

    expect(restart).toHaveBeenCalledOnce()
  })

  test('is ignored in build', async () => {
    writeYaml('https://api.local', '', 'env:\n  VITE_FLAG: true\n')
    await build({
      root,
      configFile: false,
      resolve: sourceResolve,
      logLevel: 'silent',
      plugins: [configKit({ schema: publicSchema, buildEnvSchema })],
    })
    const assets = join(root, 'dist', 'assets')
    const js = readdirSync(assets)
      .map((file) => readFileSync(join(assets, file), 'utf-8'))
      .join('\n')
    expect(js).toMatch(/console\.log\(\w+\.loadSync\(\),(false|!1)\)/)
  })
})

describe('loadDevConfig', () => {
  test('returns validated server config', () => {
    const serverSchema = z.object({
      backend: z.object({ apiUrl: z.url() }),
      db: z.object({ url: z.string().transform((url) => url.toUpperCase()) }),
    })
    expect({ ...loadDevConfig({ serverSchema, root }) }).toEqual({
      backend: { apiUrl: 'https://api.local' },
      db: { url: 'POSTGRES://LOCAL' },
    })
  })

  test('throws on invalid config', () => {
    const serverSchema = z.object({ db: z.object({ url: z.number() }) })
    expect(() => loadDevConfig({ serverSchema, root })).toThrow(
      /Config validation failed/,
    )
  })
})

describe('watch', () => {
  test('runtime change hot-reloads config modules', async () => {
    const dev = await startDev()
    await loadSource(dev, 'virtual:config-kit')
    const reloadModule = vi.spyOn(dev, 'reloadModule')

    await changeYaml(dev, () => writeYaml('https://api.changed'))

    expect(reloadModule).toHaveBeenCalled()
    expect(await loadSource(dev, 'virtual:config-kit')).toEqual({
      backend: { apiUrl: 'https://api.changed' },
    })
  })

  test('serverRestart paths restart the server', async () => {
    const dev = await startDev({ serverRestart: ['backend.*'] })
    const restart = vi.spyOn(dev, 'restart').mockResolvedValue()

    await changeYaml(dev, () => writeYaml('https://api.changed'))

    expect(restart).toHaveBeenCalledOnce()
  })

  test('fullReload paths trigger a full page reload', async () => {
    const dev = await startDev({ fullReload: ['app.*'] })
    await loadSource(dev, 'virtual:config-kit')
    const send = vi.spyOn(dev.ws, 'send')

    await changeYaml(dev, () =>
      writeYaml('https://api.local', '  app:\n    theme: dark\n'),
    )

    expect(send).toHaveBeenCalledWith({ type: 'full-reload' })
    expect(await loadSource(dev, 'virtual:config-kit')).toEqual({
      backend: { apiUrl: 'https://api.local' },
      app: { theme: 'dark' },
    })
  })

  test('invalid change reports error and keeps previous config', async () => {
    const dev = await startDev()
    await loadSource(dev, 'virtual:config-kit')
    const send = vi.spyOn(dev.ws, 'send')
    const reloadModule = vi.spyOn(dev, 'reloadModule')

    await changeYaml(dev, () => writeYaml('broken'))

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        err: expect.objectContaining({
          message: expect.stringMatching(/schema 'public'/),
        }),
      }),
    )
    expect(reloadModule).not.toHaveBeenCalled()
    expect(await loadSource(dev, 'virtual:config-kit')).toEqual({
      backend: { apiUrl: 'https://api.local' },
    })
  })

  test('any matching path among several changes decides the reaction', async () => {
    const restartDev = await startDev({ serverRestart: ['app.*'] })
    const restart = vi.spyOn(restartDev, 'restart').mockResolvedValue()
    await changeYaml(restartDev, () =>
      writeYaml('https://api.changed', '  app:\n    theme: dark\n'),
    )
    expect(restart).toHaveBeenCalledOnce()
    await restartDev.close()

    writeYaml('https://api.local')
    const reloadDev = await startDev({ fullReload: ['app.*'] })
    await loadSource(reloadDev, 'virtual:config-kit')
    const send = vi.spyOn(reloadDev.ws, 'send')
    await changeYaml(reloadDev, () =>
      writeYaml('https://api.changed', '  app:\n    theme: dark\n'),
    )
    expect(send).toHaveBeenCalledWith({ type: 'full-reload' })
  })

  test('ignores changes reported for unrelated files', async () => {
    const dev = await startDev()
    await loadSource(dev, 'virtual:config-kit')
    const reloadModule = vi.spyOn(dev, 'reloadModule')

    await changeYaml(
      dev,
      () => writeYaml('https://api.changed'),
      join(root, 'src/main.ts'),
    )

    expect(reloadModule).not.toHaveBeenCalled()
  })

  test('watch: false disables reactions', async () => {
    const dev = await startDev({ watch: false })
    await loadSource(dev, 'virtual:config-kit')
    const reloadModule = vi.spyOn(dev, 'reloadModule')

    await changeYaml(dev, () => writeYaml('https://api.changed'))

    expect(reloadModule).not.toHaveBeenCalled()
  })

  test('recovering from an error clears the overlay with an update', async () => {
    const dev = await startDev()
    await loadSource(dev, 'virtual:config-kit')
    const reloadModule = vi.spyOn(dev, 'reloadModule')

    await changeYaml(dev, () => writeYaml('broken'))
    expect(reloadModule).not.toHaveBeenCalled()

    await changeYaml(dev, () => writeYaml('https://api.local'))
    expect(reloadModule).toHaveBeenCalled()

    reloadModule.mockClear()
    await changeYaml(dev, () => writeYaml('https://api.local'))
    expect(reloadModule).not.toHaveBeenCalled()
  })

  test('dev modules self-accept and keep their source across updates', async () => {
    const dev = await startDev()
    const result = await dev.transformRequest('virtual:config-kit')
    expect(result?.code).toContain('import.meta.hot.accept()')
    expect(result?.code).toContain('import.meta.hot.data.source = source')
  })

  test('unchanged content is a no-op', async () => {
    const dev = await startDev({ serverRestart: ['backend.*'] })
    await loadSource(dev, 'virtual:config-kit')
    const restart = vi.spyOn(dev, 'restart').mockResolvedValue()
    const reloadModule = vi.spyOn(dev, 'reloadModule')

    await changeYaml(dev, () => writeYaml('https://api.local'))

    expect(restart).not.toHaveBeenCalled()
    expect(reloadModule).not.toHaveBeenCalled()
  })
})

describe('build', () => {
  const buildEnvSchema = z.object({
    VITE_FLAG: z.stringbool().default(false),
  })

  async function runBuild(options: ConfigKitOptions = {}) {
    await build({
      root,
      configFile: false,
      resolve: sourceResolve,
      logLevel: 'silent',
      plugins: [configKit({ schema: publicSchema, ...options })],
    })
    const dist = join(root, 'dist')
    const assets = join(dist, 'assets')
    const js = readdirSync(assets)
      .filter((file) => file.endsWith('.js'))
      .map((file) => readFileSync(join(assets, file), 'utf-8'))
      .join('\n')
    return { html: readFileSync(join(dist, 'index.html'), 'utf-8'), js }
  }

  test('injects the JSON placeholder and reads config from it', async () => {
    const { html, js } = await runBuild()
    expect(html).toMatch(
      /<script type="application\/json" id="__CONFIG__">\$\{APP_PUBLIC_CONFIG\}<\/script>/,
    )
    expect(html.indexOf('__CONFIG__')).toBeLessThan(
      html.indexOf('type="module"'),
    )
    expect(js).toContain('getElementById')
    expect(js).not.toContain('api.local')
  })

  test('defines validated build env with defaults', async () => {
    const { js } = await runBuild({ buildEnvSchema })
    expect(js).toMatch(/console\.log\(\w+\.loadSync\(\),(false|!1)\)/)
  })

  test('coerces build env from .env file and writes env.d.ts', async () => {
    writeFileSync(join(root, '.env.production'), 'VITE_FLAG=true\n')
    const { js } = await runBuild({ buildEnvSchema, envDts: 'src/env.d.ts' })
    expect(js).toMatch(/console\.log\(\w+\.loadSync\(\),(true|!0)\)/)
    expect(existsSync(join(root, 'src/env.d.ts'))).toBe(true)
    expect(readFileSync(join(root, 'src/env.d.ts'), 'utf-8')).toContain(
      'readonly VITE_FLAG: boolean',
    )
  })

  test('rewrites a stale env.d.ts', async () => {
    const dts = join(root, 'src/env.d.ts')
    writeFileSync(dts, 'stale')
    await runBuild({ buildEnvSchema, envDts: 'src/env.d.ts' })
    expect(readFileSync(dts, 'utf-8')).toContain('readonly VITE_FLAG: boolean')
  })

  test('leaves an up-to-date env.d.ts untouched', async () => {
    const dts = join(root, 'src/env.d.ts')
    await runBuild({ buildEnvSchema, envDts: 'src/env.d.ts' })
    const past = new Date('2020-01-01')
    utimesSync(dts, past, past)

    await runBuild({ buildEnvSchema, envDts: 'src/env.d.ts' })

    expect(statSync(dts).mtime).toEqual(past)
  })

  test('fails on invalid build env', async () => {
    writeFileSync(join(root, '.env.production'), 'VITE_FLAG=maybe\n')
    await expect(runBuild({ buildEnvSchema })).rejects.toThrow(
      /Config validation failed \(loaded from build env\)/,
    )
  })
})

describe('ssr build', () => {
  test('virtual modules read env at runtime', async () => {
    writeFileSync(
      join(root, 'src/server.ts'),
      [
        "export { source as publicSource } from 'virtual:config-kit'",
        "export { source as privateSource } from 'virtual:config-kit/private'",
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
    const mod = (await import(
      pathToFileURL(join(root, 'dist-ssr/server.mjs')).href
    )) as {
      publicSource: SourceModule['source']
      privateSource: SourceModule['source']
    }

    expect(mod.publicSource.loadSync()).toBeUndefined()
    expect(mod.privateSource.loadSync()).toBeUndefined()

    process.env.APP_PUBLIC_CONFIG = JSON.stringify({ a: 1, db: { host: 'h' } })
    process.env.APP_PRIVATE_CONFIG = JSON.stringify({ db: { password: 'p' } })
    expect(mod.publicSource.loadSync()).toEqual({ a: 1, db: { host: 'h' } })
    expect(mod.publicSource.describe()).toBe('env APP_PUBLIC_CONFIG')
    expect(mod.privateSource.loadSync()).toEqual({
      a: 1,
      db: { host: 'h', password: 'p' },
    })
    expect(mod.privateSource.describe()).toBe(
      'merge of [env APP_PUBLIC_CONFIG, env APP_PRIVATE_CONFIG]',
    )
  })
})
