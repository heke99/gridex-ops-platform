import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  row: {} as Record<string, unknown>,
  writes: [] as Record<string, unknown>[],
  invoiceFails: false,
  observedStatus: 2,
}))

vi.mock('@/lib/admin/apiGuards', () => ({ requireAdminApiAccess: async () => ({ guard: { userId: 'synthetic-actor', companyId: 'synthetic-company' } }), requireAdminReadableCompany: async () => 'synthetic-company' }))
vi.mock('@/lib/tenant/scope', () => ({ requireOperationalCompanyId: async () => 'synthetic-company' }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from: () => {
    const query = {
      select: () => query, eq: () => query,
      single: async () => ({ data: structuredClone(state.row), error: null }),
      update: (patch: Record<string, unknown>) => { state.writes.push(patch); Object.assign(state.row, patch); return query },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve),
    }
    return query
  },
} }))
vi.mock('@/lib/integrations/billing/capway/client', () => ({ createCapwayApticClient: async () => ({
  getInvoice: async () => { if (state.invoiceFails) throw new Error('synthetic provider private outage detail'); return { status: state.observedStatus, financeStatus: 2 } },
  getFinancialDetails: async () => ({ synthetic: 'financial' }),
  getPurchase: async () => ({ synthetic: 'purchase' }),
  getRecourse: async () => ({ synthetic: 'recourse' }),
}) }))

import { GET } from '@/app/api/internal/invoices/[id]/provider-status/route'

function call() {
  return GET(new Request('http://localhost/api/internal/invoices/synthetic-item/provider-status'), { params: Promise.resolve({ id: 'synthetic-item' }) })
}

beforeEach(() => {
  state.row = { id: 'synthetic-item', company_id: 'synthetic-company', provider_invoice_guid: 'synthetic-guid', environment: 'test',
    provider_status: 'paid', purchase_status: 'purchased_without_recourse', status_payload: {
      last_provider_event_occurred_at: '2026-10-12T12:00:00.000Z', last_provider_state: 'paid', last_provider_event_id: 'synthetic-event',
    } }
  state.writes = []
  state.invoiceFails = false
  state.observedStatus = 2
})

describe('provider status polling preserves authoritative webhook state', () => {
  it('returns a structured retryable error and preserves paid state and event clock on invoice lookup failure', async () => {
    const before = structuredClone(state.row)
    state.invoiceFails = true
    const response = await call()
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.code).toBe('invoice_provider_status_unavailable')
    expect(body.trace_id).toEqual(expect.any(String))
    expect(JSON.stringify(body)).not.toContain('private outage detail')
    expect(state.writes).toEqual([])
    expect(state.row).toEqual(before)
  })
  it('returns successful stale unpaid diagnostics without downgrading paid or erasing its event clock', async () => {
    const before = structuredClone(state.row)
    const response = await call()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.invoiceStatus).toBe('unpaid')
    expect(body.data.financeStatus).toBe('purchased_without_recourse')
    expect(body.data.invoice.status).toBe('fulfilled')
    expect(state.writes).toEqual([])
    expect(state.row).toEqual(before)
  })
  it('does not overwrite a terminal credit with a paid provider observation', async () => {
    state.row.provider_status = 'credited'
    state.observedStatus = 1
    const before = structuredClone(state.row)
    const response = await call()
    expect(response.status).toBe(200)
    expect((await response.json()).data.invoiceStatus).toBe('paid')
    expect(state.row).toEqual(before)
    expect(state.writes).toEqual([])
  })
})
