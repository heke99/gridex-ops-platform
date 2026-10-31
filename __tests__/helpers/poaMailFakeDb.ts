// In-memory Supabase port for the POA / grid-owner mail review tests
// (poa-mail-review). It evaluates the PostgREST filters the code under test
// uses, so guarded updates (eq status/locked_by) really match or miss rows.
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'

type Row = Record<string, unknown>
type DbError = { code: string; message: string }
type Filter = (row: Row) => boolean
const field = (row: Row, column: string) => column.split(/->>?/).reduce<unknown>((value, key) => value && typeof value === 'object' ? (value as Row)[key] : undefined, row)
function ilike(value: unknown, pattern: string): boolean {
  let expression = ''
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]
    if (char === '\\' && i + 1 < pattern.length) expression += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    else if (char === '%') expression += '.*'
    else if (char === '_') expression += '.'
    else expression += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return value != null && new RegExp(`^${expression}$`, 'i').test(String(value))
}

export type WriteHook = (input: { table: string; op: 'insert' | 'update'; next: Row; previous: Row | null }) => DbError | null

export type FakeDb = {
  tables: Record<string, Row[]>
  writes: Array<{ table: string; op: string; payload: unknown; error?: DbError | null }>
  hooks: WriteHook[]
  unique: Record<string, string[]>
  storageFiles: Map<string, Buffer>
  storageUploads: string[]
  client: { from: (table: string) => unknown; storage: { from: (bucket: string) => {
    download: (path: string) => Promise<{ data: { arrayBuffer: () => Promise<ArrayBuffer> } | null; error: null }>
    upload: (path: string, data: Buffer, options: { upsert: boolean }) => Promise<{ data: { path: string } | null; error: { statusCode: string } | null }>
  } } }
}

function compare(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b))
}

function parseValue(raw: string): unknown {
  // PostgREST double-quoted value: `eq."a,b"` compares with a,b (\" and \\ unescaped).
  if (/^"(?:\\.|[^"\\])*"$/.test(raw)) return raw.slice(1, -1).replace(/\\(.)/g, '$1')
  if (raw === 'null') return null
  if (raw === 'true') return true
  if (raw === 'false') return false
  return raw
}

function orFilter(expression: string): Filter {
  const parts = (expression.match(/(?:[^,"]|"(?:\\.|[^"\\])*")+/g) ?? []).map((part) => {
    const [column, op, ...rest] = part.split('.')
    const value = parseValue(rest.join('.'))
    return (row: Row) => {
      const cell = row[column] ?? null
      if (op === 'is') return cell === value
      if (op === 'eq') return cell !== null && String(cell) === String(value)
      if (op === 'ilike') {
        const pattern = String(value).replace(/^"|"$/g, '').replace(/\\"/g, '"')
        const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.')
        return cell !== null && new RegExp(`^${escaped}$`, 'i').test(String(cell))
      }
      if (op === 'lte') return cell !== null && compare(cell, value) <= 0
      if (op === 'lt') return cell !== null && compare(cell, value) < 0
      throw new Error(`fake db: unsupported or-op ${op}`)
    }
  })
  return (row) => parts.some((p) => p(row))
}

export function createFakeDb(seed: Record<string, Row[]> = {}): FakeDb {
  const db: FakeDb = {
    tables: Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, v.map((r) => ({ ...r }))])),
    writes: [],
    hooks: [],
    unique: { manual_email_outbox: ['idempotency_key'] },
    storageFiles: new Map(), storageUploads: [],
    client: undefined as never,
  }

  const from = (table: string) => {
    let op: 'select' | 'insert' | 'update' | 'upsert' = 'select'
    let conflictColumns: string[] = []
    let payload: Row | Row[] | null = null
    const filters: Filter[] = []
    let orderBy: { column: string; ascending: boolean; nullsFirst: boolean } | null = null
    let limitN: number | null = null
    let offsetN = 0

    const rows = () => (db.tables[table] ??= [])

    const execute = (): { data: Row[] | null; error: DbError | null } => {
      if (op === 'insert' || op === 'upsert') {
        const list = (Array.isArray(payload) ? payload : [payload]) as Row[]
        const inserted: Row[] = []
        for (const item of list) {
          if (op === 'upsert') {
            const previous = rows().find((row) => conflictColumns.length > 0 && conflictColumns.every((column) => row[column] === item[column]))
            if (previous) { Object.assign(previous, item); inserted.push({ ...previous }); db.writes.push({ table, op, payload: item }); continue }
          }
          const next: Record<string, unknown> = { id: randomUUID(), created_at: new Date().toISOString(), ...item }
          for (const column of db.unique[table] ?? []) {
            if (next[column] !== undefined && rows().some((r) => r[column] === next[column])) {
              const error = { code: '23505', message: `duplicate key value violates unique constraint on ${column}` }
              db.writes.push({ table, op, payload: item, error })
              return { data: null, error }
            }
          }
          for (const hook of db.hooks) {
            const error = hook({ table, op: 'insert', next, previous: null })
            if (error) {
              db.writes.push({ table, op, payload: item, error })
              return { data: null, error }
            }
          }
          rows().push(next)
          inserted.push({ ...next })
          db.writes.push({ table, op, payload: item })
        }
        return { data: inserted, error: null }
      }
      const matched = rows().filter((row) => filters.every((f) => f(row)))
      if (op === 'update') {
        const updated: Row[] = []
        for (const row of matched) {
          const next = { ...row, ...(payload as Row) }
          for (const hook of db.hooks) {
            const error = hook({ table, op: 'update', next, previous: row })
            if (error) {
              db.writes.push({ table, op, payload, error })
              return { data: null, error }
            }
          }
          Object.assign(row, payload)
          updated.push({ ...row })
        }
        db.writes.push({ table, op, payload: { ...(payload as Row), __matched: updated.map((r) => r.id) } })
        return { data: updated, error: null }
      }
      let result = matched.map((r) => ({ ...r }))
      if (orderBy) {
        const { column, ascending, nullsFirst } = orderBy
        result = result.sort((a, b) => {
          const av = a[column] ?? null
          const bv = b[column] ?? null
          if (av === null || bv === null) return av === bv ? 0 : (av === null) === nullsFirst ? -1 : 1
          return ascending ? compare(av, bv) : compare(bv, av)
        })
      }
      if (limitN !== null) result = result.slice(offsetN, offsetN + limitN)
      return { data: result, error: null }
    }

    const q: Record<string, unknown> = {}
    q.select = () => q
    q.insert = (p: Row | Row[]) => { op = 'insert'; payload = p; return q }
    q.upsert = (p: Row | Row[], options?: { onConflict?: string }) => { op = 'upsert'; payload = p; conflictColumns = options?.onConflict?.split(',') ?? ['id']; return q }
    q.update = (p: Row) => { op = 'update'; payload = p; return q }
    q.eq = (c: string, v: unknown) => { filters.push((r) => {
      const cell = field(r, c)
      if (cell == null) return false
      if (typeof cell === 'object' && typeof v === 'string') {
        try { return isDeepStrictEqual(cell, JSON.parse(v)) } catch { return false }
      }
      return String(cell) === String(v)
    }); return q }
    q.neq = (c: string, v: unknown) => { filters.push((r) => String(r[c]) !== String(v)); return q }
    q.in = (c: string, vs: unknown[]) => { filters.push((r) => vs.map(String).includes(String(r[c]))); return q }
    q.is = (c: string, v: unknown) => { filters.push((r) => (field(r, c) ?? null) === v); return q }
    q.lt = (c: string, v: unknown) => { filters.push((r) => r[c] !== null && r[c] !== undefined && compare(r[c], v) < 0); return q }
    q.lte = (c: string, v: unknown) => { filters.push((r) => r[c] !== null && r[c] !== undefined && compare(r[c], v) <= 0); return q }
    q.gt = (c: string, v: unknown) => { filters.push((r) => r[c] !== null && r[c] !== undefined && compare(r[c], v) > 0); return q }
    q.ilike = (c: string, v: unknown) => { filters.push((r) => ilike(field(r, c), String(v))); return q }
    q.or = (expr: string) => { filters.push(orFilter(expr)); return q }
    q.order = (column: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) => {
      orderBy ??= { column, ascending: opts?.ascending ?? true, nullsFirst: opts?.nullsFirst ?? false }
      return q
    }
    q.limit = (n: number) => { limitN = n; return q }
    q.range = (start: number, end: number) => { offsetN = start; limitN = end - start + 1; return q }
    const single = async () => {
      const r = execute()
      return { data: r.data ? r.data[0] ?? null : null, error: r.error }
    }
    q.maybeSingle = single
    q.single = single
    q.then = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) => Promise.resolve(execute()).then(ok, err)
    return q
  }

  db.client = { from, storage: { from: (bucket) => ({
    download: async (path) => {
      const data = db.storageFiles.get(`${bucket}/${path}`)
      return { data: data ? { arrayBuffer: async () => Uint8Array.from(data).buffer } : null, error: null }
    },
    upload: async (path, data, options) => {
      const key = `${bucket}/${path}`
      if (db.storageFiles.has(key) && !options.upsert) return { data: null, error: { statusCode: '409' } }
      db.storageFiles.set(key, Buffer.from(data)); db.storageUploads.push(key)
      return { data: { path }, error: null }
    },
  }) } }
  return db
}
