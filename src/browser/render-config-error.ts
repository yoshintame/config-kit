export function renderConfigError(error: unknown): void {
  const message = document.createElement('pre')
  message.style.whiteSpace = 'pre-wrap'
  message.style.padding = '1rem'
  message.textContent = error instanceof Error ? error.message : String(error)
  ;(document.getElementById('root') ?? document.body).replaceChildren(message)
}
