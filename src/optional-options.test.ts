import { expectTypeOf, test } from 'vitest'
import { z } from 'zod'

import { createJsonScriptSource } from './browser'
import { defineConfigKit } from './core'
import { createProcessEnvSource, createYamlEnvSource } from './node'
import { configKit, loadDevConfig } from './vite'

test('the entry options accept undefined in optional fields', () => {
  const definition = defineConfigKit({ schemas: { public: z.object({}) } })
  expectTypeOf(createJsonScriptSource).toBeCallableWith({
    elementId: undefined,
    placeholder: undefined,
  })
  expectTypeOf(createProcessEnvSource).toBeCallableWith({
    envVar: 'APP_CONFIG',
    parser: undefined,
  })
  expectTypeOf(createYamlEnvSource).toBeCallableWith({
    envVar: 'APP_CONFIG',
    yamlFile: 'config.yaml',
    yamlPath: undefined,
  })
  expectTypeOf(configKit).toBeCallableWith({ configFile: undefined })
  expectTypeOf(loadDevConfig).toBeCallableWith(definition, { root: undefined })
})
