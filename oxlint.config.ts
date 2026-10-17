import { base, ignorePatterns } from '@yoshintame/ox-config/oxlint'
import { defineConfig } from 'oxlint'

export default defineConfig({
  extends: [base],
  ignorePatterns,
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
      files: ['src/core/**', 'src/browser/**'],
      rules: {
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
          },
        ],
      },
    },
  ],
})
