declare module '@senate/config' {
  import type { SyncConfigSource } from '@senate/config-core'

  export const source: SyncConfigSource
}

declare module '@senate/config/private' {
  import type { SyncConfigSource } from '@senate/config-core'

  export const source: SyncConfigSource
}
