import { afterEach, describe, expect, test, vi } from 'vitest'
import { z } from 'zod'

import {
  type ConfigKitDefinition,
  ConfigKitError,
  createInMemorySource,
} from '../core'
import { createJsonScriptSource } from './json-script-source'
import { resolvePublicConfig } from './public-config'

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

function resolve(onInvalid?: ConfigKitDefinition['onInvalid']) {
  return resolvePublicConfig(
    { schemas: { public: schema }, onInvalid },
    {
      source: createJsonScriptSource({ placeholder: PLACEHOLDER }),
      knownKeys: ['apiUrl'],
      unknownKeys: 'strict',
    },
  )
}

describe('resolvePublicConfig', () => {
  test('returns the validated config', () => {
    stubDocument('{"apiUrl":"/api"}')
    expect(resolve()).toEqual({ apiUrl: '/api' })
  })

  test.each([
    ['missing', null],
    ['placeholder', PLACEHOLDER],
    ['parse', '{'],
    ['schema', '{"apiUrl":1}'],
  ])('passes the %s kind to onInvalid', (kind, text) => {
    stubDocument(text)
    const onInvalid = vi.fn()
    expect(() => resolve(onInvalid)).toThrow(ConfigKitError)
    expect(onInvalid).toHaveBeenCalledWith(
      expect.any(ConfigKitError),
      expect.objectContaining({ kind, section: 'public' }),
    )
  })

  test('renders the default screen and halts without onInvalid', () => {
    const root = stubDocument('{"apiUrl":1}')
    expect(() => resolve()).toThrow(ConfigKitError)
    expect(root.replaceChildren).toHaveBeenCalledOnce()
  })

  test('halts without rendering when onInvalid returns nothing', () => {
    const root = stubDocument(PLACEHOLDER)
    expect(() => resolve(() => undefined)).toThrow(/placeholder/)
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

  test('shows both errors when the returned config is invalid too', () => {
    const root = stubDocument('{"apiUrl":1}')
    expect(() => resolve(() => ({ apiUrl: 2 }) as never)).toThrow(
      /loaded from script#__CONFIG__[\s\S]*invalid too[\s\S]*loaded from onInvalid/,
    )
    expect(root.replaceChildren).toHaveBeenCalledOnce()
  })

  test('treats unknown keys as invalid', () => {
    stubDocument('{"apiUrl":"/api","typo":1}')
    expect(() => resolve(vi.fn())).toThrow(/Unknown top-level config keys/)
  })

  test('halts when onInvalid returns a promise', () => {
    stubDocument('{')
    expect(() => resolve(async () => undefined)).toThrow(ConfigKitError)
  })

  test('rethrows errors that are not config errors', () => {
    expect(() =>
      resolvePublicConfig(
        { schemas: { public: schema } },
        {
          source: {
            ...createInMemorySource(undefined),
            loadSync: () => {
              throw new TypeError('boom')
            },
          },
        },
      ),
    ).toThrow(TypeError)
  })
})
