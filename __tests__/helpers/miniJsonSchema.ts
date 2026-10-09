/**
 * Small JSON Schema 2020-12 subset validator for OpenAPI 3.1 response tests:
 * $ref (local JSON pointers), type (incl. arrays with "null"), enum, const,
 * properties, required, additionalProperties, items, allOf/anyOf/oneOf,
 * minimum/maximum, minLength. Unknown keywords are ignored. Used instead of a
 * new dependency so the dependency-pinned Ediel native gates stay valid.
 */
type Schema = Record<string, any> | boolean

export type MiniValidator = ((value: unknown) => boolean) & { errors: string[] }

function resolvePointer(root: any, ref: string): Schema {
  if (!ref.startsWith('#')) throw new Error(`unsupported $ref ${ref}`)
  let node = root
  for (const raw of ref.slice(1).split('/').filter(Boolean)) {
    node = node?.[raw.replace(/~1/g, '/').replace(/~0/g, '~')]
    if (node === undefined) throw new Error(`unresolved $ref ${ref}`)
  }
  return node
}

function typeOf(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number'
  return typeof value
}

function matchesType(value: unknown, type: string): boolean {
  const actual = typeOf(value)
  return actual === type || (type === 'number' && actual === 'integer')
}

function check(root: any, schema: Schema, value: unknown, path: string, errors: string[]): boolean {
  if (schema === true) return true
  if (schema === false) { errors.push(`${path}: not allowed`); return false }
  let ok = true
  const fail = (message: string) => { errors.push(`${path}: ${message}`); ok = false }
  if (schema.$ref) ok = check(root, resolvePointer(root, schema.$ref), value, path, errors) && ok
  if (schema.type !== undefined) {
    const types: string[] = Array.isArray(schema.type) ? schema.type : [schema.type]
    const allowNull = schema.nullable === true
    if (!types.some((t) => matchesType(value, t)) && !(allowNull && value === null)) {
      fail(`expected ${types.join('|')}, got ${typeOf(value)}`)
      return false
    }
  }
  if (schema.enum && !schema.enum.some((e: unknown) => e === value)) fail(`not in enum ${JSON.stringify(schema.enum)}`)
  if ('const' in schema && schema.const !== value) fail(`expected const ${JSON.stringify(schema.const)}`)
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) fail(`< minimum ${schema.minimum}`)
    if (typeof schema.maximum === 'number' && value > schema.maximum) fail(`> maximum ${schema.maximum}`)
  }
  if (typeof value === 'string' && typeof schema.minLength === 'number' && value.length < schema.minLength) fail('too short')
  if (Array.isArray(value) && schema.items !== undefined) {
    value.forEach((item, index) => { ok = check(root, schema.items, item, `${path}[${index}]`, errors) && ok })
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>
    for (const key of schema.required ?? []) if (!(key in obj)) fail(`missing required ${key}`)
    const props: Record<string, Schema> = schema.properties ?? {}
    for (const [key, sub] of Object.entries(props)) {
      if (key in obj) ok = check(root, sub, obj[key], `${path}.${key}`, errors) && ok
    }
    if (schema.additionalProperties !== undefined) {
      for (const key of Object.keys(obj)) {
        if (key in props) continue
        if (schema.additionalProperties === false) fail(`unexpected property ${key}`)
        else if (typeof schema.additionalProperties === 'object') ok = check(root, schema.additionalProperties, obj[key], `${path}.${key}`, errors) && ok
      }
    }
  }
  if (schema.allOf) for (const sub of schema.allOf) ok = check(root, sub, value, path, errors) && ok
  if (schema.anyOf && !schema.anyOf.some((sub: Schema) => check(root, sub, value, path, []))) fail('no anyOf branch matched')
  if (schema.oneOf) {
    const n = schema.oneOf.filter((sub: Schema) => check(root, sub, value, path, [])).length
    if (n !== 1) fail(`oneOf matched ${n} branches`)
  }
  return ok
}

export function compileSchema(root: unknown, schema: Schema): MiniValidator {
  const validate = ((value: unknown) => {
    validate.errors = []
    return check(root, schema, value, '$', validate.errors)
  }) as MiniValidator
  validate.errors = []
  return validate
}
