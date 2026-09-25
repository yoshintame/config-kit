import { type ZodType, z } from 'zod'

export function parseOrThrow<T extends ZodType>(
  schema: T,
  raw: unknown,
  origin: string,
): z.output<T> {
  const result = schema.safeParse(raw)
  if (result.success) return result.data
  const name = schemaName(schema)
  const target = name ? ` for schema '${name}'` : ''
  throw new Error(
    `Config validation failed${target} (loaded from ${origin}):\n${z.prettifyError(result.error)}`,
  )
}

export function schemaName(schema: ZodType): string | undefined {
  const meta = schema.meta()
  return meta?.id ?? meta?.title ?? schema.description
}
