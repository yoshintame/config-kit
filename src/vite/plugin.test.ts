import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { build, createServer, type ViteDevServer } from 'vite'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { loadDevConfig } from './dev-reader'
import { INJECT_HOOK_FILE, VALIDATOR_FILE } from './docker'
import { type ConfigKitOptions, configKit } from './plugin'

type ConfigModule = {
  source: { loadSync(): unknown; describe(): string }
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

const PUBLIC_SCHEMA = [
  "import { z } from 'zod'",
  'export const publicSchema = z',
  '  .object({ backend: z.object({ apiUrl: z.url() }) })',
  "  .meta({ title: 'public' })",
]
const SERVER_SCHEMA =
  "export const serverSchema = publicSchema.extend({ db: z.object({ url: z.string().transform((url) => url.toUpperCase()) }) }).meta({ title: 'server' })"
const BUILD_SCHEMA =
  'export const buildSchema = z.object({ devtools: z.boolean().default(false), actAs: z.string().optional() })'

let root: string
let yamlPath: string
let schemaPath: string
let server: ViteDevServer | undefined

function writeYaml(apiUrl: unknown, extra = '', tail = '') {
  writeFileSync(
    yamlPath,
    `public:\n  backend:\n    apiUrl: ${apiUrl}\n${extra}private:\n  db:\n    url: postgres://local\n${tail}`,
  )
}

function writeSchema(...extra: string[]) {
  writeFileSync(schemaPath, [...PUBLIC_SCHEMA, ...extra, ''].join('\n'))
}

function writeMain(...lines: string[]) {
  writeFileSync(join(root, 'src/main.ts'), `${lines.join('\n')}\n`)
}

function plugin(options: Partial<ConfigKitOptions> = {}) {
  return configKit({ schemaModule: 'src/schema.ts', dts: false, ...options })
}

async function startDev(options: Partial<ConfigKitOptions> = {}) {
  server = await createServer({
    root,
    configFile: false,
    resolve: sourceResolve,
    logLevel: 'silent',
    server: { middlewareMode: true, ws: false, watch: null },
    plugins: [plugin(options)],
  })
  return server
}

async function loadModule(dev: ViteDevServer, id: string) {
  return (await dev.ssrLoadModule(id)) as ConfigModule
}

async function loadSource(dev: ViteDevServer, id: string) {
  return (await loadModule(dev, id)).source.loadSync()
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

async function runBuild(options: Partial<ConfigKitOptions> = {}) {
  await build({
    root,
    configFile: false,
    resolve: sourceResolve,
    logLevel: 'silent',
    build: { minify: false },
    plugins: [plugin(options)],
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
  schemaPath = join(root, 'src/schema.ts')
  mkdirSync(join(root, 'src'))
  writeFileSync(
    join(root, 'index.html'),
    '<!doctype html><html><head></head><body><script type="module" src="/src/main.ts"></script></body></html>',
  )
  writeMain(
    "import { publicConfig } from 'virtual:config-kit'",
    'console.log(publicConfig.backend.apiUrl)',
  )
  writeSchema()
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

describe('schema module', () => {
  test('fails without a publicSchema export', async () => {
    writeFileSync(schemaPath, 'export const other = 1\n')
    await expect(startDev()).rejects.toThrow(/must export 'publicSchema'/)
  })

  test('fails on a non-schema export', async () => {
    writeSchema('export const buildSchema = {}')
    await expect(startDev()).rejects.toThrow(
      /export 'buildSchema' is not a Zod schema/,
    )
  })

  test('writes typings for the virtual modules', async () => {
    writeSchema(BUILD_SCHEMA)
    await startDev({ dts: 'src/types/config-kit.d.ts' })
    const dts = readFileSync(join(root, 'src/types/config-kit.d.ts'), 'utf-8')
    expect(dts).toContain(
      "export const publicConfig: import('zod').z.output<typeof import('../schema')['publicSchema']>",
    )
    expect(dts).toContain(
      "export const serverConfig: import('zod').z.output<typeof import('../schema')['publicSchema']>",
    )
    expect(dts).toContain("declare module 'virtual:config-kit/build'")
  })

  test('leaves up-to-date typings untouched', async () => {
    await startDev({ dts: 'src/config-kit.d.ts' })
    await server?.close()
    const dts = join(root, 'src/config-kit.d.ts')
    const past = new Date('2020-01-01')
    utimesSync(dts, past, past)

    await startDev({ dts: 'src/config-kit.d.ts' })

    expect(statSync(dts).mtime).toEqual(past)
  })

  test('schema change restarts the server', async () => {
    const dev = await startDev()
    const restart = vi.spyOn(dev, 'restart').mockResolvedValue()

    await changeFile(dev, () => writeSchema('// changed'), schemaPath)

    expect(restart).toHaveBeenCalledOnce()
  })
})

describe('dev', () => {
  test('public module exposes the validated public section', async () => {
    const dev = await startDev()
    const mod = await loadModule(dev, 'virtual:config-kit')
    expect(mod.source.loadSync()).toEqual({
      backend: { apiUrl: 'https://api.local' },
    })
    expect({ ...(mod.publicConfig as object) }).toEqual({
      backend: { apiUrl: 'https://api.local' },
    })
  })

  test('private module merges public and private sections', async () => {
    writeSchema(SERVER_SCHEMA)
    const dev = await startDev()
    const mod = await loadModule(dev, 'virtual:config-kit/private')
    expect(mod.source.loadSync()).toEqual({
      backend: { apiUrl: 'https://api.local' },
      db: { url: 'postgres://local' },
    })
    expect(mod.serverConfig).toMatchObject({ db: { url: 'POSTGRES://LOCAL' } })
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
    writeSchema(
      "export const serverSchema = z.object({ db: z.object({ url: z.number() }) }).meta({ title: 'server' })",
    )
    await expect(startDev()).rejects.toThrow(
      /Config validation failed for schema 'server'/,
    )
  })

  test('fails to start on an unknown yaml section', async () => {
    writeYaml('https://api.local', '', 'env:\n  VITE_FLAG: true\n')
    await expect(startDev()).rejects.toThrow(/Unknown sections in .*: env/)
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

  test('client code resolves the public module and the schema module', async () => {
    const dev = await startDev()
    expect((await dev.transformRequest('/src/main.ts'))?.code).toContain(
      'config-kit:public',
    )
    expect((await dev.transformRequest('virtual:config-kit'))?.code).toContain(
      '/src/schema.ts',
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

  test('watches config.yaml found above the root', async () => {
    const appRoot = join(root, 'app')
    mkdirSync(join(appRoot, 'src'), { recursive: true })
    writeFileSync(
      join(appRoot, 'src/schema.ts'),
      readFileSync(schemaPath, 'utf-8'),
    )
    server = await createServer({
      root: appRoot,
      configFile: false,
      resolve: sourceResolve,
      logLevel: 'silent',
      server: { middlewareMode: true, ws: false },
      plugins: [plugin()],
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

  test('creating it at runtime reloads config', async () => {
    const dev = await startDev()
    await loadSource(dev, 'virtual:config-kit')
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

    expect(await loadSource(dev, 'virtual:config-kit')).toEqual({
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
    await loadSource(dev, 'virtual:config-kit')

    await changeFile(dev, () => rmSync(localPath), localPath, 'unlink')

    expect(await loadSource(dev, 'virtual:config-kit')).toEqual({
      backend: { apiUrl: 'https://api.local' },
    })
  })
})

describe('build section', () => {
  beforeEach(() => writeSchema(BUILD_SCHEMA))

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

  test('build module needs a buildSchema export', async () => {
    writeSchema()
    writeFileSync(
      join(root, 'src/flags.ts'),
      "export { buildConfig } from 'virtual:config-kit/build'\n",
    )
    const dev = await startDev()
    await expect(dev.transformRequest('/src/flags.ts')).rejects.toThrow(
      /needs a 'buildSchema' export/,
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
      /Config validation failed \(loaded from env APP_BUILD_CONFIG\)/,
    )
  })
})

describe('loadDevConfig', () => {
  test('returns validated server config', async () => {
    writeSchema(SERVER_SCHEMA)
    expect({
      ...(await loadDevConfig<object>({ schemaModule: 'src/schema.ts', root })),
    }).toEqual({
      backend: { apiUrl: 'https://api.local' },
      db: { url: 'POSTGRES://LOCAL' },
    })
  })

  test('throws on invalid config', async () => {
    writeYaml('broken')
    await expect(
      loadDevConfig({ schemaModule: 'src/schema.ts', root }),
    ).rejects.toThrow(/Config validation failed/)
  })
})

describe('watch', () => {
  test('runtime change reloads the page by default', async () => {
    const dev = await startDev()
    await loadSource(dev, 'virtual:config-kit')
    const send = vi.spyOn(dev.ws, 'send')
    const reloadModule = vi.spyOn(dev, 'reloadModule')

    await changeFile(dev, () => writeYaml('https://api.changed'))

    expect(send).toHaveBeenCalledWith({ type: 'full-reload' })
    expect(reloadModule).not.toHaveBeenCalled()
    expect(await loadSource(dev, 'virtual:config-kit')).toEqual({
      backend: { apiUrl: 'https://api.changed' },
    })
  })

  test('with hmr runtime change hot-reloads config modules', async () => {
    const dev = await startDev({ hmr: true })
    await loadSource(dev, 'virtual:config-kit')
    const reloadModule = vi.spyOn(dev, 'reloadModule')

    await changeFile(dev, () => writeYaml('https://api.changed'))

    expect(reloadModule).toHaveBeenCalled()
    expect(await loadSource(dev, 'virtual:config-kit')).toEqual({
      backend: { apiUrl: 'https://api.changed' },
    })
  })

  test('serverRestart paths restart the server', async () => {
    const dev = await startDev({ serverRestart: ['backend.*'] })
    const restart = vi.spyOn(dev, 'restart').mockResolvedValue()

    await changeFile(dev, () => writeYaml('https://api.changed'))

    expect(restart).toHaveBeenCalledOnce()
  })

  test('with hmr fullReload paths trigger a full page reload', async () => {
    const dev = await startDev({ hmr: true, fullReload: ['app.*'] })
    await loadSource(dev, 'virtual:config-kit')
    const send = vi.spyOn(dev.ws, 'send')

    await changeFile(dev, () =>
      writeYaml('https://api.local', '  app:\n    theme: dark\n'),
    )

    expect(send).toHaveBeenCalledWith({ type: 'full-reload' })
  })

  test('invalid change reports error and keeps previous config', async () => {
    const dev = await startDev({ hmr: true })
    await loadSource(dev, 'virtual:config-kit')
    const send = vi.spyOn(dev.ws, 'send')
    const reloadModule = vi.spyOn(dev, 'reloadModule')

    await changeFile(dev, () => writeYaml('broken'))

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

  test('ignores changes reported for unrelated files', async () => {
    const dev = await startDev()
    await loadSource(dev, 'virtual:config-kit')
    const send = vi.spyOn(dev.ws, 'send')

    await changeFile(
      dev,
      () => writeYaml('https://api.changed'),
      join(root, 'src/main.ts'),
    )

    expect(send).not.toHaveBeenCalledWith({ type: 'full-reload' })
  })

  test('watch: false disables reactions', async () => {
    const dev = await startDev({ watch: false })
    await loadSource(dev, 'virtual:config-kit')
    const send = vi.spyOn(dev.ws, 'send')

    await changeFile(dev, () => writeYaml('https://api.changed'))

    expect(send).not.toHaveBeenCalled()
  })

  test('recovering from an error clears the overlay with an update', async () => {
    const dev = await startDev({ hmr: true })
    await loadSource(dev, 'virtual:config-kit')
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

    const hot = await startDev({ hmr: true })
    expect((await hot.transformRequest('virtual:config-kit'))?.code).toContain(
      'import.meta.hot.accept()',
    )
  })

  test('unchanged content is a no-op', async () => {
    const dev = await startDev({ serverRestart: ['backend.*'] })
    await loadSource(dev, 'virtual:config-kit')
    const restart = vi.spyOn(dev, 'restart').mockResolvedValue()
    const send = vi.spyOn(dev.ws, 'send')

    await changeFile(dev, () => writeYaml('https://api.local'))

    expect(restart).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })
})

describe('build', () => {
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
    expect(existsSync(join(root, 'dist-config'))).toBe(false)
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

  test('builds a self-contained validator', async () => {
    await runBuild({ docker: true })
    rmSync(join(root, 'node_modules'))

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
      /Config validation failed for schema 'public' \(loaded from env APP_PUBLIC_CONFIG\)/,
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
      await runBuild({ docker: true })
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
  test('virtual modules read env at runtime', async () => {
    writeFileSync(
      schemaPath,
      [
        "import { z } from 'zod'",
        'export const publicSchema = z.looseObject({})',
        '',
      ].join('\n'),
    )
    writeFileSync(
      join(root, 'src/server.ts'),
      [
        "export { source as publicSource } from 'virtual:config-kit'",
        "export { source as privateSource, serverConfig } from 'virtual:config-kit/private'",
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
      plugins: [plugin({ docker: true })],
    })
    expect(existsSync(join(root, 'dist-config'))).toBe(false)
    const mod = (await import(
      pathToFileURL(join(root, 'dist-ssr/server.mjs')).href
    )) as {
      publicSource: ConfigModule['source']
      privateSource: ConfigModule['source']
      serverConfig: unknown
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
    expect(mod.serverConfig).toMatchObject({ db: { password: 'p' } })
  })
})
