import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { createServer } from 'vite'
import { describe, expect, test, vi } from 'vitest'
import { z } from 'zod'

import { defineConfigKit } from '../core'
import { loadDevConfig } from './dev-reader'
import { configKit } from './plugin'
import {
  BUILD_SCHEMA,
  changeFile,
  configPath,
  loadModule,
  publicConfig,
  root,
  SERVER_SCHEMA,
  sourceResolve,
  startDev,
  trackServer,
  useFixture,
  writeConfig,
  writeYaml,
  yamlPath,
} from './testing/fixture'

useFixture()

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
    const dev = trackServer(
      await createServer({
        root,
        configFile: false,
        resolve: sourceResolve,
        logLevel: 'silent',
        server: { middlewareMode: true, ws: false, watch: null },
        plugins: [configKit({ configFile: 'config/app.config.ts' })],
      }),
    )
    expect(await publicConfig(dev)).toEqual({
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
      /Config validation failed for 'public' \(loaded from file .*config\.yaml \(public\)\)/,
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
    const dev = trackServer(
      await createServer({
        root: appRoot,
        configFile: false,
        resolve: sourceResolve,
        logLevel: 'silent',
        server: { middlewareMode: true, ws: false },
        plugins: [configKit()],
      }),
    )
    expect(dev.watcher.getWatched()[root]).toContain('config.yaml')
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
