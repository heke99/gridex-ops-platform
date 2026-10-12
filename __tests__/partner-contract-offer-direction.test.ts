/* eslint-disable @typescript-eslint/no-explicit-any -- finite native offer/ledger test port */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { minimalPdf } from './helpers/minimalPdf'

const m = vi.hoisted(() => ({
  direction: 'consumption' as string | null, ledger: null as Record<string, unknown> | null,
  mutations: 0, uploads: 0, nativeSiteTypes: [] as string[], resolverArgs: [] as Record<string, unknown>[],
}))
vi.mock('@/lib/integrations/apiAuth', () => ({
  requireIntegrationApiAccess: vi.fn(async () => ({ ok: true, client: { id: 'client_synthetic', company_id: 'company_synthetic', metadata: {} } })),
  logIntegrationApiRequest: vi.fn(async () => {}),
  integrationCredential: () => ({ ok: false, malformedAuthorization: false }),
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from(table: string) {
    let inserted: Record<string, unknown> | null = null, patch: Record<string, unknown> | null = null, removed = false
    const predicates: Array<(row: Record<string, unknown>) => boolean> = []
    const run = async () => {
      if (table === 'canonical_public_contract_diagnostics_v') return { data: [{ company_id: 'company_synthetic', channel: 'api', visible: true, offer_reference: 'offer_public', customer_type: 'private' }], error: null }
      if (table !== 'customer_portal_write_idempotency') throw new Error(`Unexpected business table: ${table}`)
      if (inserted) {
        if (m.ledger) return { data: null, error: { code: '23505' } }
        m.ledger = { ...inserted, id: 'ledger_synthetic' }
      }
      const matches = m.ledger && predicates.every(f => f(m.ledger!))
      if (matches && removed) { m.ledger = null; return { data: null, error: null } }
      if (matches && patch) Object.assign(m.ledger!, patch)
      return { data: matches ? m.ledger : null, error: null }
    }
    const q: any = {
      select: () => q, limit: () => q,
      eq: (key: string, value: unknown) => { predicates.push(row => row[key] === value); return q },
      is: (key: string, value: unknown) => { predicates.push(row => row[key] === value); return q },
      insert: (row: Record<string, unknown>) => { inserted = row; return q },
      update: (row: Record<string, unknown>) => { patch = row; return q },
      delete: () => { removed = true; return q },
      maybeSingle: () => run(),
      then: (resolve: (r: unknown) => unknown, reject: (r: unknown) => unknown) => run().then(resolve, reject),
    }
    return q
  },
  async rpc(name: string, args: Record<string, unknown>) {
    if (name === 'gridex_resolve_partner_api_offer_v1') {
      m.resolverArgs.push(args)
      return { data: { offer_reference: 'offer_public', energy_direction: m.direction }, error: null }
    }
    if (name !== 'gridex_create_partner_contract_v1') throw new Error(`Unexpected RPC: ${name}`)
    m.mutations += 1
    const site = (args.p_payload as { site: Record<string, unknown> }).site
    m.nativeSiteTypes.push(String(site.electricity_type ?? '').trim().toLowerCase() || String(site.site_electricity_type ?? '').trim().toLowerCase() || 'consumption')
    return { data: { contract_reference: 'contract_public', customer: { customer_reference: 'customer_public' }, site: { site_reference: 'site_public' }, power_of_attorney: { power_of_attorney_reference: 'poa_public' } }, error: null }
  },
  storage: { from: () => ({ upload: async () => { m.uploads += 1; return { error: null } }, remove: async () => ({ error: null }) }) },
} }))
import { POST } from '@/app/api/partner/v1/[[...path]]/route'

beforeEach(() => { m.direction = 'consumption'; m.ledger = null; m.mutations = 0; m.uploads = 0; m.resolverArgs = []; m.nativeSiteTypes = []; vi.spyOn(console, 'error').mockImplementation(() => {}) })
function contract(legacy: boolean, direction: string, siteExtra: Record<string, unknown> = {}) {
  const file = minimalPdf().toString('base64')
  const customer = legacy
    ? { external_customer_id: 'external_public', type: 'private', first_name: 'Synthetic', last_name: 'Person', identity_number: '199001011234', email: 'synthetic@example.invalid' }
    : { customer_type: 'PRIVATE', first_name: 'Synthetic', last_name: 'Person', soc_id: '199001011234', email: 'synthetic@example.invalid' }
  const site = legacy ? { electricity_type: direction, street: 'Synthetic address', postal_code: '12345', city: 'Synthetic' } : { site_electricity_type: direction.toUpperCase(), address: 'Synthetic address', zip_code: '12345', city: 'Synthetic' }
  const poa = legacy ? { accepted: true, signer_name: 'Synthetic Person', evidence_reference: 'evidence_public', file_base64: file, file_extension: 'pdf' } : { poa_type: 'WEB', transaction_type: 'SWITCH', file_base64: file, file_extension: 'pdf' }
  const path = legacy ? 'contracts' : 'contract'
  const body = { customer, site: { ...site, ...siteExtra }, power_of_attorney: poa, ...(legacy ? { offer_reference: 'offer_public' } : {}) }
  return POST(new NextRequest(`https://example.invalid/api/partner/v1/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'direction-test-0001' }, body: JSON.stringify(body) }), { params: Promise.resolve({ path: [path] }) })
}
describe('Partner contract direction follows the actual selected published offer', () => {
  it.each([false, true])('rejects a production site with consumption offer before upload/business mutation (legacy=%s)', async legacy => {
    const response = await contract(legacy, 'production')
    expect(response.status).toBe(422)
    expect((await response.json()).error.code).toBe('site_offer_direction_mismatch')
    expect(m.uploads).toBe(0); expect(m.mutations).toBe(0); expect(m.ledger).toBeNull()
    expect(m.resolverArgs).toEqual([{ p_company_id: 'company_synthetic', p_offer_reference: 'offer_public', p_customer_type: 'private' }])
  })
  it.each([false, true])('accepts matching directions and preserves completed retries after default direction changes (legacy=%s)', async legacy => {
    const first = await contract(legacy, 'consumption')
    expect(first.status).toBe(201)
    const original = await first.json()
    m.direction = 'production'
    const replay = await contract(legacy, 'consumption')
    expect(replay.status).toBe(201)
    const repeated = await replay.json()
    if (legacy) expect(repeated.data).toEqual(original.data)
    else expect(repeated).toEqual(original)
    expect(m.mutations).toBe(1); expect(m.uploads).toBe(1); expect(m.resolverArgs).toHaveLength(1)
  })
  it('sends the same normalized legacy site direction to the native RPC that the guard validated', async () => {
    expect((await contract(true, ' ', { site_electricity_type: 'production' })).status).toBe(201)
    expect(m.nativeSiteTypes).toEqual(['consumption'])
  })
  it('accepts a production site when the canonical offer is production', async () => {
    m.direction = 'production'
    expect((await contract(false, 'production')).status).toBe(201)
    expect(m.mutations).toBe(1); expect(m.uploads).toBe(1)
  })
  it('rejects consumption site bound to production offer and fails closed if canonical direction is unavailable', async () => {
    m.direction = 'production'
    expect((await contract(false, 'consumption')).status).toBe(422)
    m.direction = null
    expect((await contract(false, 'consumption')).status).toBe(503)
    expect(m.mutations).toBe(0); expect(m.uploads).toBe(0); expect(m.ledger).toBeNull()
  })
})
