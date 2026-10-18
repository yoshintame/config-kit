import type { OptionalKeysOf } from 'type-fest'
import { expectTypeOf, test } from 'vitest'

import type { JsonScriptSourceOptions } from './browser'
import type {
  ConfigKitDefinition,
  DefineConfigOptions,
  DevOptions,
  EnvVarNames,
  ParseOptions,
  ResolveSectionOptions,
  SyncConfigSource,
} from './core'
import type {
  ProcessEnvSourceOptions,
  ValidatorOptions,
  YamlEnvSourceOptions,
} from './node'
import type { ConfigKitOptions, loadDevConfig } from './vite'

type UndefinedInOptionalFields<T extends object> = {
  [K in OptionalKeysOf<T>]?: undefined
}

type LoadDevConfigOptions = NonNullable<Parameters<typeof loadDevConfig>[1]>

test('optional fields of the public types accept undefined', () => {
  expectTypeOf<UndefinedInOptionalFields<ConfigKitDefinition>>().toExtend<
    Pick<ConfigKitDefinition, OptionalKeysOf<ConfigKitDefinition>>
  >()
  expectTypeOf<UndefinedInOptionalFields<DevOptions>>().toExtend<DevOptions>()
  expectTypeOf<UndefinedInOptionalFields<EnvVarNames>>().toExtend<EnvVarNames>()
  expectTypeOf<
    UndefinedInOptionalFields<DefineConfigOptions>
  >().toExtend<DefineConfigOptions>()
  expectTypeOf<
    UndefinedInOptionalFields<ParseOptions>
  >().toExtend<ParseOptions>()
  expectTypeOf<UndefinedInOptionalFields<ResolveSectionOptions>>().toExtend<
    Pick<ResolveSectionOptions, OptionalKeysOf<ResolveSectionOptions>>
  >()
  expectTypeOf<UndefinedInOptionalFields<SyncConfigSource>>().toExtend<
    Pick<SyncConfigSource, OptionalKeysOf<SyncConfigSource>>
  >()
  expectTypeOf<
    UndefinedInOptionalFields<JsonScriptSourceOptions>
  >().toExtend<JsonScriptSourceOptions>()
  expectTypeOf<UndefinedInOptionalFields<ProcessEnvSourceOptions>>().toExtend<
    Pick<ProcessEnvSourceOptions, OptionalKeysOf<ProcessEnvSourceOptions>>
  >()
  expectTypeOf<UndefinedInOptionalFields<ValidatorOptions>>().toExtend<
    Pick<ValidatorOptions, OptionalKeysOf<ValidatorOptions>>
  >()
  expectTypeOf<UndefinedInOptionalFields<YamlEnvSourceOptions>>().toExtend<
    Pick<YamlEnvSourceOptions, OptionalKeysOf<YamlEnvSourceOptions>>
  >()
  expectTypeOf<
    UndefinedInOptionalFields<ConfigKitOptions>
  >().toExtend<ConfigKitOptions>()
  expectTypeOf<
    UndefinedInOptionalFields<LoadDevConfigOptions>
  >().toExtend<LoadDevConfigOptions>()
})
