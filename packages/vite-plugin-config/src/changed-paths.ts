function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

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
  return JSON.stringify(prev) === JSON.stringify(next) ? [] : [prefix]
}

export function matchesAny(path: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    const base = pattern.endsWith('.*') ? pattern.slice(0, -2) : pattern
    return (
      path === '' ||
      path === base ||
      path.startsWith(`${base}.`) ||
      base.startsWith(`${path}.`)
    )
  })
}
