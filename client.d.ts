declare module 'virtual:config-kit' {
  export const publicConfig: Readonly<
    import('@yoshintame/config-kit').PublicConfig
  >
}

declare module 'virtual:config-kit/private' {
  export const serverConfig: Readonly<
    import('@yoshintame/config-kit').ServerConfig
  >
}

declare module 'virtual:config-kit/build' {
  // oxlint-disable-next-line typescript/no-generated-empty-object-type -- without a build schema the build config has no keys
  export const buildConfig: Readonly<
    import('@yoshintame/config-kit').BuildConfig
  >
}
