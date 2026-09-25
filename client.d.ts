declare module 'virtual:config-kit' {
  import type { SyncConfigSource } from '@yoshintame/config-kit'

  export const source: SyncConfigSource
}

declare module 'virtual:config-kit/private' {
  import type { SyncConfigSource } from '@yoshintame/config-kit'

  export const source: SyncConfigSource
}
