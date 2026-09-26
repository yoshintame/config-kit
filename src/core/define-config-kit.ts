import type { ConfigErrorKind, ConfigKitError } from './errors'
import type { ObjectSchema } from './loader'
import type { UnknownKeys } from './parse-or-throw'
import type { StandardSchemaV1 } from './standard-schema'

export interface ConfigKitSchemas {
  public: ObjectSchema
  server?: ObjectSchema
  build?: ObjectSchema
}

export interface InvalidConfigContext {
  kind: ConfigErrorKind
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

export interface ConfigKitDefinition<
  S extends ConfigKitSchemas = ConfigKitSchemas,
> {
  schemas: S
  onInvalid?: (
    error: ConfigKitError,
    context: InvalidConfigContext,
  ) => StandardSchemaV1.InferInput<S['public']> | undefined | void
  unknownKeys?: UnknownKeys
  sensitive?: `build.${string}`[]
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

export interface Register {}

type RegisteredSchemas = Register extends {
  config: { schemas: infer S extends ConfigKitSchemas }
}
  ? S
  : ConfigKitSchemas

type OutputOr<S, Fallback> = S extends ObjectSchema
  ? StandardSchemaV1.InferOutput<S>
  : Fallback

export type PublicConfig = StandardSchemaV1.InferOutput<
  RegisteredSchemas['public']
>

export type ServerConfig = OutputOr<RegisteredSchemas['server'], PublicConfig>

export type BuildConfig = OutputOr<
  RegisteredSchemas['build'],
  Record<string, never>
>

export type ServerConfigOf<S extends ConfigKitSchemas> = OutputOr<
  S['server'],
  StandardSchemaV1.InferOutput<S['public']>
>
