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
      ...base, contactId: 'contact-a', actor: { kind: 'ops', userId: 'actor-a', reason: 'Corrections' },
    })).toMatchObject({ revision: 5, replayed: false })
    expect(await changeCustomerContact({
      ...base, actor: { kind: 'api', clientId: 'client-a', subject: 'subject-a' },
    })).toMatchObject({ revision: 5, replayed: true, completionReference: 'case-1' })
    expect(fixture.rpc.mock.calls.map(([name]) => name)).toEqual([
      'gridex_change_customer_contact_v1', 'gridex_change_customer_contact_v1',
    ])
    expect(fixture.rpc.mock.calls[0][1].p_command).toMatchObject({
      companyId: 'tenant-a', customerId: 'customer-a', contactId: 'contact-a',
      actorUserId: 'actor-a', mode: 'ops', expectedRevision: 4,
    })
    expect(fixture.rpc.mock.calls[1][1].p_command).toMatchObject({
      companyId: 'tenant-a', customerId: 'customer-a', clientId: 'client-a',
      subject: 'subject-a', actorUserId: null, mode: 'api', expectedRevision: 4,
    })
  })

  it('refuses forged response scope and maps revision conflicts', async () => {
    fixture.rpc.mockResolvedValueOnce({ data: { companyId: 'tenant-b', customerId: 'customer-a', revision: 5, changed: true, replayed: false }, error: null })
    await expect(changeCustomerContact({ ...base, actor: { kind: 'ops', userId: 'actor-a', reason: 'Correction' } }))
      .rejects.toMatchObject({ code: 'contact_result_invalid', status: 503 })
    fixture.rpc.mockResolvedValueOnce({ data: null, error: { message: 'contact_revision_conflict' } })
    await expect(changeCustomerContact({ ...base, actor: { kind: 'ops', userId: 'actor-a', reason: 'Correction' } }))
      .rejects.toMatchObject({ code: 'contact_revision_conflict', status: 409 })
  })

  it('rejects API changes to contact identity and invalid revision before RPC', async () => {
    await expect(changeCustomerContact({
      ...base, actor: { kind: 'api', clientId: 'client-a', subject: 'subject-a' },
      changes: { name: 'Another person' },
    })).rejects.toBeInstanceOf(ContactCommandError)
    await expect(changeCustomerContact({
      ...base, expectedRevision: -1, actor: { kind: 'ops', userId: 'actor-a', reason: 'Correction' },
    })).rejects.toBeInstanceOf(ContactCommandError)
    expect(fixture.rpc).not.toHaveBeenCalled()
  })
})

describe('profile-update contact-only contract', () => {
  it('requires a revision and refuses a mixed profile/facility write', () => {
    expect(() => parseCustomerProfileUpdateRequest({ profile: { phone: '+46123456789' } }))
      .toThrow(ApiInputError)
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
