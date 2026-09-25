import type { Parser } from '../core'

export const createFileSource = unavailable
export const createProcessEnvSource = unavailable
export const createYamlEnvSource = unavailable
export const createYamlConfigLoader = unavailable
export const yamlParser: Parser = { parse: unavailable }

function unavailable(): never {
  throw new Error(
    '@yoshintame/config-kit/node is not available in the browser: use @yoshintame/config-kit/browser',
  )
}
