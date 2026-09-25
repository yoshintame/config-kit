# ts-config

Generic ленивый загрузчик конфига с zod-валидацией. Пакеты:

- `@senate/config-core` — core: loader, контракт источника, `firstNonEmpty`, in-memory source. Ноль импортов из `node:*`, browser-safe.
- `@senate/config-node` — source-адаптеры: env, файл, yaml+env с findUp. Под `browser` condition — stub с ошибкой.
- `@senate/config-browser` — source-адаптеры для браузера: `window.__CONFIG__`.

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

Имя схемы в ошибке берётся из `.meta({ id })`, иначе из `.describe()`:

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

## Зависимости

`zod` (peer); node-слой — `yaml`, `find-up`.
