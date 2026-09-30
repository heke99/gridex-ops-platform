import { beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), site: {} as Record<string, unknown> }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: fixture.rpc, from: fixture.from } }))
import { changeCustomerProfilePreferences } from '@/lib/customer-operations/profilePreferencesCommand'
import { changeCustomerFacilityProfile } from '@/lib/customer-operations/facilityProfileCommand'

const companyId = '11111111-1111-4111-8111-111111111111'
const customerId = '22222222-2222-4222-8222-222222222222'
const actor = { kind: 'api' as const, clientId: '33333333-3333-4333-8333-333333333333', subject: 'subject-a' }
const base = { companyId, customerId, actor, idempotencyKey: 'profile-command-test-key' }
const body = { data: { profile_updated: true, profile_revision: 8, status: 'accepted' } }

describe('profile/facility service command boundary', () => {
  beforeEach(() => {
    fixture.rpc.mockReset()
    fixture.from.mockReset()
    fixture.site = { id: '44444444-4444-4444-8444-444444444444', address_revision: 4,
      street: '  Testgatan   1 ', postal_code: '123 45', city: 'Malmö', country: 'SE', care_of: 'Existing care', apartment_number: '1001' }
    fixture.from.mockImplementation(() => {
      const query: Record<string, unknown> = {}
      for (const field of ['select', 'eq']) query[field] = () => query
      query.maybeSingle = async () => ({ data: fixture.site, error: null })
      return query
    })
  })

  it('passes exact compact canonical legacy payload bytes and preserves stored business response', async () => {
    const stored = { statusCode: 200, body, replayed: true }
    fixture.rpc.mockResolvedValueOnce({ data: stored, error: null })
    const result = await changeCustomerProfilePreferences({ ...base,
      payload: { profile: { timezone: 'Europe/Stockholm', language_code: 'sv' }, metadata: { z: 1e-7, a: 'Ä' } } })
    expect(result).toEqual(stored)
    const command = fixture.rpc.mock.calls[0][1].p_command
    expect(command.requestJson).toBe('{"metadata":{"a":"Ä","z":1e-7},"profile":{"language_code":"sv","timezone":"Europe/Stockholm"}}')
    expect(command).toMatchObject({ companyId, customerId, mode: 'api', clientId: actor.clientId, subject: actor.subject, actorUserId: null, sessionId: null })
    expect(command).not.toHaveProperty('requestHash')
  })

  it('passes OPS session attribution and maps current-authority/revision errors without unsafe fallback', async () => {
    fixture.rpc.mockResolvedValueOnce({ data: null, error: { message: 'profile_revision_conflict' } })
    await expect(changeCustomerProfilePreferences({ ...base,
      actor: { kind: 'ops', userId: customerId, sessionId: actor.clientId, reason: 'Verified support correction' },
      payload: { profile: { language_code: 'en' }, expected_profile_revision: 7 } }))
      .rejects.toMatchObject({ code: 'profile_revision_conflict', status: 409 })
    expect(fixture.rpc.mock.calls[0][1].p_command).toMatchObject({ actorUserId: customerId, sessionId: actor.clientId, clientId: null, subject: null })
    fixture.rpc.mockResolvedValueOnce({ data: null, error: { message: 'profile_actor_forbidden' } })
    await expect(changeCustomerProfilePreferences({ ...base, payload: { profile: { language_code: 'sv' }, expected_profile_revision: 7 } }))
      .rejects.toMatchObject({ code: 'profile_actor_forbidden', status: 403 })
  })

  it('rejects forged actors and malformed commands and converts missing schema into safe503', async () => {
    await expect(changeCustomerProfilePreferences({ ...base,
      actor: { ...actor, verified: true } as typeof actor,
      payload: { profile: { language_code: 'sv' } } })).rejects.toMatchObject({ status: 422 })
    expect(fixture.rpc).not.toHaveBeenCalled()
    fixture.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'missing function' } })
    await expect(changeCustomerProfilePreferences({ ...base, payload: { profile: { language_code: 'sv' } } }))
      .rejects.toMatchObject({ code: 'platform_schema_not_ready', status: 503 })
  })

  it('merges only supplied address fields with the owned snapshot and preserves public result allowlist', async () => {
    const facilityResult = { statusCode: 200, body: { data: { facility_updated: true, address_revision: 5,
      address_result: { status: 'updated', address_hash: 'hash' } } }, replayed: false }
    fixture.rpc.mockResolvedValueOnce({ data: facilityResult, error: null })
    expect(await changeCustomerFacilityProfile({ ...base,
      payload: { facility_data: { facility_reference: 'facility-owned', expected_address_revision: 4, address: { city: '  Göteborg ' } } } }))
      .toEqual(facilityResult)
    const command = fixture.rpc.mock.calls[0][1].p_command
    expect(command.candidate).toMatchObject({ street: 'Testgatan 1', postal_code: '12345', city: 'Göteborg', country: 'SE', care_of: 'Existing care', apartment_number: '1001', snapshotRevision: 4 })
    expect(command.candidate.normalized).toBe('testgatan 1|1001|12345|göteborg|se')
    expect(command.candidate.address_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(command.requestJson).toBe('{"facility_data":{"address":{"city":"  Göteborg "},"expected_address_revision":4,"facility_reference":"facility-owned"}}')
    expect(JSON.stringify(facilityResult.body)).not.toMatch(/siteId|normalized/)
  })
})
