import type { Parser } from '@senate/config-core'

export function parseWith(parser: Parser, input: string, origin: string) {
  try {
    return parser.parse(input)
  } catch (err) {
    throw new Error(`Failed to parse ${origin}: ${(err as Error).message}`)
  }
}
