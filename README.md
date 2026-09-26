# @yoshintame/config-kit

Lazy, [Zod](https://zod.dev)-validated configuration with pluggable sources, plus a [Vite](https://vite.dev) plugin that injects runtime config into SPAs, so one build image serves many environments.

- **Lazy by default.** Each schema validates its own section on first access; unrelated sections never block startup.
- **Many consumers, one file.** Modules declare their own schemas over a shared config file.
- **Pluggable sources.** Env vars, YAML/JSON files, a JSON `<script>` element, in-memory values, composed with `firstNonEmpty` and `mergeAll`.
- **Runtime config for SPAs.** The Vite plugin serves config from YAML in dev, leaves an `envsubst` placeholder in `index.html` for production, and emits the container validator and nginx entrypoint hook.

## Install

```sh
bun add @yoshintame/config-kit zod
```

`zod@^4` is a peer dependency. The Vite plugin also needs `vite@^6.1 || ^7`.

| Entry point | Contents | Runtime |
| --- | --- | --- |
| `@yoshintame/config-kit` | Loader, source contract, composition, in-memory source | Any |
| `@yoshintame/config-kit/node` | Env var, file and YAML sources | Node, Bun |
| `@yoshintame/config-kit/browser` | JSON `<script>` element source, `bootstrap` | Browser |
| `@yoshintame/config-kit/vite` | Vite plugin, `loadDevConfig` | Node, Bun |

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

With the Vite plugin, use the loader from `virtual:config-kit` and `bootstrap` instead.

## Vite plugin

```ts
import { configKit } from '@yoshintame/config-kit/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    configKit({
      schemaModule: './src/config/schema.ts',
      docker: true,
      serverRestart: ['devServer.*'],
    }),
  ],
})
```

### Schema module

The plugin imports `schemaModule` itself, validates dev config against it and bundles it into the generated modules and the container validator. It reads three exports:

```ts
import { z } from 'zod'

export const publicSchema = z.object({
  backend: z.object({ apiUrl: z.string() }),
})

export const serverSchema = publicSchema.extend({
  devServer: z.object({ backendUrl: z.url() }),
})

export const buildSchema = z.object({
  msw: z.boolean().default(false),
  devtools: z.boolean().default(false),
})
```

- `publicSchema`, required: the runtime config the browser sees.
- `serverSchema`, optional: `public` plus `private`, for dev-server settings and SSR. Defaults to `publicSchema`.
- `buildSchema`, optional: build-time values inlined into the bundle.

Editing the schema module restarts the dev server.

### Config file

```yaml
public:
  backend:
    apiUrl: /api
private:
  devServer:
    backendUrl: https://staging.example.com
build:
  msw: false
  devtools: true
```

In dev the plugin reads `config.yaml` (found upward from the Vite root), deep-merges the gitignored `config.local.yaml` next to it and the file named in `APP_CONFIG_OVERLAY`, then takes:

- `public`: `APP_PUBLIC_CONFIG` (JSON) overrides it.
- `private`: merged over `public` for the server view. `APP_PRIVATE_CONFIG` overrides it.
- `build`: `APP_BUILD_CONFIG` overrides it. Dev only: `vite build` ignores the section and takes `APP_BUILD_CONFIG` over the schema defaults, so a committed dev file never sets production flags.

Any other top-level section is an error.

`loadDevConfig({ schemaModule })` reads the same files from `vite.config.ts` and resolves to the validated server config, for proxy targets and similar settings.

### Virtual modules

```ts
import { loader, publicConfig, source } from 'virtual:config-kit'
import { buildConfig } from 'virtual:config-kit/build'

if (buildConfig.msw) await import('./mocks')
fetch(`${publicConfig.backend.apiUrl}/users`)
```

| Module | Exports | Dev | Build |
| --- | --- | --- | --- |
| `virtual:config-kit` | `source`, `loader`, `publicConfig` | `public` section | Client: `createJsonScriptSource`. SSR: `APP_PUBLIC_CONFIG` |
| `virtual:config-kit/private` | `source`, `loader`, `serverConfig` | `private` merged over `public` | `APP_PUBLIC_CONFIG` merged with `APP_PRIVATE_CONFIG` at runtime |
| `virtual:config-kit/build` | `buildConfig` | `build` section | `APP_BUILD_CONFIG` over schema defaults |

`virtual:config-kit/private` is SSR-only; importing it from client code fails the build. `buildConfig` is an object literal in the bundle, so branches behind `false` flags and the dynamic imports inside them are dropped. Read its fields directly; passing the whole object around keeps every branch.

The plugin writes typings for these modules to `dts` (default `src/config-kit.d.ts`, `false` to disable); keep the file inside your `tsconfig` includes.

### Dev reactions

| Change | Reaction |
| --- | --- |
| Schema module, `build` section, or a path in `serverRestart` | Dev server restart |
| `public` or `private` | Full page reload |
| Same, with `hmr: true` | The source updates in place and `loader.onChange` subscribers run; paths in `fullReload` still reload the page |
| Invalid config | Error overlay; the last valid config stays active |

### Fail-fast entry

Modules often read config at import time, so validate before the app graph loads:

```ts
import { bootstrap } from '@yoshintame/config-kit/browser'
import { loader } from 'virtual:config-kit'

bootstrap(loader, () => import('./app'))
```

`bootstrap` runs `validateAll()` and `assertOnlyKnownTopKeys()`, then imports the app. On failure it logs the error and shows its text in `#root` (or `<body>`). Pass `{ renderError }` for a custom screen.

### Docker

A production build leaves this in `index.html`:

```html
<script type="application/json" id="__CONFIG__">${APP_PUBLIC_CONFIG}</script>
```

With `docker: true`, `vite build` also writes `dist-config/`:

- `validate.mjs`: a self-contained validator (schema, Zod and core bundled) that checks `APP_PUBLIC_CONFIG` like `bootstrap` does and exits with 1 and the error. Runs with `node` or `bun`, no `node_modules`.
- `docker-entrypoint.d/40-config-kit-inject.sh`: a hook for the official nginx image entrypoint. On every start it requires a non-empty `APP_PUBLIC_CONFIG`, escapes `<` so the JSON cannot close the script element, and renders `index.html` with `envsubst` from a template kept outside the docroot.

```dockerfile
FROM node:22-alpine AS config-validator
COPY --from=build /app/dist-config/validate.mjs /validate.mjs
ENTRYPOINT ["node", "/validate.mjs"]

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY --from=build /app/dist-config/docker-entrypoint.d/ /docker-entrypoint.d/
```

Run the validator as an init container before nginx. Keep `index.html` out of service-worker precache, or a cached page keeps serving the old config.

## License

MIT
