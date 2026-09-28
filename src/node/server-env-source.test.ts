import { afterEach, describe, expect, test, vi } from 'vitest'

import { createServerEnvSource } from './server-env-source'

const source = createServerEnvSource({
  publicEnvVar: 'TEST_PUBLIC',
  privateEnvVar: 'TEST_PRIVATE',
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('createServerEnvSource', () => {
  test('merges private over public', () => {
    vi.stubEnv('TEST_PUBLIC', '{"db":{"host":"h"}}')
    vi.stubEnv('TEST_PRIVATE', '{"db":{"password":"p"}}')
    expect(source.loadSync()).toEqual({
      raw: { db: { host: 'h', password: 'p' } },
      source: 'env TEST_PUBLIC + env TEST_PRIVATE',
    })
  })

  test('requires the public env var', () => {
    vi.stubEnv('TEST_PRIVATE', '{"db":{"password":"p"}}')
    expect(() => source.loadSync()).toThrow(
      expect.objectContaining({ kind: 'missing', section: 'public' }),
    )
  })
})
