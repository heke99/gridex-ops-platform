import { beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  command: vi.fn(), guard: vi.fn(), session: vi.fn(), legacy: vi.fn(),
  company: '22222222-2222-4222-8222-222222222222', customer: '33333333-3333-4333-8333-333333333333',
  actor: '11111111-1111-4111-8111-111111111111', sessionId: '44444444-4444-4444-8444-444444444444',
  site: '55555555-5555-4555-8555-555555555555',
}))
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ unstable_rethrow: () => {} }))
vi.mock('@/lib/admin/guards', () => ({ requireAdminActionAccess: fixture.guard }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({}) }))
vi.mock('@/lib/masterdata/db', () => ({
  getCustomerSiteById: async () => ({ id: fixture.site, company_id: fixture.company, customer_id: fixture.customer, site_revision: 4 }),
  saveCustomerSite: fixture.legacy,
}))
vi.mock('@/app/admin/customers/[id]/actions.part-4', () => ({ requireCustomerMutationContext: async () => ({ companyId: fixture.company }) }))
vi.mock('@/lib/customer-operations/supportSession', () => ({ currentSupportSession: fixture.session }))
vi.mock('@/lib/customer-operations/siteCommand', () => ({
  saveCustomerSiteCommand: fixture.command,
  SiteCommandError: class SiteCommandError extends Error { constructor(readonly code: string, readonly status: number) { super(code) } },
}))
import { saveCustomerSiteAction } from '@/app/admin/customers/[id]/actions.part-1'

function form() {
  const data = new FormData()
  for (const [key, value] of Object.entries({ customer_id: fixture.customer, id: fixture.site,
    expected_site_revision: '4', idempotency_key: 'site-action-current-key',
    site_name: 'Synthetic facility', facility_id: '735999999999999999', site_type: 'consumption', status: 'draft',
    site_flow_type: 'switch', street: 'Testgatan 1', postal_code: '123 45', city: 'Teststad', country: 'SE',
  })) data.set(key, value)
  return data
}
describe('OPS customer site authoritative action', () => {
  beforeEach(() => {
    fixture.guard.mockReset().mockResolvedValue({ userId: fixture.actor, companyId: fixture.company, isPlatformAdmin: false })
    fixture.session.mockReset().mockResolvedValue({ kind: 'ops', userId: fixture.actor, sessionId: fixture.sessionId })
    fixture.command.mockReset().mockResolvedValue({ revision: 5, changed: true, replayed: false, siteId: fixture.site, addressStatus: 'updated' })
    fixture.legacy.mockReset().mockRejectedValue(new Error('legacy direct site writer reached'))
  })
  it('uses the current server actor and saved revision at one command boundary', async () => {
    const result = await saveCustomerSiteAction(form())
    expect(result).toMatchObject({ revision: 5, changed: true, replayed: false })
    expect(fixture.guard).toHaveBeenCalledWith({ anyOf: ['sites.write', 'customers.write'] })
    expect(fixture.command).toHaveBeenCalledWith(expect.objectContaining({ companyId: fixture.company,
      customerId: fixture.customer, siteId: fixture.site, expectedRevision: 4, idempotencyKey: 'site-action-current-key',
      actor: { kind: 'ops', userId: fixture.actor, sessionId: fixture.sessionId, reason: 'OPS customer site form' },
      changes: expect.objectContaining({ site_name: 'Synthetic facility', street: 'Testgatan 1', postal_code: '123 45', city: 'Teststad' }),
    }))
    expect(fixture.legacy).not.toHaveBeenCalled()
  })
  it.each(['expected_site_revision', 'idempotency_key'])('requires the persisted %s without a invented default', async (field) => {
    const data = form(); data.delete(field)
    await expect(saveCustomerSiteAction(data)).resolves.toMatchObject({ error: true, code: 'invalid_site_command' })
    expect(fixture.command).not.toHaveBeenCalled(); expect(fixture.legacy).not.toHaveBeenCalled()
  })
  it('rejects forged actor and tenant controls', async () => {
    const data = form(); data.set('actorUserId', '66666666-6666-4666-8666-666666666666')
    await expect(saveCustomerSiteAction(data)).resolves.toMatchObject({ error: true, code: 'invalid_site_command' })
    expect(fixture.command).not.toHaveBeenCalled(); expect(fixture.legacy).not.toHaveBeenCalled()
  })
  it('cannot make a manually selected price area or network owner operational', async () => {
    const data = form(); data.set('price_area_code', 'SE3'); data.set('grid_owner_id', '66666666-6666-4666-8666-666666666666')
    await saveCustomerSiteAction(data)
    expect(fixture.command).toHaveBeenCalledWith(expect.objectContaining({
      addressHints: { claimedGridOwnerId: '66666666-6666-4666-8666-666666666666', claimedPriceAreaCode: 'SE3' },
    }))
    expect(fixture.command.mock.calls[0][0].changes).not.toHaveProperty('grid_owner_id')
    expect(fixture.command.mock.calls[0][0].changes).not.toHaveProperty('price_area_code')
    expect(fixture.legacy).not.toHaveBeenCalled()
  })
  it('clears obsolete move-from values for a normal supplier switch', async () => {
    const data = form(); data.set('moved_from_street', 'Obsolete 1'); data.set('moved_from_city', 'Obsolete')
    await saveCustomerSiteAction(data)
    expect(fixture.command.mock.calls[0][0].changes).toMatchObject({ moved_from_street: null, moved_from_city: null })
  })
  it('rejects duplicate form controls and an unknown flow instead of silently accepting one value', async () => {
    const duplicate = form(); duplicate.append('idempotency_key', 'another-attempt-key')
    await expect(saveCustomerSiteAction(duplicate)).resolves.toMatchObject({ error: true, code: 'invalid_site_command' })
    const unknown = form(); unknown.set('site_flow_type', 'unexpected_move')
    await expect(saveCustomerSiteAction(unknown)).resolves.toMatchObject({ error: true, code: 'invalid_site_flow' })
    expect(fixture.command).not.toHaveBeenCalled(); expect(fixture.legacy).not.toHaveBeenCalled()
  })
  it('reports a committed address candidate as awaiting review while preserving the confirmed revision', async () => {
    fixture.command.mockResolvedValue({ revision: 5, changed: true, replayed: false, siteId: fixture.site, addressStatus: 'conflict' })
    expect(await saveCustomerSiteAction(form())).toMatchObject({ revision: 5, changed: true,
      notice: 'Adressförslaget är sparat för granskning. Den tidigare verifierade adressen gäller tills förslaget har godkänts.' })
  })
})
