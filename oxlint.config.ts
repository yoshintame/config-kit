import {
  base,
  ignorePatterns,
  strict,
  vitest,
} from '@yoshintame/ox-config/oxlint'
import { defineConfig } from 'oxlint'

export default defineConfig({
  extends: [base, strict, vitest],
  ignorePatterns,
  options: {
    typeCheck: true,
  },
  rules: {
    'unicorn/no-array-sort': 'off',
  },
  overrides: [
    {
      files: ['test/types/**'],
      rules: {
        'no-unused-expressions': 'off',
      },
    },
    {
      files: ['src/core/**', 'src/browser/**', 'src/node/browser.ts'],
      plugins: ['node'],
      rules: {
        'import/no-nodejs-modules': 'error',
        'node/no-process-env': 'error',
        'no-restricted-imports': [
          'error',
          {
            paths: [
              {
                name: 'ts-pattern',
                message:
                  'core and browser ship to the client bundle: ts-pattern more than doubles their size',
              },
            ],
            patterns: [
              {
                group: ['../node', '../node/*', '../vite', '../vite/*'],
                message:
                  'core and browser ship to the client bundle: the node and vite entries do not belong there',
              },
            ],
          },
        ],
      },
    },
  ],
})
