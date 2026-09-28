# @yoshintame/config-kit

Lazy configuration validated by any [Standard Schema](https://standardschema.dev) library (Zod, Valibot, ArkType) with pluggable sources, plus a [Vite](https://vite.dev) plugin that injects runtime config into SPAs, so one build image serves many environments.

- **Lazy by default.** Each schema validates its own section on first access; unrelated sections never block startup.
- **Many consumers, one file.** Modules declare their own schemas over a shared config file.
- **Pluggable sources.** Env vars, YAML/JSON files, a JSON `<script>` element, in-memory values, composed with `firstNonEmpty` and `mergeAll`.
- **Runtime config for SPAs.** The Vite plugin serves config from YAML in dev, leaves an `envsubst` placeholder in `index.html` for production, validates config in the browser before the app runs, and emits the container validator and nginx entrypoint hook.

## Install

```sh
bun add @yoshintame/config-kit zod
```

Bring any Standard Schema library; the examples use Zod 4. The Vite plugin also needs `vite@^6.1 || ^7`.

| Entry point | Contents | Runtime |
| --- | --- | --- |
| `@yoshintame/config-kit` | Loader, source contract, composition, in-memory source | Any |
| `@yoshintame/config-kit/node` | Env var, file and YAML sources | Node, Bun |
| `@yoshintame/config-kit/browser` | JSON `<script>` element source, default error screen | Browser |
| `@yoshintame/config-kit/vite` | Vite plugin, `loadDevConfig` | Node, Bun |
| `@yoshintame/config-kit/client` | Typings for the virtual modules | Types only |

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
  z.object({
    db: z.object({ url: z.url(), poolSize: z.number().default(10) }),
  }),
  { name: 'db' },
)

dbConfig.db.url
```

The config comes from the JSON in `APP_CONFIG` if it is set, otherwise from `app.config.yaml`, found by searching up from the working directory. Nothing is read or validated until `dbConfig.db.url` is accessed.

## Core

### Sources

```ts
interface RawConfig {
  raw: unknown
  source: string
}

interface SyncConfigSource {
  loadSync(): RawConfig | undefined
  describe(): string
  watch?(onChange: () => void): () => void
}
```

A source returns the raw config together with where it came from (`env APP_CONFIG`, `file /srv/app/app.config.yaml`), or `undefined` when it has nothing. Composed sources report the source that actually delivered. `describe()` names what the source would read, for errors when nothing was found. Middleware such as decryption or interpolation wraps a source and returns a source.

### `createSyncConfigLoader(source)`

- **`defineConfig(schema, { name? })`** returns a read-only proxy over the parsed output of an object schema. The first property access loads the source and validates; the result is cached. Writes and deletes throw.
- **`onChange(callback)`** subscribes to `source.watch`. On change the loader drops its caches before calling subscribers. Destructured values keep their old value.
- **`loadRaw()`** returns the cached raw value without validation, `undefined` when the source is empty; **`reset()`** drops every cache.

An empty source fails on first access with `Config not found in <describe()>`. The loader serves many consumers of one file, so it validates lazily and ignores keys other schemas own. For one schema that must hold at startup, use `resolveConfig` below.

Validation errors name the schema and the source:

```
Config validation failed for 'db' (loaded from file /srv/app/app.config.yaml):
✖ Invalid input: expected string, received number
  → at db.url
```

The name comes from the `name` option, otherwise from the schema's JSON Schema: a named definition, `$id`, `title` or `description` (Zod `.meta({ id })`, `.meta({ title })`, `.describe()`). Zod registers `id` globally and throws when a module that declares it runs twice (HMR, `vi.resetModules`), so prefer `name` or `title` in modules that can re-execute.

### Standard Schema

Schemas are validated through `~standard.validate`. config-kit is synchronous: a schema that validates asynchronously (an async refinement) fails with an error naming it.

Checking unknown keys and listing the fields of `buildConfig` need the schema's shape, which comes from `~standard.jsonSchema`. Zod 4.2+ and ArkType implement it; wrap Valibot schemas in `toStandardJsonSchema()` from `@valibot/to-json-schema`. Zod Mini has none: turn unknown key checks off with `unknownKeys: 'ignore'` and skip the `build` section. Fields that JSON Schema cannot express (dates, transforms, custom checks) are fine, only the object structure is read.

### Composition

- **`firstNonEmpty(sources)`** returns the first config whose value is not `undefined` or `null`; `{}` counts as a value. Returns `undefined` when all are empty.
- **`mergeAll(sources)`** deep-merges values left to right: objects merge recursively, arrays and scalars are replaced, empty sources are skipped. The result names every contributing source (`env A + env B`). Returns `undefined` when all are empty.
- **`requiredSource(source, section?)`** wraps a source so that an empty one throws a `missing` error; `requireConfig(source, section?)` loads it once.
- **`createInMemorySource(value, origin?)`** holds a value for tests and dev; `set(next)` replaces it and notifies watchers.
- **`resolveConfig(schema, { source, name, knownKeys?, unknownKeys? })`** loads a source, requires a value and validates it eagerly. With `knownKeys`, top-level keys outside the list fail (`unknownKeys: 'strict'`), log (`'warn'`) or pass (`'ignore'`, the default).
- **`parseOrThrow(schema, { raw, source }, options)`** validates an already loaded config with the same error format.

Failures are `ConfigKitError`s with `kind` (`missing`, `placeholder`, `parse`, `schema`), `section` and `source`.

## Node sources

- `createProcessEnvSource({ envVar, parser? })` parses a JSON env var; an unset variable yields `undefined`. An empty variable is a value, not a fallback to the next source, so it fails to parse as JSON.
- `createFileSource({ path, parser })` reads and parses a file; a missing file yields `undefined`.
- `createYamlEnvSource({ envVar, yamlFile, yamlPath? })` is `firstNonEmpty` over the env var and a YAML file, taken from `yamlPath` or found upward from `process.cwd()`.
- `createYamlConfigLoader(options)` wraps `createYamlEnvSource` in a loader.
- `createServerEnvSource({ publicEnvVar, privateEnvVar })` merges the private env var over the required public one, as SSR server config does.
- `yamlParser` and `jsonParser` plug into any source that takes a parser.

## Browser source

`createJsonScriptSource({ elementId = '__CONFIG__', placeholder? })` parses the JSON inside `<script type="application/json" id="__CONFIG__">`. A missing element or empty text yields `undefined`; text equal to `placeholder` throws a `placeholder` error, so an unsubstituted `${APP_PUBLIC_CONFIG}` is told apart from broken JSON.

```ts
import { resolveConfig } from '@yoshintame/config-kit'
import { createJsonScriptSource } from '@yoshintame/config-kit/browser'

export const config = resolveConfig(publicConfigSchema, {
  source: createJsonScriptSource(),
  name: 'public',
  knownKeys: ['backend'],
  unknownKeys: 'strict',
})
```

With the Vite plugin, read `publicConfig` from `virtual:config-kit` instead.

## Vite plugin

Schemas and behavior live in one `config-kit.config.ts` next to `vite.config.ts`:

```ts
import { defineConfigKit } from '@yoshintame/config-kit'
import { z } from 'zod'

const publicSchema = z.object({
  backend: z.object({ apiUrl: z.string() }),
})

const config = defineConfigKit({
  schemas: {
    public: publicSchema,
    server: publicSchema.extend({
      devServer: z.object({ backendUrl: z.url() }),
    }),
    build: z.object({
      msw: z.boolean().default(false),
      devtools: z.boolean().default(false),
      token: z.string().optional(),
    }),
  },
  onInvalid(error, { renderDefault }) {
    reportToTelemetry(error)
    renderDefault()
  },
  sensitive: ['build.token'],
  dev: { serverRestart: ['devServer.*'] },
  docker: true,
})

export default config

declare module '@yoshintame/config-kit' {
  interface Register {
    config: typeof config
  }
}
```

```ts
import { configKit, loadDevConfig } from '@yoshintame/config-kit/vite'
import { defineConfig } from 'vite'

import config from './config-kit.config'

export default defineConfig(({ command }) => {
  const server = command === 'serve' ? loadDevConfig(config) : undefined
  return {
    plugins: [configKit()],
    server: { proxy: server && { '/api': server.devServer.backendUrl } },
  }
})
```

The plugin finds `config-kit.config.ts` in the Vite root; `configKit({ configFile })` points it elsewhere. `loadDevConfig(config, { root? })` reads the same files as the dev server and returns the validated server config, typed from the schemas. It searches from `process.cwd()`; pass `root` when `vite.config` sets a different Vite root.

| Option | Default | Meaning |
| --- | --- | --- |
| `schemas.public` | required | The runtime config the browser sees |
| `schemas.server` | `schemas.public` | `public` plus `private`, for dev-server settings and SSR |
| `schemas.build` | none | Build-time values inlined into the bundle |
| `onInvalid` | default screen | Reaction to invalid config in the browser, see below |
| `unknownKeys` | `'strict'` | Top-level keys no schema declares: `'strict'` fails, `'warn'` logs, `'ignore'` skips the check. Applies to every section |
| `sensitive` | `[]` | Paths under `build.` or `private.` that hold secrets, see below |
| `dev` | | `yamlFile`, `yamlPath`, `localYamlFile`, `overlayEnvVar`, `watch`, `hmr`, `serverRestart`, `fullReload` |
| `docker` | `false` | Emit the container validator and nginx hook |
| `envVars` | `APP_PUBLIC_CONFIG`, `APP_PRIVATE_CONFIG`, `APP_BUILD_CONFIG` | Names of the three env vars |
| `elementId` | `__CONFIG__` | Id of the JSON `<script>` element |

Editing the config file or anything it imports restarts the dev server. The client bundle gets only `schemas.public` and `onInvalid` from it: the plugin drops the other sections and options and marks top-level declarations as side-effect free, so the server schema and its field names stay out. This needs `defineConfigKit({ schemas: { public, ... } })` written with object literals, without spreads; otherwise the plugin warns and ships the whole definition.

### Types

The `Register` augmentation types the virtual modules; nothing is generated. Keep `config-kit.config.ts` in the `tsconfig` that checks your app, so TypeScript sees both the augmentation and the module declarations the package references. Without either, add `/// <reference types="@yoshintame/config-kit/client" />`.

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

### Virtual modules

```ts
import { publicConfig } from 'virtual:config-kit'
import { buildConfig } from 'virtual:config-kit/build'

if (buildConfig.msw) await import('./mocks')
fetch(`${publicConfig.backend.apiUrl}/users`)
```

| Module | Export | Dev | Build |
| --- | --- | --- | --- |
| `virtual:config-kit` | `publicConfig` | `public` section | Client: the JSON `<script>`. SSR: `APP_PUBLIC_CONFIG` |
| `virtual:config-kit/private` | `serverConfig` | `private` merged over `public` | `APP_PUBLIC_CONFIG` merged with `APP_PRIVATE_CONFIG` |
| `virtual:config-kit/build` | `buildConfig` | `build` section | `APP_BUILD_CONFIG` over schema defaults |

The config modules validate when they run. ES modules run their dependencies first, so the first module that reads config triggers the check before its own code, and a failure stops the whole module graph: modules that read config at import time never see invalid values, and `index.html` points straight at the app entry. On the server, SSR and the private module throw instead.

`virtual:config-kit/private` is SSR-only; importing it from client code fails the build. `buildConfig` is an object literal in the bundle, so branches behind `false` flags and the dynamic imports inside them are dropped. Read its fields directly; passing the whole object around keeps every branch.

### Invalid config in the browser

Without `onInvalid` the plugin shows the error text in `#root` (or `<body>`) and stops the app; the console shows the uncaught `ConfigKitError`. With it, the handler decides:

| Handler | Result |
| --- | --- |
| Returns nothing | The app stops; the screen is up to the handler |
| Returns a config | It is validated and the app runs with it; if it is invalid too, the default screen shows both errors |
| Calls `renderDefault()` | The default screen |

```ts
onInvalid(error, { kind, section, source, renderDefault }) {
  if (kind === 'placeholder') return localDefaults
  void import('./src/config-error').then((m) => m.render(error))
}
```

`kind` is `missing` (no `<script>` element), `placeholder` (the container did not substitute `${APP_PUBLIC_CONFIG}`), `parse` (broken JSON) or `schema` (failed validation or unknown keys). The handler is synchronous; start async work inside it, the app is already stopped. Code it imports dynamically is loaded only on failure and never reaches the container validator.

### Secrets

`private` never reaches the browser. Values in `build` are inlined into the bundle, so `build.` paths listed in `sensitive` (dev tokens, impersonation) are allowed only in `vite serve`: `vite build` fails when one of them is set. `buildConfig` values must be JSON.

After a client build the plugin searches the emitted chunks and assets for the string values of every `sensitive` path, taken from `config.yaml` and its overlays when present and from `APP_PRIVATE_CONFIG` / `APP_BUILD_CONFIG`, and fails the build naming the path and the chunk, never the value. Only paths marked sensitive are scanned: ordinary private values such as hosts or environment names legitimately appear in bundles. Dev-server responses are not scanned.

The build also fails when `index.html` lost the `${APP_PUBLIC_CONFIG}` placeholder, for example to a plugin that rewrites the HTML.

### Dev reactions

| Change | Reaction |
| --- | --- |
| Config file, its imports, `build` section, or a path in `dev.serverRestart` | Dev server restart |
| `public` or `private` | Full page reload |
| Same, with `dev.hmr: true` | Config modules update in place; reads through `publicConfig` see new values, destructured values keep the old ones. Paths in `dev.fullReload` still reload the page |
| Invalid config | Error overlay; the last valid config stays active |

### Docker

A production build leaves this in `index.html`:

```html
<script type="application/json" id="__CONFIG__">${APP_PUBLIC_CONFIG}</script>
```

With `docker: true`, a successful client build also writes `dist-config/`:

- `validate.mjs`: a self-contained validator (public schema, schema library and core bundled, `onInvalid` left out) that checks `APP_PUBLIC_CONFIG` like the browser does and exits with 1 and the error. Runs with `node` or `bun`, no `node_modules`.
- `docker-entrypoint.d/40-config-kit-inject.sh`: a hook for the official nginx image entrypoint. On every start it requires a set, non-empty `APP_PUBLIC_CONFIG`, escapes `<` so the JSON cannot close the script element, and renders `index.html` with `envsubst` from a template kept outside the docroot.

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
