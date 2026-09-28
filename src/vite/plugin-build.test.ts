import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Plugin } from 'vite'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import {
  BUILD_SCHEMA,
  changeFile,
  configPath,
  loadModule,
  publicConfig,
  root,
  runBuild,
  SERVER_SCHEMA,
  startDev,
  useFixture,
  writeConfig,
  writeMain,
  writeYaml,
  yamlPath,
} from './testing/fixture'

useFixture()

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
      /Sensitive config values found in the bundle: build\.actAs in assets\/index-.*\.js/,
    )
  })
})

describe('leak scan', () => {
  test('fails the build when a sensitive private value reaches a chunk', async () => {
    writeConfig({ options: ["sensitive: ['private.db.url']"] })
    writeMain("console.log('postgres://local')")
    await expect(runBuild()).rejects.toThrow(
      /found in the bundle: private\.db\.url in assets\/index-.*\.js/,
    )
  })

  test('checks sensitive values from the env var', async () => {
    writeConfig({ options: ["sensitive: ['private.db.url']"] })
    vi.stubEnv(
      'APP_PRIVATE_CONFIG',
      JSON.stringify({ db: { url: 'postgres://from-env' } }),
    )
    writeMain("console.log('postgres://from-env')")
    await expect(runBuild()).rejects.toThrow(/private\.db\.url/)
  })

  test('ignores private values that are not sensitive', async () => {
    writeMain("console.log('postgres://local')")
    await expect(runBuild()).resolves.toBeDefined()
  })

  test('skips artifacts of a failed build', async () => {
    writeConfig({ options: ["sensitive: ['private.db.url']", 'docker: true'] })
    writeMain("console.log('postgres://local')")
    await expect(runBuild()).rejects.toThrow(/private\.db\.url/)
    expect(existsSync(join(root, 'dist-config'))).toBe(false)
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
    expect(js).toMatch(/"?knownKeys"?: \["backend"\]/)
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
