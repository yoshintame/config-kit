# @yoshintame/config-kit

Lazy, [Zod](https://zod.dev)-validated configuration with pluggable sources, plus a [Vite](https://vite.dev) plugin that injects runtime config into SPAs — one build image, many environments.

- **Lazy by default.** Each schema validates its own section on first access; unrelated sections never block startup.
- **Many consumers, one file.** Modules declare their own schemas over a shared config file.
- **Pluggable sources.** Env vars, YAML/JSON files, a JSON `<script>` element, in-memory values — composed with `firstNonEmpty` and `mergeAll`.
- **Runtime config for SPAs.** The Vite plugin serves config from YAML in dev and leaves an `envsubst` placeholder in `index.html` for production.

## Install

```sh
bun add @yoshintame/config-kit zod
```

`zod@^4` is a peer dependency. The Vite plugin also needs `vite@^6 || ^7`.

| Entry point | Contents | Runtime |
| --- | --- | --- |
| `@yoshintame/config-kit` | Loader, source contract, composition, in-memory source | Any |
| `@yoshintame/config-kit/node` | Env var, file and YAML sources | Node, Bun |
| `@yoshintame/config-kit/browser` | JSON `<script>` element source | Browser |
| `@yoshintame/config-kit/vite` | Vite plugin, `loadDevConfig` | Node, Bun |
| `@yoshintame/config-kit/vite/client` | Types for the virtual modules | — |

The core entry imports nothing from `node:*`. Under the `browser` condition, `/node` resolves to a stub whose functions throw.

## Quick start

```ts
import { createYamlConfigLoader } from '@yoshintame/config-kit/node'

export const { defineConfig } = createYamlConfigLoader({
  envVar: 'APP_CONFIG',
  yamlFile: 'app.config.yaml',
})
```

```ts
import { z } from 'zod'

import { defineConfig } from './config'

export const dbConfig = defineConfig(
  z
    .object({
      db: z.object({ url: z.url(), poolSize: z.number().default(10) }),
    })
    .meta({ title: 'db' }),
)

dbConfig.db.url
```

The config comes from the JSON in `APP_CONFIG` if it is set, otherwise from `app.config.yaml`, found by searching up from the working directory. Nothing is read or validated until `dbConfig.db.url` is accessed.

## Core

### Sources

```ts
interface SyncConfigSource {
  loadSync(): unknown
  describe(): string
  watch?(onChange: () => void): () => void
}
```

A source returns the raw config or `undefined` when it has nothing. `describe()` appears in error messages. Middleware such as decryption or interpolation wraps a source and returns a source.

### `createSyncConfigLoader(source)`

- **`defineConfig(schema)`** returns a read-only proxy over the parsed output of an object schema. The first property access loads the source and validates; the result is cached. Writes and deletes throw.
- **`validateAll()`** validates every registered schema now and throws one error listing all failures.
- **`assertOnlyKnownTopKeys()`** throws if the raw config has top-level keys that no registered object schema declares. Use it in single-schema apps together with `validateAll()`; skip it when several modules share one file.
- **`onChange(callback)`** subscribes to `source.watch`. On change the loader drops its caches before calling subscribers. Destructured values keep their old value.
- **`loadRaw()`** returns the cached raw value without validation; **`reset()`** drops every cache.

Validation errors name the schema and the source:

```
Config validation failed for schema 'db' (loaded from file /srv/app/app.config.yaml):
✖ Invalid input: expected string, received number
  → at db.url
```

The schema name comes from `.meta({ id })`, `.meta({ title })` or `.describe()`. Zod registers `id` globally and throws when a module that declares it runs twice (HMR, `vi.resetModules`), so prefer `title` in modules that can re-execute.

### Composition

- **`firstNonEmpty(sources)`** returns the first value that is not `undefined` or `null`; `{}` counts as a value. Throws with every source's `describe()` when all are empty.
- **`mergeAll(sources)`** deep-merges values left to right: objects merge recursively, arrays and scalars are replaced, empty sources are skipped. Returns `undefined` when all are empty, so it composes with `firstNonEmpty`.
- **`createInMemorySource(value, origin?)`** holds a value for tests and dev; `set(next)` replaces it and notifies watchers.
- **`parseOrThrow(schema, raw, origin)`** validates once with the same error format, for eager checks outside a loader.

## Node sources

- `createProcessEnvSource({ envVar, parser? })` parses a JSON env var; an unset or empty variable yields `undefined`.
- `createFileSource({ path, parser })` reads and parses a file; a missing file yields `undefined`.
- `createYamlEnvSource({ envVar, yamlFile, yamlPath? })` is `firstNonEmpty` over the env var and a YAML file, taken from `yamlPath` or found upward from `process.cwd()`.
- `createYamlConfigLoader(options)` wraps `createYamlEnvSource` in a loader.
- `yamlParser` and `jsonParser` plug into any source that takes a parser.

## Browser source

`createJsonScriptSource({ elementId = '__CONFIG__' })` parses the JSON inside `<script type="application/json" id="__CONFIG__">`. A missing element or empty text yields `undefined`.

```ts
import { createSyncConfigLoader } from '@yoshintame/config-kit'
import { createJsonScriptSource } from '@yoshintame/config-kit/browser'

const loader = createSyncConfigLoader(createJsonScriptSource())
export const config = loader.defineConfig(publicConfigSchema)

loader.validateAll()
loader.assertOnlyKnownTopKeys()
```

## Vite plugin

```ts
import { configKit } from '@yoshintame/config-kit/vite'
import { defineConfig } from 'vite'

import {
  buildEnvSchema,
  publicConfigSchema,
  serverConfigSchema,
} from './src/config/schema'

export default defineConfig({
  plugins: [
    configKit({
      schema: publicConfigSchema,
      serverSchema: serverConfigSchema,
      buildEnvSchema,
      envDts: 'src/env.d.ts',
      serverRestart: ['devServer.*'],
    }),
  ],
})
```

The app owns its loader and schema; the plugin only supplies the source:

```ts
/// <reference types="@yoshintame/config-kit/vite/client" />
import { createSyncConfigLoader } from '@yoshintame/config-kit'
import { source } from 'virtual:config-kit'

const loader = createSyncConfigLoader(source)
export const publicConfig = loader.defineConfig(publicConfigSchema)
```

### Config file

```yaml
public:
  backend:
    apiUrl: /api
private:
  devServer:
    backendUrl: https://staging.example.com
env:
  VITE_MSW_ENABLED: false
```

In dev the plugin reads `config.yaml` (found upward from the Vite root), deep-merges the gitignored `config.local.yaml` next to it and the file named in `APP_CONFIG_OVERLAY`, then takes:

- `public` — the runtime config the browser sees. `APP_PUBLIC_CONFIG` (JSON) overrides it.
- `private` — server-only values such as dev-server settings, merged over `public`. `APP_PRIVATE_CONFIG` overrides it.
- `env` — build-time values for `import.meta.env`, dev only; real env vars and `.env` files win.

`loadDevConfig({ serverSchema, ...options })` reads the same files from `vite.config.ts` and returns the validated server config, for proxy targets and similar settings.

### Virtual modules

| Module | Dev | Build |
| --- | --- | --- |
| `virtual:config-kit` | In-memory source with the `public` section | Client: `createJsonScriptSource`. SSR: `APP_PUBLIC_CONFIG` |
| `virtual:config-kit/private` | `private` merged over `public` | `APP_PUBLIC_CONFIG` merged with `APP_PRIVATE_CONFIG` at runtime |

`virtual:config-kit/private` is SSR-only; importing it from client code fails the build.

### Dev reactions

| Change | Reaction |
| --- | --- |
| `env` section, or a path in `serverRestart` | Dev server restart |
| A path in `fullReload` | Full page reload |
| Anything else | HMR: the source updates in place and `loader.onChange` subscribers run |
| Invalid config | Error overlay; the last valid config stays active |

### Build-time env

`buildEnvSchema` validates env at dev and build start: in dev the YAML `env` section under `loadEnv`, in build `loadEnv` only. Parsed values, with coercion and defaults, replace `import.meta.env.*` through `define`, so dead code behind build flags is tree-shaken. `envDts` writes a matching `ImportMetaEnv` declaration.

### Runtime injection

A production build leaves this in `index.html`:

```html
<script type="application/json" id="__CONFIG__">${APP_PUBLIC_CONFIG}</script>
```

Substitute it when the container starts. Escape `<` so the JSON cannot close the script element:

```sh
config=$(printf '%s' "$APP_PUBLIC_CONFIG" | jq -c . | sed 's/</\\u003c/g')
APP_PUBLIC_CONFIG=$config envsubst '${APP_PUBLIC_CONFIG}' < index.template.html > index.html
```

Keep `index.html` out of service-worker precache, or a cached page keeps serving the old config.

## License

MIT
