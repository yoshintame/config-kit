export type ConfigErrorKind = 'missing' | 'placeholder' | 'parse' | 'schema'

export interface ConfigErrorDetails {
  kind: ConfigErrorKind
  section: string | undefined
  source: string
}

export class ConfigKitError extends Error {
  override readonly name = 'ConfigKitError'
  readonly kind: ConfigErrorKind
  readonly section: string | undefined
  readonly source: string

  constructor(
    message: string,
    { kind, section, source }: ConfigErrorDetails,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.kind = kind
    this.section = section
    this.source = source
  }
}
