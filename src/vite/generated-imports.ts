import type { Rollup } from 'vite'

export function resolveGeneratedImport(
  context: Rollup.PluginContext,
  {
    id,
    configPath,
    pluginFile,
    options,
  }: {
    id: string
    configPath: string
    pluginFile: string
    options: Parameters<Rollup.PluginContext['resolve']>[2]
  },
) {
  return id === configPath
    ? id
    : context.resolve(id, pluginFile, { ...options, skipSelf: true })
}
