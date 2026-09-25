# ts-config

Generic ленивый загрузчик конфига с zod-валидацией. Пакеты:

- `@senate/config-core` — core: loader, контракт источника, `firstNonEmpty`, in-memory source. Ноль импортов из `node:*`, browser-safe.
- `@senate/config-node` — source-адаптеры: env, файл, yaml+env с findUp. Под `browser` condition — stub с ошибкой.
- `@senate/config-browser` — source-адаптеры для браузера: JSON из `<script type="application/json">`.
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

Возвращает Proxy<T> над секцией конфига, валидированной schema (только схемы с объектным выходом). Первый доступ к любому полю триггерит валидацию и кэширует результат. Proxy read-only: запись и удаление бросают `TypeError`; `.readonly()`-схемы (замороженный результат) поддерживают spread и `Object.keys`.

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

Eager-валидация всех зарегистрированных схем; одна ошибка со всеми провалами. Ошибка самого источника (битый JSON/YAML) бросается один раз, до валидации схем.

#### `assertOnlyKnownTopKeys(): void`

Opt-in: throws, если в корне конфига есть ключи вне объединения top-level ключей зарегистрированных `z.object`-схем (обёртки `readonly` / `default` / `optional` / `catch` / `lazy` / `pipe` разворачиваются). Для SPA с одной схемой — `validateAll()` + `assertOnlyKnownTopKeys()` в entry. В multi-consumer режиме не вызывать.

#### `onChange(cb): () => void`

Подписка на `source.watch`: сначала сбрасываются все кэши, потом вызываются callbacks. Деструктурированные значения (`const { host } = config.db`) не обновятся.

### `firstNonEmpty(sources)`

Первый источник, вернувший не `undefined`/`null` (`{}` — non-empty). Все пусты → ошибка со списком `describe()`. Ошибки источников пробрасываются. `describe()` после загрузки — описание сработавшего источника.

### `createInMemorySource(value, origin = 'in-memory')`

Для тестов и dev: `set(next)` меняет значение и триггерит `watch`; `origin` попадает в сообщения об ошибках.

```ts
const loader = createSyncConfigLoader(createInMemorySource({ db: { host: 'x' } }))
```

### `mergeAll(sources)`

Deep merge источников слева направо: объекты сливаются рекурсивно, массивы и скаляры заменяются, `null` в overlay — литеральное значение, пустые источники (`undefined`/`null`) пропускаются. Все пусты → `undefined` (композируется с `firstNonEmpty`). Используется для `config.yaml` + gitignored `config.local.yaml`.

### `parseOrThrow(schema, raw, origin)`

Разовая валидация с тем же форматом ошибки, что у loader: для жадных проверок вне Proxy (vite.config, build env).

### `jsonParser`, `Parser`, `parseWith`

Парсер — параметр source-фабрики: `{ parse(input: string): unknown }`. `parseWith(parser, input, origin)` — парсинг с `Failed to parse <origin>: …` и исходной ошибкой в `cause`.

## Node (`@senate/config-node`)

- `createProcessEnvSource({ envVar, parser = jsonParser })` — пустая/отсутствующая переменная → `undefined`.
- `createFileSource({ path, parser })` — отсутствующий файл → `undefined`.
- `createYamlEnvSource({ envVar, yamlFile, yamlPath? })` — `firstNonEmpty([env, yaml])`; yaml читается из `yamlPath` или ищется `findUp(yamlFile)` от `process.cwd()`.
- `createYamlConfigLoader(options)` — `createSyncConfigLoader(createYamlEnvSource(options))`.
- `yamlParser`.

## Browser (`@senate/config-browser`)

- `createJsonScriptSource({ elementId = '__CONFIG__' })` — парсит JSON из `<script type="application/json" id="__CONFIG__">`; нет элемента, пустой текст или нет `document` → `undefined`; битый JSON → ошибка с `script#__CONFIG__`.

SPA с одной схемой, fail-fast в entry:

```ts
const loader = createSyncConfigLoader(createJsonScriptSource())
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

Источник в dev: `APP_PUBLIC_CONFIG` / `APP_PRIVATE_CONFIG`, иначе секции `public:` / `private:` из `mergeAll([config.yaml, config.local.yaml, $APP_CONFIG_OVERLAY])`, читается один раз за загрузку. `config.yaml` — findUp от root (не найден → ожидается в root и подхватится при создании); `config.local.yaml` — рядом с ним, личные настройки (`localYamlFile: false` отключает, например в vitest); `APP_CONFIG_OVERLAY` — путь временного overlay-файла для скриптов (`overlayEnvVar`). Runtime-схемы валидируются на старте dev-сервера.

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

`loadDevConfig({ serverSchema, ...options })` — тот же источник для `vite.config.ts` (proxy target и т.п.), возвращает провалидированный plain-объект — deep merge `private` поверх `public`. Ошибка серверной схемы указывает оба источника.

Virtual modules (типы — `/// <reference types="@senate/vite-plugin-config/client" />`):

- `@senate/config` — `source` с public-конфигом. Dev: in-memory source со значением из yaml; build: `createJsonScriptSource`, в `index.html` инжектится `<script type="application/json" id="__CONFIG__">${APP_PUBLIC_CONFIG}</script>` под envsubst; SSR-build: `createProcessEnvSource(APP_PUBLIC_CONFIG)`.
- `@senate/config/private` — `source` с deep merge `private` поверх `public`, только SSR; импорт из клиентского кода — ошибка. Build: `mergeAll` двух env-var в runtime.

Продовые модули импортируют `@senate/config-*`, резолвя их от пакета плагина — приложению прямые зависимости на `config-browser` / `config-node` не нужны. Плагин `enforce: 'pre'`: virtual id не перехватывается одноимённым пакетом из `node_modules`.

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
| остальное | HMR: dev-модуль self-accept, сохраняет `source` в `import.meta.hot.data` и делает `source.set(raw)` → `loader.onChange` сбрасывает кэши и зовёт подписчиков, приложение перерисовывается само |
| невалидный конфиг | error overlay, предыдущий конфиг остаётся; откат к валидному (даже без изменений) шлёт HMR-update и снимает overlay |

Build env: `buildEnvSchema` валидирует env на старте dev/build — dev: yaml-секция `env` (скаляры приводятся к строкам, как в `.env`) под `loadEnv` (все префиксы), build: только `loadEnv`. Результат с coercion и defaults подставляется через `define` в `import.meta.env.*`. `envDts` генерирует `ImportMetaEnv`.

## Сборка

`bun run build` — tsup собирает каждый пакет в `dist/` (ESM + `.d.ts`); потребители резолвят `dist`. Внутри репо `tsc` идёт по export-condition `source`, vitest — по `resolve.alias` на исходники (condition не доходит до node-окружения vitest). Потребитель через `bun link` видит изменения только после пересборки.

## Мутационное тестирование

`bun run test:mutation` — StrykerJS (vitest runner, per-test coverage, typescript checker). Результаты инкрементальные (`reports/stryker-incremental.json`), HTML-отчёт — `reports/mutation/index.html`. Выжившие мутанты — непроверенное поведение: дописать тест или упростить код. Оставшиеся выжившие эквивалентны (логгер, имя плагина, `?? []`, форматирование сгенерированного кода, guard'ы на невозможные значения).

## Зависимости

`zod` (peer); node-слой — `yaml`, `find-up`; vite-плагин — `vite` (peer).
