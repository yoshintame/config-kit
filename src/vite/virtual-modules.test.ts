import { describe, expect, test, vi } from 'vitest'

import { createInMemorySource, type InMemorySource } from '../core'
import { buildModule, devModule } from './virtual-modules'

interface HotStub {
  data: Record<string, unknown>
  accept: () => void
}

function runDevModule(code: string, hot: HotStub): InMemorySource {
  const body = code
    .replace(/^import .*$/m, '')
    .replaceAll('import.meta.hot', 'hot')
    .replace('export const source', 'const source')
  return new Function('createInMemorySource', 'hot', `${body}\nreturn source`)(
    createInMemorySource,
    hot,
  )
}

describe('devModule', () => {
  test('keeps one source across hot updates and pushes the new value', () => {
    const hot: HotStub = { data: {}, accept: vi.fn() }
    const first = runDevModule(
      devModule({ raw: { a: 1 }, origin: 'yaml' }),
      hot,
    )
    const onChange = vi.fn()
    first.watch?.(onChange)

    const second = runDevModule(
      devModule({ raw: { a: 2 }, origin: 'yaml' }),
      hot,
    )

    expect(second).toBe(first)
    expect(first.loadSync()).toEqual({ a: 2 })
    expect(onChange).toHaveBeenCalledOnce()
    expect(hot.accept).toHaveBeenCalledTimes(2)
  })

  test('describes the source with its origin', () => {
    const source = runDevModule(devModule({ raw: {}, origin: 'file x' }), {
      data: {},
      accept: () => {},
    })
    expect(source.describe()).toBe('file x')
  })
})

describe('buildModule', () => {
  const names = {
    elementId: 'cfg',
    publicEnvVar: 'PUB',
    privateEnvVar: 'PRIV',
  }

  test('client public module reads the JSON script', () => {
    expect(buildModule({ kind: 'public', ssr: false, ...names })).toBe(
      [
        "import { createJsonScriptSource } from '@yoshintame/config-kit/browser'",
        'export const source = createJsonScriptSource({ elementId: "cfg" })',
      ].join('\n'),
    )
  })

  test('ssr public module reads the public env var', () => {
    expect(buildModule({ kind: 'public', ssr: true, ...names })).toContain(
      'createProcessEnvSource({ envVar: "PUB" })',
    )
  })

  test('server module merges both env vars', () => {
    expect(buildModule({ kind: 'server', ssr: true, ...names })).toContain(
      'mergeAll([createProcessEnvSource({ envVar: "PUB" }), createProcessEnvSource({ envVar: "PRIV" })])',
    )
  })
})
