import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { build } from 'vite'
import { describe, expect, test } from 'vitest'

import { INJECT_HOOK_FILE, VALIDATOR_FILE } from './docker'
import { configKit } from './plugin'
import {
  type ConfigModule,
  configPath,
  root,
  runBuild,
  sourceResolve,
  useFixture,
  writeConfig,
} from './testing/fixture'

useFixture()

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
    expect(missing.stderr).toContain(
      'Config not found in env APP_PUBLIC_CONFIG',
    )
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
      expect(missing.stderr).toContain('APP_PUBLIC_CONFIG is not set or empty')
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
      'Config not found in env APP_PUBLIC_CONFIG',
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
