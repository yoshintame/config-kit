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
  server?: ObjectSchema | undefined
  build?: ObjectSchema | undefined
}

export interface InvalidConfigContext {
  kind: `${ConfigErrorKind}`
  section: string
  source: string
  renderDefault: () => void
}

export interface DevOptions {
  yamlFile?: string | undefined
  yamlPath?: string | undefined
  localYamlFile?: string | false | undefined
  overlayEnvVar?: string | undefined
  watch?: boolean | undefined
  hmr?: boolean | undefined
  serverRestart?: string[] | undefined
  fullReload?: string[] | undefined
}

export interface EnvVarNames {
  public?: string | undefined
  private?: string | undefined
  build?: string | undefined
}

export type SensitivePath = `build.${string}` | `private.${string}`

export interface ConfigKitDefinition<
  S extends ConfigKitSchemas = ConfigKitSchemas,
> {
  schemas: S
  onInvalid?:
    | ((
        error: ConfigKitError,
        context: InvalidConfigContext,
        // oxlint-disable-next-line typescript/no-invalid-void-type -- a handler without a return statement returns void
      ) => StandardSchemaV1.InferInput<S['public']> | void)
    | undefined
  unknownKeys?: `${UnknownKeys}` | undefined
  sensitive?: SensitivePath[] | undefined
  dev?: DevOptions | undefined
  docker?: boolean | undefined
  envVars?: EnvVarNames | undefined
  elementId?: string | undefined
}

export function defineConfigKit<S extends ConfigKitSchemas>(
  definition: ConfigKitDefinition<S>,
): ConfigKitDefinition<S> {
  return definition
}

// oxlint-disable-next-line typescript/no-empty-object-type -- the app augments it with its config
export interface Register {}

export type PublicConfig = StandardSchemaV1.InferOutput<
  RegisteredSchemas['public']
>

export type ServerConfig = ServerConfigOf<RegisteredSchemas>

// oxlint-disable-next-line typescript/no-generated-empty-object-type -- without a build schema the build config has no keys
export type BuildConfig = OutputOr<
  SchemaAt<RegisteredSchemas, Section.Build>,
  // oxlint-disable-next-line typescript/no-generated-empty-object-type -- see above
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
