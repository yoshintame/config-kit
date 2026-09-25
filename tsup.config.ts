import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/core/index.ts',
    'node/index': 'src/node/index.ts',
    'node/browser': 'src/node/browser.ts',
    'browser/index': 'src/browser/index.ts',
    'vite/index': 'src/vite/index.ts',
  },
  format: 'esm',
  dts: true,
  clean: true,
  target: 'es2022',
})
