export enum ConfigErrorKind {
  Missing = 'missing',
  Placeholder = 'placeholder',
  Parse = 'parse',
  Schema = 'schema',
}

export interface ConfigErrorDetails {
  kind: `${ConfigErrorKind}`
  section: string | undefined
  source: string
}

export class ConfigKitError extends Error {
  public override readonly name = 'ConfigKitError'
  public readonly kind: `${ConfigErrorKind}`
  public readonly section: string | undefined
  public readonly source: string

  public constructor(
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
