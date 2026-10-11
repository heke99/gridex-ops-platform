/**
 * In-memory database/storage for the mounted customer support routes (tests only). Supports the
 * keyset `.or()` filters and multi-column ordering so that real cursor pagination is exercised.
 */
import { postgrestOr, sortRows } from './postgrestOrFilter'

type Row = Record<string, unknown>
export const db: Record<string, Row[]> = {}
export const objects = new Map<string, Buffer>()
let idCounter = 0
export const nextId = () => `00000000-0000-4000-8000-${String(++idCounter).padStart(12, '0')}`

function readPath(row: Row, field: string): unknown {
  const json = /^(\w+)->>(\w+)$/.exec(field)
  if (json) {
    const value = (row[json[1]] as Row | null)?.[json[2]]
    return value === undefined || value === null ? null : String(value)
  }
  return row[field]
}

function builder(table: string) {
  const filters: Array<(row: Row) => boolean> = []
  const orders: Array<{ column: string; ascending: boolean }> = []
  let mode: 'select' | 'insert' | 'update' = 'select'
  let pending: Row[] = []
  let patch: Row = {}
  let limit: number | null = null
  let head = false
  let conflict = false
  const api: Record<string, unknown> = {
    select: (_columns?: string, options?: { head?: boolean }) => { head = Boolean(options?.head); return api },
    gte: (field: string, value: string) => { filters.push((row) => String(readPath(row, field)) >= value); return api },
    eq: (field: string, value: unknown) => { filters.push((row) => readPath(row, field) === value); return api },
    in: (field: string, values: unknown[]) => { filters.push((row) => values.includes(readPath(row, field))); return api },
    contains: (field: string, value: Row) => {
      filters.push((row) => Object.entries(value).every(([key, v]) => (row[field] as Row | null)?.[key] === v))
      return api
    },
    or: (expression: string) => { filters.push(postgrestOr(expression)); return api },
    order: (column: string, options?: { ascending?: boolean }) => { orders.push({ column, ascending: options?.ascending ?? true }); return api },
    limit: (value: number) => { limit = value; return api },
    insert: (value: Row | Row[]) => {
      mode = 'insert'
      const key = (row: Row) => [row.company_id, row.api_client_id, row.route, row.idempotency_key].join('|')
      if (table === 'customer_portal_write_idempotency' && !Array.isArray(value)
        && (db[table] ?? []).some((row) => key(row) === key(value))) {
        conflict = true
        pending = []
        return api
      }
      pending = (Array.isArray(value) ? value : [value]).map((row) => ({
        id: nextId(), ...(table === 'customer_cases' ? { status: 'open', resolved_at: null } : {}), created_at: new Date(Date.now() + idCounter).toISOString(), updated_at: new Date().toISOString(), metadata: {}, ...row,
      }))
      db[table] = [...(db[table] ?? []), ...pending]
      return api
    },
    update: (value: Row) => { mode = 'update'; patch = value; return api },
    rows(): Row[] {
      if (mode === 'insert') return pending
      const matched = (db[table] ?? []).filter((row) => filters.every((filter) => filter(row)))
      if (mode === 'update') { matched.forEach((row) => Object.assign(row, patch)); return matched }
      const sorted = sortRows(matched, orders.length ? orders : [{ column: 'created_at', ascending: true }])
      return limit === null ? sorted : sorted.slice(0, limit)
    },
    single: async () => (conflict ? { data: null, error: { code: '23505' } } : { data: (api.rows as () => Row[])()[0] ?? null, error: null }),
    maybeSingle: async () => (conflict ? { data: null, error: { code: '23505' } } : { data: (api.rows as () => Row[])()[0] ?? null, error: null }),
    then: (resolve: (value: unknown) => unknown) => {
      const rows = (api.rows as () => Row[])()
      return resolve({ data: head ? null : rows, count: rows.length, error: null })
    },
  }
  return api
}

export const serviceMock = {
  supabaseService: {
    from: (table: string) => builder(table),
    storage: {
      from: () => ({
        upload: async (path: string, bytes: Buffer) => { objects.set(path, Buffer.from(bytes)); return { error: null } },
        remove: async (paths: string[]) => { paths.forEach((path) => objects.delete(path)); return { error: null } },
        download: async (path: string) => {
          const bytes = objects.get(path)
          return bytes ? { data: new Blob([new Uint8Array(bytes)]), error: null } : { data: null, error: { message: 'missing' } }
        },
      }),
    },
  },
}

export const TENANT_A = '0000000a-0000-4000-8000-000000000000'
export const TENANT_B = '0000000b-0000-4000-8000-000000000000'
export const CUSTOMER_A1 = '000000a1-0000-4000-8000-000000000000'
export const CUSTOMER_A2 = '000000a2-0000-4000-8000-000000000000'

export function resetSupportDb() {
  objects.clear()
  for (const key of Object.keys(db)) delete db[key]
  db.customers = [{ id: CUSTOMER_A1, company_id: TENANT_A }, { id: CUSTOMER_A2, company_id: TENANT_A }]
  db.customer_cases = []
  db.customer_case_events = []
  db.customer_case_attachments = []
  db.customer_portal_write_idempotency = []
  db.audit_logs = []
}
