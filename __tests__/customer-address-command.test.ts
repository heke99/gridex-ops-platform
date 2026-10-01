import { beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: fixture.rpc } }))

import { changeCustomerAddress } from '@/lib/customer-operations/addressCommand'

const companyId = '11111111-1111-4111-8111-111111111111'
const customerId = '22222222-2222-4222-8222-222222222222'
const addressId = '55555555-5555-4555-8555-555555555555'
const base = {
  companyId, customerId, addressId,
  actor: { kind: 'ops' as const, userId: '33333333-3333-4333-8333-333333333333',
    sessionId: '44444444-4444-4444-8444-444444444444', reason: 'Authorized address-book correction' },
  expectedRevision: 4, idempotencyKey: 'address-book-repeatable-command',
  changes: { type: 'registered' as const, street_1: 'Testgatan 1', street_2: null,
    postal_code: '12345', city: 'Stockholm', country: 'SE', municipality: null,
    moved_in_at: '2026-09-01', moved_out_at: null, is_active: true },
}
const persisted = { companyId, customerId, addressId, revision: 5, changed: true, replayed: false }

describe('OPS customer address-book service boundary', () => {
  beforeEach(() => fixture.rpc.mockReset())

  it('sends one atomic command with the actual session, saved customer address revision and unchanged address-book fields', async () => {
    fixture.rpc.mockResolvedValueOnce({ data: persisted, error: null })
    expect(await changeCustomerAddress(base)).toEqual({ addressId, revision: 5, changed: true, replayed: false })
    expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith('gridex_change_customer_address_book_v1', { p_command: {
      companyId, customerId, addressId, actorUserId: base.actor.userId, sessionId: base.actor.sessionId,
      reason: base.actor.reason, expectedRevision: 4, idempotencyKey: base.idempotencyKey, changes: base.changes,
    } })
  })

  it('uses a null selection only for a new address and preserves an authorized persisted replay', async () => {
    fixture.rpc.mockResolvedValueOnce({ data: { ...persisted, replayed: true }, error: null })
    expect(await changeCustomerAddress({ ...base, addressId: undefined })).toEqual({ addressId, revision: 5, changed: true, replayed: true })
    expect(fixture.rpc.mock.calls[0][1].p_command.addressId).toBeNull()
  })

  it('accepts uppercase UUID inputs and confirms the database-normalized persisted result without a false post-save failure', async () => {
    const ids = {
      companyId: 'abcdefab-cdef-4abc-8def-abcdefabcdef',
      customerId: 'bcdefabc-defa-4bcd-8efa-bcdefabcdefa',
      addressId: 'cdefabcd-efab-4cde-8fab-cdefabcdefab',
      userId: 'defabcde-fabc-4def-8abc-defabcdefabc',
      sessionId: 'efabcdef-abcd-4efa-8bcd-efabcdefabcd',
    }
    fixture.rpc.mockResolvedValueOnce({ data: { ...persisted, companyId: ids.companyId,
      customerId: ids.customerId, addressId: ids.addressId }, error: null })
    const input = { ...base, companyId: ids.companyId.toUpperCase(), customerId: ids.customerId.toUpperCase(),
      addressId: ids.addressId.toUpperCase(), actor: { ...base.actor, userId: ids.userId.toUpperCase(), sessionId: ids.sessionId.toUpperCase() } }
    expect(await changeCustomerAddress(input)).toEqual({ addressId: ids.addressId, revision: 5, changed: true, replayed: false })
    expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith('gridex_change_customer_address_book_v1', { p_command: {
      companyId: ids.companyId, customerId: ids.customerId, addressId: ids.addressId,
      actorUserId: ids.userId, sessionId: ids.sessionId, reason: base.actor.reason,
      expectedRevision: 4, idempotencyKey: base.idempotencyKey, changes: base.changes,
    } })
  })

  it.each([
    { actor: { ...base.actor, sessionId: undefined } },
    { actor: { ...base.actor, kind: 'api' } },
    { actor: { ...base.actor, verified: true } },
    { expectedRevision: undefined }, { expectedRevision: -1 }, { idempotencyKey: 'invalid key' },
    { changes: { ...base.changes, type: 'facility' } },
    { changes: { ...base.changes, street_1: '' } },
    { changes: { ...base.changes, country: 'se' } },
    { changes: { ...base.changes, moved_in_at: '2026-02-30' } },
    { changes: { ...base.changes, moved_in_at: '0000-01-01' } },
    { changes: { ...base.changes, moved_out_at: '2026-08-31' } },
    { changes: { ...base.changes, invoice_email: 'billing@example.invalid' } },
    { changes: { ...base.changes, company_id: companyId } },
  ])('rejects malformed, forged or mixed-domain commands without a legacy writer', async (patch) => {
    await expect(changeCustomerAddress({ ...base, ...patch } as never)).rejects.toMatchObject({ code: 'invalid_address_command', status: 422 })
    expect(fixture.rpc).not.toHaveBeenCalled()
  })

  it.each(['address_book_revision_conflict', 'address_book_idempotency_conflict', 'address_book_selection_conflict'])
    ('retains the original command on %s without retrying another writer', async (code) => {
      fixture.rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: code } })
      await expect(changeCustomerAddress(base)).rejects.toMatchObject({ code, status: 409 })
      expect(fixture.rpc).toHaveBeenCalledTimes(1)
    })

  it.each(['address_service_required', 'address_actor_forbidden', 'address_customer_unavailable', 'address_tenant_unavailable'])
    ('maps current authority denial %s', async (code) => {
      fixture.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: code } })
      await expect(changeCustomerAddress(base)).rejects.toMatchObject({ code, status: 403 })
    })

  it.each(['invalid_address_command', 'invalid_customer_address'])('maps %s without a second mutation', async (code) => {
    fixture.rpc.mockResolvedValueOnce({ data: null, error: { code: '22023', message: code } })
    await expect(changeCustomerAddress(base)).rejects.toMatchObject({ code, status: 422 })
  })

  it('fails closed for a missing capability and invalid or foreign persisted results', async () => {
    fixture.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'missing gridex_change_customer_address_book_v1(p_command)' } })
    await expect(changeCustomerAddress(base)).rejects.toMatchObject({ code: 'platform_schema_not_ready', status: 503 })
    for (const result of [
      { ...persisted, companyId: customerId }, { ...persisted, customerId: companyId },
      { ...persisted, addressId: customerId }, { ...persisted, addressId: 'not-an-id' },
      { ...persisted, revision: -1 }, { ...persisted, changed: 'true' },
      { ...persisted, revision: 4 }, { ...persisted, changed: false }, { ...persisted, replayed: 'false' },
    ]) {
      fixture.rpc.mockResolvedValueOnce({ data: result, error: null })
      await expect(changeCustomerAddress(base)).rejects.toMatchObject({ code: 'address_result_invalid', status: 503 })
    }
  })

  it('propagates a late transaction failure without executing a split audit or fallback', async () => {
    fixture.rpc.mockResolvedValueOnce({ data: null, error: { code: 'XX000', message: 'late audit failure' } })
    await expect(changeCustomerAddress(base)).rejects.toMatchObject({ code: 'XX000' })
    expect(fixture.rpc).toHaveBeenCalledTimes(1)
  })
})
