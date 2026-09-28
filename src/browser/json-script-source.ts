import { match, P } from 'ts-pattern'

import {
  ConfigErrorKind,
  ConfigKitError,
  jsonParser,
  parseWith,
  type SyncConfigSource,
} from '../core'

export const DEFAULT_CONFIG_ELEMENT_ID = '__CONFIG__'

export interface JsonScriptSourceOptions {
  elementId?: string
  placeholder?: string
}

export function createJsonScriptSource({
  elementId = DEFAULT_CONFIG_ELEMENT_ID,
  placeholder,
}: JsonScriptSourceOptions = {}): SyncConfigSource {
  const source = `script#${elementId}`

  return {
    loadSync() {
      return match(
        globalThis.document?.getElementById(elementId)?.textContent?.trim(),
      )
        .with(P.union(P.nullish, ''), () => undefined)
        .when(
          (input) => input === placeholder,
          () => {
            throw new ConfigKitError(
              `${source} still holds the ${placeholder} placeholder: the container did not substitute it into index.html`,
              { kind: ConfigErrorKind.Placeholder, section: undefined, source },
            )
          },
        )
        .otherwise((input) => parseWith({ parser: jsonParser, input, source }))
    },
    describe: () => source,
  }
}
