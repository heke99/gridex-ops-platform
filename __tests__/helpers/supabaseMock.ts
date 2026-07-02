/**
 * Minimal in-memory fake for the supabase-js query builder, covering the
 * chains used by the modules under test:
 *
 *   from(t).select(...).eq(...).in(...).lt(...).gt(...).order(...).limit(n)
 *   from(t).select(..., { count: 'exact', head: true }).eq(...)
 *   from(t).select(...).eq(...).order(...).limit(1).maybeSingle()
 *   from(t).insert(row).select('*').maybeSingle()
 *   from(t).update(patch).eq(...).eq(...)
 *
 * The builder is thenable so `await query` resolves `{ data, error, count }`
 * exactly like supabase-js.
 */

export type Row = Record<string, unknown>

export type FakeSupabaseCall = {
  table: string
  operation: 'select' | 'insert' | 'update' | 'upsert' | 'delete'
  filters: Array<{ method: string; column: string; value: unknown }>
  payload?: unknown
}

export type FakeSupabaseOptions = {
  tables: Record<string, Row[]>
  /** Force an error for a table (e.g. simulate a missing relation). */
  errorsByTable?: Record<string, { code?: string; message?: string }>
}

type QueryResult = { data: unknown; error: unknown; count: number | null }

let generatedId = 0

class FakeQueryBuilder implements PromiseLike<QueryResult> {
  private predicates: Array<(row: Row) => boolean> = []
  private orderBy: { column: string; ascending: boolean } | null = null
  private limitCount: number | null = null
  private singleMode: 'maybeSingle' | null = null
  private countMode = false
  private headMode = false
  private operation: FakeSupabaseCall['operation'] = 'select'
  private insertPayload: Row | Row[] | null = null
  private updatePayload: Row | null = null
  private readonly call: FakeSupabaseCall

  constructor(
    private readonly tableName: string,
    private readonly options: FakeSupabaseOptions,
    calls: FakeSupabaseCall[]
  ) {
    this.call = { table: tableName, operation: 'select', filters: [] }
    calls.push(this.call)
  }

  select(_columns?: string, opts?: { count?: string; head?: boolean }): this {
    if (opts?.count) this.countMode = true
    if (opts?.head) this.headMode = true
    return this
  }

  insert(payload: Row | Row[]): this {
    this.operation = 'insert'
    this.call.operation = 'insert'
    this.insertPayload = payload
    this.call.payload = payload
    return this
  }

  upsert(payload: Row | Row[]): this {
    this.operation = 'upsert'
    this.call.operation = 'upsert'
    this.insertPayload = payload
    this.call.payload = payload
    return this
  }

  update(payload: Row): this {
    this.operation = 'update'
    this.call.operation = 'update'
    this.updatePayload = payload
    this.call.payload = payload
    return this
  }

  private track(method: string, column: string, value: unknown) {
    this.call.filters.push({ method, column, value })
  }

  eq(column: string, value: unknown): this {
    this.track('eq', column, value)
    this.predicates.push((row) => row[column] === value)
    return this
  }

  is(column: string, value: unknown): this {
    this.track('is', column, value)
    this.predicates.push((row) => (row[column] ?? null) === value)
    return this
  }

  in(column: string, values: unknown[]): this {
    this.track('in', column, values)
    this.predicates.push((row) => values.includes(row[column]))
    return this
  }

  lt(column: string, value: unknown): this {
    this.track('lt', column, value)
    this.predicates.push((row) => String(row[column]) < String(value))
    return this
  }

  gt(column: string, value: unknown): this {
    this.track('gt', column, value)
    this.predicates.push((row) => String(row[column]) > String(value))
    return this
  }

  or(_expression: string): this {
    return this
  }

  order(column: string, opts?: { ascending?: boolean }): this {
    this.orderBy = { column, ascending: opts?.ascending !== false }
    return this
  }

  limit(count: number): this {
    this.limitCount = count
    return this
  }

  maybeSingle(): this {
    this.singleMode = 'maybeSingle'
    return this
  }

  private materialize(): QueryResult {
    const forcedError = this.options.errorsByTable?.[this.tableName]
    if (forcedError) {
      return { data: null, error: forcedError, count: null }
    }

    const table = this.options.tables[this.tableName] ?? []

    if (this.operation === 'insert' || this.operation === 'upsert') {
      const rows = (Array.isArray(this.insertPayload) ? this.insertPayload : [this.insertPayload ?? {}]).map((row) => ({
        id: `generated-${++generatedId}`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...row,
      }))
      table.push(...rows)
      this.options.tables[this.tableName] = table
      const data = this.singleMode ? (rows[0] ?? null) : rows
      return { data, error: null, count: null }
    }

    let rows = table.filter((row) => this.predicates.every((predicate) => predicate(row)))

    if (this.operation === 'update') {
      for (const row of rows) Object.assign(row, this.updatePayload ?? {})
      return { data: this.singleMode ? (rows[0] ?? null) : rows, error: null, count: null }
    }

    if (this.orderBy) {
      const { column, ascending } = this.orderBy
      rows = [...rows].sort((a, b) => {
        const left = String(a[column] ?? '')
        const right = String(b[column] ?? '')
        return ascending ? left.localeCompare(right) : right.localeCompare(left)
      })
    }
    if (this.limitCount !== null) rows = rows.slice(0, this.limitCount)

    if (this.countMode && this.headMode) {
      return { data: null, error: null, count: rows.length }
    }
    if (this.singleMode) {
      return { data: rows[0] ?? null, error: null, count: null }
    }
    return { data: rows, error: null, count: rows.length }
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.materialize()).then(onfulfilled, onrejected)
  }
}

export function createFakeSupabase(options: FakeSupabaseOptions) {
  const calls: FakeSupabaseCall[] = []
  return {
    calls,
    client: {
      from(table: string) {
        return new FakeQueryBuilder(table, options, calls)
      },
    },
  }
}
