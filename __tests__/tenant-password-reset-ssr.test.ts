// local finding: local/033. Supporting auth prerequisite, not whole scenario acceptance.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ports = vi.hoisted(() => ({
  generate: vi.fn(), listUsers: vi.fn(), reset: vi.fn(), send: vi.fn(),
  events: [] as Record<string, unknown>[],
  hasCompany: true,
}))

vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  auth: { admin: { listUsers: ports.listUsers, get generateLink() { return ports.generate } }, resetPasswordForEmail: ports.reset },
  from(table: string) {
    const query = {
      select: () => query, eq: () => query, neq: () => query, order: () => query, limit: () => query,
      async maybeSingle() {
        return { data: !ports.hasCompany ? null : table === 'user_profiles' ? { active_company_id: 'company-fixture' } : { company_id: 'company-fixture', status: 'active' }, error: null }
      },
      update: () => query,
      async insert(value: Record<string, unknown>) { ports.events.push(value); return { error: null } },
    }
    return query
  },
} }))
vi.mock('@/lib/auth/smtpTransactionalEmail', () => ({
  getAuthSmtpReadiness: () => ({ ready: true, missing: [], message: 'fixture' }),
  sendTransactionalEmail: ports.send,
}))
vi.mock('@/lib/tenant/emailBranding', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/tenant/emailBranding')>()
  return { ...actual, getTenantEmailBranding: async () => ({
    companyId: 'company-fixture', companyName: 'Synthetic company', displayName: 'Synthetic company',
    supportEmail: 'support@example.invalid', primaryColor: '#112233', logoUrl: null,
  }) }
})

import { sendTenantBrandedPasswordResetEmail } from '@/lib/tenant/passwordResetEmail'

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://127.0.0.1:3301')
  ports.events = []
  ports.hasCompany = true
  ports.listUsers.mockReset().mockResolvedValue({ data: { users: [{ id: 'user-fixture', email: 'actor@example.invalid' }] }, error: null })
  ports.generate = vi.fn().mockResolvedValue({ data: { properties: {
    hashed_token: 'synthetic-recovery-hash',
    action_link: 'https://provider.example.invalid/auth/v1/verify?type=recovery&token=synthetic-legacy-link',
    email_otp: 'synthetic-unused-otp',
  } }, error: null })
  ports.reset.mockReset().mockResolvedValue({ error: null })
  ports.send.mockReset().mockResolvedValue(undefined)
})
afterEach(() => vi.unstubAllEnvs())

describe('branded recovery email uses the existing SSR verification boundary', () => {
  it('renders a same-app recovery verification link rather than the provider fragment-session link', async () => {
    await sendTenantBrandedPasswordResetEmail({ email: 'actor@example.invalid' })
    const html = ports.send.mock.calls[0][0].html as string
    const href = html.match(/href="([^"]+)"/)![1].replaceAll('&amp;', '&')
    const url = new URL(href)
    expect(url.origin).toBe('http://127.0.0.1:3301')
    expect(url.pathname).toBe('/auth/callback')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      next: '/login/update-password', token_hash: 'synthetic-recovery-hash', type: 'recovery',
    })
    expect(html).not.toContain('synthetic-legacy-link')
    expect(html).not.toContain('synthetic-unused-otp')
  })

  it.each([undefined, null, ''])('fails closed before sending when the provider verification hash is missing: %s', async hashedToken => {
    ports.generate.mockResolvedValue({ data: { properties: { hashed_token: hashedToken, action_link: 'https://provider.example.invalid/legacy' } }, error: null })
    await expect(sendTenantBrandedPasswordResetEmail({ email: 'actor@example.invalid' })).rejects.toThrow()
    expect(ports.send).not.toHaveBeenCalled()
  })

  it('preserves the supported provider-email fallback when link generation is unavailable', async () => {
    ports.generate = undefined as unknown as typeof ports.generate
    const result = await sendTenantBrandedPasswordResetEmail({ email: 'actor@example.invalid' })
    expect(result).toEqual({ userId: 'user-fixture', companyId: 'company-fixture', branded: false, fallback: true })
    expect(ports.reset).toHaveBeenCalledWith('actor@example.invalid', {
      redirectTo: 'http://127.0.0.1:3301/auth/callback?next=%2Flogin%2Fupdate-password',
    })
    expect(ports.send).not.toHaveBeenCalled()
  })

  it('does not send a branded message after a provider error', async () => {
    ports.generate.mockResolvedValue({ data: null, error: new Error('synthetic provider failure') })
    await expect(sendTenantBrandedPasswordResetEmail({ email: 'actor@example.invalid' })).rejects.toThrow('synthetic provider failure')
    expect(ports.send).not.toHaveBeenCalled()
  })

  it('does not mint an unused recovery token before delegating a user without company scope', async () => {
    ports.hasCompany = false
    const result = await sendTenantBrandedPasswordResetEmail({ email: 'actor@example.invalid' })
    expect(result).toEqual({ userId: 'user-fixture', companyId: null, branded: false, fallback: true })
    expect(ports.generate).not.toHaveBeenCalled()
    expect(ports.reset).toHaveBeenCalledOnce()
    expect(ports.send).not.toHaveBeenCalled()
  })

  it('preserves the successful company-scoped delivery event and recipient', async () => {
    const result = await sendTenantBrandedPasswordResetEmail({ email: 'actor@example.invalid', source: 'public_forgot_password' })
    expect(result).toEqual({ userId: 'user-fixture', companyId: 'company-fixture', branded: true, fallback: false })
    expect(ports.send.mock.calls[0][0].to).toBe('actor@example.invalid')
    expect(ports.events).toContainEqual(expect.objectContaining({
      company_id: 'company-fixture', user_id: 'user-fixture', event_type: 'password_reset_sent', status: 'sent', source: 'public_forgot_password',
    }))
  })
})
