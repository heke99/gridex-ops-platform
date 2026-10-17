/* eslint-disable @typescript-eslint/no-explicit-any -- stateful PostgREST test port */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { minimalPdf } from './helpers/minimalPdf'

const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  ledger: null as Record<string, unknown> | null,
  uploads: 0,
  removals: 0,
}))
vi.mock('@/lib/integrations/apiAuth', () => ({
  requireIntegrationApiAccess: vi.fn(async () => ({ ok: true, client: { id: 'client_synthetic', company_id: 'company_synthetic' } })),
  logIntegrationApiRequest: vi.fn(async () => {}),
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from(table: string) {
    const filters: Array<[string, unknown]> = []
    let inserted: Record<string, unknown> | null = null
    let patch: Record<string, unknown> | null = null
    const matches = (row: Record<string, unknown>) => filters.every(([key, value]) => row[key] === value)
    const q: any = {
      select: () => q,
      eq: (key: string, value: unknown) => { filters.push([key, value]); return q },
      is: (key: string, value: unknown) => { filters.push([key, value]); return q },
      insert: (value: Record<string, unknown>) => { inserted = value; return q },
      update: (value: Record<string, unknown>) => { patch = value; return q },
      single: () => q.maybeSingle(),
      async maybeSingle() {
        if (table === 'customers') return { data: { id: 'customer_synthetic', company_id: 'company_synthetic', customer_reference: 'customer_public', customer_type: 'private', first_name: 'Synthetic', last_name: 'Person', identity_number: '199001011234' }, error: null }
        if (table === 'customer_sites') {
          const reference = filters.find(([key]) => key === 'facility_reference')?.[1]
          return { data: { id: `internal:${reference}`, company_id: 'company_synthetic', customer_id: 'customer_synthetic', facility_reference: reference }, error: null }
        }
        if (table === 'powers_of_attorney') {
          if (inserted) {
            const row = { ...inserted, power_of_attorney_reference: `poa_public_${state.rows.length + 1}` }
            state.rows.push(row)
            return { data: { power_of_attorney_reference: row.power_of_attorney_reference }, error: null }
          }
          return { data: state.rows.find(matches) ?? null, error: null }
        }
        if (table === 'customer_portal_write_idempotency') {
          if (inserted) {
            if (state.ledger) return { data: null, error: { code: '23505' } }
            state.ledger = { ...inserted, id: 'ledger_synthetic' }
            return { data: state.ledger, error: null }
          }
          if (patch && state.ledger && matches(state.ledger)) Object.assign(state.ledger, patch)
          return { data: state.ledger && matches(state.ledger) ? state.ledger : null, error: null }
        }
        throw new Error(`Unexpected table: ${table}`)
      },
      then: (resolve: (result: unknown) => unknown) => resolve({ data: null, error: null }),
    }
    return q
  },
  storage: { from: () => ({
    upload: async () => { state.uploads += 1; return { error: null } },
    remove: async () => { state.removals += 1; return { error: null } },
  }) },
} }))
import { handleSimplePartnerApi } from '@/lib/partner-api/simple'

beforeEach(() => { state.rows = []; state.ledger = null; state.uploads = 0; state.removals = 0 })
function createPoa(siteReference: string, content = minimalPdf().toString('base64')) {
  const path = ['customer', 'customer_public', 'site', siteReference, 'powerofattorney']
  return handleSimplePartnerApi(new NextRequest(`https://example.invalid/api/partner/v1/${path.join('/')}`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'synthetic-poa-key-0001' },
    body: JSON.stringify({ poa_type: 'WEB', transaction_type: 'SWITCH', file_base64: content, file_extension: 'pdf' }),
  }), 'POST', path)
}
describe('Partner POA replay owns the requested site', () => {
  it('rejects reuse on a different valid site of the same customer before another upload or write', async () => {
    expect((await createPoa('site_A'))!.status).toBe(201)
    const changed = (await createPoa('site_B'))!
    expect(changed.status).toBe(409)
    expect((await changed.json()).error.code).toBe('idempotency_conflict')
    expect(state.rows).toHaveLength(1)
    expect(state.rows[0].customer_site_id).toBe('internal:site_A')
    expect(state.uploads).toBe(1)
    expect(state.removals).toBe(0)
  })
  it('preserves the historical body-only ledger hash and replays the same-site result', async () => {
    const first = (await createPoa('site_A'))!
    const initialBody = await first.json()
    const initialHash = state.ledger!.request_hash
    expect(state.ledger!.route).toBe('/api/partner/v1/customer/{customer_id}/site/{site_id}/powerofattorney')
    const second = (await createPoa('site_A'))!
    expect(second.status).toBe(201)
    expect(await second.json()).toEqual(initialBody)
    expect(state.ledger!.request_hash).toBe(initialHash)
    expect(state.rows).toHaveLength(1)
    expect(state.uploads).toBe(1)
    expect(state.removals).toBe(0)
  })
  it.each(['company_id', 'customer_id', 'customer_site_id'])('rejects a cached entity whose %s ownership differs', async (column) => {
    expect((await createPoa('site_A'))!.status).toBe(201)
    state.rows[0][column] = 'other_synthetic'
    const replay = (await createPoa('site_A'))!
    expect(replay.status).toBe(409)
    expect((await replay.json()).error.code).toBe('idempotency_conflict')
    expect(state.uploads).toBe(1)
    expect(state.rows).toHaveLength(1)
  })
})
