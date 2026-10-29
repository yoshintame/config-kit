import { set } from 'es-toolkit/compat'
import { parse } from 'yaml'

import { createInMemorySource, type SyncConfigSource } from '../core'
import { toEnum } from '../core/guards'
import { YamlSection } from './constants'

export const SET_FLAG = '--set'

export interface DevOverride {
  section: YamlSection
  path: string
  value: unknown
  assignment: string
}

export function parseDevOverrides(argv: readonly string[]): DevOverride[] {
  const separator = argv.indexOf('--')
  const args = separator === -1 ? [] : argv.slice(separator + 1)
  return args.flatMap((arg, index) =>
    arg === SET_FLAG
      ? [parseAssignment(args[index + 1])]
      : arg.startsWith(`${SET_FLAG}=`)
        ? [parseAssignment(arg.slice(SET_FLAG.length + 1))]
        : [],
  )
}

export function devOverrideSource(
  overrides: readonly DevOverride[],
  section: YamlSection,
): SyncConfigSource | undefined {
  const own = overrides.filter((override) => override.section === section)
  return own.length === 0
    ? undefined
    : createInMemorySource(
        own.reduce<Record<string, unknown>>(
          (patch, { path, value }) => set(patch, path, value),
          {},
        ),
        own.map(({ assignment }) => `${SET_FLAG} ${assignment}`).join(' '),
      )
}

function parseAssignment(assignment: string | undefined): DevOverride {
  const groups = ASSIGNMENT.exec(assignment ?? '')?.groups
  if (assignment === undefined || groups === undefined) {
    throw new Error(
      `${SET_FLAG} expects <${Object.values(YamlSection).join('|')}>.<path>=<value>, got '${assignment ?? ''}'`,
    )
  }
  const { section = '', path = '', value = '' } = groups
  return {
    section: toEnum(YamlSection, section as `${YamlSection}`),
    path,
    value: value === '' ? '' : (parse(value) as unknown),
    assignment,
  }
}

const ASSIGNMENT = new RegExp(
  `^(?<section>${Object.values(YamlSection).join('|')})\\.(?<path>[^=]+)=(?<value>.*)$`,
  's',
)
