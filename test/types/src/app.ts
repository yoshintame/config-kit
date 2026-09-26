import { publicConfig } from 'virtual:config-kit'
import { buildConfig } from 'virtual:config-kit/build'
import { serverConfig } from 'virtual:config-kit/private'

const url: string = publicConfig.backend.apiUrl
const flag: boolean = publicConfig.flag
const msw: boolean = buildConfig.msw
const token: string | undefined = buildConfig.token
const backend: string = serverConfig.devServer.backendUrl
// @ts-expect-error
publicConfig.devServer
// @ts-expect-error
buildConfig.nope

export { backend, flag, msw, token, url }
