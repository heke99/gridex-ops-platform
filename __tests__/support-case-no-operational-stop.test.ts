import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Regression: a support case must never trigger the withdrawal/operational stops.
 * Before the fix every non-withdrawal case was assessed billingBlocked=true, so a customer's
 * support question (web, API event or OPS) cancelled info requests, metering permissions,
 * outbound requests and partner exports and blocked all billing underlays of the customer.
 */
type Row = Record<string, unknown>
const db: Record<string, Row[]> = {}
let idCounter = 0
const nextId = () => `00000000-0000-4000-8000-${String(++idCounter).padStart(12, '0')}`

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
  let mode: 'select' | 'insert' | 'update' = 'select'
  let pending: Row[] = []
  let patch: Row = {}
  let limit: number | null = null
  let ascending = true
  const api: Record<string, unknown> = {
    select: () => api,
    eq: (field: string, value: unknown) => { filters.push((row) => readPath(row, field) === value); return api },
    in: (field: string, values: unknown[]) => { filters.push((row) => values.includes(readPath(row, field))); return api },
    contains: (field: string, value: Row) => {
      filters.push((row) => Object.entries(value).every(([key, v]) => (row[field] as Row | null)?.[key] === v))
      return api
    },
    or: () => api,
    order: (_field: string, options?: { ascending?: boolean }) => { ascending = options?.ascending ?? true; return api },
    limit: (value: number) => { limit = value; return api },
    insert: (value: Row | Row[]) => {
      mode = 'insert'
      pending = (Array.isArray(value) ? value : [value]).map((row) => ({
        id: nextId(), created_at: new Date(Date.now() + idCounter).toISOString(), updated_at: new Date().toISOString(), metadata: {}, ...row,
      }))
      db[table] = [...(db[table] ?? []), ...pending]
      return api
    },
    update: (value: Row) => { mode = 'update'; patch = value; return api },
    rows(): Row[] {
      if (mode === 'insert') return pending
      const matched = (db[table] ?? []).filter((row) => filters.every((filter) => filter(row)))
      if (mode === 'update') { matched.forEach((row) => Object.assign(row, patch)); return matched }
      const sorted = [...matched].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) * (ascending ? 1 : -1))
      return limit === null ? sorted : sorted.slice(0, limit)
    },
    single: async () => ({ data: (api.rows as () => Row[])()[0] ?? null, error: null }),
    maybeSingle: async () => ({ data: (api.rows as () => Row[])()[0] ?? null, error: null }),
    then: (resolve: (value: unknown) => unknown) => resolve({ data: (api.rows as () => Row[])(), error: null }),
  }
  return api
}

vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: (table: string) => builder(table) } }))
vi.mock('@/lib/customer-portal/keysetPagination', () => ({
  portalPageLimit: (value?: number | null) => Math.min(Math.max(Math.trunc(value ?? 50), 1), 100),
  decodePortalCursor: () => null,
  buildPortalDatabasePage: (rows: Row[], input: { limit: number }) => ({
    items: rows.slice(0, input.limit),
    page: { limit: input.limit, offset: 0, returned: Math.min(rows.length, input.limit), has_more: rows.length > input.limit, next_cursor: null },
  }),
}))


const TENANT_A = '0000000a-0000-4000-8000-000000000000'
const CUSTOMER_A1 = '000000a1-0000-4000-8000-000000000000'

beforeEach(() => {
  for (const key of Object.keys(db)) delete db[key]
  db.customers = [{ id: CUSTOMER_A1, company_id: TENANT_A }]
  db.customer_cases = []
  db.customer_case_events = []
  db.billing_underlays = [{ id: 'u1', company_id: TENANT_A, customer_id: CUSTOMER_A1, readiness_status: 'ready' }]
  db.customer_info_requests = [{ id: 'i1', company_id: TENANT_A, customer_id: CUSTOMER_A1, status: 'open' }]
  db.metering_permissions = [{ id: 'm1', company_id: TENANT_A, customer_id: CUSTOMER_A1, status: 'active' }]
  db.outbound_requests = [{ id: 'o1', company_id: TENANT_A, customer_id: CUSTOMER_A1, status: 'queued' }]
  db.partner_exports = [{ id: 'p1', company_id: TENANT_A, customer_id: CUSTOMER_A1, status: 'ready' }]
})

describe('support cases have no operational side effects', () => {
  for (const channel of ['customer_portal', 'api', 'admin', 'phone'] as const) {
    it(`a ${channel} support case leaves billing, onboarding and outbound untouched`, async () => {
      const { createTenantSupportCase } = await import('@/lib/customer-cases/support')
      const created = await createTenantSupportCase({
        companyId: TENANT_A, customerId: CUSTOMER_A1, title: 'Var är min faktura?', channel, idempotencyKey: `k-${channel}`,
      })
      expect(created.case.billing_blocked).toBe(false)
      expect(created.case.status).toBe('open')
      expect(db.billing_underlays[0].readiness_status).toBe('ready')
      expect(db.billing_underlays[0].billing_blocked_by_case_id).toBeUndefined()
      expect(db.customer_info_requests[0].status).toBe('open')
      expect(db.metering_permissions[0].status).toBe('active')
      expect(db.outbound_requests[0].status).toBe('queued')
      expect(db.partner_exports[0].status).toBe('ready')
      expect(db.customer_case_events.some((row) => row.event_type === 'operational_stop_applied')).toBe(false)
    })
  }
})

describe('support case idempotency under concurrency (F9)', () => {
  it('a unique-index conflict replays the winning case instead of failing or duplicating', async () => {
    const { createTenantSupportCase } = await import('@/lib/customer-cases/support')
    const caseDb = await import('@/lib/customer-cases/db')
    // The concurrent winner commits between our pre-check and our insert.
    const spy = vi.spyOn(caseDb, 'createCustomerCase').mockImplementationOnce(async () => {
      db.customer_cases.push({ id: 'winner-case', company_id: TENANT_A, customer_id: CUSTOMER_A1, status: 'open', billing_blocked: false,
        metadata: { support_case: true, support_idempotency_key: 'race-key' }, created_at: new Date().toISOString() })
      throw Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' })
    })
    const result = await createTenantSupportCase({ companyId: TENANT_A, customerId: CUSTOMER_A1, title: 'Fråga', channel: 'api', idempotencyKey: 'race-key' })
    spy.mockRestore()
    expect(result).toMatchObject({ reused: true, case: { id: 'winner-case' } })
    expect(db.customer_cases).toHaveLength(1)
  })

  it('the migration enforces one case per company, customer and key and keeps duplicates', async () => {
    const { readFileSync } = await import('node:fs')
    const sql = readFileSync('supabase/migrations/20261001200000_support_case_idempotency_unique.sql', 'utf8')
    expect(sql).toContain("on public.customer_cases (company_id, customer_id, (metadata->>'support_idempotency_key'))")
    expect(sql).toContain("where metadata->>'support_idempotency_key' is not null")
    expect(sql).not.toMatch(/\bdelete\b/i)
  })
})
