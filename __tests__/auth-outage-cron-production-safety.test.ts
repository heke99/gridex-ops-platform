import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  AUTH_ACTION_LINK_EXPIRED_MESSAGE,
  AUTH_ACTION_LINK_MISSING_INFO_MESSAGE,
  COMPANY_INVITE_ACCEPT_FAILED_MESSAGE,
  COMPANY_INVITE_MISSING_TOKEN_MESSAGE,
  FORGOT_PASSWORD_EMAIL_REQUIRED_MESSAGE,
  FORGOT_PASSWORD_SEND_FAILED_MESSAGE,
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
  sanitizeAuthActionErrorFlash,
  sanitizeCompanyInviteErrorFlash,
  sanitizeForgotPasswordErrorFlash,
  LOGIN_ACCOUNT_DISABLED_MESSAGE,
  loginReasonErrorFlash,
  sanitizeLoginErrorFlash,
  sanitizeLoginSuccessFlash,
  sanitizeUpdatePasswordErrorFlash,
} from '@/lib/auth/loginError'
import { getBaseAppUrl as getAuthEmailFlowBaseAppUrl } from '@/lib/auth/authEmailFlow'
import { getBaseAppUrl, getSafeNextPath } from '@/lib/auth/urls'
import {
  EXTERNAL_CONTRACT_GENERIC_ERROR_MESSAGE,
  EXTERNAL_CONTRACT_SUCCESS_CREATED_MESSAGE,
  sanitizeExternalContractFlash,
} from '@/lib/external-contracts/publicIntakeFlash'
import {
  PORTAL_COMPLETION_CUSTOMER_MISSING_MESSAGE,
  PORTAL_COMPLETION_EMPTY_MESSAGE,
  sanitizePortalCompletionBlockedFlash,
} from '@/lib/customer-portal/completionFlash'

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

describe('sibling auth flash allowlists', () => {
  it('keeps known forgot-password / auth-action / company-invite flashes', () => {
    expect(sanitizeForgotPasswordErrorFlash(FORGOT_PASSWORD_EMAIL_REQUIRED_MESSAGE)).toBe(
      FORGOT_PASSWORD_EMAIL_REQUIRED_MESSAGE,
    )
    expect(sanitizeForgotPasswordErrorFlash(FORGOT_PASSWORD_SEND_FAILED_MESSAGE)).toBe(
      FORGOT_PASSWORD_SEND_FAILED_MESSAGE,
    )
    expect(sanitizeAuthActionErrorFlash(AUTH_ACTION_LINK_MISSING_INFO_MESSAGE)).toBe(
      AUTH_ACTION_LINK_MISSING_INFO_MESSAGE,
    )
    expect(sanitizeAuthActionErrorFlash(AUTH_ACTION_LINK_EXPIRED_MESSAGE)).toBe(
      AUTH_ACTION_LINK_EXPIRED_MESSAGE,
    )
    expect(sanitizeAuthActionErrorFlash(LOGIN_VERIFY_LINK_EXPIRED_MESSAGE)).toBe(
      LOGIN_VERIFY_LINK_EXPIRED_MESSAGE,
    )
    expect(sanitizeCompanyInviteErrorFlash(COMPANY_INVITE_MISSING_TOKEN_MESSAGE)).toBe(
      COMPANY_INVITE_MISSING_TOKEN_MESSAGE,
    )
    expect(sanitizeCompanyInviteErrorFlash(COMPANY_INVITE_ACCEPT_FAILED_MESSAGE)).toBe(
      COMPANY_INVITE_ACCEPT_FAILED_MESSAGE,
    )
  })

  it('replaces crafted sibling auth flashes instead of rendering phishing copy', () => {
    const crafted =
      'Ditt konto är låst. Skicka lösenordet till attacker@evil.example för att låsa upp.'
    expect(sanitizeForgotPasswordErrorFlash(crafted)).toBe(FORGOT_PASSWORD_SEND_FAILED_MESSAGE)
    expect(sanitizeAuthActionErrorFlash(crafted)).toBe(AUTH_ACTION_LINK_EXPIRED_MESSAGE)
    expect(sanitizeCompanyInviteErrorFlash(crafted)).toBe(COMPANY_INVITE_ACCEPT_FAILED_MESSAGE)
    expect(sanitizeForgotPasswordErrorFlash(crafted)).not.toContain('attacker@evil.example')
  })

  it('wires sanitizers into sibling auth pages', () => {
    const forgot = fs.readFileSync(
      path.join(process.cwd(), 'app/login/forgot-password/page.tsx'),
      'utf8',
    )
    const action = fs.readFileSync(path.join(process.cwd(), 'app/auth/action/page.tsx'), 'utf8')
    const invite = fs.readFileSync(
      path.join(process.cwd(), 'app/auth/company-invite/page.tsx'),
      'utf8',
    )

    expect(forgot).toContain('sanitizeForgotPasswordErrorFlash')
    expect(action).toContain('sanitizeAuthActionErrorFlash')
    expect(invite).toContain('sanitizeCompanyInviteErrorFlash')
    expect(forgot).not.toMatch(/const error = params\.error\b/)
    expect(action).not.toMatch(/const error = params\.error\b/)
    expect(invite).not.toMatch(/const error = params\.error\b/)
  })
})

describe('canonical base app URL', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('fails closed in production when no public app URL is configured', () => {
    process.env.NODE_ENV = 'production'
    delete process.env.NEXT_PUBLIC_APP_URL
    delete process.env.NEXT_PUBLIC_SITE_URL
    delete process.env.NEXT_PUBLIC_BASE_URL
    delete process.env.SITE_URL
    delete process.env.VERCEL_URL

    expect(() => getBaseAppUrl()).toThrow(/Missing required production app URL/)
    expect(() => getAuthEmailFlowBaseAppUrl()).toThrow(/Missing required production app URL/)
  })

  it('prefers NEXT_PUBLIC_APP_URL and is shared by auth email flow', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://ops.example'
    process.env.NEXT_PUBLIC_SITE_URL = 'https://site.example'
    expect(getBaseAppUrl()).toBe('https://ops.example')
    expect(getAuthEmailFlowBaseAppUrl()).toBe('https://ops.example')
  })

  it('canonical getSafeNextPath accepts same-origin absolute URLs used by auth email flow', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://ops.example'
    expect(getSafeNextPath('https://ops.example/admin/customers', '/login')).toBe(
      '/admin/customers',
    )
    expect(getSafeNextPath('https://evil.example/admin', '/login')).toBe('/login')

    const authEmailFlow = fs.readFileSync(
      path.join(process.cwd(), 'lib/auth/authEmailFlow.ts'),
      'utf8',
    )
    expect(authEmailFlow).toContain("from '@/lib/auth/urls'")
    expect(authEmailFlow).not.toMatch(/export function getSafeNextPath\s*\(/)
  })

  it('logout and password-reset email use the shared fail-closed base URL helper', () => {
    const logout = fs.readFileSync(path.join(process.cwd(), 'app/logout/route.ts'), 'utf8')
    const passwordReset = fs.readFileSync(
      path.join(process.cwd(), 'lib/tenant/passwordResetEmail.ts'),
      'utf8',
    )
    const authEmailFlow = fs.readFileSync(
      path.join(process.cwd(), 'lib/auth/authEmailFlow.ts'),
      'utf8',
    )

    expect(logout).toContain("from '@/lib/auth/urls'")
    expect(logout).toContain('getBaseAppUrl()')
    expect(logout).not.toContain("process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'")
    expect(passwordReset).toContain("from '@/lib/auth/urls'")
    expect(passwordReset).toContain('getBaseAppUrl()')
    expect(passwordReset).not.toMatch(/function getBaseAppUrl\s*\(/)
    expect(authEmailFlow).toContain("from '@/lib/auth/urls'")
    expect(authEmailFlow).not.toMatch(/export function getBaseAppUrl\s*\(/)
  })
})

describe('disabled-session login reason flash', () => {
  it('maps allowlisted account_disabled reason to a fixed Swedish error flash', () => {
    expect(loginReasonErrorFlash('account_disabled')).toBe(LOGIN_ACCOUNT_DISABLED_MESSAGE)
    expect(loginReasonErrorFlash('temporary_password')).toBeNull()
    expect(loginReasonErrorFlash('Please wire money to attacker@evil.example')).toBeNull()
  })

  it('login page consumes reason through the allowlisted mapper', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'app/login/page.tsx'), 'utf8')
    expect(source).toContain('loginReasonErrorFlash')
    expect(source).toMatch(/reason\?:/)
    expect(source).not.toMatch(/const error = params\.error\b/)
  })
})

describe('public and portal query flash allowlists', () => {
  it('rejects crafted teckna-avtal success/error flashes and never trusts raw Error text', () => {
    expect(
      sanitizeExternalContractFlash('success', EXTERNAL_CONTRACT_SUCCESS_CREATED_MESSAGE),
    ).toEqual({
      status: 'success',
      message: EXTERNAL_CONTRACT_SUCCESS_CREATED_MESSAGE,
    })
    expect(
      sanitizeExternalContractFlash('success', 'Wire money to attacker@evil.example'),
    ).toBeNull()
    expect(
      sanitizeExternalContractFlash('error', 'PostgREST connection secret=abc'),
    ).toEqual({
      status: 'error',
      message: EXTERNAL_CONTRACT_GENERIC_ERROR_MESSAGE,
    })

    const actions = fs.readFileSync(
      path.join(process.cwd(), 'app/teckna-avtal/actions.ts'),
      'utf8',
    )
    const page = fs.readFileSync(path.join(process.cwd(), 'app/teckna-avtal/page.tsx'), 'utf8')
    expect(actions).toContain('externalContractErrorFlash')
    expect(actions).not.toMatch(/error instanceof Error \? error\.message/)
    expect(page).toContain('sanitizeExternalContractFlash')
    expect(page).not.toMatch(/\{params\.message\}/)
  })

  it('allowlists portal completion blocked flashes', () => {
    expect(sanitizePortalCompletionBlockedFlash(PORTAL_COMPLETION_CUSTOMER_MISSING_MESSAGE)).toBe(
      PORTAL_COMPLETION_CUSTOMER_MISSING_MESSAGE,
    )
    expect(sanitizePortalCompletionBlockedFlash(PORTAL_COMPLETION_EMPTY_MESSAGE)).toBe(
      PORTAL_COMPLETION_EMPTY_MESSAGE,
    )
    expect(sanitizePortalCompletionBlockedFlash('attacker@evil.example')).toBe(
      PORTAL_COMPLETION_EMPTY_MESSAGE,
    )

    const page = fs.readFileSync(
      path.join(process.cwd(), 'app/portal/komplettera/page.tsx'),
      'utf8',
    )
    expect(page).toContain('sanitizePortalCompletionBlockedFlash')
    expect(page).not.toMatch(/params\.message \?\?/)
  })
})

describe('auth action error redirect preserves retry context', () => {
  it('keeps token_hash, type and next on verify failure redirects', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'app/auth/action/actions.ts'),
      'utf8',
    )
    expect(source).toMatch(/function redirectBackWithError\([\s\S]*token_hash/)
    expect(source).toContain('params.set(')
    expect(source).toContain("params.set('token_hash'")
    expect(source).toContain("params.set('type'")
    expect(source).toContain("params.set('next'")
    expect(source).not.toMatch(
      /redirect\(`\/auth\/action\?error=\$\{encodeURIComponent\(message\)\}`\)/,
    )
  })
})

describe('dependency remediation pin', () => {
  it('keeps production-relevant audit remediations pinned via package.json overrides', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
    ) as {
      overrides?: Record<string, unknown>
    }
    const overrides = pkg.overrides ?? {}
    expect(overrides.nanoid).toBe('3.3.18')
    expect(overrides['js-yaml']).toBe('4.3.1')
    expect(overrides['brace-expansion']).toBe('1.1.18')
    expect(overrides['@typescript-eslint/typescript-estree']).toEqual({
      'brace-expansion': '5.0.9',
    })
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
