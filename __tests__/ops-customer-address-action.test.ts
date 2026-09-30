import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const companyId = '11111111-1111-4111-8111-111111111111'
const customerId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const sessionId = '44444444-4444-4444-8444-444444444444'
const addressId = '55555555-5555-4555-8555-555555555555'
const fixture = vi.hoisted(() => ({ rpc: vi.fn(), revalidate: vi.fn(),
  companyId: '11111111-1111-4111-8111-111111111111', selectedCompanyId: '11111111-1111-4111-8111-111111111111',
  status: 'active', revoked: false, directWrites: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: fixture.revalidate }))
vi.mock('next/navigation', () => ({ unstable_rethrow: () => {}, useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/lib/admin/guards', () => ({ requireAdminActionAccess: async () => ({
  userId: '33333333-3333-4333-8333-333333333333', companyId: fixture.selectedCompanyId, isPlatformAdmin: false,
}) }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: '33333333-3333-4333-8333-333333333333' } } }) },
}) }))
vi.mock('@/lib/customer-operations/supportSession', () => ({ currentSupportSession: async () => {
  if (fixture.revoked) throw Object.assign(new Error('support_session_revoked'), { code: 'support_session_revoked' })
  return { kind: 'ops', userId: '33333333-3333-4333-8333-333333333333', sessionId: '44444444-4444-4444-8444-444444444444' }
} }))
vi.mock('@/lib/tenant/scope', () => ({ assertUserCanOperateCompany: async (_actor: string, company: string) => company }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: fixture.rpc, from: (table: string) => {
  const query = {
    select: () => query, eq: () => query,
    maybeSingle: async () => ({ data: table === 'customers' ? { company_id: fixture.companyId, status: fixture.status } : null, error: null }),
    insert: fixture.directWrites, update: fixture.directWrites, delete: fixture.directWrites,
  }
  return query
} } }))

import CustomerContactsAddressesCard, { saveCustomerAddressFormAction } from '@/components/admin/customers/CustomerContactsAddressesCard'

function form(extra: Record<string, string> = {}) {
  const data = new FormData()
  for (const [key, value] of Object.entries({ customer_id: customerId, id: addressId, type: 'registered',
    street_1: 'Testgatan 1', street_2: 'c/o Synthetic', postal_code: '12345', city: 'Stockholm', country: 'SE',
    municipality: 'Stockholm', moved_in_at: '2026-09-01', moved_out_at: '', is_active: 'on',
    expected_address_revision: '4', idempotency_key: 'address-form-repeatable-key', ...extra })) data.set(key, value)
  return data
}
const persisted = { companyId, customerId, addressId, revision: 5, changed: true, replayed: false }

describe('OPS address form uses the canonical address-book command', () => {
  beforeEach(() => {
    fixture.rpc.mockReset(); fixture.revalidate.mockReset(); fixture.directWrites.mockReset()
    fixture.companyId = companyId; fixture.selectedCompanyId = companyId; fixture.status = 'active'; fixture.revoked = false
  })

  it('returns the persisted revision and preserves the displayed fields, key and actual session in one transaction', async () => {
    fixture.rpc.mockResolvedValueOnce({ data: persisted, error: null })
    expect(await saveCustomerAddressFormAction(form({ actor_user_id: customerId, session_id: addressId })))
      .toEqual({ addressId, revision: 5, changed: true, replayed: false })
    expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith('gridex_change_customer_address_book_v1', { p_command: {
      companyId, customerId, addressId, actorUserId: userId, sessionId, reason: 'OPS customer address-book form',
      expectedRevision: 4, idempotencyKey: 'address-form-repeatable-key',
      changes: { type: 'registered', street_1: 'Testgatan 1', street_2: 'c/o Synthetic', postal_code: '12345',
        city: 'Stockholm', country: 'SE', municipality: 'Stockholm', moved_in_at: '2026-09-01', moved_out_at: null, is_active: true },
    } })
    expect(fixture.directWrites).not.toHaveBeenCalled()
    expect(fixture.revalidate).toHaveBeenCalledExactlyOnceWith(`/admin/customers/${customerId}`)
  })

  it('retains the submitted key and revision when the saved attempt is safely replayed', async () => {
    fixture.rpc.mockResolvedValue({ data: { ...persisted, replayed: true }, error: null })
    const data = form()
    expect(await saveCustomerAddressFormAction(data)).toMatchObject({ revision: 5, replayed: true })
    expect(data.get('expected_address_revision')).toBe('4')
    expect(data.get('idempotency_key')).toBe('address-form-repeatable-key')
  })

  it.each(['address_book_revision_conflict', 'address_book_idempotency_conflict', 'address_book_selection_conflict'])
    ('returns safe %s and does not refresh or try a legacy writer', async (code) => {
      fixture.rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: code } })
      expect(await saveCustomerAddressFormAction(form())).toEqual({ error: true, code })
      expect(fixture.rpc).toHaveBeenCalledTimes(1)
      expect(fixture.directWrites).not.toHaveBeenCalled()
      expect(fixture.revalidate).not.toHaveBeenCalled()
    })

  it.each([{ expected_address_revision: '' }, { idempotency_key: '' }, { type: 'facility' },
    { moved_in_at: '2026-02-30' }, { moved_out_at: '2026-08-31' }] as Array<Record<string, string>>)('denies an incomplete or invalid command before RPC', async (extra) => {
    expect(await saveCustomerAddressFormAction(form(extra))).toMatchObject({ error: true })
    expect(fixture.rpc).not.toHaveBeenCalled()
    expect(fixture.directWrites).not.toHaveBeenCalled()
  })

  it('requires the current selected tenant and unrevoked session before the command', async () => {
    fixture.selectedCompanyId = customerId
    expect(await saveCustomerAddressFormAction(form())).toEqual({ error: true, code: 'address_actor_forbidden' })
    fixture.selectedCompanyId = companyId; fixture.revoked = true
    expect(await saveCustomerAddressFormAction(form())).toEqual({ error: true, code: 'support_session_revoked' })
    expect(fixture.rpc).not.toHaveBeenCalled()
  })

  it('does not serialize a transaction failure to the browser or claim success', async () => {
    fixture.rpc.mockResolvedValueOnce({ data: null, error: { code: 'XX000', message: 'private database detail' } })
    expect(await saveCustomerAddressFormAction(form())).toEqual({ error: true, code: 'address_save_unconfirmed' })
    expect(fixture.directWrites).not.toHaveBeenCalled()
  })

  it('binds address creation to the loaded book revision and fails editing closed if it is unavailable', () => {
    const props = { customerId, customerType: 'private' as const, contacts: [], addresses: [], sites: [], contactRevision: 2, canEdit: true }
    const markup = renderToStaticMarkup(createElement(CustomerContactsAddressesCard, { ...props, addressBookRevision: 4 }))
    expect(markup).toContain('name="expected_address_revision" value="4"')
    expect(markup).toContain('Sparad adressrevision: 4')
    expect(markup).toContain('name="idempotency_key"')
    const unavailable = renderToStaticMarkup(createElement(CustomerContactsAddressesCard, props))
    expect(unavailable).not.toContain('name="expected_address_revision"')
    expect(unavailable).toContain('adressrevision saknas')
  })
})
