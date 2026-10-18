import {
  createInMemorySource,
  defineConfigKit,
  resolveConfig,
} from '@yoshintame/config-kit'
import { z } from 'zod'

const schema = z.object({ apiUrl: z.string() })

const resolved: { apiUrl: string } = resolveConfig(schema, {
  source: createInMemorySource({ apiUrl: '/api' }),
  name: 'app',
  knownKeys: undefined,
  unknownKeys: undefined,
  warn: undefined,
})

const definition = defineConfigKit({
  schemas: { public: schema, server: undefined, build: undefined },
  onInvalid: undefined,
  unknownKeys: undefined,
  sensitive: undefined,
  docker: undefined,
  elementId: undefined,
  envVars: { public: undefined, private: undefined, build: undefined },
  dev: {
    yamlFile: undefined,
    yamlPath: undefined,
    localYamlFile: undefined,
    overlayEnvVar: undefined,
    watch: undefined,
    hmr: undefined,
    serverRestart: undefined,
    fullReload: undefined,
  },
})

export { definition, resolved }
