import type { ConfigErrorKind, ConfigKitError } from './errors'
import type { ObjectSchema } from './loader'
import type { UnknownKeys } from './parse-or-throw'
import type { StandardSchemaV1 } from './standard-schema'

export enum Section {
  Public = 'public',
  Server = 'server',
  Build = 'build',
}

export interface ConfigKitSchemas {
  public: ObjectSchema
  server?: ObjectSchema
  build?: ObjectSchema
}

export interface InvalidConfigContext {
  kind: `${ConfigErrorKind}`
  section: string
  source: string
  renderDefault(): void
}

export interface DevOptions {
  yamlFile?: string
  yamlPath?: string
  localYamlFile?: string | false
  overlayEnvVar?: string
  watch?: boolean
  hmr?: boolean
  serverRestart?: string[]
  fullReload?: string[]
}

export interface EnvVarNames {
  public?: string
  private?: string
  build?: string
}

export type SensitivePath = `build.${string}` | `private.${string}`

export interface ConfigKitDefinition<
  S extends ConfigKitSchemas = ConfigKitSchemas,
> {
  schemas: S
  onInvalid?: (
    error: ConfigKitError,
    context: InvalidConfigContext,
    // biome-ignore lint/suspicious/noConfusingVoidType: a handler without a return statement returns void
  ) => StandardSchemaV1.InferInput<S['public']> | void
  unknownKeys?: `${UnknownKeys}`
  sensitive?: SensitivePath[]
  dev?: DevOptions
  docker?: boolean
  envVars?: EnvVarNames
  elementId?: string
}

export function defineConfigKit<S extends ConfigKitSchemas>(
  definition: ConfigKitDefinition<S>,
): ConfigKitDefinition<S> {
  return definition
}

// biome-ignore lint/suspicious/noEmptyInterface: the app augments it with its config
export interface Register {}

export type PublicConfig = StandardSchemaV1.InferOutput<
  RegisteredSchemas['public']
>

export type ServerConfig = ServerConfigOf<RegisteredSchemas>

export type BuildConfig = OutputOr<
  SchemaAt<RegisteredSchemas, Section.Build>,
  Record<never, never>
>

export type ServerConfigOf<S extends ConfigKitSchemas> = OutputOr<
  SchemaAt<S, Section.Server>,
  StandardSchemaV1.InferOutput<S['public']>
>

type RegisteredSchemas = Register extends {
  config: { schemas: infer S extends ConfigKitSchemas }
}
  ? S
  : ConfigKitSchemas

type SchemaAt<S, K extends string> = S extends {
  [P in K]: infer X extends ObjectSchema
}
  ? X
  : undefined

type OutputOr<X, Fallback> = X extends ObjectSchema
  ? StandardSchemaV1.InferOutput<X>
  : Fallback
