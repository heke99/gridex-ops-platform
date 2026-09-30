import { beforeEach, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const boundary = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, creates: 0, purchases: [] as string[], periodLocks: 0 }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from(table: string) {
    if (!(table in boundary.tables)) throw new Error(`unexpected_fixture_table:${table}`)
    const predicates: Array<(row: Row) => boolean> = []
    let update: Row | null = null, insert: Row | null = null, single = false
    const query = {
      select: () => query, order: () => query, range: () => query,
      eq: (field: string, value: unknown) => { predicates.push(row => row[field] === value); return query },
      in: (field: string, values: unknown[]) => { predicates.push(row => values.includes(row[field])); return query },
      maybeSingle: () => { single = true; return query }, single: () => { single = true; return query },
      update: (value: Row) => { update = structuredClone(value); return query },
      insert: (value: Row) => { insert = structuredClone(value); return query },
      then: (resolve: (value: unknown) => unknown) => {
        if (insert) boundary.tables[table].push(insert)
        const rows = boundary.tables[table].filter(row => predicates.every(predicate => predicate(row)))
        if (update) rows.forEach(row => Object.assign(row, update))
        return Promise.resolve({ data: structuredClone(single ? rows[0] ?? null : rows), error: null }).then(resolve)
      },
    }
    return query
  },
} }))
vi.mock('@/lib/platform/schemaReadiness', () => ({ assertPlatformSchemaReady: async () => undefined }))
vi.mock('@/lib/platform/outboundFreeze', () => ({ assertOutboundAllowed: async () => undefined }))
vi.mock('@/lib/automation/locks', () => ({ withAutomationLock: async ({ run }: { run: () => Promise<unknown> }) => run() }))
vi.mock('@/lib/events/domainEvents', () => ({ emitDomainEvent: async () => undefined }))
vi.mock('@/lib/billing/invoiceReadiness', () => ({ lockBillingPeriodForInvoiceExport: async () => { boundary.periodLocks += 1 } }))
vi.mock('@/lib/integrations/billing/capway/auth', () => ({ resolveCapwayConnectionConfig: async () => ({
  companyId: 'tenant-a', environment: 'test', provider: 'capway_aptic', defaultFinancingMode: 'factoring_with_recourse',
}) }))
vi.mock('@/lib/integrations/billing/capway/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/integrations/billing/capway/client')>()
  return { ...actual, CapwayApticClient: class {
    async createInvoices() { boundary.creates += 1; throw new Error('unexpected_second_create') }
    async postPurchase(guid: string) {
      boundary.purchases.push(guid)
      throw new actual.CapwayApiError({ message: 'Synthetic purchase conflict requiring reconciliation', httpStatus: 409, kind: 'http' })
    }
  } }
})
import { sendInvoiceExportRun } from '@/lib/integrations/billing/invoiceExportCore'

beforeEach(() => {
  boundary.creates = 0; boundary.purchases = []; boundary.periodLocks = 0
  const payload = {
    invoiceDate: '2026-09-01T10:00:00Z', externalReferenceCode: 'pricing-a',
    customer: { email: 'original@example.invalid', extraFields: [{ name: 'gridex_customer_id', value: ['customer-a'] }] },
    debts: [{ originalPrincipal: 100, originalVat: 25, rounding: 0, invoiceDate: '2026-09-01T10:00:00Z', dueDate: '2026-09-21T10:00:00Z',
      extraFields: [{ name: 'gridex_billing_underlay_id', value: ['underlay-a'] }] }],
    extraFields: [{ name: 'gridex_company_id', value: ['tenant-a'] }, { name: 'gridex_pricing_run_id', value: ['pricing-a'] },
      { name: 'gridex_financing_mode', value: ['factoring_with_recourse'] }],
  }
  boundary.tables = {
    invoice_export_items: [{ id: 'item-a', company_id: 'tenant-a', export_run_id: 'run-a', customer_id: 'customer-a',
      customer_contract_id: 'contract-a', billing_underlay_id: 'underlay-a', pricing_run_id: 'pricing-a', provider: 'capway_aptic',
      environment: 'test', financing_mode: 'factoring_with_recourse', status: 'failed_retryable', attempt_count: 1,
      idempotency_key: 'original-provider-key', provider_request_id: 'original-provider-key', provider_idempotency_key: 'original-provider-key',
      provider_invoice_guid: 'accepted-original-guid', provider_invoice_id: 'accepted-original-guid',
      request_payload: payload, response_payload: { create_invoice: { invoiceGuids: ['accepted-original-guid'] } },
      amount_ex_vat: 100, vat_amount: 25, amount_inc_vat: 125 }],
    invoice_export_runs: [{ id: 'run-a', company_id: 'tenant-a', billing_month: '2026-09', environment: 'test', financing_mode: 'factoring_with_recourse' }],
    pricing_runs: [{ id: 'pricing-a', company_id: 'tenant-a' }], pricing_preview_lines: [],
    customers: [{ id: 'customer-a', company_id: 'tenant-a' }],
    billing_underlays: [{ id: 'underlay-a', company_id: 'tenant-a' }], companies: [{ id: 'tenant-a' }],
    customer_invoices: [{ id: 'invoice-a', company_id: 'tenant-a', invoice_export_item_id: 'item-a', status: 'draft' }],
    invoice_export_attempts: [], invoice_dead_letters: [], invoice_purchase_events: [],
  }
})

it('retains a purchase conflict for review without treating a confirmed create identity as completed purchase', async () => {
  const original = structuredClone(boundary.tables.invoice_export_items[0])
  const result = await sendInvoiceExportRun({ companyId: 'tenant-a', exportRunId: 'run-a', actorUserId: 'actor-a' })
  expect(boundary.creates).toBe(0)
  expect(boundary.purchases).toEqual(['accepted-original-guid'])
  expect(boundary.tables.invoice_export_items[0]).toMatchObject({ status: 'needs_review', error_code: 'provider_conflict',
    provider_invoice_guid: original.provider_invoice_guid, request_payload: original.request_payload })
  expect(boundary.tables.customer_invoices[0].status).not.toBe('sent')
  expect(boundary.tables.invoice_export_attempts[0]).toMatchObject({ outcome: 'needs_review', error_code: 'provider_conflict', http_status: 409 })
  expect(result).toMatchObject({ sent: 0, failed: 1 })
  expect(boundary.periodLocks).toBe(0)
})
