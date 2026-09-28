import type { publicConfig } from 'virtual:config-kit'
import { buildConfig } from 'virtual:config-kit/build'
import { serverConfig } from 'virtual:config-kit/private'

const url: string = serverConfig.apiUrl
const same: typeof publicConfig = serverConfig
// @ts-expect-error
const count: number = serverConfig
// @ts-expect-error
buildConfig.msw

export { count, same, url }
