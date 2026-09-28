import { isPromise } from 'es-toolkit'

import {
  type ConfigKitDefinition,
  ConfigKitError,
  createInMemorySource,
  errorMessage,
  type ResolveSectionOptions,
  resolveSection,
  Section,
} from '../core'
import { renderConfigError } from './render-config-error'

type PublicConfigDefinition = Pick<ConfigKitDefinition, 'schemas' | 'onInvalid'>

export function resolvePublicConfig(
  config: PublicConfigDefinition,
  options: ResolveSectionOptions,
): unknown {
  try {
    return resolveSection(config, Section.Public, options)
  } catch (error) {
    if (!(error instanceof ConfigKitError)) throw error
    return resolveFallback(config, options, error)
  }
}

function resolveFallback(
  config: PublicConfigDefinition,
  options: ResolveSectionOptions,
  error: ConfigKitError,
): unknown {
  const renderDefault = () => renderConfigError(error)
  const fallback = config.onInvalid
    ? config.onInvalid(error, {
        kind: error.kind,
        section: Section.Public,
        source: error.source,
        renderDefault,
      })
    : renderDefault()
  if (!isUsableFallback(fallback)) throw error

  try {
    return resolveSection(config, Section.Public, {
      ...options,
      source: createInMemorySource(fallback, 'onInvalid'),
    })
  } catch (fallbackError) {
    const combined = new ConfigKitError(
      `${error.message}\n\nThe config returned by onInvalid is invalid too:\n${errorMessage(fallbackError)}`,
      { kind: error.kind, section: Section.Public, source: error.source },
      { cause: fallbackError },
    )
    renderConfigError(combined)
    throw combined
  }
}

function isUsableFallback(fallback: unknown): boolean {
  return fallback === undefined ? false : !isPromise(fallback)
}
