import type { SyncConfigLoader } from '../core'

export interface BootstrapOptions {
  renderError?: (error: unknown) => void
}

export async function bootstrap(
  loader: Pick<SyncConfigLoader, 'validateAll' | 'assertOnlyKnownTopKeys'>,
  importApp: () => Promise<unknown>,
  { renderError = renderConfigError }: BootstrapOptions = {},
): Promise<void> {
  try {
    loader.validateAll()
    loader.assertOnlyKnownTopKeys()
  } catch (error) {
    renderError(error)
    return
  }
  await importApp()
}

export function renderConfigError(error: unknown): void {
  console.error(error)
  const message = document.createElement('pre')
  message.style.whiteSpace = 'pre-wrap'
  message.style.padding = '1rem'
  message.textContent = error instanceof Error ? error.message : String(error)
  ;(document.getElementById('root') ?? document.body).replaceChildren(message)
}
