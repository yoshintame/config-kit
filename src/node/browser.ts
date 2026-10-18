import type * as node from './index'

export const createFileSource: typeof node.createFileSource = unavailable
export const createProcessEnvSource: typeof node.createProcessEnvSource =
  unavailable
export const createYamlEnvSource: typeof node.createYamlEnvSource = unavailable
export const createYamlConfigLoader: typeof node.createYamlConfigLoader =
  unavailable
export const createServerEnvSource: typeof node.createServerEnvSource =
  unavailable
export const runValidator: typeof node.runValidator = unavailable
export const yamlParser: typeof node.yamlParser = { parse: unavailable }

function unavailable(): never {
  throw new Error(
    '@yoshintame/config-kit/node is not available in the browser: use @yoshintame/config-kit/browser',
  )
}
