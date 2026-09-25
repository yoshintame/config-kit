# ts-config

Generic ленивый загрузчик конфига с zod-валидацией. Пакеты:

- `@senate/config-core` — core: loader, контракт источника, `firstNonEmpty`, in-memory source. Ноль импортов из `node:*`, browser-safe.
- `@senate/config-node` — source-адаптеры: env, файл, yaml+env с findUp. Под `browser` condition — stub с ошибкой.
- `@senate/config-browser` — source-адаптеры для браузера: `window.__CONFIG__`.
- `@senate/vite-plugin-config` — Vite-интеграция: virtual modules, HMR конфига, build env через `define`, `env.d.ts`.

Пример wrapper-а в корне проекта (`config.ts`):

```ts
import { createYamlConfigLoader } from '@senate/config-node'

export const { defineConfig, loadRaw, reset } = createYamlConfigLoader({
  envVar: 'SENATE_E2E_CONFIG',        // имя env-переменной с JSON
  yamlFile: 'senate-e2e.config.yaml', // имя yaml (findUp от cwd)
  yamlPath: undefined,                // явный путь — override для тестов
})
```

## Core

### `SyncConfigSource`

```ts
interface SyncConfigSource {
  loadSync(): unknown
  describe(): string
  watch?(onChange: () => void): () => void
}
```

`describe()` попадает в сообщения об ошибках (`loaded from file /path/senate-e2e.config.yaml`). `ConfigSource` — alias.

### `createSyncConfigLoader(source): SyncConfigLoader`

#### `defineConfig(schema): z.infer<schema>`

Возвращает Proxy<T> над секцией конфига, валидированной schema. Первый доступ к любому полю триггерит валидацию и кэширует результат.

```ts
import z from 'zod'

const schema = z
  .object({
    api: z.object({ baseUrl: z.url(), timeout: z.number().default(30_000) }),
  })
  .meta({ id: 'crm-api' })

export const config = defineConfig(schema)

config.api.baseUrl        // string
Object.keys(config)       // ['api']
{ ...config }             // shallow copy
```

Имя схемы в ошибке берётся из `.meta({ id })`, `.meta({ title })`, иначе из `.describe()`. `id` уникален в глобальном реестре zod: повторное выполнение модуля со схемой (HMR, `vi.resetModules`) бросает «ID already exists» — для модулей, которые могут перевыполняться, используй `title`:

```
Config validation failed for schema 'crm-api' (loaded from file /repo/senate-e2e.config.yaml):
✖ Invalid input: expected string, received number
  → at api.baseUrl
```

Несколько consumer-ов могут описать **разные секции** одного конфига — каждый валидирует только свою, лениво.

#### `loadRaw(): unknown`

Сырой результат `source.loadSync()` без валидации, кэшируется.

#### `reset(): void`

Сбрасывает raw-кэш и все per-schema кэши.

#### `validateAll(): void`

Eager-валидация всех зарегистрированных схем; одна ошибка со всеми провалами.

#### `assertOnlyKnownTopKeys(): void`

Opt-in: throws, если в корне конфига есть ключи вне объединения top-level ключей зарегистрированных `z.object`-схем. Для SPA с одной схемой — `validateAll()` + `assertOnlyKnownTopKeys()` в entry. В multi-consumer режиме не вызывать.

#### `onChange(cb): () => void`

Подписка на `source.watch`: сначала сбрасываются все кэши, потом вызываются callbacks. Деструктурированные значения (`const { host } = config.db`) не обновятся.

### `firstNonEmpty(sources)`

Первый источник, вернувший не `undefined`/`null` (`{}` — non-empty). Все пусты → ошибка со списком `describe()`. Ошибки источников пробрасываются. `describe()` после загрузки — описание сработавшего источника.

### `createInMemorySource(value)`

Для тестов: `set(next)` меняет значение и триггерит `watch`.

```ts
const loader = createSyncConfigLoader(createInMemorySource({ db: { host: 'x' } }))
```

### `mergeAll(sources)`

Deep merge источников слева направо: объекты сливаются рекурсивно, массивы и скаляры заменяются, `null` в overlay — литеральное значение, пустые источники (`undefined`/`null`) пропускаются. Все пусты → `undefined` (композируется с `firstNonEmpty`). Используется для `config.yaml` + gitignored `config.local.yaml`.

### `jsonParser`, `Parser`

Парсер — параметр source-фабрики: `{ parse(input: string): unknown }`.

## Node (`@senate/config-node`)

- `createProcessEnvSource({ envVar, parser = jsonParser })` — пустая/отсутствующая переменная → `undefined`.
- `createFileSource({ path, parser })` — отсутствующий файл → `undefined`.
- `createYamlEnvSource({ envVar, yamlFile, yamlPath? })` — `firstNonEmpty([env, yaml])`; yaml читается из `yamlPath` или ищется `findUp(yamlFile)` от `process.cwd()`.
- `createYamlConfigLoader(options)` — `createSyncConfigLoader(createYamlEnvSource(options))`.
- `yamlParser`.

## Browser (`@senate/config-browser`)

- `createWindowSource({ globalKey = '__CONFIG__' })` — читает `globalThis[globalKey]`; отсутствует → `undefined`.

SPA с одной схемой, fail-fast в entry:

```ts
const loader = createSyncConfigLoader(createWindowSource())
export const config = loader.defineConfig(publicConfigSchema)
loader.validateAll()
loader.assertOnlyKnownTopKeys()
```

## Vite (`@senate/vite-plugin-config`)

```ts
import { senateConfig } from '@senate/vite-plugin-config'

export default defineConfig({
  plugins: [
    senateConfig({
      schema: publicConfigSchema,
      serverSchema: serverConfigSchema,
      buildEnvSchema,
      envDts: 'src/env.d.ts',
      serverRestart: ['backend.proxyUrl', 'otel.*'],
    }),
  ],
})
```

Источник в dev: `APP_PUBLIC_CONFIG` / `APP_PRIVATE_CONFIG`, иначе секции `public:` / `private:` из `mergeAll([config.yaml, config.local.yaml])` (`config.yaml` — findUp от root, `config.local.yaml` — рядом с ним, `localYamlFile`). Runtime-схемы валидируются на старте dev-сервера.

```yaml
public:   # → @senate/config
  backend:
    apiUrl: /api
private:  # → @senate/config/private и loadDevConfig
  devServer:
    backendUrl: https://crm-dev.example.com
env:      # только dev: build env под buildEnvSchema, process env важнее
  VITE_MSW_ENABLED: false
```

`loadDevConfig({ serverSchema, ...options })` — тот же источник для `vite.config.ts` (proxy target и т.п.), возвращает провалидированный `{ ...public, ...private }`.

Virtual modules (типы — `/// <reference types="@senate/vite-plugin-config/client" />`):

- `@senate/config` — `source` с public-конфигом. Dev: значение из yaml; build: `window.__CONFIG__`, в `index.html` инжектится `<script>window.__CONFIG__ = ${APP_PUBLIC_CONFIG}</script>` под envsubst.
- `@senate/config/private` — `source` с `{ ...public, ...private }`, только SSR; импорт из клиентского кода — ошибка. Build: читает оба env-var в runtime.

```ts
import { createSyncConfigLoader } from '@senate/config-core'
import { source } from '@senate/config'

const loader = createSyncConfigLoader(source)
export const publicConfig = loader.defineConfig(publicConfigSchema)
```

Watch yaml в dev — реакция по изменённым путям:

| Путь | Реакция |
|---|---|
| секция `env` или совпал с `serverRestart` | `server.restart()` |
| совпал с `fullReload` | full page reload |
| остальное | HMR virtual modules |
| невалидный конфиг | error overlay, предыдущий конфиг остаётся |

Build env: `buildEnvSchema` валидирует env на старте dev/build — dev: yaml-секция `env` (скаляры приводятся к строкам, как в `.env`) под `loadEnv` (все префиксы), build: только `loadEnv`. Результат с coercion и defaults подставляется через `define` в `import.meta.env.*`. `envDts` генерирует `ImportMetaEnv`.

## Сборка

`bun run build` — tsup собирает каждый пакет в `dist/` (ESM + `.d.ts`); потребители резолвят `dist`. Внутри репо `tsc` идёт по export-condition `source`, vitest — по `resolve.alias` на исходники (condition не доходит до node-окружения vitest). Потребитель через `bun link` видит изменения только после пересборки.

## Мутационное тестирование

`bun run test:mutation` — StrykerJS (vitest runner, per-test coverage, typescript checker). Результаты инкрементальные (`reports/stryker-incremental.json`), HTML-отчёт — `reports/mutation/index.html`. Выжившие мутанты — непроверенное поведение: дописать тест или упростить код. Оставшиеся выжившие эквивалентны (логгер, имя плагина, `?? []`, форматирование сгенерированного кода, guard'ы на невозможные значения).

## Зависимости

`zod` (peer); node-слой — `yaml`, `find-up`; vite-плагин — `vite` (peer).
