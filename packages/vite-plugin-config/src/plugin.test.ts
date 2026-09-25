import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { build, createServer, type ViteDevServer } from 'vite'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import z from 'zod'

import { loadDevConfig } from './dev-reader'
import { type SenateConfigOptions, senateConfig } from './plugin'

type SourceModule = {
  source: { loadSync(): unknown; describe(): string }
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

async function startDev(options: SenateConfigOptions = {}) {
  server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    server: { middlewareMode: true, ws: false },
    plugins: [senateConfig({ schema: publicSchema, ...options })],
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
    "import { source } from '@senate/config'\nconsole.log(source.loadSync(), import.meta.env.VITE_FLAG)\n",
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
    expect(await loadSource(dev, '@senate/config')).toEqual({
      backend: { apiUrl: 'https://api.local' },
    })
  })

  test('private module merges public and private sections', async () => {
    const dev = await startDev()
    expect(await loadSource(dev, '@senate/config/private')).toEqual({
      backend: { apiUrl: 'https://api.local' },
      db: { url: 'postgres://local' },
    })
  })

  test('env var wins over yaml', async () => {
    process.env.APP_PUBLIC_CONFIG = JSON.stringify({
      backend: { apiUrl: 'https://api.env' },
    })
    const dev = await startDev()
    expect(await loadSource(dev, '@senate/config')).toEqual({
      backend: { apiUrl: 'https://api.env' },
    })
  })

  test('fails to start on invalid runtime config', async () => {
    writeYaml('not-a-url')
    await expect(startDev()).rejects.toThrow(
      /Config validation failed for schema 'public' \(loaded from merge of \[file .*config\.yaml, file .*config\.local\.yaml\] \(public\)\)/,
    )
  })

  test('private module is rejected in client code', async () => {
    writeFileSync(
      join(root, 'src/leak.ts'),
      "export { source } from '@senate/config/private'\n",
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
    expect(await loadSource(dev, '@senate/config/private')).toEqual({
      backend: { apiUrl: 'https://api.mine' },
      db: { url: 'postgres://local' },
    })
  })

  test('creating it at runtime hot-reloads config', async () => {
    const dev = await startDev()
    await loadSource(dev, '@senate/config')
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

    expect(await loadSource(dev, '@senate/config')).toEqual({
      backend: { apiUrl: 'https://api.mine' },
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
      logLevel: 'silent',
      plugins: [senateConfig({ schema: publicSchema, buildEnvSchema })],
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
    await loadSource(dev, '@senate/config')
    const reloadModule = vi.spyOn(dev, 'reloadModule')

    await changeYaml(dev, () => writeYaml('https://api.changed'))

    expect(reloadModule).toHaveBeenCalled()
    expect(await loadSource(dev, '@senate/config')).toEqual({
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
    await loadSource(dev, '@senate/config')
    const send = vi.spyOn(dev.ws, 'send')

    await changeYaml(dev, () =>
      writeYaml('https://api.local', '  app:\n    theme: dark\n'),
    )

    expect(send).toHaveBeenCalledWith({ type: 'full-reload' })
    expect(await loadSource(dev, '@senate/config')).toEqual({
      backend: { apiUrl: 'https://api.local' },
      app: { theme: 'dark' },
    })
  })

  test('invalid change reports error and keeps previous config', async () => {
    const dev = await startDev()
    await loadSource(dev, '@senate/config')
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
    expect(await loadSource(dev, '@senate/config')).toEqual({
      backend: { apiUrl: 'https://api.local' },
    })
  })

  test('unchanged content is a no-op', async () => {
    const dev = await startDev({ serverRestart: ['backend.*'] })
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

  async function runBuild(options: SenateConfigOptions = {}) {
    await build({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [senateConfig({ schema: publicSchema, ...options })],
    })
    const dist = join(root, 'dist')
    const assets = join(dist, 'assets')
    const js = readdirSync(assets)
      .filter((file) => file.endsWith('.js'))
      .map((file) => readFileSync(join(assets, file), 'utf-8'))
      .join('\n')
    return { html: readFileSync(join(dist, 'index.html'), 'utf-8'), js }
  }

  test('injects placeholder script and reads config from window', async () => {
    const { html, js } = await runBuild()
    expect(html).toMatch(
      /<script>window\.__CONFIG__ = \$\{APP_PUBLIC_CONFIG\}<\/script>/,
    )
    expect(html.indexOf('__CONFIG__')).toBeLessThan(
      html.indexOf('type="module"'),
    )
    expect(js).toContain('globalThis.__CONFIG__')
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

  test('fails on invalid build env', async () => {
    writeFileSync(join(root, '.env.production'), 'VITE_FLAG=maybe\n')
    await expect(runBuild({ buildEnvSchema })).rejects.toThrow(
      /Build env validation failed/,
    )
  })
})
