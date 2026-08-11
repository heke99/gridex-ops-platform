import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  LOGIN_INVALID_CREDENTIALS_MESSAGE,
  LOGIN_TEMPORARILY_UNAVAILABLE_MESSAGE,
  loginErrorMessage,
} from '@/lib/auth/loginError'

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

describe('production cron scheduling', () => {
  it('does not schedule test-environment mailbox pollers in the production deployment', () => {
    const config = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'vercel.json'), 'utf8')) as {
      crons?: Array<{ path?: string; schedule?: string }>
    }
    const paths = (config.crons ?? []).map((cron) => cron.path ?? '')

    expect(paths).not.toContain('/api/internal/inbound-mail/cron?environment=test')
    expect(paths).not.toContain('/api/internal/manual-inbound/cron?environment=test')
    expect(paths).toContain('/api/internal/inbound-mail/cron?environment=production')
    expect(paths).toContain('/api/internal/manual-inbound/cron?environment=production')
  })
})
