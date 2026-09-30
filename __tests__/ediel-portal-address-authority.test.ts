import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ rpc: vi.fn(), access: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: fixture.rpc } }))
vi.mock('@/lib/ediel/testing/tgtTestData', () => ({ getEdielTgtTestDataForCase: () => null }))

import { createEdielPortalTestCustomerGraph } from '@/lib/ediel/portalTestCustomer'

const company = '11111111-1111-4111-8111-111111111111'
const customer = '22222222-2222-4222-8222-222222222222'
const actor = '33333333-3333-4333-8333-333333333333'
const session = '44444444-4444-4444-8444-444444444444'
const input = { companyId: company, actorUserId: actor, actorSessionId: session,
  testSuite: 'PRODAT' as const, roleCode: 'supplier' as const, testCaseCode: '1.1.1',
  agreementStartDateTime: '202610010000',
  powerOfAttorneyReference: 'synthetic-test-reference',
  customerPersonalNumber: '199001010000', customerName: 'Synthetic customer', customerEmail: 'synthetic@example.invalid',
  customerAddress: 'Registered 1', customerPostalCode: '12345', customerCity: 'Stockholm',
  billingRecipientAddress: 'Billing 2', billingRecipientPostalCode: '54321', billingRecipientCity: 'Lund',
  facilityId: '735999999999999999', gridAreaId: 'SYN', siteAddress: 'Facility 3',
  sitePostalCode: '12345', siteCity: 'Stockholm' }

function database(revision: unknown) {
  const writes: Array<{ table: string; values: unknown }> = []
  const addresses: Array<Record<string, unknown>> = []
  let currentRevision = revision
  fixture.rpc.mockImplementation(async (name: string, args: { p_command: Record<string, unknown> }) => {
    if (name !== 'gridex_change_customer_address_book_v1') throw new Error(`unexpected RPC ${name}`)
    const command = args.p_command
    const addressId = command.changes && (command.changes as { type: string }).type === 'registered'
      ? '55555555-5555-4555-8555-555555555555' : '66666666-6666-4666-8666-666666666666'
    addresses.push({ id: addressId, ...(command.changes as object), company_id: company, customer_id: customer })
    currentRevision = Number(currentRevision) + 1
    return { data: { companyId: company, customerId: customer, addressId, revision: currentRevision,
      changed: true, replayed: false }, error: null }
  })
  const client = { rpc: fixture.access, from(table: string) {
    const filters: Record<string, unknown> = {}
    let selected = '*'
    const result = () => {
      if (table === 'customer_addresses') return { data: addresses.find(row =>
        Object.entries(filters).every(([key, value]) => row[key] === value)) ?? null, error: null }
      if (table === 'customers') return { data: selected === 'address_book_revision'
        ? { address_book_revision: currentRevision } : { id: customer }, error: null }
      return { data: { id: '77777777-7777-4777-8777-777777777777', is_active: true,
        status: 'draft', ediel_id: '91100', endpoint: 'smtp://91100@ediel.se', route_type: 'ediel_partner',
        target_system: 'ediel_portal_tgt', target_email: '91100@ediel.se' }, error: null }
    }
    const query = {
      select(value: string) { selected = value; return query },
      eq(key: string, value: unknown) { filters[key] = value; return query },
      neq() { return query }, order() { return query }, limit() { return query },
      update(values: unknown) { writes.push({ table, values }); return query },
      insert(values: unknown) {
        writes.push({ table, values })
        if (table === 'customer_addresses') {
          return Promise.resolve({ error: { code: '42501', message: 'address_book_command_required' } })
        }
        return query
      },
      maybeSingle: async () => result(), single: async () => result(),
      then(resolve: (value: { data: unknown; error: null }) => unknown) { return Promise.resolve(result()).then(resolve) },
    }
    return query
  } } as unknown as SupabaseClient
  return { client, writes, addresses }
}

describe('Ediel portal test graph authoritative address book', () => {
  beforeEach(() => { fixture.rpc.mockReset(); fixture.access.mockReset().mockResolvedValue({ data: true, error: null }) })

  it('creates distinct registered and billing addresses with the actual session and fresh book revisions', async () => {
    const db = database(7)
    const result = await createEdielPortalTestCustomerGraph(db.client, input)
    expect(result.customerId).toBe(customer)
    expect(fixture.access).toHaveBeenCalledExactlyOnceWith('gridex_ediel_portal_test_graph_access_v1', {
      p_company_id: company, p_user_id: actor, p_session_id: session,
    })
    expect(db.addresses.map(row => [row.type, row.street_1, row.city])).toEqual([
      ['registered', 'Registered 1', 'Stockholm'], ['billing', 'Billing 2', 'Lund'],
    ])
    expect(fixture.rpc.mock.calls.map(([, args]) => args.p_command)).toEqual([
      expect.objectContaining({ companyId: company, customerId: customer, actorUserId: actor,
        sessionId: session, addressId: null, expectedRevision: 7 }),
      expect.objectContaining({ companyId: company, customerId: customer, actorUserId: actor,
        sessionId: session, addressId: null, expectedRevision: 8 }),
    ])
    expect(db.writes.some(write => write.table === 'customer_addresses')).toBe(false)
    expect(db.writes.some(write => write.table === 'supplier_switch_requests')).toBe(true)
    await createEdielPortalTestCustomerGraph(db.client, input)
    expect(db.addresses).toHaveLength(2)
    expect(fixture.rpc).toHaveBeenCalledTimes(2)
  })

  it.each([undefined, null, -1, '7', Number.MAX_SAFE_INTEGER + 1])
    ('stops an unavailable or invalid saved revision %s without inventing zero or writing downstream', async revision => {
      const db = database(revision)
      await expect(createEdielPortalTestCustomerGraph(db.client, input)).rejects.toThrow('address_book_revision_unavailable')
      expect(fixture.rpc).not.toHaveBeenCalled()
      expect(db.writes.some(write => write.table === 'supplier_switch_requests')).toBe(false)
    })

  it('propagates a revoked-session denial without a service-role marker exception or fallback write', async () => {
    const db = database(7)
    fixture.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'address_actor_forbidden' } })
    await expect(createEdielPortalTestCustomerGraph(db.client, input)).rejects.toMatchObject({ code: 'address_actor_forbidden', status: 403 })
    expect(db.writes.some(write => write.table === 'customer_addresses' || write.table === 'supplier_switch_requests')).toBe(false)
  })

  it.each([
    { data: false, error: null }, { data: true, error: { code: '42501', message: 'denied' } },
    { data: null, error: null }, { data: 'true', error: null },
  ])('denies missing target-company write authority before any graph DML', async access => {
    const db = database(7)
    fixture.access.mockResolvedValueOnce(access)
    await expect(createEdielPortalTestCustomerGraph(db.client, input)).rejects.toThrow('ediel_portal_test_graph_forbidden')
    expect(db.writes).toEqual([])
    expect(fixture.rpc).not.toHaveBeenCalled()
  })
})
