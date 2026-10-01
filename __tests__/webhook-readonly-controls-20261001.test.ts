import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { notFound, redirect } from 'next/navigation'

// Actual exported page/React renderer/guard implementations; only current Auth,
// canonical SQL context, membership and storage/provider boundaries are controlled.
// This is SSR/source-action evidence, never a mounted Next/browser/native receipt.
vi.mock('server-only', () => ({}))
const f = vi.hoisted(() => ({
  company: '00000000-0000-4000-8000-000000000901',
  actor: '00000000-0000-4000-8000-000000000902',
  delivery: '00000000-0000-4000-8000-000000000903',
  subscription: '00000000-0000-4000-8000-000000000904',
  permissions: ['integrations.read'] as string[], roles: ['operations_manager'] as string[],
  platform: false, loggedIn: true, companyStatus: 'active', membershipRole: 'owner',
  auth: vi.fn(), memberships: vi.fn(), rpc: vi.fn(), writes: vi.fn(), emit: vi.fn(), enqueue: vi.fn(), dispatch: vi.fn(),
  revalidate: vi.fn(),
}))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: f.company }) }) }))
vi.mock('next/cache', () => ({ revalidatePath: f.revalidate }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({
  auth: { getUser: f.auth },
  rpc: f.rpc,
}) }))
vi.mock('@/lib/tenant/scope', () => ({
  getOperationalCompanyScope: async () => ({ companyId: f.company, companyName: 'Synthetic webhook company' }),
  listOperationalCompaniesForUser: f.memberships,
}))
vi.mock('@/lib/admin/websiteIntegrationOps', () => ({
  listWebhookSubscriptions: async () => [{ id: f.subscription, company_id: f.company, name: 'Synthetic subscription',
    endpoint_url: 'https://example.invalid/synthetic-hook', event_types: ['webhook.test'], status: 'active' }],
  listWebhookDeliveries: async () => [{ id: f.delivery, company_id: f.company, webhook_subscription_id: f.subscription,
    event_type: 'webhook.test', status: 'failed', attempts: 1, max_attempts: 5, payload: {} }],
}))
vi.mock('@/lib/events/domainEvents', () => ({ emitDomainEvent: f.emit }))
vi.mock('@/lib/integrations/webhooks', () => ({ enqueueWebhookDeliveriesForEvent: f.enqueue, dispatchDueWebhookDeliveries: f.dispatch }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: (table: string) => {
  const query = {
    insert: (data: unknown) => { f.writes(table, 'insert', data); return query },
    update: (data: unknown) => { f.writes(table, 'update', data); return query },
    eq: (key: string, value: unknown) => { f.writes(table, 'predicate', { key, value }); return query },
    then: (resolve: (result: { data: null; error: null }) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve),
  }
  return query
} } }))

import Page from '@/app/admin/webhooks/deliveries/page'
import { sendWebhookTestEventAction, resendWebhookDeliveryAction, markWebhookDeliveryIgnoredAction } from '@/app/admin/webhooks/actions'

beforeEach(() => {
  vi.clearAllMocks()
  f.permissions = ['integrations.read']; f.roles = ['operations_manager']
  f.platform = false; f.loggedIn = true; f.companyStatus = 'active'; f.membershipRole = 'owner'
  f.auth.mockImplementation(async () => ({ data: { user: f.loggedIn ? { id: f.actor, email: 'synthetic-ops@example.invalid' } : null }, error: null }))
  f.memberships.mockImplementation(async () => [{ companyId: f.company, companyName: 'Synthetic webhook company',
    membershipRole: f.membershipRole, companyStatus: f.companyStatus, status: 'active' }])
  f.rpc.mockImplementation(async (name: string, args: unknown) => {
    expect(name).toBe('canonical_authenticated_tenant_context')
    expect(args).toEqual({ p_selected_company_id: f.company })
    return { data: { authorized: true, user_id: f.actor, user_email: 'synthetic-ops@example.invalid',
      selected_company_id: f.company, is_platform_admin: f.platform, roles: f.roles, permissions: f.permissions }, error: null }
  })
  f.emit.mockResolvedValue({ id: '00000000-0000-4000-8000-000000000905', company_id: f.company })
  f.enqueue.mockResolvedValue(1); f.dispatch.mockResolvedValue(undefined)
})
afterEach(() => vi.restoreAllMocks())
function context(overrides: Record<string, unknown> = {}) {
  return { data: { authorized: true, user_id: f.actor, user_email: 'synthetic-ops@example.invalid',
    selected_company_id: f.company, is_platform_admin: f.platform, roles: f.roles, permissions: f.permissions, ...overrides }, error: null }
}

async function renderedButtons() {
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }))
  const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
    .map((match) => ({ disabled: /\bdisabled(?:=|\s|$)/.test(match[1]), label: match[2] }))
    .filter((button) => /Skicka testevent|Resend|Ignorera/.test(button.label))
  expect(buttons).toHaveLength(3)
  expect(f.rpc).toHaveBeenCalled()
  return { html, buttons }
}
function input() {
  const data = new FormData()
  data.set('company_id', f.company); data.set('delivery_id', f.delivery)
  data.set('subscription_id', f.subscription); data.set('note', 'Synthetic handled note')
  return data
}
function noEffects() {
  expect(f.emit).not.toHaveBeenCalled(); expect(f.enqueue).not.toHaveBeenCalled()
  expect(f.dispatch).not.toHaveBeenCalled(); expect(f.writes).not.toHaveBeenCalled()
  expect(f.revalidate).not.toHaveBeenCalled()
}
const actions = [
  { name: 'test event', action: sendWebhookTestEventAction },
  { name: 'resend', action: resendWebhookDeliveryAction },
  { name: 'ignore', action: markWebhookDeliveryIgnoredAction },
]

describe('actual webhook page capability follows current company-scoped server authority', () => {
  it('disables all three mutation controls for an actual current integration-read-only guard receipt', async () => {
    const { buttons, html } = await renderedButtons()
    expect(buttons.every((button) => button.disabled)).toBe(true)
    expect(html).toContain('Läsläge')
    noEffects()
  })
  it('disables all three controls when the current tenant is paused even with a write permission', async () => {
    f.permissions.push('integrations.write'); f.companyStatus = 'paused'
    expect((await renderedButtons()).buttons.every((button) => button.disabled)).toBe(true)
    noEffects()
  })
  it('disables mutation controls for a readable viewer membership which cannot operate the company', async () => {
    f.permissions.push('integrations.write'); f.membershipRole = 'viewer'
    expect((await renderedButtons()).buttons.every((button) => button.disabled)).toBe(true)
    noEffects()
  })
  it('does not elevate a company-scoped platform-named role whose canonical platform flag is false', async () => {
    f.roles = ['platform_admin']
    expect((await renderedButtons()).buttons.every((button) => button.disabled)).toBe(true)
    noEffects()
  })
  it('keeps three controls available to a current writable owner with the real write grant', async () => {
    f.permissions.push('integrations.write')
    expect((await renderedButtons()).buttons.every((button) => !button.disabled)).toBe(true)
    noEffects()
  })
  it('preserves the real canonical platform authority path', async () => {
    f.platform = true; f.roles = ['platform_admin']; f.permissions = []
    expect((await renderedButtons()).buttons.every((button) => !button.disabled)).toBe(true)
    noEffects()
  })
  it('preflights once per distinct rendered company, without effects or duplicated local role policy', async () => {
    f.permissions.push('integrations.write')
    await renderedButtons()
    expect(f.rpc).toHaveBeenCalledTimes(2) // Page guard plus one company preflight, in this uncached direct-call harness.
    noEffects()
  })
  it('disables controls if the returned current company differs from the page guard/resource', async () => {
    f.permissions.push('integrations.write')
    f.rpc.mockResolvedValueOnce(context()).mockResolvedValue(context({ selected_company_id: '00000000-0000-4000-8000-000000000906' }))
    const { buttons, html } = await renderedButtons()
    expect(buttons.every((button) => button.disabled)).toBe(true)
    // The current-selection guard now denies this drift before the page's
    // redundant post-guard receipt comparison; all controls stay read-only.
    expect(html).toContain('Läsläge')
    noEffects()
  })
  it('binds a newly authenticated actor receipt to the actor who opened the page', async () => {
    f.permissions.push('integrations.write')
    const nextActor = '00000000-0000-4000-8000-000000000907'
    f.auth.mockResolvedValueOnce({ data: { user: { id: f.actor } }, error: null }).mockResolvedValue({ data: { user: { id: nextActor } }, error: null })
    f.rpc.mockResolvedValueOnce(context()).mockResolvedValue(context({ user_id: nextActor }))
    expect((await renderedButtons()).buttons.every((button) => button.disabled)).toBe(true)
    noEffects()
  })
  it('does not treat changed canonical global authority as the original page receipt', async () => {
    f.permissions.push('integrations.write')
    f.rpc.mockResolvedValueOnce(context()).mockResolvedValue(context({ is_platform_admin: true }))
    expect((await renderedButtons()).buttons.every((button) => button.disabled)).toBe(true)
    noEffects()
  })
  it('shows an explicit unavailable authorization state rather than ordinary read-only when canonical SQL verification fails', async () => {
    f.permissions.push('integrations.write')
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    f.rpc.mockResolvedValueOnce(context()).mockResolvedValue({ data: null, error: { code: '57P03', message: 'synthetic_context_unavailable' } })
    const { buttons, html } = await renderedButtons()
    expect(buttons.every((button) => button.disabled)).toBe(true)
    expect(html).toContain('Åtgärdsbehörigheten kunde inte bekräftas')
    expect(html).not.toContain('synthetic_context_unavailable')
    expect(html).not.toContain('Läsläge')
    noEffects()
  })
  it('propagates an unexpected membership/database fault instead of quietly declaring ordinary read-only', async () => {
    f.permissions.push('integrations.write')
    f.memberships.mockResolvedValueOnce([{ companyId: f.company, membershipRole: 'owner', companyStatus: 'active' }])
      .mockRejectedValueOnce(new Error('synthetic_membership_unavailable'))
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow('synthetic_membership_unavailable')
    noEffects()
  })
  it.each([['redirect', () => redirect('/login')], ['not-found', () => notFound()]] as const)(
    'preserves installed Next %s control flow during authorization preflight', async (_, signal) => {
      f.permissions.push('integrations.write')
      f.rpc.mockResolvedValueOnce(context()).mockImplementationOnce(async () => signal())
      await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow(/NEXT_REDIRECT|NEXT_HTTP_ERROR_FALLBACK/)
      noEffects()
    },
  )
})

describe.each(actions)('actual webhook $name exported action current denial boundary', ({ action }) => {
  it('rejects a previously writable client after current write grant loss before every storage/event/provider/audit effect', async () => {
    await expect(action(input())).rejects.toThrow('Forbidden')
    noEffects()
  })
  it('rejects a currently paused ordinary tenant before all effects', async () => {
    f.permissions.push('integrations.write'); f.companyStatus = 'paused'
    await expect(action(input())).rejects.toThrow('Bolaget är pausat')
    noEffects()
  })
  it('retains current session denial before every effect', async () => {
    f.permissions.push('integrations.write'); f.loggedIn = false
    await expect(action(input())).rejects.toThrow('NEXT_REDIRECT')
    noEffects()
  })
})

it('preserves actual test-event enqueue, audit, cache and installed Next redirect behavior for an authorized writer', async () => {
  f.permissions.push('integrations.write')
  await expect(sendWebhookTestEventAction(input())).rejects.toThrow('NEXT_REDIRECT')
  expect(f.emit).toHaveBeenCalledOnce()
  expect(f.emit.mock.calls[0][0]).toMatchObject({ companyId: f.company, eventType: 'webhook.test', aggregateId: f.subscription })
  expect(f.enqueue).toHaveBeenCalledWith(expect.objectContaining({ company_id: f.company }), { subscriptionIds: [f.subscription], force: true })
  expect(f.writes).toHaveBeenCalledWith('audit_logs', 'insert', expect.objectContaining({ company_id: f.company, actor_user_id: f.actor, action: 'webhook.test_event_created' }))
  expect(f.dispatch).not.toHaveBeenCalled()
  expect(f.revalidate).toHaveBeenCalledWith('/admin/webhooks/deliveries')
})
