// reality-defects: G-5
// The monthly billing cron prepared all companies in one loop without
// isolating them: one company without an invoice provider (verified live: HTTP
// 500 invoice_provider_not_selected) or an orphaned `running` run row from a
// killed function (unique running-per-month index) stopped every later company
// for the rest of the month.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({ companies: [] as Row[], runs: [] as Row[], lockHeld: new Set<string>(), prepared: [] as string[], underlayError: null as unknown }))

vi.mock('@/lib/platform/schemaReadiness', () => ({ assertPlatformSchemaReady: async () => undefined }))
vi.mock('@/lib/billing/invoiceReadiness', () => ({ getBillingPeriodLock: async () => null }))
vi.mock('@/lib/metering/monthlyAutopilot', () => ({ runMeteringMarketDataAutopilot: async () => ({ review: 0, stopped: 0, requested: 0 }) }))
vi.mock('@/lib/billing/underlayEngine', () => ({ generateBillingUnderlaysForMonth: async () => { if (io.underlayError) throw io.underlayError; return { created: 0 } } }))
// J2-02: the correction step of the run is not under test here (no corrections).
vi.mock('@/lib/billing/meteringCorrection', () => ({ recordMeteringCorrectionsAfterBilling: async (input: { billingMonth: string }) => ({ billingMonth: input.billingMonth, originals: 0, truncated: false, results: [], error: null }) }))
vi.mock('@/lib/billing/supplyEndRegate', () => ({ regateSupplyEndValues: async () => ({ candidates: 0, evaluated: 0, billable: 0, failed: 0, errors: [] }) }))
vi.mock('@/lib/billing/invoiceReviewPrepare', () => ({ prepareInvoiceDraftsForReview: async (input: { companyId: string }) => { io.prepared.push(input.companyId); return { underlays: 1, created: 1, blocked: 0, failed: 0 } } }))
vi.mock('@/lib/automation/locks', async () => {
  const actual = await vi.importActual<typeof import('@/lib/automation/locks')>('@/lib/automation/locks')
  return { ...actual, withAutomationLock: async (input: { lockKey: string; run: (lock: { lockKey: string; lockToken: string }) => Promise<unknown> }) => {
    if (io.lockHeld.has(input.lockKey)) throw new actual.AutomationAlreadyRunningError(input.lockKey)
    return input.run({ lockKey: input.lockKey, lockToken: '00000000-0000-4000-8000-0000000000aa' })
  } }
})
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: (table: string) => {
  const filters: Array<[string, unknown]> = []
  let op: 'select' | 'insert' | 'update' = 'select', payload: Row = {}, neq: [string, unknown] | null = null
  const rowsOf = () => (table === 'companies' ? io.companies : io.runs)
  const matches = (row: Row) => filters.every(([k, v]) => row[k] === v) && (!neq || row[neq[0]] !== neq[1])
  const run = () => {
    if (op === 'insert') {
      if (io.runs.some(r => r.company_id === payload.company_id && r.period_month === payload.period_month && r.status === 'running')) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "billing_automation_one_running_period_uidx"' } }
      const row = { id: `run-${io.runs.length + 1}`, ...payload }; io.runs.push(row); return { data: row, error: null }
    }
    const rows = rowsOf().filter(matches)
    if (op === 'update') rows.forEach(r => Object.assign(r, payload))
    return { data: rows, error: null }
  }
  const query: Record<string, unknown> = {}
  query.select = () => query
  query.eq = (k: string, v: unknown) => { filters.push([k, v]); return query }
  query.neq = (k: string, v: unknown) => { neq = [k, v]; return query }
  query.order = () => query
  query.range = () => query
  query.insert = (row: Row) => { op = 'insert'; payload = row; return query }
  query.update = (row: Row) => { op = 'update'; payload = row; return query }
  query.single = async () => { const r = run(); return { data: Array.isArray(r.data) ? r.data[0] : r.data, error: r.error } }
  query.maybeSingle = async () => { const r = run(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error } }
  query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(run()).then(resolve)
  return query
} } }))

import { runMonthlyBillingAutomation } from '@/lib/billing/monthlyAutomation'

const company = (id: string, provider: string | null) => ({ id, status: 'active', is_active: true, billing_automation_enabled: true, invoice_export_enabled: true, invoice_export_target_system: provider, billing_provider_environment: 'test' })

beforeEach(() => {
  process.env.GRIDEX_AUTOMATION_USER_ID = '7f1c2a9e-4b3d-4c1e-9a2b-5d6e7f8a9b0c'
  io.companies = []; io.runs = []; io.lockHeld = new Set(); io.prepared = []; io.underlayError = null
})

describe('monthly billing cron company isolation', () => {
  it('records a misconfigured company as failed and still prepares the next one', async () => {
    io.companies = [company('co-a', null), company('co-b', 'nordfin')]
    const result = await runMonthlyBillingAutomation({ billingMonth: '2026-08' })
    expect(result.results.map(r => [r.companyId, r.status])).toEqual([['co-a', 'failed'], ['co-b', 'completed']])
    expect(result.results[0].error).toContain('fakturaleverantör')
    expect(io.prepared).toEqual(['co-b'])
  })

  it('G-5: a PostgREST error object (not an Error) keeps its message and code on the failed run', async () => {
    io.companies = [company('co-a', 'nordfin')]
    io.underlayError = { code: '57014', message: 'canceling statement due to statement timeout', details: null, hint: null }
    const result = await runMonthlyBillingAutomation({ billingMonth: '2026-10' })
    expect(result.results[0]).toMatchObject({ status: 'failed', error: 'canceling statement due to statement timeout · kod: 57014' })
    expect(io.runs[0]).toMatchObject({ status: 'failed', failure_reason: 'canceling statement due to statement timeout · kod: 57014' })
  })

  it('closes a run row orphaned by a killed function instead of failing for the rest of the month', async () => {
    io.companies = [company('co-a', 'nordfin'), company('co-b', 'nordfin')]
    io.runs = [{ id: 'run-orphan', company_id: 'co-a', period_month: '2026-08', status: 'running', lock_token: '00000000-0000-4000-8000-0000000000ff' }]
    const result = await runMonthlyBillingAutomation({ billingMonth: '2026-08' })
    expect(result.results.map(r => r.status)).toEqual(['completed', 'completed'])
    expect(io.runs.find(r => r.id === 'run-orphan')).toMatchObject({ status: 'failed', failure_reason: 'stale_run_recovered' })
    expect(io.prepared).toEqual(['co-a', 'co-b'])
  })

  it('skips a company whose lock is still held by a live run without stopping the others', async () => {
    io.companies = [company('co-a', 'nordfin'), company('co-b', 'nordfin')]
    io.lockHeld.add('billing-monthly-prepare:co-a:2026-08')
    const result = await runMonthlyBillingAutomation({ billingMonth: '2026-08' })
    expect(result.results.map(r => [r.companyId, r.status])).toEqual([['co-a', 'failed'], ['co-b', 'completed']])
    expect(io.prepared).toEqual(['co-b'])
  })
})
