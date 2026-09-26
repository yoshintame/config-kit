declare module 'virtual:config-kit' {
  export const publicConfig: import('@yoshintame/config-kit').PublicConfig
}

declare module 'virtual:config-kit/private' {
  export const serverConfig: import('@yoshintame/config-kit').ServerConfig
}

declare module 'virtual:config-kit/build' {
  export const buildConfig: import('@yoshintame/config-kit').BuildConfig
}
