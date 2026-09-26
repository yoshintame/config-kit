import { isPlainObject } from 'es-toolkit'
import { get } from 'es-toolkit/compat'
import type { Rollup } from 'vite'

import { createProcessEnvSource } from '../node'
import type { ConfigKitSettings } from './config-file'
import { yamlSections, yamlSource } from './dev-reader'

export const MIN_SECRET_LENGTH = 8

export interface Secret {
  path: string
  value: string
}

export function collectSecrets(
  settings: ConfigKitSettings,
  root: string,
): Secret[] {
  const sections = readYamlSections(settings, root)
  const env = (envVar: string) => {
    try {
      return createProcessEnvSource({ envVar }).loadSync()
    } catch {
      return undefined
    }
  }
  const { envVars } = settings
  const publicValues = new Set(
    [sections.public, env(envVars.public)]
      .flatMap((value) => stringLeaves(value, 'public'))
      .map((leaf) => leaf.value),
  )
  const privateLeaves = [sections.private, env(envVars.private)].flatMap(
    (value) => stringLeaves(value, 'private'),
  )
  const sensitiveLeaves = settings.sensitive.flatMap((entry) => {
    const relative = entry.slice('build.'.length)
    return [sections.build, env(envVars.build)].flatMap((value) =>
      stringLeaves(get(value, relative), entry),
    )
  })
  return [...privateLeaves, ...sensitiveLeaves].filter(
    ({ value }) =>
      value.length >= MIN_SECRET_LENGTH && !publicValues.has(value),
  )
}

function readYamlSections(
  settings: ConfigKitSettings,
  root: string,
): Record<string, unknown> {
  try {
    return yamlSections(yamlSource(settings, root).yaml)
  } catch {
    return {}
  }
}

function stringLeaves(value: unknown, path: string): Secret[] {
  if (typeof value === 'string') return [{ path, value }]
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      stringLeaves(item, `${path}[${index}]`),
    )
  }
  if (isPlainObject(value)) {
    return Object.entries(value).flatMap(([key, item]) =>
      stringLeaves(item, `${path}.${key}`),
    )
  }
  return []
}

export function findLeaks(
  bundle: Rollup.OutputBundle,
  secrets: Secret[],
): string[] {
  if (secrets.length === 0) return []
  const decoder = new TextDecoder()
  return Object.values(bundle).flatMap((output) => {
    const content =
      output.type === 'chunk'
        ? output.code
        : typeof output.source === 'string'
          ? output.source
          : decoder.decode(output.source)
    return secrets
      .filter(({ value }) => content.includes(value))
      .map(({ path }) => `${path} in ${output.fileName}`)
  })
}
