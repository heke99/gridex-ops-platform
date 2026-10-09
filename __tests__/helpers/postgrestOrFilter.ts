/**
 * Minimal evaluator for the PostgREST logical filter grammar used by `.or()` in keyset pagination
 * (`col.op.value`, `and(...)`, `or(...)`, ops eq/lt/gt/lte/gte/is/in). Test-only.
 */
type Row = Record<string, unknown>

function splitTop(input: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const char of input) {
    if (char === '(') depth += 1
    if (char === ')') depth -= 1
    if (char === ',' && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (current) parts.push(current)
  return parts
}

function compare(a: unknown, b: string): number {
  const left = String(a)
  const leftTime = Date.parse(left)
  const rightTime = Date.parse(b)
  if (/^\d{4}-\d{2}-\d{2}/.test(left) && Number.isFinite(leftTime) && Number.isFinite(rightTime)) return leftTime - rightTime
  return left < b ? -1 : left > b ? 1 : 0
}

function term(row: Row, expression: string): boolean {
  const group = /^(and|or)\((.*)\)$/s.exec(expression)
  if (group) {
    const parts = splitTop(group[2])
    return group[1] === 'and' ? parts.every((part) => term(row, part)) : parts.some((part) => term(row, part))
  }
  const first = expression.indexOf('.')
  const second = expression.indexOf('.', first + 1)
  const column = expression.slice(0, first)
  const op = expression.slice(first + 1, second)
  const value = expression.slice(second + 1)
  const actual = row[column]
  switch (op) {
    case 'is': return value === 'null' ? actual === null || actual === undefined : String(actual) === value
    case 'eq': return actual !== null && actual !== undefined && compare(actual, value) === 0
    case 'lt': return actual !== null && actual !== undefined && compare(actual, value) < 0
    case 'gt': return actual !== null && actual !== undefined && compare(actual, value) > 0
    case 'lte': return actual !== null && actual !== undefined && compare(actual, value) <= 0
    case 'gte': return actual !== null && actual !== undefined && compare(actual, value) >= 0
    case 'in': return value.replace(/^\(|\)$/g, '').split(',').includes(String(actual))
    default: throw new Error(`unsupported filter operator ${op}`)
  }
}

/** Returns a predicate for the argument of `.or(...)`. */
export function postgrestOr(filter: string): (row: Row) => boolean {
  return (row) => term(row, `or(${filter})`)
}

/** Multi-column sort compatible with `.order(col, { ascending, nullsFirst })` calls. */
export function sortRows(rows: Row[], orders: Array<{ column: string; ascending: boolean; nullsFirst?: boolean }>): Row[] {
  return [...rows].sort((a, b) => {
    for (const order of orders) {
      const left = a[order.column]
      const right = b[order.column]
      if (left === right) continue
      const nullsFirst = order.nullsFirst ?? !order.ascending
      if (left === null || left === undefined) return nullsFirst ? -1 : 1
      if (right === null || right === undefined) return nullsFirst ? 1 : -1
      const result = compare(left, String(right))
      if (result !== 0) return order.ascending ? result : -result
    }
    return 0
  })
}
