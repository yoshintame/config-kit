import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test, vi } from 'vitest'

import {
  changeFile,
  publicConfig,
  root,
  startDev,
  useFixture,
  writeConfig,
  writeYaml,
  yamlPath,
} from './testing/fixture'

useFixture()

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

  test('a public change hidden by private in the server view still reloads', async () => {
    writeFileSync(
      yamlPath,
      'public:\n  backend:\n    apiUrl: https://api.local\nprivate:\n  backend:\n    apiUrl: https://internal\n  db:\n    url: postgres://local\n',
    )
    const dev = await startDev()
    await publicConfig(dev)
    const send = vi.spyOn(dev.ws, 'send')

    await changeFile(dev, () =>
      writeFileSync(
        yamlPath,
        'public:\n  backend:\n    apiUrl: https://api.changed\nprivate:\n  backend:\n    apiUrl: https://internal\n  db:\n    url: postgres://local\n',
      ),
    )

    expect(send).toHaveBeenCalledWith({ type: 'full-reload' })
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
