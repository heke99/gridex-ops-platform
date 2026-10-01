import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { notFound, redirect } from 'next/navigation'

// Actual current-context and company-action guards plus all three exported
// webhook actions. Auth/SQL/storage/event/queue/transport are memory adapters;
// no real Auth, SQL, network, HTTP replay or provider exercise occurs here.
vi.mock('server-only', () => ({}))
const f = vi.hoisted(() => ({
  a: '00000000-0000-4000-8000-000000001101', b: '00000000-0000-4000-8000-000000001102',
  actor: '00000000-0000-4000-8000-000000001103', deliveryA: '00000000-0000-4000-8000-000000001104',
  deliveryB: '00000000-0000-4000-8000-000000001105', subscription: '00000000-0000-4000-8000-000000001106',
  selected: '', permissionsA: [] as string[], permissionsB: [] as string[], platform: false, roles: [] as string[],
  loggedIn: true, statusA: 'active', statusB: 'active', membershipA: 'owner', membershipB: 'owner',
  auth: vi.fn(), rpc: vi.fn(), memberships: vi.fn(), emit: vi.fn(), enqueue: vi.fn(), dispatch: vi.fn(), revalidate: vi.fn(),
  effects: [] as Array<Record<string, unknown>>, rows: {} as Record<string, Array<Record<string, unknown>>>,
}))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: f.selected }) }) }))
vi.mock('next/cache', () => ({ revalidatePath: f.revalidate }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({ auth: { getUser: f.auth }, rpc: f.rpc }) }))
vi.mock('@/lib/tenant/scope', () => ({ listOperationalCompaniesForUser: f.memberships }))
vi.mock('@/lib/events/domainEvents', () => ({ emitDomainEvent: f.emit }))
vi.mock('@/lib/integrations/webhooks', () => ({ enqueueWebhookDeliveriesForEvent: f.enqueue, dispatchDueWebhookDeliveries: f.dispatch }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from(table: string) {
  const predicates: Array<(row: Record<string, unknown>) => boolean> = []
  let update: Record<string, unknown> | null = null, insert: Record<string, unknown> | null = null
  const query = {
    update: (value: Record<string, unknown>) => { update = structuredClone(value); return query },
    insert: (value: Record<string, unknown>) => { insert = structuredClone(value); return query },
    eq: (key: string, value: unknown) => { predicates.push(row => row[key] === value); return query },
    then: (resolve: (value: unknown) => unknown) => {
      const rows = f.rows[table] ?? []
      if (insert) {
        rows.push(insert); f.rows[table] = rows
        f.effects.push({ table, operation: 'insert', row: structuredClone(insert) })
      }
      const matched = rows.filter(row => predicates.every(predicate => predicate(row)))
      if (update) for (const row of matched) {
        Object.assign(row, update)
        f.effects.push({ table, operation: 'update', row: structuredClone(row) })
      }
      return Promise.resolve({ data: null, error: null }).then(resolve)
    },
  }
  return query
} } }))

import { requireCompanyScopedActionAccess } from '@/lib/admin/guards'
import { sendWebhookTestEventAction, resendWebhookDeliveryAction, markWebhookDeliveryIgnoredAction } from '@/app/admin/webhooks/actions'

beforeEach(() => {
  vi.clearAllMocks()
  f.selected = f.a; f.permissionsA = ['integrations.read', 'integrations.write']; f.permissionsB = ['integrations.read']
  f.platform = false; f.roles = ['synthetic_company_operator']; f.loggedIn = true
  f.statusA = 'active'; f.statusB = 'active'; f.membershipA = 'owner'; f.membershipB = 'owner'; f.effects = []
  f.rows = { webhook_deliveries: [
    { id: f.deliveryA, company_id: f.a, status: 'failed', payload: { original: 'A' } },
    { id: f.deliveryB, company_id: f.b, status: 'failed', payload: { original: 'B' } },
  ], audit_logs: [] }
  f.auth.mockImplementation(async () => ({ data: { user: f.loggedIn ? { id: f.actor, email: 'synthetic-scope@example.invalid' } : null }, error: null }))
  f.memberships.mockImplementation(async () => [
    { companyId: f.a, membershipRole: f.membershipA, status: 'active', companyStatus: f.statusA },
    { companyId: f.b, membershipRole: f.membershipB, status: 'active', companyStatus: f.statusB },
  ])
  f.rpc.mockImplementation(async (name: string, input: { p_selected_company_id: string }) => {
    expect(name).toBe('canonical_authenticated_tenant_context')
    expect(input.p_selected_company_id).toBe(f.selected)
    return { data: { authorized: true, user_id: f.actor, user_email: 'synthetic-scope@example.invalid',
      selected_company_id: input.p_selected_company_id, is_platform_admin: f.platform, roles: f.roles,
      permissions: input.p_selected_company_id === f.a ? f.permissionsA : f.permissionsB }, error: null }
  })
  f.emit.mockImplementation(async (input: { companyId: string }) => {
    f.effects.push({ operation: 'event', companyId: input.companyId })
    return { id: '00000000-0000-4000-8000-000000001107', company_id: input.companyId }
  })
  f.enqueue.mockImplementation(async (event: { company_id: string }) => { f.effects.push({ operation: 'enqueue', companyId: event.company_id }); return 1 })
  f.dispatch.mockResolvedValue(undefined)
})
afterEach(() => vi.restoreAllMocks())
const actions = [
  { name: 'test event', action: sendWebhookTestEventAction },
  { name: 'resend', action: resendWebhookDeliveryAction },
  { name: 'ignore', action: markWebhookDeliveryIgnoredAction },
]
function input(companyId: string) {
  const data = new FormData()
  data.set('company_id', companyId); data.set('delivery_id', companyId === f.a ? f.deliveryA : f.deliveryB)
  data.set('subscription_id', f.subscription); data.set('note', 'Synthetic handled note')
  return data
}
function noEffects() {
  expect(f.effects).toEqual([])
  expect(f.emit).not.toHaveBeenCalled(); expect(f.enqueue).not.toHaveBeenCalled()
  expect(f.dispatch).not.toHaveBeenCalled(); expect(f.revalidate).not.toHaveBeenCalled()
  expect(f.rows.webhook_deliveries).toEqual([
    { id: f.deliveryA, company_id: f.a, status: 'failed', payload: { original: 'A' } },
    { id: f.deliveryB, company_id: f.b, status: 'failed', payload: { original: 'B' } },
  ])
  expect(f.rows.audit_logs).toEqual([])
}
async function caught(action: () => Promise<unknown>) {
  try { await action(); return null } catch (error) { return error }
}

it('actual shared guard binds ordinary write authority to the current selected company before accepting a different resource company', async () => {
  await expect(requireCompanyScopedActionAccess(f.b, { anyOf: ['integrations.write'] })).rejects.toThrow('Forbidden')
  expect(f.rpc).toHaveBeenCalledWith('canonical_authenticated_tenant_context', { p_selected_company_id: f.a })
  // The existing action preflight reads membership once. The mismatched target
  // never reaches the separate target-membership read or transfers A's grant.
  expect(f.memberships).toHaveBeenCalledOnce()
  noEffects()
})
describe.each(actions)('actual $name current-selection boundary', ({ action }) => {
  it('keeps all effect adapters and target B rows unchanged when only current A has the write grant', async () => {
    const error = await caught(() => action(input(f.b)))
    // Assert the effect boundary first: RED must expose real memory dispatch,
    // not merely a different error string or a missing mock/module.
    noEffects()
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('Forbidden')
  })
  it('preserves legitimate current A action behavior and its actual installed Next redirect', async () => {
    await expect(action(input(f.a))).rejects.toThrow('NEXT_REDIRECT')
    expect(f.effects.length).toBeGreaterThan(0)
    expect(f.effects.every(effect => effect.companyId === f.a || (effect.row as { company_id?: string })?.company_id === f.a)).toBe(true)
    expect(f.rows.webhook_deliveries[1]).toEqual({ id: f.deliveryB, company_id: f.b, status: 'failed', payload: { original: 'B' } })
    expect(f.rows.audit_logs).toHaveLength(1)
    expect(f.rows.audit_logs[0]).toMatchObject({ company_id: f.a, actor_user_id: f.actor })
  })
  it('preserves a legitimate switch to B after its real current receipt also has the required write permission', async () => {
    f.selected = f.b; f.permissionsB.push('integrations.write')
    await expect(action(input(f.b))).rejects.toThrow('NEXT_REDIRECT')
    expect(f.effects.length).toBeGreaterThan(0)
    expect(f.effects.every(effect => effect.companyId === f.b || (effect.row as { company_id?: string })?.company_id === f.b)).toBe(true)
    expect(f.rows.webhook_deliveries[0]).toEqual({ id: f.deliveryA, company_id: f.a, status: 'failed', payload: { original: 'A' } })
  })
  it('preserves the authoritative global platform path across company selection without fabricating tenant permissions', async () => {
    f.platform = true; f.roles = ['platform_admin']; f.permissionsA = []; f.permissionsB = []
    await expect(action(input(f.b))).rejects.toThrow('NEXT_REDIRECT')
    expect(f.effects.length).toBeGreaterThan(0)
    expect(f.rows.audit_logs[0]).toMatchObject({ company_id: f.b, actor_user_id: f.actor })
  })
  it('retains current selected-company permission denial before all effects', async () => {
    f.selected = f.b
    await expect(action(input(f.b))).rejects.toThrow('Forbidden')
    noEffects()
  })
  it('retains current same-company viewer membership denial before all effects', async () => {
    f.membershipA = 'viewer'
    await expect(action(input(f.a))).rejects.toThrow('Du saknar aktiv ändringsbehörighet')
    noEffects()
  })
  it('retains the existing paused-company denial before every effect', async () => {
    f.statusA = 'paused'; f.statusB = 'paused'
    await expect(action(input(f.a))).rejects.toThrow('Bolaget är pausat')
    noEffects()
  })
  it('retains current session denial and installed Next login redirect before effects', async () => {
    f.loggedIn = false
    await expect(action(input(f.a))).rejects.toThrow('NEXT_REDIRECT')
    noEffects()
  })
})
it('does not use a company platform-named role with canonical global flag false to bypass current resource selection', async () => {
  f.roles = ['platform_admin']
  await expect(requireCompanyScopedActionAccess(f.b, { anyOf: ['integrations.write'] })).rejects.toThrow('Forbidden')
  noEffects()
})
it('retains canonical verification errors without action effects or an unverified grant', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  f.rpc.mockResolvedValue({ data: null, error: { code: '57P03', message: 'synthetic_context_unavailable' } })
  await expect(requireCompanyScopedActionAccess(f.a, { anyOf: ['integrations.write'] })).rejects.toThrow('Behörighetskontrollen kunde inte verifieras')
  noEffects()
})
it.each([['redirect', () => redirect('/login')], ['not found', () => notFound()]] as const)('retains installed Next %s control flow from the actual current context', async (_, signal) => {
  f.rpc.mockImplementation(async () => signal())
  await expect(requireCompanyScopedActionAccess(f.a, { anyOf: ['integrations.write'] })).rejects.toThrow(/NEXT_REDIRECT|NEXT_HTTP_ERROR_FALLBACK/)
  noEffects()
})
