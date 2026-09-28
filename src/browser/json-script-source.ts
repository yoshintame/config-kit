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

  function parseInput(input: string) {
    if (input === placeholder) {
      throw new ConfigKitError(
        `${source} still holds the ${placeholder} placeholder: the container did not substitute it into index.html`,
        { kind: ConfigErrorKind.Placeholder, section: undefined, source },
      )
    }
    return parseWith({ parser: jsonParser, input, source })
  }

  return {
    loadSync() {
      const input = globalThis.document
        ?.getElementById(elementId)
        ?.textContent?.trim()
      return input ? parseInput(input) : undefined
    },
    describe: () => source,
  }
}
