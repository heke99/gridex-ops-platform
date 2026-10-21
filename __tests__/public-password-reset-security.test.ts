import { AsyncLocalStorage } from 'node:async_hooks'
import { createRequire } from 'node:module'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const boundary = vi.hoisted(() => ({
  send: vi.fn(),
  rpc: vi.fn(),
  headers: vi.fn(),
}))
vi.mock('@/lib/tenant/passwordResetEmail', () => ({ sendTenantBrandedPasswordResetEmail: boundary.send }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: boundary.rpc } }))
vi.mock('next/headers', () => ({ headers: boundary.headers }))

// Use Next's actual request stores, after queue and redirect exception. Only the
// external tenant helper, RPC and incoming headers are synthetic boundaries.
Object.assign(globalThis, { AsyncLocalStorage })
const require = createRequire(import.meta.url)
const { AfterContext } = require('next/dist/server/after/after-context') as typeof import('next/dist/server/after/after-context')
const { workAsyncStorage } = require('next/dist/server/app-render/work-async-storage.external') as typeof import('next/dist/server/app-render/work-async-storage.external')
const { workUnitAsyncStorage } = require('next/dist/server/app-render/work-unit-async-storage.external') as typeof import('next/dist/server/app-render/work-unit-async-storage.external')
const { actionAsyncStorage } = require('next/dist/server/app-render/action-async-storage.external') as typeof import('next/dist/server/app-render/action-async-storage.external')
const { getURLFromRedirectError, getRedirectTypeFromError } = require('next/dist/client/components/redirect') as typeof import('next/dist/client/components/redirect')
const { isRedirectError } = require('next/dist/client/components/redirect-error') as typeof import('next/dist/client/components/redirect-error')
const receipt = '/login/forgot-password?sent=1'

async function publicRequest(email: string) {
  const closed: Array<() => void> = []
  const pending: Promise<unknown>[] = []
  const taskErrors: unknown[] = []
  const afterContext = new AfterContext({
    waitUntil: (task) => { pending.push(task) },
    onClose: (callback) => { closed.push(callback) },
    onTaskError: (error) => { taskErrors.push(error) },
  })
  const work = { afterContext } as Parameters<typeof workAsyncStorage.run>[0]
  const unit = { type: 'request', phase: 'action' } as Parameters<typeof workUnitAsyncStorage.run>[0]
  const form = new FormData()
  form.set('email', email)
  const { requestPasswordResetAction } = await import('@/app/login/forgot-password/actions')
  let redirectError: unknown
  try {
    await workAsyncStorage.run(work, () => workUnitAsyncStorage.run(unit, () =>
      actionAsyncStorage.run({ isAction: true }, () => requestPasswordResetAction(form)),
    ))
  } catch (error) { redirectError = error }
  if (!isRedirectError(redirectError)) throw redirectError ?? new Error('Expected Next redirect')
  const url = getURLFromRedirectError(redirectError)
  const redirectType = getRedirectTypeFromError(redirectError)
  return {
    url, redirectType,
    async finish() {
      closed.forEach((close) => close())
      await Promise.all(pending)
      expect(taskErrors).toEqual([])
    },
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
  boundary.send.mockReset().mockResolvedValue(undefined)
  boundary.rpc.mockReset().mockImplementation(() => ({ abortSignal: () => Promise.resolve({ data: true, error: null }) }))
  boundary.headers.mockReset().mockResolvedValue(new Headers())
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'synthetic-reset-key-only')
  vi.stubEnv('VERCEL', '')
  vi.stubEnv('INTEGRATION_API_TRUST_PROXY_HEADERS', 'false')
})

describe('public reset response and Next Server Action lifecycle', () => {
  it('redirects before any account lookup and runs the existing branded helper only after response close', async () => {
    const response = await publicRequest('  Synthetic.User@Example.test  ')
    expect(response.url).toBe(receipt)
    expect(response.redirectType).toBe('push')
    expect(boundary.send).not.toHaveBeenCalled()
    expect(boundary.rpc).not.toHaveBeenCalled()
    await response.finish()
    expect(boundary.rpc).toHaveBeenCalledOnce()
    expect(boundary.send).toHaveBeenCalledExactlyOnceWith({ email: 'synthetic.user@example.test', source: 'public_forgot_password' })
  })

  it.each(['unknown account', 'provider unavailable'])('keeps the same response when the helper rejects: %s', async (reason) => {
    boundary.send.mockRejectedValue(new Error(reason))
    const response = await publicRequest('synthetic.user@example.test')
    expect(response.url).toBe(receipt)
    await response.finish()
  })

  it.each([
    { data: false, error: null }, { data: null, error: null },
    { data: 'true', error: null }, { data: true, error: { message: 'synthetic outage' } },
  ])('fails closed without invoking account/provider work on denied or malformed RPC response %#', async (result) => {
    boundary.rpc.mockImplementation(() => ({ abortSignal: () => Promise.resolve(result) }))
    const response = await publicRequest('synthetic.user@example.test')
    expect(response.url).toBe(receipt)
    await response.finish()
    expect(boundary.send).not.toHaveBeenCalled()
  })

  it('fails closed on limiter transport failure', async () => {
    boundary.rpc.mockImplementation(() => { throw new Error('synthetic transport failure') })
    const response = await publicRequest('synthetic.user@example.test')
    expect(response.url).toBe(receipt)
    await response.finish()
    expect(boundary.send).not.toHaveBeenCalled()
  })

  it('does not start the helper until the atomic reservation resolves', async () => {
    let resolveBudget!: (value: { data: boolean; error: null }) => void
    const budget = new Promise<{ data: boolean; error: null }>((resolve) => { resolveBudget = resolve })
    boundary.rpc.mockImplementation(() => ({ abortSignal: () => budget }))
    const response = await publicRequest('synthetic.user@example.test')
    expect(response.url).toBe(receipt)
    const finish = response.finish()
    await vi.waitFor(() => expect(boundary.rpc).toHaveBeenCalledOnce())
    expect(boundary.send).not.toHaveBeenCalled()
    resolveBudget({ data: true, error: null })
    await finish
    expect(boundary.send).toHaveBeenCalledOnce()
  })

  it.each(['', 'not-an-address', 'a'.repeat(255) + '@example.test'])('bounds malformed input without starting account work %#', async (email) => {
    const response = await publicRequest(email)
    expect(response.url).toBe(receipt)
    await response.finish()
    expect(boundary.rpc).not.toHaveBeenCalled()
    expect(boundary.send).not.toHaveBeenCalled()
  })
})

describe('reset budget adapter privacy and failure boundaries', () => {
  it('sends only domain-separated keyed digests and an abort signal to the service-only RPC', async () => {
    let signal: AbortSignal | undefined
    boundary.rpc.mockImplementation(() => ({ abortSignal: (value: AbortSignal) => {
      signal = value
      return Promise.resolve({ data: true, error: null })
    } }))
    vi.stubEnv('INTEGRATION_API_TRUST_PROXY_HEADERS', 'true')
    const { consumePublicPasswordResetBudget } = await import('@/lib/auth/publicPasswordResetBudget')
    expect(await consumePublicPasswordResetBudget('synthetic.user@example.test', new Headers({ 'x-forwarded-for': '192.0.2.10' }))).toBe(true)
    const [name, args] = boundary.rpc.mock.calls[0]
    expect(name).toBe('gridex_consume_public_password_reset_budget_v1')
    expect(Object.keys(args).sort()).toEqual(['p_client_key', 'p_email_key'])
    expect(args.p_client_key).toMatch(/^[0-9a-f]{64}$/)
    expect(args.p_email_key).toMatch(/^[0-9a-f]{64}$/)
    expect(args.p_client_key).not.toBe(args.p_email_key)
    expect(JSON.stringify(args)).not.toContain('synthetic.user')
    expect(JSON.stringify(args)).not.toContain('192.0.2.10')
    expect(JSON.stringify(args)).not.toContain('synthetic-reset-key-only')
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(signal?.aborted).toBe(false)
    const first = args
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'synthetic-rotated-key-only')
    await consumePublicPasswordResetBudget('synthetic.user@example.test', new Headers({ 'x-forwarded-for': '192.0.2.10' }))
    expect(boundary.rpc.mock.calls[1][1].p_email_key).not.toBe(first.p_email_key)
    expect(boundary.rpc.mock.calls[1][1].p_client_key).not.toBe(first.p_client_key)
  })

  it('shares a bounded fallback bucket for untrusted/missing/spoofed client headers', async () => {
    const { consumePublicPasswordResetBudget } = await import('@/lib/auth/publicPasswordResetBudget')
    for (const headers of [new Headers(), new Headers({ 'x-forwarded-for': '192.0.2.1' }), new Headers({ 'x-real-ip': '192.0.2.2' })]) {
      await consumePublicPasswordResetBudget('synthetic.user@example.test', headers)
    }
    const args = boundary.rpc.mock.calls.map((call) => call[1])
    expect(new Set(args.map((value) => value.p_client_key)).size).toBe(1)
    expect(new Set(args.map((value) => value.p_email_key)).size).toBe(1)
  })

  it('uses trusted normalized client metadata as a supplemental tier without changing the address tier', async () => {
    vi.stubEnv('INTEGRATION_API_TRUST_PROXY_HEADERS', 'true')
    const { consumePublicPasswordResetBudget } = await import('@/lib/auth/publicPasswordResetBudget')
    for (const ip of ['192.0.2.10', '::ffff:192.0.2.10', '192.0.2.20', 'malformed']) {
      await consumePublicPasswordResetBudget('synthetic.user@example.test', new Headers({ 'x-forwarded-for': ip }))
    }
    const args = boundary.rpc.mock.calls.map((call) => call[1])
    expect(args[0].p_client_key).toBe(args[1].p_client_key)
    expect(args[0].p_client_key).not.toBe(args[2].p_client_key)
    expect(args[0].p_client_key).not.toBe(args[3].p_client_key)
    expect(new Set(args.map((value) => value.p_email_key)).size).toBe(1)
  })

  it('fails closed on absent server credentials without a service request', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', undefined)
    const { consumePublicPasswordResetBudget } = await import('@/lib/auth/publicPasswordResetBudget')
    expect(await consumePublicPasswordResetBudget('synthetic.user@example.test', new Headers())).toBe(false)
    expect(boundary.rpc).not.toHaveBeenCalled()
  })

  it('returns the generic receipt without work when request headers are unavailable', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    boundary.headers.mockRejectedValue(new Error('synthetic headers failure'))
    const response = await publicRequest('synthetic.user@example.test')
    expect(response.url).toBe(receipt)
    await response.finish()
    expect(boundary.rpc).not.toHaveBeenCalled()
    expect(boundary.send).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalledExactlyOnceWith('public_password_reset_scheduling_failed')
  })

  it('fails closed if after cannot register a request callback', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { requestPasswordResetAction } = await import('@/app/login/forgot-password/actions')
    const form = new FormData()
    form.set('email', 'synthetic.user@example.test')
    const error = await requestPasswordResetAction(form).catch((value: unknown) => value)
    if (!isRedirectError(error)) throw new Error('Expected Next redirect')
    expect(getURLFromRedirectError(error)).toBe(receipt)
    expect(boundary.rpc).not.toHaveBeenCalled()
    expect(boundary.send).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalledExactlyOnceWith('public_password_reset_scheduling_failed')
  })

  it('does not put account addresses or raw provider errors into logs', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    boundary.send.mockRejectedValue(new Error('synthetic.user@example.test: provider-private-detail'))
    const response = await publicRequest('synthetic.user@example.test')
    expect(response.url).toBe(receipt)
    await response.finish()
    expect(console.warn).toHaveBeenCalledExactlyOnceWith('public_password_reset_processing_failed')
  })

  it('renders a conditional receipt without claiming delivery or revealing account membership', async () => {
    const { default: ForgotPasswordPage } = await import('@/app/login/forgot-password/page')
    const { renderToStaticMarkup } = await import('react-dom/server')
    const html = renderToStaticMarkup(await ForgotPasswordPage({ searchParams: Promise.resolve({ sent: '1' }) }))
    expect(html).toContain('Om adressen är registrerad skickas en återställningslänk.')
    expect(html).not.toContain('En återställningslänk har skickats')
    expect(html).not.toContain('synthetic.user@example.test')
  })
})
