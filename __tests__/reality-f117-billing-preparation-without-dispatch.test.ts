// reality-defects: F117
// Owner decision 24 (2026-10-24) "Separera förberedelse och utskick": the monthly billing cron prepares underlays,
// pricing and draft invoices for review when a provider is selected and billing automation is on; it does not need
// dispatch (invoice_export_enabled, which requires a tested provider connection). Dispatch keeps its own gate. Billing
// automation is turned on by the tenant's admin under Fakturering → Integrationer (setTenantBillingAutomationEnabled),
// which never enables dispatch. The real cron, registry and month approval code run; only the database transport and
// the independently tested preparation steps are finite ports. Synthetic data only.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({
  companies: [] as Row[], runs: [] as Row[], audit: [] as Row[], exportRuns: [] as Row[], prepared: [] as Row[],
  auditFails: false, updates: [] as Row[],
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/ediel/retention/financeCopyRetention', () => ({ requireInvoiceSourceCopiesAvailable: vi.fn() }))
vi.mock('@/lib/platform/schemaReadiness', () => ({ assertPlatformSchemaReady: async () => undefined }))
vi.mock('@/lib/billing/invoiceReadiness', () => ({ getBillingPeriodLock: async () => null, lockBillingPeriodForInvoiceExport: vi.fn() }))
vi.mock('@/lib/metering/monthlyAutopilot', () => ({ runMeteringMarketDataAutopilot: async () => ({ review: 0, stopped: 0, requested: 0 }) }))
vi.mock('@/lib/billing/underlayEngine', () => ({ generateBillingUnderlaysForMonth: async () => ({ created: 1 }) }))
vi.mock('@/lib/billing/supplyEndRegate', () => ({ regateSupplyEndValues: async () => ({ candidates: 0, evaluated: 0, billable: 0, failed: 0, errors: [] }) }))
vi.mock('@/lib/billing/invoiceReviewPrepare', () => ({
  prepareInvoiceDraftsForReview: async (input: Row) => { io.prepared.push(input); return { underlays: 1, created: 1, blocked: 0, failed: 0 } },
}))
vi.mock('@/lib/automation/locks', async () => {
  const actual = await vi.importActual<typeof import('@/lib/automation/locks')>('@/lib/automation/locks')
  return { ...actual, withAutomationLock: async (input: { lockKey: string; run: (lock: { lockKey: string; lockToken: string }) => Promise<unknown> }) =>
    input.run({ lockKey: input.lockKey, lockToken: '00000000-0000-4000-8000-0000000000aa' }) }
})
vi.mock('@/lib/tenant/governance', () => ({ requireCompanyOperationalForWrites: async () => undefined }))
vi.mock('@/lib/supabase/tenantDb', () => ({
  tenantDb: (companyId: string) => ({ unscoped: () => ({ from: (table: string) => {
    if (table !== 'companies') throw Error(`unexpected tenantDb table ${table}`)
    return { select: () => ({ eq: (_key: string, id: string) => ({ maybeSingle: async () => ({ data: id === companyId ? structuredClone(io.companies.find(row => row.id === id) ?? null) : null, error: null }) }) }) }
  } }) }),
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: (table: string) => {
  const filters: Array<[string, unknown]> = []
  let op: 'select' | 'insert' | 'update' = 'select', payload: Row = {}, neq: [string, unknown] | null = null
  const rowsOf = () => (table === 'companies' ? io.companies : table === 'billing_automation_runs' ? io.runs : table === 'invoice_export_runs' ? io.exportRuns : table === 'audit_logs' ? io.audit : [])
  const matches = (row: Row) => filters.every(([k, v]) => row[k] === v) && (!neq || row[neq[0]] !== neq[1])
  const run = () => {
    if (op === 'insert') {
      if (table === 'audit_logs' && io.auditFails) return { data: null, error: { message: 'audit write refused' } }
      const row = { id: `${table}-${rowsOf().length + 1}`, ...payload }; rowsOf().push(row); return { data: row, error: null }
    }
    const rows = rowsOf().filter(matches)
    if (op === 'update') { rows.forEach(r => Object.assign(r, payload)); io.updates.push({ table, payload, filters: [...filters] }) }
    return { data: structuredClone(rows), error: null }
  }
  const query: Record<string, unknown> = {}
  query.select = () => query
  query.eq = (k: string, v: unknown) => { filters.push([k, v]); return query }
  query.neq = (k: string, v: unknown) => { neq = [k, v]; return query }
  query.in = () => query
  query.order = () => query
  query.range = () => query
  query.insert = (row: Row) => { op = 'insert'; payload = row; return query }
  query.update = (row: Row) => { op = 'update'; payload = row; return query }
  query.single = async () => { const r = run(); return { data: Array.isArray(r.data) ? r.data[0] : r.data, error: r.error } }
  query.maybeSingle = async () => { const r = run(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error } }
  query.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject)
  return query
} } }))

import { runMonthlyBillingAutomation } from '@/lib/billing/monthlyAutomation'
import { InvoiceProviderConfigError, setTenantBillingAutomationEnabled } from '@/lib/billing/providers/registry'
import { approveAndSendReadyInvoicesForMonth } from '@/lib/billing/invoiceApprovedDispatch'

const CO = '11111111-1111-4111-8111-111111111111'
const ACTOR = '22222222-2222-4222-8222-222222222222'
const company = (overrides: Row = {}) => ({ id: CO, status: 'active', is_active: true, billing_automation_enabled: true, invoice_export_enabled: false,
  invoice_export_target_system: 'nordfin', billing_provider_environment: 'test', ...overrides })

beforeEach(() => {
  process.env.GRIDEX_AUTOMATION_USER_ID = '7f1c2a9e-4b3d-4c1e-9a2b-5d6e7f8a9b0c'
  io.companies = []; io.runs = []; io.audit = []; io.exportRuns = []; io.prepared = []; io.auditFails = false; io.updates = []
})

describe('F117 the monthly cron prepares invoices for review without dispatch', () => {
  it('prepares a tenant with a provider and billing automation while dispatch is off (no tested connection)', async () => {
    io.companies = [company()]
    const result = await runMonthlyBillingAutomation({ companyId: CO, billingMonth: '2026-09' })
    expect(result.results.map(row => [row.status, row.error ?? null])).toEqual([['completed', null]])
    expect(io.prepared).toEqual([expect.objectContaining({ companyId: CO, billingMonth: '2026-09', provider: 'nordfin', environment: 'test' })])
    // The run is prepare-only and approval-required; it never requests or confirms an export.
    expect(io.runs[0]).toMatchObject({ status: 'completed', export_requested: false, export_confirmed: false, metadata: { approval_required: true } })
    // Preparation never turns dispatch on.
    expect(io.companies[0].invoice_export_enabled).toBe(false)
  })

  it('does not prepare when billing automation is off, whatever dispatch says', async () => {
    io.companies = [company({ billing_automation_enabled: false, invoice_export_enabled: true })]
    const result = await runMonthlyBillingAutomation({ companyId: CO, billingMonth: '2026-09' })
    expect(result.results[0]).toMatchObject({ status: 'failed', error: 'Faktureringsautomation är inte aktiverad för tenant.' })
    expect(io.prepared).toEqual([])
  })

  it('does not prepare without a selected provider (F115 definition)', async () => {
    io.companies = [company({ invoice_export_target_system: null })]
    const result = await runMonthlyBillingAutomation({ companyId: CO, billingMonth: '2026-09' })
    expect(result.results[0].status).toBe('failed')
    expect(result.results[0].error).toContain('Ingen fakturaleverantör är vald')
    expect(io.prepared).toEqual([])
  })
})

describe('F117 the tenant admin turns billing automation on; dispatch keeps its own gate', () => {
  it('turning it on needs a selected provider and writes an audit row; dispatch is untouched', async () => {
    io.companies = [company({ billing_automation_enabled: false, invoice_export_enabled: false })]
    await expect(setTenantBillingAutomationEnabled({ companyId: CO, enabled: true, actorUserId: ACTOR })).resolves.toEqual({ enabled: true, changed: true })
    expect(io.companies[0]).toMatchObject({ billing_automation_enabled: true, invoice_export_enabled: false })
    expect(io.updates.every(update => !('invoice_export_enabled' in (update.payload as Row)))).toBe(true)
    // Compare-and-set on the tenant's own row.
    expect(io.updates[0].filters).toEqual([['id', CO], ['billing_automation_enabled', false]])
    expect(io.audit).toEqual([expect.objectContaining({ company_id: CO, actor_user_id: ACTOR, entity_type: 'company', entity_id: CO, action: 'billing_automation_enabled',
      old_values: { billing_automation_enabled: false }, new_values: { billing_automation_enabled: true } })])
  })

  it('refuses to turn it on without a provider, and changes nothing', async () => {
    io.companies = [company({ billing_automation_enabled: false, invoice_export_target_system: null })]
    const error = await setTenantBillingAutomationEnabled({ companyId: CO, enabled: true, actorUserId: ACTOR }).catch(e => e)
    expect(error).toBeInstanceOf(InvoiceProviderConfigError)
    expect(error.code).toBe('invoice_provider_not_selected')
    expect(io.companies[0].billing_automation_enabled).toBe(false)
    expect(io.audit).toEqual([])
  })

  it('a refused audit write reverts the change (fail-closed)', async () => {
    io.companies = [company({ billing_automation_enabled: false })]
    io.auditFails = true
    await expect(setTenantBillingAutomationEnabled({ companyId: CO, enabled: true, actorUserId: ACTOR })).rejects.toMatchObject({ message: 'audit write refused' })
    expect(io.companies[0].billing_automation_enabled).toBe(false)
  })

  it('only the tenant\'s own row is read and written', async () => {
    io.companies = [company({ billing_automation_enabled: false }), company({ id: '33333333-3333-4333-8333-333333333333', billing_automation_enabled: false })]
    await setTenantBillingAutomationEnabled({ companyId: CO, enabled: true, actorUserId: ACTOR })
    expect(io.companies.map(row => [row.id, row.billing_automation_enabled])).toEqual([[CO, true], ['33333333-3333-4333-8333-333333333333', false]])
  })

  it('month approval approves only (never sends) while dispatch is off, and sends once dispatch is on', async () => {
    io.companies = [company({ invoice_export_target_system: 'capway_aptic', invoice_export_enabled: false })]
    expect(await approveAndSendReadyInvoicesForMonth({ companyId: CO, billingMonth: '2026-09', actorUserId: ACTOR })).toMatchObject({ approveOnly: true, dispatchEnabled: false, sent: 0 })
    io.companies[0].invoice_export_enabled = true
    expect(await approveAndSendReadyInvoicesForMonth({ companyId: CO, billingMonth: '2026-09', actorUserId: ACTOR })).toMatchObject({ approveOnly: false, dispatchEnabled: true })
    // A file provider is approve-only either way; its file is gated by dispatch in the database (gridex_create_invoice_export_file_v1).
    io.companies[0].invoice_export_target_system = 'nordfin'
    expect(await approveAndSendReadyInvoicesForMonth({ companyId: CO, billingMonth: '2026-09', actorUserId: ACTOR })).toMatchObject({ approveOnly: true, dispatchEnabled: true })
  })
})
