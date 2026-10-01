import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveEffectiveBillingProfile } from '@/lib/billing/effectiveBillingProfile'
import { billingConfigurationSnapshotSha256 } from '@/lib/billing/billingConfigurationSnapshot'

type Row = Record<string, unknown>
const state = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>, requests: [] as Array<{ payload: unknown; key: string }>,
  purchases: [] as string[], networkFailures: 0, purchaseFailures: 0, captureFailure: false,
  persistedBeforeSend: [] as boolean[], config: {} as Row,
  locks: new Set<string>(), holdNetwork: false, providerEntered: null as (() => void) | null, releaseProvider: null as (() => void) | null,
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from(table: string) {
    if (!(table in state.tables)) throw new Error(`unexpected_fixture_table:${table}`)
    const predicates: Array<(row: Row) => boolean> = []
    let update: Row | null = null, insert: Row | null = null, single = false
    const chain = {
      select: () => chain, order: () => chain, range: () => chain, limit: () => chain,
      eq: (field: string, value: unknown) => { predicates.push(row => JSON.stringify(row[field]) === JSON.stringify(value)); return chain },
      in: (field: string, values: unknown[]) => { predicates.push(row => values.includes(row[field])); return chain },
      lte: (field: string, value: string) => { predicates.push(row => String(row[field]) <= value); return chain },
      maybeSingle: () => { single = true; return chain }, single: () => { single = true; return chain },
      update: (value: Row) => { update = structuredClone(value); return chain },
      insert: (value: Row) => { insert = structuredClone(value); return chain },
      then: (resolve: (value: unknown) => unknown) => {
        if (insert) state.tables[table].push(insert)
        const rows = state.tables[table].filter(row => predicates.every(predicate => predicate(row)))
        if (state.captureFailure && table === 'invoice_export_items' && update?.request_payload && update?.provider_request_id) {
          return Promise.resolve({ data: null, error: { message: 'synthetic_capture_unavailable' } }).then(resolve)
        }
        if (update) rows.forEach(row => Object.assign(row, update))
        return Promise.resolve({ data: structuredClone(single ? rows[0] ?? null : rows), error: null }).then(resolve)
      },
    }
    return chain
  },
} }))
vi.mock('@/lib/tenant/governance', () => ({ requireCompanyOperationalForWrites: async () => undefined }))
vi.mock('@/lib/platform/schemaReadiness', () => ({ assertPlatformSchemaReady: async () => undefined }))
vi.mock('@/lib/platform/outboundFreeze', () => ({ assertOutboundAllowed: async () => undefined }))
vi.mock('@/lib/automation/locks', () => ({ withAutomationLock: async ({ lockKey, run }: { lockKey: string; run: () => Promise<unknown> }) => {
  if (state.locks.has(lockKey)) throw new Error('automation_already_running')
  state.locks.add(lockKey)
  try { return await run() } finally { state.locks.delete(lockKey) }
} }))
vi.mock('@/lib/events/domainEvents', () => ({ emitDomainEvent: async () => undefined }))
vi.mock('@/lib/billing/invoiceReadiness', () => ({ lockBillingPeriodForInvoiceExport: async () => undefined }))
vi.mock('@/lib/integrations/billing/capway/auth', () => ({ resolveCapwayConnectionConfig: async () => structuredClone(state.config) }))
vi.mock('@/lib/integrations/billing/capway/client', () => ({
  CapwayApiError: class extends Error {},
  CapwayApticClient: class {
    async createInvoices(payloads: unknown[], key: string) {
      state.requests.push({ payload: structuredClone(payloads[0]), key })
      state.persistedBeforeSend.push(JSON.stringify(state.tables.invoice_export_items[0].request_payload) === JSON.stringify(payloads[0]))
      if (state.holdNetwork) {
        state.providerEntered?.()
        await new Promise<void>(resolve => { state.releaseProvider = resolve })
      }
      if (state.networkFailures-- > 0) throw new Error('network: synthetic uncertain response')
      return { invoiceGuids: ['synthetic-provider-invoice'], invoiceNumber: 'SYNTHETIC-1' }
    }
    async postPurchase(guid: string) {
      state.purchases.push(guid)
      if (state.purchaseFailures-- > 0) throw new Error('network: synthetic purchase failure')
      return { purchased: true }
    }
  },
}))
import { sendApprovedInvoiceExportRun } from '@/lib/billing/invoiceApprovedDispatch'
import { sendInvoiceExportRun } from '@/lib/integrations/billing/invoiceExportCore'

const companyId = 'synthetic-tenant', customerId = 'synthetic-customer', contractId = 'synthetic-contract'
const senders = [
  { name: 'approved invoice dispatch', send: () => sendApprovedInvoiceExportRun({ companyId, exportRunId: 'synthetic-run', actorUserId: 'synthetic-staff' }) },
  { name: 'canonical export and retry', send: () => sendInvoiceExportRun({ companyId, exportRunId: 'synthetic-run', actorUserId: 'synthetic-staff' }) },
]
function fixture(financingMode = 'invoice_service') {
  const customer = { id: customerId, company_id: companyId, customer_type: 'private', customer_number: 'SYNTHETIC-CUSTOMER',
    first_name: 'Original', last_name: 'Customer', phone: '+4600000000', billing_profile_revision: 4,
    billing_profile: { recipient: 'Original Receiver', distributionMethod: 'email', email: 'original@example.invalid', country: 'SE' } }
  const effective = resolveEffectiveBillingProfile({ companyId, customerId, customer,
    contract: { id: contractId, company_id: companyId, customer_id: customerId, billing_profile_override: {}, billing_profile_override_revision: 0 } })
  const snapshot = { schema: 'billing_configuration_v2', company_id: companyId, customer_id: customerId, contract_id: contractId, effective_billing_profile: effective }
  const approval = { status: 'approved', approved_by: 'synthetic-staff' }
  state.tables = {
    invoice_export_items: [{ id: 'synthetic-item', company_id: companyId, export_run_id: 'synthetic-run', customer_id: customerId,
      customer_contract_id: contractId, billing_underlay_id: 'synthetic-underlay', pricing_run_id: 'synthetic-price', provider: 'capway_aptic',
      environment: 'test', financing_mode: financingMode, status: 'pending', metadata: { approval }, request_payload: {}, response_payload: {},
      idempotency_key: 'synthetic-idempotency-key', provider_request_id: null, provider_idempotency_key: null, provider_invoice_guid: null,
      amount_ex_vat: 100, vat_amount: 25, amount_inc_vat: 125, total_kwh: 1, attempt_count: 0 }],
    invoice_export_runs: [{ id: 'synthetic-run', company_id: companyId, billing_month: '2026-09', environment: 'test', financing_mode: financingMode }],
    pricing_runs: [{ id: 'synthetic-price', company_id: companyId, billing_underlay_id: 'synthetic-underlay', status: 'locked', locked_at: '2026-09-01', total_ex_vat: 100, vat_amount: 25, total_inc_vat: 125 }],
    pricing_preview_lines: [{ id: 'synthetic-line', company_id: companyId, pricing_run_id: 'synthetic-price', description: 'Synthetic electricity', quantity: 1,
      amount_ex_vat: 100, amount_inc_vat: 125, vat_amount: 25, vat_rate: 0.25 }],
    customers: [customer],
    billing_underlays: [{ id: 'synthetic-underlay', company_id: companyId, customer_id: customerId, contract_id: contractId, customer_contract_id: contractId,
      underlay_year: 2026, underlay_month: 9, status: 'validated', readiness_status: 'ready', missing_values_count: 0, total_kwh: 1, price_area: 'SE3',
      billing_configuration_snapshot: snapshot, billing_configuration_snapshot_sha256: billingConfigurationSnapshotSha256(snapshot) }],
    companies: [{ id: companyId, name: 'Original Synthetic Issuer', org_number: '556000-0000' }],
    customer_invoices: [{ id: 'synthetic-invoice', company_id: companyId, invoice_export_item_id: 'synthetic-item', status: 'draft', total_kwh: 1,
      amount_inc_vat: 125, calculation_snapshot_sha256: 'synthetic-calculation-hash', metadata: { approval } }],
    billing_export_run_items: [{ id: 'synthetic-item', company_id: companyId }], billing_export_runs: [{ id: 'synthetic-run', company_id: companyId }],
    invoice_export_attempts: [], invoice_dead_letters: [], invoice_purchase_events: [], customer_operation_tasks: [],
  }
  state.config = { companyId, provider: 'capway_aptic', environment: 'test', baseUrl: 'https://example.invalid', authMode: 'apikey',
    defaultService: 'Synthetic Service', defaultFinancingMode: financingMode }
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-01T10:00:00Z'))
  state.requests = []; state.purchases = []; state.persistedBeforeSend = []
  state.networkFailures = 0; state.purchaseFailures = 0; state.captureFailure = false
  state.locks.clear(); state.holdNetwork = false; state.providerEntered = null; state.releaseProvider = null
  fixture()
})

it('simultaneous approved and canonical callers share one item lock before creating a provider invoice', async () => {
  const entered = new Promise<void>(resolve => { state.providerEntered = resolve })
  state.holdNetwork = true
  const first = senders[0].send()
  await entered
  state.holdNetwork = false
  try {
    await senders[1].send().catch(() => undefined)
    expect(state.requests).toHaveLength(1)
  } finally {
    state.releaseProvider?.()
    await first
  }
})
afterEach(() => vi.useRealTimers())

describe.each(senders)('$name preserves one durable provider request', ({ send }) => {
  it('commits the complete destination, dates and provider key before the first network attempt', async () => {
    await send()
    expect(state.persistedBeforeSend).toEqual([true])
    expect(state.tables.invoice_export_items[0].provider_request_id).toBe('synthetic-idempotency-key')
  })
  it('replays the original complete payload after an uncertain response and later live edits', async () => {
    state.networkFailures = 1
    await send()
    const original = structuredClone(state.requests[0])
    vi.setSystemTime(new Date('2026-09-03T11:00:00Z'))
    Object.assign(state.tables.customers[0], { first_name: 'Later', last_name: 'Legal Name', phone: '+4600000001' })
    state.tables.companies[0].name = 'Later Issuer'
    state.config.defaultService = 'Later Service'
    await send()
    expect(state.requests).toEqual([original, original])
    expect(state.tables.customer_invoices[0]).toMatchObject({ issued_at: '2026-09-01T10:00:00.000Z', due_date: '2026-09-21' })
  })
  it('retains a confirmed provider invoice across purchase failure and continues without another create', async () => {
    fixture('factoring_with_recourse'); state.purchaseFailures = 1
    await send()
    expect(state.tables.invoice_export_items[0].provider_invoice_guid).toBe('synthetic-provider-invoice')
    vi.setSystemTime(new Date('2026-09-04T11:00:00Z'))
    await send()
    expect(state.requests).toHaveLength(1)
    expect(state.purchases).toEqual(['synthetic-provider-invoice', 'synthetic-provider-invoice'])
    expect(state.tables.invoice_export_items[0].status).toBe('sent')
  })
  it('makes no provider call when durable request capture fails', async () => {
    state.captureFailure = true
    await send().catch(() => undefined)
    expect(state.requests).toEqual([])
  })
  it('blocks an earlier ambiguous attempt whose original request is missing', async () => {
    state.tables.invoice_export_items[0].attempt_count = 1
    state.tables.invoice_export_items[0].status = 'failed_retryable'
    await send().catch(() => undefined)
    expect(state.requests).toEqual([])
    expect(state.tables.invoice_export_items[0].request_payload).toEqual({})
  })
  it('does not replace a malformed historical request with live customer data', async () => {
    const historical = { schema: 'old-unqualified-request', recipient: 'historical@example.invalid' }
    state.tables.invoice_export_items[0].request_payload = historical
    state.tables.invoice_export_items[0].status = 'failed_retryable'
    await send().catch(() => undefined)
    expect(state.requests).toEqual([])
    expect(state.tables.invoice_export_items[0].request_payload).toEqual(historical)
  })
  it('rejects a wrong customer binding in an otherwise valid saved request', async () => {
    state.networkFailures = 1
    await send()
    const saved = state.tables.invoice_export_items[0].request_payload as { customer: { extraFields: Array<{ name: string; value: string[] }> } }
    saved.customer.extraFields.find(field => field.name === 'gridex_customer_id')!.value = ['another-customer']
    const before = structuredClone(saved)
    await send().catch(() => undefined)
    expect(state.requests).toHaveLength(1)
    expect(state.tables.invoice_export_items[0].request_payload).toEqual(before)
  })
  it('rejects saved financial amounts that differ from the reserved invoice', async () => {
    state.networkFailures = 1
    await send()
    const saved = state.tables.invoice_export_items[0].request_payload as { debts: Array<{ originalPrincipal: number }> }
    saved.debts[0].originalPrincipal = 999
    await send().catch(() => undefined)
    expect(state.requests).toHaveLength(1)
    expect(saved.debts[0].originalPrincipal).toBe(999)
  })
  it('T17 never silently redelivers an already sent invoice', async () => {
    state.tables.invoice_export_items[0].status = 'sent'
    await send().catch(() => undefined)
    expect(state.requests).toEqual([])
  })
})
