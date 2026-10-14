import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const m = vi.hoisted(() => ({ receipts: [] as Row[], completionCount: 0, applied: vi.fn(), status: 'updated' }))
const COMPANY = '00000000-0000-4000-8000-000000000001'
const CUSTOMER = '00000000-0000-4000-8000-000000000002'
const SITE = '00000000-0000-4000-8000-000000000003'
function query(table: string) {
  let mode = 'select'
  let pending: Row | null = null
  let error: unknown = null
  const filters: Array<(row: Row) => boolean> = []
  const run = async () => {
    if (table === 'customer_sites') return { data: { id: SITE, facility_reference: 'facility-synthetic' }, error: null }
    if (table === 'customer_portal_completions') { m.completionCount++; return { data: { id: 'completion-internal', completion_reference: 'completion_synthetic', status: pending?.status, created_at: '2026-10-12T12:00:00Z' }, error: null } }
    const hit = m.receipts.find((row) => filters.every((match) => match(row))) ?? null
    if (mode === 'update' && hit) Object.assign(hit, pending)
    return { data: mode === 'insert' ? pending : hit, error }
  }
  const b = {
    select: () => b,
    eq: (field: string, value: unknown) => { filters.push((row) => row[field] === value); return b },
    is: (field: string, value: unknown) => { filters.push((row) => row[field] === value); return b },
    insert: (value: Row) => {
      mode = 'insert'; pending = { id: 'receipt-synthetic', ...value }
      if (table === 'customer_portal_write_idempotency') {
        if (m.receipts.some((row) => row.idempotency_key === value.idempotency_key)) { error = { code: '23505' }; pending = null }
        else m.receipts.push(pending)
      }
      return b
    },
    update: (value: Row) => { mode = 'update'; pending = value; return b },
    maybeSingle: run,
    single: run,
    then: (resolve: (value: unknown) => unknown) => run().then(resolve),
  }
  return b
}
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: query } }))
vi.mock('@/lib/customer-sites/addressIntake', () => ({ applyCustomerSiteAddressCandidate: m.applied }))
vi.mock('@/lib/customer-operations/automation', () => ({ enqueueCustomerDataRequestAutomation: vi.fn() }))
vi.mock('@/lib/customer-portal/db', () => ({ createPortalCompletionCase: vi.fn() }))
vi.mock('@/lib/integrations/apiAuth', async (original) => ({ ...await original<typeof import('@/lib/integrations/apiAuth')>(), logIntegrationApiRequest: vi.fn(), currentIntegrationApiResponseContext: () => null }))
vi.mock('@/lib/customer-portal/externalApi', async (original) => ({
  ...await original<typeof import('@/lib/customer-portal/externalApi')>(),
  requireCustomerPortalApiContext: async () => ({ ok: true, client: { id: 'synthetic-client', company_id: COMPANY, scopes: ['customer_facility_data.write'] }, identity: { id: 'synthetic-identity', customer_id: CUSTOMER }, startedAt: Date.now() }),
  logCustomerPortalSuccess: vi.fn(),
}))
beforeEach(() => {
  m.receipts = []; m.completionCount = 0; m.applied.mockReset()
})
describe('profile-update public address response and durable replay', () => {
  it.each(['updated', 'unchanged', 'conflict', 'incomplete'])('projects %s with an actual UUID site id before saving the replay receipt', async (status) => {
    m.applied.mockResolvedValue({ status, siteId: SITE, addressHash: 'synthetic-hash', normalized: { street: 'Synthetic 1', postalCode: '12345', city: 'Synthetic', country: 'SE' }, ...(status === 'conflict' ? { reason: 'verified_address_conflict' } : status === 'incomplete' ? { reason: 'missing_site_address_fields' } : {}) })
    const { POST } = await import('@/app/api/v1/customer/profile-update/route')
    const request = () => new NextRequest('https://synthetic.example/api/v1/customer/profile-update', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'synthetic-profile-address-001' }, body: JSON.stringify({ facility_data: { facility_reference: 'facility-synthetic', address: { street: 'Synthetic 1', postal_code: '12345', city: 'Synthetic' } } }) })
    const first = await POST(request())
    expect(first.status).toBe(200)
    const firstBody = await first.json()
    expect(firstBody.data.address_result).toMatchObject({ status, address_hash: 'synthetic-hash' })
    expect(firstBody.data.status).toBe(['updated', 'unchanged'].includes(status) ? 'accepted' : 'submitted')
    expect(JSON.stringify(firstBody)).not.toContain(SITE)
    expect(firstBody.data.address_result).not.toHaveProperty('siteId')
    const replay = await POST(request())
    expect(replay.status).toBe(200)
    expect((await replay.json()).data).toEqual(firstBody.data)
    expect(m.applied).toHaveBeenCalledTimes(1)
    expect(m.completionCount).toBe(1)
    expect(m.receipts[0].status).toBe('completed')
    expect(JSON.stringify(m.receipts[0].response_body)).not.toContain(SITE)
  })
})
