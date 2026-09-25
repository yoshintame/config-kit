import { jsonParser, parseWith, type SyncConfigSource } from '../core'

export const DEFAULT_CONFIG_ELEMENT_ID = '__CONFIG__'

export interface JsonScriptSourceOptions {
  elementId?: string
}

export function createJsonScriptSource({
  elementId = DEFAULT_CONFIG_ELEMENT_ID,
}: JsonScriptSourceOptions = {}): SyncConfigSource {
  const origin = `script#${elementId}`

  return {
    loadSync() {
      const text = globalThis.document?.getElementById(elementId)?.textContent
      return text ? parseWith(jsonParser, text, origin) : undefined
    },
    describe: () => origin,
  }
}
