import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

const source = (pkg: string) =>
  fileURLToPath(new URL(`./packages/${pkg}/src/index.ts`, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@senate/config-core': source('config-core'),
      '@senate/config-node': source('config-node'),
      '@senate/config-browser': source('config-browser'),
    },
  },
  test: {
    include: ['packages/*/src/**/*.test.ts'],
    environment: 'node',
  },
})
