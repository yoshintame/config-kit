import { Section } from '../core'

export const PACKAGE_NAME = '@yoshintame/config-kit'
export const PUBLIC_MODULE_ID = 'virtual:config-kit'
export const PRIVATE_MODULE_ID = 'virtual:config-kit/private'
export const BUILD_MODULE_ID = 'virtual:config-kit/build'
export const PUBLIC_ENV_VAR = 'APP_PUBLIC_CONFIG'
export const PRIVATE_ENV_VAR = 'APP_PRIVATE_CONFIG'
export const BUILD_ENV_VAR = 'APP_BUILD_CONFIG'
export const OVERLAY_ENV_VAR = 'APP_CONFIG_OVERLAY'

export enum YamlSection {
  Public = 'public',
  Private = 'private',
  Build = 'build',
}

export interface ConfigModule {
  id: string
  resolvedId: string
  exportName: string
}

export const configModulesBySection = {
  [Section.Public]: {
    id: PUBLIC_MODULE_ID,
    resolvedId: '\0config-kit:public',
    exportName: 'publicConfig',
  },
  [Section.Server]: {
    id: PRIVATE_MODULE_ID,
    resolvedId: '\0config-kit:private',
    exportName: 'serverConfig',
  },
  [Section.Build]: {
    id: BUILD_MODULE_ID,
    resolvedId: '\0config-kit:build',
    exportName: 'buildConfig',
  },
} as const satisfies Record<Section, ConfigModule>

export function envPlaceholder(envVar: string): string {
  return `\${${envVar}}`
}
