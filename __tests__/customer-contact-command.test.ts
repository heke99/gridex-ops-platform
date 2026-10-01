import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiInputError } from '@/lib/api/strictRequest'
import { parseCustomerProfileUpdateRequest } from '@/lib/customer-portal/profileUpdateContract'

const fixture = vi.hoisted(() => ({
  rpc: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: fixture.rpc } }))

import { changeCustomerContact, ContactCommandError } from '@/lib/customer-operations/contactCommand'

const base = {
  companyId: 'tenant-a',
  customerId: 'customer-a',
  expectedRevision: 4,
  idempotencyKey: 'p2-retryable-key',
  changes: { phone: '+46123456789' },
}

describe('shared contact command boundary', () => {
  beforeEach(() => fixture.rpc.mockReset())

  it('sends OPS and API through the same RPC with distinct server actors', async () => {
    fixture.rpc
      .mockResolvedValueOnce({ data: { companyId: 'tenant-a', customerId: 'customer-a', revision: 5, changed: true, replayed: false }, error: null })
      .mockResolvedValueOnce({ data: { companyId: 'tenant-a', customerId: 'customer-a', revision: 5, changed: true, replayed: true, completionReference: 'case-1' }, error: null })
    expect(await changeCustomerContact({
      ...base, contactId: 'contact-a', actor: { kind: 'ops', userId: 'actor-a', sessionId: 'verified-session-a', reason: 'Corrections' },
    })).toMatchObject({ revision: 5, replayed: false })
    expect(await changeCustomerContact({
      ...base, actor: { kind: 'api', clientId: 'client-a', subject: 'subject-a' },
    })).toMatchObject({ revision: 5, replayed: true, completionReference: 'case-1' })
    expect(fixture.rpc.mock.calls.map(([name]) => name)).toEqual([
      'gridex_change_customer_contact_v2', 'gridex_change_customer_contact_v2',
    ])
    expect(fixture.rpc.mock.calls[0][1].p_command).toMatchObject({
      companyId: 'tenant-a', customerId: 'customer-a', contactId: 'contact-a',
      actorUserId: 'actor-a', sessionId: 'verified-session-a', mode: 'ops', expectedRevision: 4,
    })
    expect(fixture.rpc.mock.calls[1][1].p_command).toMatchObject({
      companyId: 'tenant-a', customerId: 'customer-a', clientId: 'client-a',
      subject: 'subject-a', actorUserId: null, sessionId: null, mode: 'api', expectedRevision: 4,
      requestJson: '{"expected_contact_revision":4,"profile":{"phone":"+46123456789"}}',
    })
  })

  it('marks a secondary OPS change explicitly without extending delegated API authority', async () => {
    fixture.rpc.mockResolvedValueOnce({
      data: { companyId: 'tenant-a', customerId: 'customer-a', revision: 5, changed: true, replayed: false },
      error: null,
    })
    await changeCustomerContact({
      ...base, contactTarget: 'secondary', contactType: 'billing',
      actor: { kind: 'ops', userId: 'actor-a', sessionId: 'verified-session-a', reason: 'Verified correction' },
    })
    expect(fixture.rpc.mock.calls[0][1].p_command).toMatchObject({
      contactTarget: 'secondary', contactType: 'billing', mode: 'ops',
      expectedRevision: 4,
    })
    await expect(changeCustomerContact({
      ...base, contactTarget: 'secondary', contactType: 'billing',
      actor: { kind: 'api', clientId: 'client-a', subject: 'subject-a' },
    })).rejects.toMatchObject({ code: 'invalid_contact_command' })
    expect(fixture.rpc).toHaveBeenCalledTimes(1)
  })

  it('rejects OPS without a verified live-session identifier before RPC', async () => {
    await expect(changeCustomerContact({
      ...base, actor: { kind: 'ops', userId: 'actor-a', reason: 'Unverified session' } as never,
    })).rejects.toMatchObject({ code: 'contact_actor_forbidden', status: 403 })
    expect(fixture.rpc).not.toHaveBeenCalled()
  })

  it('maps current authorization and cross-category route-key conflicts without retrying a legacy writer', async () => {
    fixture.rpc.mockResolvedValueOnce({ data: null, error: { message: 'profile_actor_forbidden', code: '42501' } })
    await expect(changeCustomerContact({ ...base, actor: { kind: 'ops', userId: 'actor-a', sessionId: 'verified-session-a', reason: 'Correction' } }))
      .rejects.toMatchObject({ code: 'profile_actor_forbidden', status: 403 })
    fixture.rpc.mockResolvedValueOnce({ data: null, error: { message: 'idempotency_conflict', code: 'P0001' } })
    await expect(changeCustomerContact({ ...base, actor: { kind: 'api', clientId: 'client-a', subject: 'subject-a' } }))
      .rejects.toMatchObject({ code: 'idempotency_conflict', status: 409 })
    expect(fixture.rpc).toHaveBeenCalledTimes(2)
    expect(fixture.rpc.mock.calls.every(([name]) => name === 'gridex_change_customer_contact_v2')).toBe(true)
  })

  it('fails closed when the v2 migration is absent and never retries v1', async () => {
    fixture.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'Could not find public.gridex_change_customer_contact_v2(p_command) in the schema cache' } })
    await expect(changeCustomerContact({ ...base, actor: { kind: 'api', clientId: 'client-a', subject: 'subject-a' } }))
      .rejects.toMatchObject({ code: 'platform_schema_not_ready', status: 503 })
    fixture.rpc.mockResolvedValueOnce({ data: null, error: { code: 'XX000', message: 'late audit insert failed' } })
    await expect(changeCustomerContact({ ...base, actor: { kind: 'api', clientId: 'client-a', subject: 'subject-a' } }))
      .rejects.toMatchObject({ code: 'XX000' })
    expect(fixture.rpc.mock.calls.every(([name]) => name === 'gridex_change_customer_contact_v2')).toBe(true)
  })

  it('allows only the API legacy replay to omit revision and preserves the stored public business body', async () => {
    const publicBody = { data: { completion_reference: 'old-completion', created_at: '2026-09-28T01:02:03.123456Z', status: 'accepted', profile_updated: true, facility_updated: false, address_result: null } }
    fixture.rpc.mockResolvedValueOnce({ data: { companyId: base.companyId, customerId: base.customerId, publicBody, statusCode: 200, replayed: true }, error: null })
    const legacy = { companyId: base.companyId, customerId: base.customerId, idempotencyKey: base.idempotencyKey, changes: base.changes }
    expect(await changeCustomerContact({ ...legacy, actor: { kind: 'api', clientId: 'client-a', subject: 'subject-a' } })).toEqual({ publicBody, statusCode: 200, replayed: true })
    expect(fixture.rpc.mock.calls[0][1].p_command.requestJson).toBe('{"profile":{"phone":"+46123456789"}}')
    fixture.rpc.mockResolvedValueOnce({ data: null, error: { code: '22023', message: 'contact_revision_required' } })
    await expect(changeCustomerContact({ ...legacy, actor: { kind: 'api', clientId: 'client-a', subject: 'subject-a' } })).rejects.toMatchObject({ code: 'contact_revision_required', status: 422 })
  })

  it('refuses forged response scope and maps revision conflicts', async () => {
    fixture.rpc.mockResolvedValueOnce({ data: { companyId: 'tenant-b', customerId: 'customer-a', revision: 5, changed: true, replayed: false }, error: null })
    await expect(changeCustomerContact({ ...base, actor: { kind: 'ops', userId: 'actor-a', sessionId: 'verified-session-a', reason: 'Correction' } }))
      .rejects.toMatchObject({ code: 'contact_result_invalid', status: 503 })
    fixture.rpc.mockResolvedValueOnce({ data: null, error: { message: 'contact_revision_conflict' } })
    await expect(changeCustomerContact({ ...base, actor: { kind: 'ops', userId: 'actor-a', sessionId: 'verified-session-a', reason: 'Correction' } }))
      .rejects.toMatchObject({ code: 'contact_revision_conflict', status: 409 })
  })

  it('checks current result scope even for a completed legacy public replay', async () => {
    fixture.rpc.mockResolvedValueOnce({ data: { companyId: 'tenant-b', customerId: base.customerId,
      statusCode: 200, publicBody: { data: { status: 'accepted' } }, replayed: true }, error: null })
    await expect(changeCustomerContact({ ...base, actor: { kind: 'api', clientId: 'client-a', subject: 'subject-a' } }))
      .rejects.toMatchObject({ code: 'contact_result_invalid', status: 503 })
  })

  it('does not accept a negative persisted contact revision', async () => {
    fixture.rpc.mockResolvedValueOnce({ data: { companyId: base.companyId, customerId: base.customerId,
      revision: -1, changed: true, replayed: false }, error: null })
    await expect(changeCustomerContact({ ...base, actor: { kind: 'api', clientId: 'client-a', subject: 'subject-a' } }))
      .rejects.toMatchObject({ code: 'contact_result_invalid', status: 503 })
  })

  it('rejects API changes to contact identity and invalid revision before RPC', async () => {
    await expect(changeCustomerContact({
      ...base, actor: { kind: 'api', clientId: 'client-a', subject: 'subject-a' },
      changes: { name: 'Another person' },
    })).rejects.toBeInstanceOf(ContactCommandError)
    await expect(changeCustomerContact({
      ...base, expectedRevision: -1, actor: { kind: 'ops', userId: 'actor-a', sessionId: 'verified-session-a', reason: 'Correction' },
    })).rejects.toBeInstanceOf(ContactCommandError)
    expect(fixture.rpc).not.toHaveBeenCalled()
  })
})

describe('profile-update contact-only contract', () => {
  it('permits legacy billing lookup while refusing mixed billing mutation categories', () => {
    expect(parseCustomerProfileUpdateRequest({ profile: { invoice_email: 'bill@example.invalid' } }))
      .toEqual({ profile: { invoice_email: 'bill@example.invalid' } })
    expect(() => parseCustomerProfileUpdateRequest({ profile: { invoice_email: 'bill@example.invalid', language_code: 'sv' }, expected_billing_revision: 2 })).toThrow(ApiInputError)
    expect(() => parseCustomerProfileUpdateRequest({ profile: { phone: '+46123456789' }, expected_contact_revision: 2, expected_billing_revision: 2 })).toThrow(ApiInputError)
    expect(parseCustomerProfileUpdateRequest({ profile: { invoice_email: 'bill@example.invalid' }, expected_billing_revision: 2 })).toMatchObject({ expected_billing_revision: 2 })
  })
  it('permits revision omission only for transactional legacy lookup and refuses mixed contact writes', () => {
    expect(parseCustomerProfileUpdateRequest({ profile: { phone: '+46123456789' } })).toEqual({ profile: { phone: '+46123456789' } })
    expect(() => parseCustomerProfileUpdateRequest({
      profile: { phone: '+46123456789', first_name: 'Synthetic' },
      expected_contact_revision: 4,
    })).toThrow(ApiInputError)
    expect(() => parseCustomerProfileUpdateRequest({
      profile: { phone: '+46123456789' },
      facility_data: { facility_reference: 'synthetic', address: { city: 'Stockholm' } },
      expected_contact_revision: 4,
    })).toThrow(ApiInputError)
    expect(parseCustomerProfileUpdateRequest({
      profile: { phone: '+46123456789' }, expected_contact_revision: 4,
    })).toMatchObject({ expected_contact_revision: 4 })
  })
})
