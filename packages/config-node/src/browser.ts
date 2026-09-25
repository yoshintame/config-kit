import type { Parser } from '@senate/config-core'

export const createFileSource = unavailable
export const createProcessEnvSource = unavailable
export const createYamlEnvSource = unavailable
export const createYamlConfigLoader = unavailable
export const yamlParser: Parser = { parse: unavailable }

function unavailable(): never {
  throw new Error(
    '@senate/config-node is not available in the browser: use @senate/config-browser',
  )
}
