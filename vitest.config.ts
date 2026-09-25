import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

const srcDir = fileURLToPath(new URL('./src/', import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@yoshintame\/config-kit\/(node|browser)$/,
        replacement: `${srcDir}$1/index.ts`,
      },
      {
        find: /^@yoshintame\/config-kit$/,
        replacement: `${srcDir}core/index.ts`,
      },
    ],
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
