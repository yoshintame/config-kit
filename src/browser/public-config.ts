import {
  type ConfigKitDefinition,
  ConfigKitError,
  errorMessage,
  parseOrThrow,
  type StandardSchemaV1,
  type UnknownKeys,
} from '../core'
import { renderConfigError } from './render-config-error'

export interface RawConfig {
  raw: unknown
  source: string
}

export interface ResolvePublicConfigOptions<S extends StandardSchemaV1> {
  config: {
    schemas: { public: S }
    onInvalid?: ConfigKitDefinition['onInvalid']
  }
  read(): RawConfig
  knownKeys?: readonly string[]
  unknownKeys?: UnknownKeys
}

const SECTION = 'public'

export function resolvePublicConfig<S extends StandardSchemaV1>({
  config,
  read,
  knownKeys,
  unknownKeys,
}: ResolvePublicConfigOptions<S>): StandardSchemaV1.InferOutput<S> {
  const parse = ({ raw, source }: RawConfig) =>
    parseOrThrow(config.schemas.public, raw, source, {
      name: SECTION,
      knownKeys,
      unknownKeys,
    })
  try {
    return parse(read())
  } catch (error) {
    if (!(error instanceof ConfigKitError)) throw error
    const fallback = handleInvalid(config.onInvalid, error)
    if (fallback === undefined) throw error
    return parse({ raw: fallback, source: 'onInvalid' })
  }
}

function handleInvalid(
  onInvalid: ConfigKitDefinition['onInvalid'],
  error: ConfigKitError,
): unknown {
  const renderDefault = () => renderConfigError(error)
  if (!onInvalid) {
    renderDefault()
    return undefined
  }
  const result = onInvalid(error, {
    kind: error.kind,
    section: SECTION,
    source: error.source,
    renderDefault,
  })
  return isThenable(result) ? undefined : result
}

function isThenable(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  )
}

export function readConfigScript(elementId: string, envVar: string): RawConfig {
  const source = `script#${elementId}`
  const details = { section: SECTION, source }
  const text = globalThis.document?.getElementById(elementId)?.textContent
  if (!text?.trim()) {
    throw new ConfigKitError(`Config element ${source} is missing or empty`, {
      kind: 'missing',
      ...details,
    })
  }
  if (text.trim() === `\${${envVar}}`) {
    throw new ConfigKitError(
      `${source} still holds the \${${envVar}} placeholder: the container did not substitute ${envVar} into index.html`,
      { kind: 'placeholder', ...details },
    )
  }
  try {
    return { raw: JSON.parse(text), source }
  } catch (error) {
    throw new ConfigKitError(
      `Failed to parse ${source}: ${errorMessage(error)}`,
      { kind: 'parse', ...details },
      { cause: error },
    )
  }
}
