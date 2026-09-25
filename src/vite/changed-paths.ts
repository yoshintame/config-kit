import { isEqual, isPlainObject } from 'es-toolkit'

export function changedPaths(
  prev: unknown,
  next: unknown,
  prefix = '',
): string[] {
  if (isPlainObject(prev) && isPlainObject(next)) {
    const keys = new Set([...Object.keys(prev), ...Object.keys(next)])
    return [...keys].flatMap((key) =>
      changedPaths(prev[key], next[key], prefix ? `${prefix}.${key}` : key),
    )
  }
  return isEqual(prev, next) ? [] : [prefix]
}

export function matchesAny(path: string, patterns: string[]): boolean {
  if (path === '') return patterns.length > 0
  return patterns
    .map((pattern) => pattern.replace(/\.\*$/, ''))
    .some((base) => [isWithin(path, base), isWithin(base, path)].some(Boolean))
}

function isWithin(inner: string, outer: string): boolean {
  return `${inner}.`.startsWith(`${outer}.`)
}
