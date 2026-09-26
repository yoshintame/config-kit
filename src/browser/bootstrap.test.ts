import { afterEach, describe, expect, test, vi } from 'vitest'

import { bootstrap } from './bootstrap'

function loader(error?: Error) {
  return {
    validateAll: vi.fn(() => {
      if (error) throw error
    }),
    assertOnlyKnownTopKeys: vi.fn(),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('bootstrap', () => {
  test('imports the app after the config validates', async () => {
    const valid = loader()
    const importApp = vi.fn(async () => ({}))

    await bootstrap(valid, importApp)

    expect(valid.assertOnlyKnownTopKeys).toHaveBeenCalledOnce()
    expect(importApp).toHaveBeenCalledOnce()
  })

  test('renders the error instead of importing the app', async () => {
    const importApp = vi.fn(async () => ({}))
    const renderError = vi.fn()
    const error = new Error('bad config')

    await bootstrap(loader(error), importApp, { renderError })

    expect(renderError).toHaveBeenCalledWith(error)
    expect(importApp).not.toHaveBeenCalled()
  })

  test('default screen replaces #root with the message', async () => {
    const pre = { style: {} as Record<string, string>, textContent: '' }
    const root = { replaceChildren: vi.fn() }
    vi.stubGlobal('document', {
      createElement: () => pre,
      getElementById: (id: string) => (id === 'root' ? root : null),
      body: null,
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await bootstrap(loader(new Error('bad config')), async () => ({}))

    expect(pre.textContent).toBe('bad config')
    expect(root.replaceChildren).toHaveBeenCalledWith(pre)
    expect(console.error).toHaveBeenCalled()
  })
})
