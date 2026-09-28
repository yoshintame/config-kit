import { describe, expect, test } from 'vitest'
import z from 'zod'

import { Section } from '../core'
import { JsonSchemaIo, jsonSchemaOf } from '../core/standard-schema'
import { resolveSettings } from './config-file'
import {
  buildConfigModule,
  buildModule,
  devModule,
  validatorModule,
} from './virtual-modules'

const settings = resolveSettings({
  schemas: {
    public: z.object({ a: z.number(), flag: z.boolean().default(false) }),
  },
})
const target = { configPath: '/app/config-kit.config.ts', settings }

describe('devModule', () => {
  test('serializes raw config as data, never as code', () => {
    const code = devModule({
      ...target,
      section: Section.Public,
      loaded: { raw: { code: 'alert(1)' }, source: 'yaml' },
      hmr: false,
    })
    expect(code).toContain(
      'createInMemorySource({ "code": "alert(1)" }, "yaml")',
    )
  })

  test('self-accepts only with hmr', () => {
    const loaded = { raw: { a: 1 }, source: 'yaml' }
    expect(
      devModule({ ...target, section: Section.Public, loaded, hmr: false }),
    ).not.toContain('import.meta.hot')
    expect(
      devModule({ ...target, section: Section.Public, loaded, hmr: true }),
    ).toContain('if (import.meta.hot) import.meta.hot.accept()')
  })
})

test('buildModule passes the known keys to the runtime', () => {
  expect(
    buildModule({ ...target, section: Section.Public, ssr: false }),
  ).toContain('"knownKeys": ["a","flag"], "unknownKeys": "strict"')
})

test('validatorModule runs the validator on the public env var', () => {
  expect(validatorModule(target)).toContain(
    'runValidator(config, { "envVar": "APP_PUBLIC_CONFIG"',
  )
})

describe('buildConfigModule', () => {
  test('inlines the value', () => {
    expect(buildConfigModule({ msw: false }, undefined)).toBe(
      'export const buildConfig = {"msw":false}',
    )
  })

  test('spells out absent optional fields from the schema shape', () => {
    const schema = z.object({
      msw: z.boolean(),
      token: z.string().optional(),
      nested: z.object({ actAs: z.string().optional() }).prefault({}),
    })
    expect(
      buildConfigModule(
        { msw: true, nested: {} },
        jsonSchemaOf(schema, JsonSchemaIo.Output),
      ),
    ).toBe(
      'export const buildConfig = {"msw":true,"nested":{"actAs":undefined},"token":undefined}',
    )
  })

  test('rejects values that are not JSON', () => {
    expect(() =>
      buildConfigModule({ at: { when: new Date(0) } }, undefined),
    ).toThrow('buildConfig.at.when is not a JSON value')
  })
})
