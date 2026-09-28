import { isPlainObject } from 'es-toolkit'
import { get } from 'es-toolkit/compat'
import { match, P } from 'ts-pattern'
import type { Rollup } from 'vite'

import { createProcessEnvSource } from '../node'
import type { ConfigKitSettings } from './config-file'
import { envPlaceholder, YamlSection } from './constants'
import { yamlDocument, yamlSource } from './dev-reader'

export interface Secret {
  path: string
  value: string
}

export function findBuildProblems(
  bundle: Rollup.OutputBundle,
  { secrets, publicEnvVar }: { secrets: Secret[]; publicEnvVar: string },
): string[] {
  const outputs = Object.values(bundle).map((output) => ({
    fileName: output.fileName,
    content: outputContent(output),
  }))
  const placeholder = envPlaceholder(publicEnvVar)
  const lostPlaceholder = outputs
    .filter(({ fileName }) => fileName.endsWith('.html'))
    .filter(({ content }) => !content.includes(placeholder))
    .map(
      ({ fileName }) =>
        `${fileName} lost the ${placeholder} placeholder: the container cannot inject the config. Check plugins that rewrite index.html`,
    )
  const leaks = outputs.flatMap(({ fileName, content }) =>
    secrets
      .filter(({ value }) => content.includes(value))
      .map(({ path }) => `${path} in ${fileName}`),
  )
  return [
    ...lostPlaceholder,
    ...(leaks.length > 0
      ? [`Sensitive config values found in the bundle: ${leaks.join(', ')}`]
      : []),
  ]
}

export function collectSecrets(
  settings: ConfigKitSettings,
  root: string,
): Secret[] {
  const sections = readYamlSections(settings, root)
  const envVarsBySection = {
    [YamlSection.Build]: settings.envVars.build,
    [YamlSection.Private]: settings.envVars.private,
  }
  return settings.sensitive.flatMap((entry) => {
    const [prefix, ...rest] = entry.split('.')
    const section =
      prefix === YamlSection.Build ? YamlSection.Build : YamlSection.Private
    const relative = rest.join('.')
    return [sections[section], envValue(envVarsBySection[section])].flatMap(
      (value) => stringLeaves(get(value, relative), entry),
    )
  })
}

function outputContent(
  output: Rollup.OutputChunk | Rollup.OutputAsset,
): string {
  return match(output)
    .with({ type: 'chunk' }, ({ code }) => code)
    .with({ type: 'asset' }, ({ source }) =>
      typeof source === 'string' ? source : new TextDecoder().decode(source),
    )
    .exhaustive()
}

function readYamlSections(
  settings: ConfigKitSettings,
  root: string,
): Record<string, unknown> {
  try {
    return yamlDocument(yamlSource(settings, root).yaml).sections
  } catch {
    return {}
  }
}

function envValue(envVar: string): unknown {
  try {
    return createProcessEnvSource({ envVar }).loadSync()?.raw
  } catch {
    return undefined
  }
}

function stringLeaves(value: unknown, path: string): Secret[] {
  return match(value)
    .with(P.string.minLength(1), (text) => [{ path, value: text }])
    .with(P.array(), (items) =>
      items.flatMap((item, index) => stringLeaves(item, `${path}[${index}]`)),
    )
    .when(isPlainObject, (object) =>
      Object.entries(object).flatMap(([key, item]) =>
        stringLeaves(item, `${path}.${key}`),
      ),
    )
    .otherwise(() => [])
}
