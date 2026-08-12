import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  LOGIN_EMAIL_CONFIRMED_MESSAGE,
  LOGIN_INVALID_CREDENTIALS_MESSAGE,
  LOGIN_INVITE_ACCEPTED_MESSAGE,
  LOGIN_MISSING_FIELDS_MESSAGE,
  LOGIN_TEMPORARILY_UNAVAILABLE_MESSAGE,
  LOGIN_VERIFY_LINK_EXPIRED_MESSAGE,
  LOGIN_VERIFY_LINK_MISSING_CODE_MESSAGE,
  UPDATE_PASSWORD_FAILED_MESSAGE,
  UPDATE_PASSWORD_TOO_SHORT_MESSAGE,
  loginErrorMessage,
  sanitizeLoginErrorFlash,
  sanitizeLoginSuccessFlash,
  sanitizeUpdatePasswordErrorFlash,
} from '@/lib/auth/loginError'
import { getSafeNextPath } from '@/lib/auth/urls'

describe('login auth error classification', () => {
  it('keeps invalid credentials indistinguishable', () => {
    expect(loginErrorMessage({ code: 'invalid_credentials', status: 400, name: 'AuthApiError' }))
      .toBe(LOGIN_INVALID_CREDENTIALS_MESSAGE)
  })

  it.each([
    { name: 'AuthUnknownError', status: 0, message: 'fetch failed' },
    { name: 'AuthRetryableFetchError', status: 503, message: 'Service unavailable' },
    { status: 522, message: 'Connection timed out' },
    new Error('network failure'),
    null,
  ])('does not mislabel provider or infrastructure failures as credential failures', (error) => {
    expect(loginErrorMessage(error)).toBe(LOGIN_TEMPORARILY_UNAVAILABLE_MESSAGE)
    expect(loginErrorMessage(error)).not.toBe(LOGIN_INVALID_CREDENTIALS_MESSAGE)
  })

  it('does not expose raw provider error text', () => {
    const raw = 'AuthUnknownError: db.piidsfebjqjmnepdpnas.supabase.co connection timed out secret=abc'
    expect(loginErrorMessage({ name: 'AuthUnknownError', message: raw })).not.toContain(raw)
    expect(loginErrorMessage({ name: 'AuthUnknownError', message: raw })).not.toContain('supabase.co')
    expect(loginErrorMessage({ name: 'AuthUnknownError', message: raw })).not.toContain('secret=abc')
  })
})

describe('login error flash allowlist', () => {
  it('keeps known login action messages', () => {
    expect(sanitizeLoginErrorFlash(LOGIN_INVALID_CREDENTIALS_MESSAGE)).toBe(
      LOGIN_INVALID_CREDENTIALS_MESSAGE,
    )
    expect(sanitizeLoginErrorFlash(LOGIN_TEMPORARILY_UNAVAILABLE_MESSAGE)).toBe(
      LOGIN_TEMPORARILY_UNAVAILABLE_MESSAGE,
    )
    expect(sanitizeLoginErrorFlash(LOGIN_MISSING_FIELDS_MESSAGE)).toBe(LOGIN_MISSING_FIELDS_MESSAGE)
  })

  it('keeps auth-callback verification failure messages', () => {
    expect(sanitizeLoginErrorFlash(LOGIN_VERIFY_LINK_MISSING_CODE_MESSAGE)).toBe(
      LOGIN_VERIFY_LINK_MISSING_CODE_MESSAGE,
    )
    expect(sanitizeLoginErrorFlash(LOGIN_VERIFY_LINK_EXPIRED_MESSAGE)).toBe(
      LOGIN_VERIFY_LINK_EXPIRED_MESSAGE,
    )
  })

  it('replaces crafted query-string phishing text with the outage message', () => {
    const crafted =
      'Ditt konto är låst. Skicka lösenordet till attacker@evil.example för att låsa upp.'
    expect(sanitizeLoginErrorFlash(crafted)).toBe(LOGIN_TEMPORARILY_UNAVAILABLE_MESSAGE)
    expect(sanitizeLoginErrorFlash(crafted)).not.toContain('attacker@evil.example')
  })

  it('replaces crafted update-password flashes with the generic failure message', () => {
    const crafted = 'Ange engångskoden från attacker@evil.example för att fortsätta.'
    expect(sanitizeUpdatePasswordErrorFlash(crafted)).toBe(UPDATE_PASSWORD_FAILED_MESSAGE)
    expect(sanitizeUpdatePasswordErrorFlash(UPDATE_PASSWORD_TOO_SHORT_MESSAGE)).toBe(
      UPDATE_PASSWORD_TOO_SHORT_MESSAGE,
    )
  })
})

describe('login success flash allowlist', () => {
  it('keeps known success flashes and drops phishing copy', () => {
    expect(sanitizeLoginSuccessFlash(LOGIN_EMAIL_CONFIRMED_MESSAGE)).toBe(
      LOGIN_EMAIL_CONFIRMED_MESSAGE,
    )
    expect(sanitizeLoginSuccessFlash(LOGIN_INVITE_ACCEPTED_MESSAGE)).toBe(
      LOGIN_INVITE_ACCEPTED_MESSAGE,
    )
    const crafted =
      'Inbjudan accepterad. Skicka engångskoden till attacker@evil.example för att aktivera kontot.'
    expect(sanitizeLoginSuccessFlash(crafted)).toBeNull()
    expect(String(sanitizeLoginSuccessFlash(crafted) ?? '')).not.toContain('attacker@evil.example')
  })
})

describe('login next-path hardening', () => {
  it('rejects protocol-relative and backslash open-redirect shapes', () => {
    expect(getSafeNextPath('//evil.example')).toBe('/dashboard')
    expect(getSafeNextPath('/\\evil.example')).toBe('/dashboard')
    expect(getSafeNextPath('/admin\\@evil.example')).toBe('/dashboard')
    expect(getSafeNextPath('/%5Cevil.example')).toBe('/dashboard')
    expect(getSafeNextPath('%2F%5Cevil.example')).toBe('/dashboard')
    expect(getSafeNextPath('/dashboard/customers')).toBe('/dashboard/customers')
  })
})

describe('middleware auth outage safety', () => {
  it('fails protected routes closed when auth or authorization infrastructure errors', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'proxy.ts'), 'utf8')

    expect(source).toContain("return authServiceUnavailable(request, 'get_user', error)")
    expect(source).toContain('if (sessionCheckError)')
    expect(source).toContain("return authServiceUnavailable(request, 'session_allowed', sessionCheckError)")
    expect(source).toContain("return authServiceUnavailable(request, 'platform_admin_roles', error)")
    expect(source).toContain("'Retry-After': '15'")
  })

  it('reuses shared next-path hardening instead of a weaker local normalizer', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'proxy.ts'), 'utf8')

    expect(source).toContain("from '@/lib/auth/urls'")
    expect(source).toContain('getSafeNextPath(')
    expect(source).not.toContain('function normalizeNextPath')
  })

  it('does not log the raw provider response body from middleware', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'proxy.ts'), 'utf8')

    expect(source).toContain('safeAuthInfrastructureError')
    expect(source).not.toContain("console.error('[auth-proxy] provider unavailable', error)")
    expect(source).not.toContain('error.message')
  })

  it('still redirects disabled sessions when signOut itself fails during an outage', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'proxy.ts'), 'utf8')

    expect(source).toMatch(/try\s*\{\s*await supabase\.auth\.signOut\(\)/)
    expect(source).toContain("loginUrl.searchParams.set('reason', 'account_disabled')")
  })
})

describe('production cron scheduling', () => {
  it('does not schedule test-environment mailbox pollers in the production deployment', () => {
    const config = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'vercel.json'), 'utf8')) as {
      crons?: Array<{ path?: string; schedule?: string }>
    }
    const paths = (config.crons ?? []).map((cron) => cron.path ?? '')

    expect(paths.some((cronPath) => /(?:^|[?&])environment=test(?:&|$)/i.test(cronPath))).toBe(
      false,
    )
    expect(paths).not.toContain('/api/internal/inbound-mail/cron?environment=test')
    expect(paths).not.toContain('/api/internal/manual-inbound/cron?environment=test')
    expect(paths).toContain('/api/internal/inbound-mail/cron?environment=production')
    expect(paths).toContain('/api/internal/manual-inbound/cron?environment=production')
  })
})
