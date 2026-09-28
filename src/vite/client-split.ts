import { isNotNil } from 'es-toolkit'
import type {
  Directive,
  ExportDefaultDeclaration,
  ModuleDeclaration,
  Node,
  ObjectExpression,
  Program,
  Property,
  Statement,
  VariableDeclarator,
} from 'estree'
import MagicString from 'magic-string'
import { match, P } from 'ts-pattern'
import type { Rollup } from 'vite'

import { isAstNode } from '../core/guards'

export interface SplitOptions {
  keepOnInvalid: boolean
}

export interface SplitResult {
  code: string
  map: ReturnType<MagicString['generateMap']>
}

export function transformConfigFile(
  context: Pick<Rollup.TransformPluginContext, 'parse' | 'warn'>,
  {
    code,
    id,
    ssr,
    configPath,
    keepOnInvalid,
    skipSsr,
  }: SplitOptions & {
    code: string
    id: string
    ssr: boolean
    configPath: string
    skipSsr: boolean
  },
): SplitResult | undefined {
  const applies = match({
    file: id.split('?')[0] === configPath,
    skipped: ssr ? skipSsr : false,
  })
    .with({ file: true, skipped: false }, () => true)
    .otherwise(() => false)
  if (!applies) return undefined

  const split = splitConfigModule(code, context.parse(code), { keepOnInvalid })
  if (!split) {
    context.warn(
      'config-kit: could not split the config file, the whole definition ships to the client bundle. Export defineConfigKit({ schemas: { public, ... } }) with object literals and no spreads',
    )
  }
  return split
}

export function splitConfigModule(
  code: string,
  program: Program,
  { keepOnInvalid }: SplitOptions,
): SplitResult | undefined {
  const definition = findDefinition(program.body)
  const split = definition
    ? splitOf({ code, definition, keepOnInvalid })
    : undefined
  if (!split) return undefined

  const output = new MagicString(code)
  output.overwrite(
    span(split.definition).start,
    span(split.definition).end,
    `{${split.text}}`,
  )
  const reachable = reachableNames(program.body, split)
  for (const statement of program.body) {
    if (!isReachable(statement, reachable)) {
      output.remove(span(statement).start, span(statement).end)
    }
  }
  return { code: output.toString(), map: output.generateMap({ hires: true }) }
}

type TopLevel = Statement | ModuleDeclaration | Directive

interface Split {
  definition: ObjectExpression
  roots: Node[]
  text: string
}

function findDefinition(body: TopLevel[]): ObjectExpression | undefined {
  const exported = body.find(
    (node): node is ExportDefaultDeclaration =>
      node.type === 'ExportDefaultDeclaration',
  )?.declaration
  const expression = match(exported)
    .with({ type: 'Identifier' }, ({ name }) => declaratorOf(body, name)?.init)
    .otherwise((node) => node)
  return objectOf(expression)
}

function objectOf(
  node: Node | ExportDefaultDeclaration['declaration'] | null | undefined,
): ObjectExpression | undefined {
  return match(node)
    .with({ type: 'ObjectExpression' }, (object) => object)
    .with({ type: 'CallExpression' }, ({ arguments: [first] }) =>
      objectOf(first),
    )
    .otherwise(() => undefined)
}

function splitOf({
  code,
  definition,
  keepOnInvalid,
}: {
  code: string
  definition: ObjectExpression
  keepOnInvalid: boolean
}): Split | undefined {
  const properties = plainProperties(definition)
  const schemas = properties?.find((property) => keyOf(property) === 'schemas')
  const publicSchema = match(schemas?.value)
    .with({ type: 'ObjectExpression' }, (value) =>
      plainProperties(value)?.find((property) => keyOf(property) === 'public'),
    )
    .otherwise(() => undefined)
  if (!publicSchema) return undefined

  const onInvalid = keepOnInvalid
    ? properties?.find((property) => keyOf(property) === 'onInvalid')
    : undefined
  const kept = [publicSchema, onInvalid].filter(isNotNil)
  return {
    definition,
    roots: kept.map(({ value }) => value),
    text: [
      `schemas: {${slice(code, publicSchema)}}`,
      ...(onInvalid ? [slice(code, onInvalid)] : []),
    ].join(', '),
  }
}

function plainProperties(object: ObjectExpression): Property[] | undefined {
  const properties = object.properties.filter(
    (property): property is Property =>
      property.type === 'Property' ? !property.computed : false,
  )
  return properties.length === object.properties.length ? properties : undefined
}

function keyOf(property: Property): string | undefined {
  return match(property.key)
    .with({ type: 'Identifier' }, ({ name }) => name)
    .with({ type: 'Literal', value: P.string }, ({ value }) => value)
    .otherwise(() => undefined)
}

function reachableNames(body: TopLevel[], split: Split): Set<string> {
  const reachable = new Set<string>()
  const pending = body
    .filter((node) => isRoot(node))
    .flatMap((node) => referencedNames(node, split))

  while (pending.length > 0) {
    const name = pending.pop()!
    if (reachable.has(name)) continue
    reachable.add(name)
    pending.push(
      ...declarationsOf(body, name).flatMap((node) =>
        referencedNames(node, split),
      ),
    )
  }
  return reachable
}

function isRoot(node: TopLevel): boolean {
  return match(node.type)
    .with(
      P.union(
        'ExportDefaultDeclaration',
        'ExportNamedDeclaration',
        'ExportAllDeclaration',
        'ExpressionStatement',
      ),
      () => true,
    )
    .otherwise(() => false)
}

function isReachable(node: TopLevel, reachable: Set<string>): boolean {
  return match(node)
    .with({ type: 'VariableDeclaration' }, ({ declarations }) =>
      declarations.some(({ id }) =>
        boundNames(id).some((name) => reachable.has(name)),
      ),
    )
    .with(
      { type: P.union('FunctionDeclaration', 'ClassDeclaration') },
      ({ id }) => (id ? reachable.has(id.name) : true),
    )
    .with({ type: 'ImportDeclaration' }, ({ specifiers }) =>
      specifiers.length === 0
        ? true
        : specifiers.some(({ local }) => reachable.has(local.name)),
    )
    .otherwise(() => true)
}

function declarationsOf(body: TopLevel[], name: string): Node[] {
  return body.flatMap((node) =>
    match(node)
      .returnType<Node[]>()
      .with({ type: 'VariableDeclaration' }, ({ declarations }) =>
        declarations.filter(({ id }) => boundNames(id).includes(name)),
      )
      .with(
        { type: P.union('FunctionDeclaration', 'ClassDeclaration') },
        (declaration) => (declaration.id?.name === name ? [declaration] : []),
      )
      .otherwise(() => []),
  )
}

function declaratorOf(
  body: TopLevel[],
  name: string,
): VariableDeclarator | undefined {
  return declarationsOf(body, name).find(
    (node): node is VariableDeclarator => node.type === 'VariableDeclarator',
  )
}

function boundNames(pattern: Node): string[] {
  return collectIdentifiers(pattern)
}

function referencedNames(node: Node, split: Split): string[] {
  return node === split.definition
    ? split.roots.flatMap((root) => collectIdentifiers(root))
    : [
        ...identifierName(node),
        ...childNodes(node).flatMap((child) => referencedNames(child, split)),
      ]
}

function collectIdentifiers(node: Node): string[] {
  return [
    ...identifierName(node),
    ...childNodes(node).flatMap((child) => collectIdentifiers(child)),
  ]
}

function identifierName(node: Node): string[] {
  return node.type === 'Identifier' ? [node.name] : []
}

function childNodes(node: Node): Node[] {
  return Object.values(node)
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .filter(isAstNode)
}

function span(node: Node): { start: number; end: number } {
  return node as Node & { start: number; end: number }
}

function slice(code: string, node: Node): string {
  return code.slice(span(node).start, span(node).end)
}
