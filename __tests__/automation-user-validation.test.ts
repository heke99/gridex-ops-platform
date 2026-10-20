import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getUserById, from, select, eq, maybeSingle } = vi.hoisted(() => ({
  getUserById: vi.fn(), from: vi.fn(), select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({
  supabaseService: { auth: { admin: { getUserById } }, from },
}))

import { AUTOMATION_USER_ENV_KEY, validateAutomationUserConfig } from '@/lib/customer-operations/automationConfig'

const ACTOR = '0076220e-3b76-4c30-a2a2-310b64a9d264'
const OTHER = 'bc2babae-356d-44be-bc96-30da527aa2de'
const originalEnv = process.env[AUTOMATION_USER_ENV_KEY]

beforeEach(() => {
  vi.resetAllMocks()
  process.env[AUTOMATION_USER_ENV_KEY] = ACTOR
  getUserById.mockResolvedValue({ data: { user: { id: ACTOR, email_confirmed_at: '2026-01-01T00:00:00Z' } }, error: null })
  from.mockReturnValue({ select })
  select.mockReturnValue({ eq })
  eq.mockReturnValue({ maybeSingle })
  maybeSingle.mockResolvedValue({ data: { id: ACTOR, user_status: 'active' }, error: null })
})

afterEach(() => {
  if (originalEnv === undefined) delete process.env[AUTOMATION_USER_ENV_KEY]
  else process.env[AUTOMATION_USER_ENV_KEY] = originalEnv
})

describe('automation actor runtime qualification', () => {
  it.each([['', 'missing'], ['not-a-uuid', 'invalid_uuid']])('rejects invalid configuration %s', async (value, issue) => {
    process.env[AUTOMATION_USER_ENV_KEY] = value
    expect(await validateAutomationUserConfig()).toMatchObject({ ok: false, issue, userId: null })
    expect(getUserById).not.toHaveBeenCalled()
    expect(from).not.toHaveBeenCalled()
  })

  it('accepts the exact verified Auth identity with an active profile', async () => {
    process.env[AUTOMATION_USER_ENV_KEY] = ` ${ACTOR.toUpperCase()} `
    expect(await validateAutomationUserConfig()).toEqual({ ok: true, userId: ACTOR, issue: null, message: null })
    expect(getUserById).toHaveBeenCalledWith(ACTOR)
    expect(from).toHaveBeenCalledWith('user_profiles')
    expect(eq).toHaveBeenCalledWith('id', ACTOR)
  })

  it.each([
    { message: 'User not found', status: 404 },
    { message: 'user does not exist' },
  ])('rejects a nonexistent Auth user', async error => {
    getUserById.mockResolvedValue({ data: { user: null }, error })
    expect(await validateAutomationUserConfig()).toMatchObject({ ok: false, issue: 'user_not_found' })
    expect(from).not.toHaveBeenCalled()
  })

  it.each([null, { id: OTHER }])('rejects missing or mismatched Auth identity', async user => {
    getUserById.mockResolvedValue({ data: { user }, error: null })
    expect(await validateAutomationUserConfig()).toMatchObject({ ok: false, issue: 'user_not_found' })
    expect(from).not.toHaveBeenCalled()
  })

  it.each([
    { deleted_at: '2026-01-01T00:00:00Z' },
    { banned_until: '2999-01-01T00:00:00Z' },
    { banned_until: 'malformed' },
    { email_confirmed_at: null },
    { email_confirmed_at: 'malformed' },
  ])('rejects deleted or banned Auth identities', async lifecycle => {
    getUserById.mockResolvedValue({ data: { user: { id: ACTOR, email_confirmed_at: '2026-01-01T00:00:00Z', ...lifecycle } }, error: null })
    expect(await validateAutomationUserConfig()).toMatchObject({ ok: false, issue: 'user_inactive' })
    expect(from).not.toHaveBeenCalled()
  })

  it('accepts an expired Auth ban only with the active profile', async () => {
    getUserById.mockResolvedValue({ data: { user: { id: ACTOR, email_confirmed_at: '2026-01-01T00:00:00Z', banned_until: '2000-01-01T00:00:00Z' } }, error: null })
    expect(await validateAutomationUserConfig()).toMatchObject({ ok: true, issue: null })
  })

  it('fails closed when Auth verification is unavailable', async () => {
    getUserById.mockResolvedValue({ data: { user: null }, error: { status: 503, message: 'upstream unavailable' } })
    expect(await validateAutomationUserConfig()).toMatchObject({ ok: false, issue: 'verification_unavailable' })
    expect(from).not.toHaveBeenCalled()
  })

  it('fails closed when Auth verification throws', async () => {
    getUserById.mockRejectedValue(new Error('network unavailable'))
    expect(await validateAutomationUserConfig()).toMatchObject({ ok: false, issue: 'verification_unavailable' })
  })

  it('rejects an Auth-only automation account without a profile', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null })
    expect(await validateAutomationUserConfig()).toMatchObject({ ok: false, issue: 'profile_missing' })
  })

  it.each(['disabled', 'pending', null, undefined])('rejects profile status %s', async user_status => {
    maybeSingle.mockResolvedValue({ data: { id: ACTOR, user_status }, error: null })
    expect(await validateAutomationUserConfig()).toMatchObject({ ok: false, issue: 'profile_inactive' })
  })

  it('rejects a mismatched profile', async () => {
    maybeSingle.mockResolvedValue({ data: { id: OTHER, user_status: 'active' }, error: null })
    expect(await validateAutomationUserConfig()).toMatchObject({ ok: false, issue: 'profile_missing' })
  })

  it('fails closed when profile verification returns an error', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { code: '42501', message: 'unavailable' } })
    expect(await validateAutomationUserConfig()).toMatchObject({ ok: false, issue: 'verification_unavailable' })
  })

  it('fails closed when profile verification throws', async () => {
    maybeSingle.mockRejectedValue(new Error('network unavailable'))
    expect(await validateAutomationUserConfig()).toMatchObject({ ok: false, issue: 'verification_unavailable' })
  })
})
