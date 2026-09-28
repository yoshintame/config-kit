import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { match } from 'ts-pattern'
import { type AliasOptions, build, type Plugin } from 'vite'

import { transformConfigFile } from './client-split'
import type { ConfigKitSettings } from './config-file'
import { resolveGeneratedImport } from './generated-imports'
import { validatorModule } from './virtual-modules'

export const DOCKER_OUT_DIR = 'dist-config'
export const VALIDATOR_FILE = 'validate.mjs'
export const INJECT_HOOK_FILE = 'docker-entrypoint.d/40-config-kit-inject.sh'

const VALIDATOR_ID = 'virtual:config-kit/validator'
const RESOLVED_VALIDATOR_ID = '\0config-kit:validator'

export async function writeDockerArtifacts({
  root,
  mode,
  alias,
  configPath,
  settings,
  pluginFile,
}: {
  root: string
  mode: string
  alias: AliasOptions
  configPath: string
  settings: ConfigKitSettings
  pluginFile: string
}): Promise<void> {
  const publicEnvVar = settings.envVars.public
  const outDir = path.resolve(root, DOCKER_OUT_DIR)
  await build({
    root,
    mode,
    configFile: false,
    envFile: false,
    logLevel: 'warn',
    resolve: { alias },
    ssr: { noExternal: true, target: 'node' },
    plugins: [
      validatorEntry({
        code: validatorModule({ configPath, settings }),
        configPath,
        pluginFile,
      }),
    ],
    build: {
      ssr: true,
      outDir,
      emptyOutDir: true,
      target: 'node18',
      copyPublicDir: false,
      rollupOptions: {
        input: VALIDATOR_ID,
        output: { format: 'es', entryFileNames: VALIDATOR_FILE },
      },
    },
  })
  const hook = path.join(outDir, INJECT_HOOK_FILE)
  mkdirSync(path.dirname(hook), { recursive: true })
  writeFileSync(hook, injectHook(publicEnvVar))
  chmodSync(hook, 0o755)
}

function validatorEntry({
  code,
  configPath,
  pluginFile,
}: {
  code: string
  configPath: string
  pluginFile: string
}): Plugin {
  return {
    name: 'config-kit:validator',
    enforce: 'pre',
    resolveId(id, importer, options) {
      return match({ id, importer })
        .with({ id: VALIDATOR_ID }, () => RESOLVED_VALIDATOR_ID)
        .with({ importer: RESOLVED_VALIDATOR_ID }, () =>
          resolveGeneratedImport(this, { id, configPath, pluginFile, options }),
        )
        .otherwise(() => null)
    },
    load: (id) => (id === RESOLVED_VALIDATOR_ID ? code : undefined),
    transform: {
      order: 'post',
      handler(source, id, options) {
        return transformConfigFile(this, {
          code: source,
          id,
          ssr: options?.ssr === true,
          configPath,
          keepOnInvalid: false,
          skipSsr: false,
        })
      },
    },
  }
}

export function injectHook(envVar: string): string {
  return [
    '#!/bin/sh',
    'set -eu',
    '',
    'docroot=/usr/share/nginx/html',
    'template=/usr/share/nginx/config-kit-index.template.html',
    '',
    `if [ -z "\${${envVar}:-}" ]; then`,
    `  echo "$0: ${envVar} is not set or empty" >&2`,
    '  exit 1',
    'fi',
    '',
    '[ -f "$template" ] || cp "$docroot/index.html" "$template"',
    '',
    `${envVar}=$(printf '%s' "$${envVar}" | sed 's/</\\\\u003c/g') \\`,
    `  envsubst '\${${envVar}}' <"$template" >"$docroot/index.html"`,
    '',
  ].join('\n')
}
