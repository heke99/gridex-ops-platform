import { beforeEach, describe, expect, it, vi } from 'vitest'
const fixture = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), apartment: null as string | null,
  company: '22222222-2222-4222-8222-222222222222', customer: '33333333-3333-4333-8333-333333333333',
  actor: '11111111-1111-4111-8111-111111111111', session: '44444444-4444-4444-8444-444444444444',
  site: '55555555-5555-4555-8555-555555555555',
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: fixture.rpc, from: fixture.from } }))
import { saveCustomerSiteCommand, type SiteCommandInput } from '@/lib/customer-operations/siteCommand'
function input(): SiteCommandInput {
  return { companyId: fixture.company, customerId: fixture.customer, siteId: fixture.site,
    actor: { kind: 'ops', userId: fixture.actor, sessionId: fixture.session, reason: 'Synthetic site correction' },
    expectedRevision: 4, idempotencyKey: 'site-command-test-current-key', siteFlowType: 'switch',
    addressHints: { claimedGridOwnerId: null, claimedPriceAreaCode: 'SE3' },
    changes: { site_name: 'Synthetic site', facility_id: '735999999999999999', site_type: 'consumption', status: 'draft',
      move_in_date: null, annual_consumption_kwh: 1200, current_supplier_name: null, current_supplier_org_number: null,
      street: 'Testgatan   1', care_of: null, postal_code: '123 45', city: 'Teststad', country: 'SE',
      moved_from_street: null, moved_from_postal_code: null, moved_from_city: null, moved_from_supplier_name: null, internal_notes: null },
  }
}
describe('authoritative customer site adapter', () => {
  beforeEach(() => {
    fixture.apartment = null
    fixture.from.mockReset().mockImplementation((table: string) => {
      if (table !== 'customer_sites') throw new Error('unexpected table access')
      const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { id: fixture.site, apartment_number: fixture.apartment }, error: null }) }
      return query
    })
    fixture.rpc.mockReset().mockResolvedValue({ data: { companyId: fixture.company, customerId: fixture.customer, siteId: fixture.site,
      revision: 5, changed: true, replayed: false, addressStatus: 'updated' }, error: null })
  })
  it('normalizes the candidate without writing any table and keeps hints separate from canonical fields', async () => {
    await expect(saveCustomerSiteCommand(input())).resolves.toEqual({ siteId: fixture.site, revision: 5, changed: true, replayed: false, addressStatus: 'updated' })
    expect(fixture.rpc).toHaveBeenCalledWith('gridex_save_customer_site_v1', { p_command: expect.objectContaining({
      companyId: fixture.company, customerId: fixture.customer, siteId: fixture.site, actorUserId: fixture.actor,
      sessionId: fixture.session, expectedRevision: 4, idempotencyKey: 'site-command-test-current-key',
      addressHints: { claimedGridOwnerId: null, claimedPriceAreaCode: 'SE3' },
      candidate: expect.objectContaining({ street: 'Testgatan 1', postal_code: '12345', normalized: 'testgatan 1||12345|teststad|se', complete: true }),
    }) })
    expect(fixture.rpc.mock.calls[0][1].p_command.changes).not.toHaveProperty('price_area_code')
  })
  it('preserves the persisted apartment instead of discarding a field the form does not expose', async () => {
    fixture.apartment = '1002'
    await saveCustomerSiteCommand(input())
    expect(fixture.rpc.mock.calls[0][1].p_command.candidate).toMatchObject({ apartment_number: '1002', normalized: 'testgatan 1|1002|12345|teststad|se' })
  })
  it('recognizes an uppercase spelling of the same persisted UUID after a confirmed SQL write', async () => {
    const company = 'abcdefab-cdef-4abc-8def-abcdefabcdef', customer = 'bcdefabc-defa-4bcd-8efa-bcdefabcdefa',
      site = 'cdefabcd-efab-4cde-8fab-cdefabcdefab', actor = 'defabcde-fabc-4def-8abc-defabcdefabc',
      session = 'efabcdef-abcd-4efa-8bcd-efabcdefabcd'
    fixture.rpc.mockResolvedValue({ data: { companyId: company, customerId: customer, siteId: site,
      revision: 5, changed: true, replayed: false, addressStatus: 'updated' }, error: null })
    const command = input()
    Object.assign(command, { companyId: company.toUpperCase(), customerId: customer.toUpperCase(), siteId: site.toUpperCase(),
      actor: { kind: 'ops', userId: actor.toUpperCase(), sessionId: session.toUpperCase(), reason: 'Synthetic case-insensitive identity' } })
    await expect(saveCustomerSiteCommand(command)).resolves.toMatchObject({ siteId: site, revision: 5 })
    expect(fixture.rpc.mock.calls[0][1].p_command).toMatchObject({ companyId: company, customerId: customer, siteId: site, actorUserId: actor, sessionId: session })
  })
  it.each([
    { expectedRevision: -1 }, { expectedRevision: Number.MAX_SAFE_INTEGER + 1 }, { idempotencyKey: '' },
    { actor: { kind: 'ops', userId: fixture.actor, sessionId: '', reason: 'Forged' } }, { actorUserId: fixture.actor },
  ])('rejects malformed authority/revision/key input before any query', async (patch) => {
    await expect(saveCustomerSiteCommand({ ...input(), ...patch } as SiteCommandInput)).rejects.toMatchObject({ code: 'invalid_site_command', status: 422 })
    expect(fixture.rpc).not.toHaveBeenCalled(); expect(fixture.from).not.toHaveBeenCalled()
  })
  it.each([{ grid_owner_id: fixture.site }, { price_area_code: 'SE3' }, { site_name: '' }, { annual_consumption_kwh: -1 }, { move_in_date: '2026-02-30' }])('rejects unsupported operational or invalid fields', async (patch) => {
    const command = input(); command.changes = { ...command.changes, ...patch } as SiteCommandInput['changes']
    await expect(saveCustomerSiteCommand(command)).rejects.toMatchObject({ code: 'invalid_site_command', status: 422 })
    expect(fixture.rpc).not.toHaveBeenCalled(); expect(fixture.from).not.toHaveBeenCalled()
  })
  it('never uses an invented revision for a new site or an incomplete move', async () => {
    await expect(saveCustomerSiteCommand({ ...input(), siteId: null })).rejects.toMatchObject({ code: 'invalid_site_command' })
    const command = input(); command.siteFlowType = 'move_in'
    await expect(saveCustomerSiteCommand(command)).rejects.toMatchObject({ code: 'invalid_site_command' })
    expect(fixture.rpc).not.toHaveBeenCalled()
  })
  it.each([['site_revision_conflict', 409], ['site_idempotency_conflict', 409], ['site_actor_forbidden', 403], ['site_resource_not_found', 404]])('preserves safe SQL denial %s', async (code, status) => {
    fixture.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: code } })
    await expect(saveCustomerSiteCommand(input())).rejects.toMatchObject({ code, status })
  })
  it.each([{ companyId: fixture.actor }, { customerId: fixture.site }, { siteId: fixture.customer }, { revision: 1.5 }, { changed: undefined }, { replayed: undefined }, { addressStatus: 'invented' }])('fails closed on an unconfirmed or foreign command result', async (patch) => {
    fixture.rpc.mockResolvedValue({ data: { companyId: fixture.company, customerId: fixture.customer, siteId: fixture.site,
      revision: 5, changed: true, replayed: false, addressStatus: 'updated', ...patch }, error: null })
    await expect(saveCustomerSiteCommand(input())).rejects.toMatchObject({ code: 'site_result_invalid', status: 503 })
  })
})
