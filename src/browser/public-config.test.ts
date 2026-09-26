import { afterEach, describe, expect, test, vi } from 'vitest'
import { z } from 'zod'

import { ConfigKitError } from '../core'
import { readConfigScript, resolvePublicConfig } from './public-config'

const schema = z.object({ apiUrl: z.string() })
const ENV_VAR = 'APP_PUBLIC_CONFIG'
const PLACEHOLDER = `\${${ENV_VAR}}`

function stubDocument(text: string | null) {
  const root = { replaceChildren: vi.fn() }
  vi.stubGlobal('document', {
    getElementById: (id: string) =>
      id === '__CONFIG__'
        ? text === null
          ? null
          : { textContent: text }
        : root,
    createElement: () => ({ style: {} }),
  })
  return root
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function resolve(
  onInvalid?: Parameters<typeof resolvePublicConfig>[0]['config']['onInvalid'],
) {
  return resolvePublicConfig({
    config: { schemas: { public: schema }, onInvalid },
    read: () => readConfigScript('__CONFIG__', 'APP_PUBLIC_CONFIG'),
    knownKeys: ['apiUrl'],
    unknownKeys: 'strict',
  })
}

describe('readConfigScript', () => {
  test.each([
    ['missing', null, 'missing'],
    ['empty', ' ', 'missing'],
    ['placeholder', PLACEHOLDER, 'placeholder'],
    ['broken JSON', '{', 'parse'],
  ])('classifies a %s element', (_, text, kind) => {
    stubDocument(text)
    expect(() => readConfigScript('__CONFIG__', 'APP_PUBLIC_CONFIG')).toThrow(
      expect.objectContaining({
        kind,
        section: 'public',
        source: 'script#__CONFIG__',
      }),
    )
  })
})

describe('resolvePublicConfig', () => {
  test('returns the validated config', () => {
    stubDocument('{"apiUrl":"/api"}')
    expect(resolve()).toEqual({ apiUrl: '/api' })
  })

  test('renders the default screen and halts without onInvalid', () => {
    const root = stubDocument('{"apiUrl":1}')
    expect(() => resolve()).toThrow(ConfigKitError)
    expect(root.replaceChildren).toHaveBeenCalledOnce()
  })

  test('halts when onInvalid returns nothing', () => {
    const root = stubDocument(PLACEHOLDER)
    const onInvalid = vi.fn()
    expect(() => resolve(onInvalid)).toThrow(/placeholder/)
    expect(onInvalid).toHaveBeenCalledWith(
      expect.any(ConfigKitError),
      expect.objectContaining({
        kind: 'placeholder',
        section: 'public',
        source: 'script#__CONFIG__',
      }),
    )
    expect(root.replaceChildren).not.toHaveBeenCalled()
  })

  test('renderDefault shows the default screen from onInvalid', () => {
    const root = stubDocument('{')
    expect(() =>
      resolve((_error, { renderDefault }) => {
        renderDefault()
      }),
    ).toThrow(/Failed to parse script#__CONFIG__/)
    expect(root.replaceChildren).toHaveBeenCalledOnce()
  })

  test('runs with the config onInvalid returns', () => {
    stubDocument('{"apiUrl":1}')
    expect(resolve(() => ({ apiUrl: '/fallback' }))).toEqual({
      apiUrl: '/fallback',
    })
  })

  test('validates the returned config', () => {
    stubDocument('{"apiUrl":1}')
    expect(() => resolve(() => ({ apiUrl: 2 }) as never)).toThrow(
      /loaded from onInvalid/,
    )
  })

  test('treats unknown keys as invalid', () => {
    stubDocument('{"apiUrl":"/api","typo":1}')
    const onInvalid = vi.fn()
    expect(() => resolve(onInvalid)).toThrow(/Unknown top-level config keys/)
    expect(onInvalid.mock.calls[0]?.[1]).toMatchObject({ kind: 'schema' })
  })

  test('halts when onInvalid returns a promise', () => {
    stubDocument('{')
    expect(() => resolve(async () => undefined)).toThrow(ConfigKitError)
  })

  test('rethrows errors that are not config errors', () => {
    expect(() =>
      resolvePublicConfig({
        config: { schemas: { public: schema } },
        read: () => {
          throw new TypeError('boom')
        },
      }),
    ).toThrow(TypeError)
  })
})
