// poa-mail-review: #10, #16
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveManualMailboxEnvironment, resolveManualMailboxSecret } from '@/lib/email/manualOperationsMailbox'

afterEach(() => { vi.unstubAllEnvs() })

describe('#10 manual ops environment', () => {
  it('ignores NODE_ENV=production on Vercel previews and fails closed', () => {
    vi.stubEnv('GRIDEX_MANUAL_OPS_ENVIRONMENT', '')
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('VERCEL_ENV', 'preview')
    expect(resolveManualMailboxEnvironment()).toBe('test')
    vi.stubEnv('VERCEL_ENV', '')
    expect(resolveManualMailboxEnvironment()).toBe('test')
  })

  it('is production only for VERCEL_ENV=production or an explicit override', () => {
    vi.stubEnv('GRIDEX_MANUAL_OPS_ENVIRONMENT', '')
    vi.stubEnv('VERCEL_ENV', 'production')
    expect(resolveManualMailboxEnvironment()).toBe('production')
    vi.stubEnv('GRIDEX_MANUAL_OPS_ENVIRONMENT', 'test')
    expect(resolveManualMailboxEnvironment()).toBe('test')
    vi.stubEnv('VERCEL_ENV', 'preview')
    vi.stubEnv('GRIDEX_MANUAL_OPS_ENVIRONMENT', 'production')
    expect(resolveManualMailboxEnvironment()).toBe('production')
  })
})

describe('#16 manual mailbox secret references', () => {
  it('refuses database references to arbitrary server secrets', () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-secret')
    vi.stubEnv('RESEND_API_KEY', 'resend-secret')
    vi.stubEnv('MANUAL_OPS_IMAP_PASS', 'fallback')
    expect(resolveManualMailboxSecret('env:SUPABASE_SERVICE_ROLE_KEY', 'mbx-1')).toBeNull()
    expect(resolveManualMailboxSecret('RESEND_API_KEY', 'mbx-1')).toBeNull()
  })

  it('resolves MANUAL_MAILBOX_* references and the documented fallbacks', () => {
    vi.stubEnv('MANUAL_MAILBOX_OPS_PASSWORD', 'imap-pass')
    vi.stubEnv('MANUAL_OPS_IMAP_PASS', 'fallback')
    expect(resolveManualMailboxSecret('env:MANUAL_MAILBOX_OPS_PASSWORD', 'mbx-1')).toBe('imap-pass')
    expect(resolveManualMailboxSecret('MANUAL_MAILBOX_OPS_PASSWORD', 'mbx-1')).toBe('imap-pass')
    expect(resolveManualMailboxSecret(null, 'mbx-1')).toBe('fallback')
  })
})
