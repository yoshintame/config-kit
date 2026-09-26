import MagicString from 'magic-string'

interface Node {
  type: string
  start: number
  end: number
  [key: string]: unknown
}

export interface SplitOptions {
  keepOnInvalid: boolean
}

export function splitConfigModule(
  code: string,
  program: unknown,
  { keepOnInvalid }: SplitOptions,
): { code: string; map: ReturnType<MagicString['generateMap']> } | undefined {
  const body = (program as Node).body as Node[]
  const definition = findDefinition(body)
  if (!definition) return undefined
  const kept = keptProperties(code, definition, keepOnInvalid)
  if (kept === undefined) return undefined

  const output = new MagicString(code)
  for (const init of topLevelInitializers(body)) {
    output.prependLeft(init.start, '/*#__PURE__*/(() => (')
    output.appendRight(init.end, '))()')
  }
  output.overwrite(definition.start, definition.end, `{${kept.join(', ')}}`)
  return { code: output.toString(), map: output.generateMap({ hires: true }) }
}

function findDefinition(body: Node[]): Node | undefined {
  const exported = body.find((node) => node.type === 'ExportDefaultDeclaration')
    ?.declaration as Node | undefined
  const expression =
    exported?.type === 'Identifier'
      ? declarators(body).find(
          (declarator) => (declarator.id as Node).name === exported.name,
        )?.init
      : exported
  return objectOf(expression as Node | undefined)
}

function objectOf(node: Node | undefined): Node | undefined {
  if (node?.type === 'ObjectExpression') return node
  if (node?.type === 'CallExpression') {
    return objectOf((node.arguments as Node[])[0])
  }
  return undefined
}

function keptProperties(
  code: string,
  definition: Node,
  keepOnInvalid: boolean,
): string[] | undefined {
  const properties = definition.properties as Node[]
  if (properties.some((property) => !isPlainProperty(property))) {
    return undefined
  }
  const schemas = properties.find((property) => keyOf(property) === 'schemas')
    ?.value as Node | undefined
  if (schemas?.type !== 'ObjectExpression') return undefined
  const schemaProperties = schemas.properties as Node[]
  if (schemaProperties.some((property) => !isPlainProperty(property))) {
    return undefined
  }
  const publicSchema = schemaProperties.find(
    (property) => keyOf(property) === 'public',
  )
  if (!publicSchema) return undefined
  const onInvalid = properties.find(
    (property) => keyOf(property) === 'onInvalid',
  )
  return [
    `schemas: {${slice(code, publicSchema)}}`,
    ...(keepOnInvalid && onInvalid ? [slice(code, onInvalid)] : []),
  ]
}

function isPlainProperty(node: Node): boolean {
  return node.type === 'Property' && !node.computed && keyOf(node) !== undefined
}

function keyOf(property: Node): string | undefined {
  const key = property.key as Node | undefined
  if (key?.type === 'Identifier') return key.name as string
  if (key?.type === 'Literal' && typeof key.value === 'string') return key.value
  return undefined
}

function slice(code: string, node: Node): string {
  return code.slice(node.start, node.end)
}

function declarators(body: Node[]): Node[] {
  return body
    .map((node) =>
      node.type === 'ExportNamedDeclaration'
        ? (node.declaration as Node | null)
        : node,
    )
    .filter((node): node is Node => node?.type === 'VariableDeclaration')
    .flatMap((node) => node.declarations as Node[])
}

const SIDE_EFFECT_FREE = new Set([
  'ArrowFunctionExpression',
  'FunctionExpression',
  'Literal',
  'Identifier',
])

function topLevelInitializers(body: Node[]): Node[] {
  return declarators(body)
    .map((declarator) => declarator.init as Node | null)
    .filter((init): init is Node => init !== null)
    .filter((init) => !SIDE_EFFECT_FREE.has(init.type) && !awaits(init))
}

const FUNCTIONS = new Set([
  'ArrowFunctionExpression',
  'FunctionExpression',
  'FunctionDeclaration',
])

function awaits(node: Node): boolean {
  if (node.type === 'AwaitExpression') return true
  if (FUNCTIONS.has(node.type)) return false
  return Object.values(node).some((value) =>
    (Array.isArray(value) ? value : [value]).some(
      (child) => isNode(child) && awaits(child),
    ),
  )
}

function isNode(value: unknown): value is Node {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Node).type === 'string'
  )
}

export function transformConfigFile(
  context: {
    parse(code: string): unknown
    warn(message: string): void
  },
  code: string,
  options: SplitOptions,
) {
  const split = splitConfigModule(code, context.parse(code), options)
  if (!split) {
    context.warn(
      'config-kit: could not split the config file, the whole definition ships to the client bundle. Export defineConfigKit({ schemas: { public, ... } }) with object literals and no spreads',
    )
  }
  return split
}
