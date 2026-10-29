import { describe, expect, test } from 'vitest'

import { YamlSection } from './constants'
import { devOverrideSource, parseDevOverrides } from './dev-overrides'

describe('parseDevOverrides', () => {
  test('reads --set assignments after the -- separator only', () => {
    expect(
      parseDevOverrides([
        'node',
        'vite',
        '--host',
        '--',
        '--set',
        'build.msw=true',
        '--set=build.impersonation.actAs=e2e-manager',
        '--other',
      ]),
    ).toEqual([
      {
        section: YamlSection.Build,
        path: 'msw',
        value: true,
        assignment: 'build.msw=true',
      },
      {
        section: YamlSection.Build,
        path: 'impersonation.actAs',
        value: 'e2e-manager',
        assignment: 'build.impersonation.actAs=e2e-manager',
      },
    ])
  })

  test('ignores --set before the separator', () => {
    expect(parseDevOverrides(['vite', '--set', 'build.msw=true'])).toEqual([])
  })

  test.each([
    ['1', 1],
    ['false', false],
    ['null', null],
    ['', ''],
    ['https://x.dev/a=b', 'https://x.dev/a=b'],
  ])('parses %j as a YAML scalar', (text, value) => {
    expect(
      parseDevOverrides(['--', '--set', `public.backend.apiUrl=${text}`])[0]
        ?.value,
    ).toEqual(value)
  })

  test.each([
    ['missing value', ['--', '--set']],
    ['no equals sign', ['--', '--set', 'build.msw']],
    ['unknown section', ['--', '--set', 'env.MSW=true']],
    ['section without a field', ['--', '--set', 'build=true']],
  ])('rejects %s', (_, argv) => {
    expect(() => parseDevOverrides(argv)).toThrow(
      '--set expects <public|private|build>.<path>=<value>',
    )
  })
})

describe('devOverrideSource', () => {
  const overrides = parseDevOverrides([
    '--',
    '--set',
    'build.devtools.router=true',
    '--set',
    'build.msw=true',
    '--set',
    'public.a=2',
  ])

  test('builds a patch for one section and names the flags', () => {
    expect(devOverrideSource(overrides, YamlSection.Build)?.loadSync()).toEqual(
      {
        raw: { devtools: { router: true }, msw: true },
        source: '--set build.devtools.router=true --set build.msw=true',
      },
    )
  })

  test('is absent for a section without overrides', () => {
    expect(devOverrideSource(overrides, YamlSection.Private)).toBeUndefined()
  })
})
