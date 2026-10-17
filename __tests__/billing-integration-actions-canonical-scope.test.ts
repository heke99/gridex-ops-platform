import { beforeEach, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  companyId: 'guard-A' as string | null, platform: false, user: true,
  guard: vi.fn(), legacy: vi.fn(), provider: vi.fn(), dispatch: vi.fn(), clientId: vi.fn(),
  selection: vi.fn(), retry: vi.fn(), config: vi.fn(), ping: vi.fn(), audit: vi.fn(),
  filters: [] as Array<[string, unknown]>,
}))
vi.mock('@/lib/admin/guards', () => ({
  requireAdminActionAccess: io.guard, isPlatformAdminContext: () => io.platform,
}))
vi.mock('@/lib/tenant/scope', () => ({
  getOperationalCompanyScope: io.legacy,
  TenantCompanyRequiredError: class extends Error {
    constructor() { super('Kontot saknar ett aktivt bolag.'); this.name = 'TenantCompanyRequiredError' }
  },
}))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({
  auth: { getUser: async () => ({ data: { user: io.user ? { id: 'operator' } : null } }) },
}) }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from() {
    const query = {
      select: () => query, update: () => query,
      eq(key: string, value: unknown) { io.filters.push([key, value]); return query },
      maybeSingle: async () => ({ data: { id: 'connection', readiness_issues: [] }, error: null }),
      then(resolve: (result: unknown) => unknown) { return Promise.resolve({ data: null, error: null }).then(resolve) },
    }
    return query
  },
} }))
vi.mock('@/lib/billing/providers/registry', () => ({
  InvoiceProviderConfigError: class extends Error { constructor(readonly code: string, message: string) { super(message) } },
  loadTenantInvoiceProviderSelection: io.selection,
  selectTenantInvoiceProvider: io.provider, setTenantInvoiceDispatchEnabled: io.dispatch, saveNordfinClientId: io.clientId,
}))
vi.mock('@/lib/billing/providerEventProcessor', () => ({ retryReviewableInvoiceProviderEvents: io.retry }))
vi.mock('@/lib/integrations/billing/capway/auth', () => ({ resolveCapwayConnectionConfig: io.config }))
vi.mock('@/lib/integrations/billing/capway/client', () => ({ CapwayApticClient: class { ping = io.ping } }))
vi.mock('@/lib/audit/actionLogger', () => ({ logAdminActionAndUsage: io.audit }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => { throw new Error('NEXT_REDIRECT:' + url) },
  unstable_rethrow: () => undefined,
}))

import {
  selectInvoiceProviderAction, setInvoiceDispatchEnabledAction, saveNordfinClientIdAction,
  testCapwayConnectionAction, reprocessInvoiceProviderEventsAction,
} from '@/app/admin/billing/integrations/actions'
import { InvoiceProviderConfigError } from '@/lib/billing/providers/registry'

function form(values: Record<string, string>) {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}
const actions = [
  ['select provider', () => selectInvoiceProviderAction(form({ provider: 'capway_aptic', environment: 'production' })), 'selected', io.provider],
  ['enable dispatch', () => setInvoiceDispatchEnabledAction(form({ enabled: 'true' })), 'enabled', io.dispatch],
  ['save client ID', () => saveNordfinClientIdAction(form({ client_id: 'Nordfin-owned' })), 'nordfin_client_id_saved', io.clientId],
  ['test connection', () => testCapwayConnectionAction(), null, io.config],
  ['retry provider events', () => reprocessInvoiceProviderEventsAction(), null, io.retry],
] as const

beforeEach(() => {
  io.companyId = 'guard-A'; io.platform = false; io.user = true; io.filters = []
  io.guard.mockReset().mockImplementation(async () => ({ userId: 'operator', companyId: io.companyId,
    isPlatformAdmin: io.platform, roles: [], permissions: ['billing_underlay.export', 'pricing.write'] }))
  io.legacy.mockReset().mockResolvedValue({ companyId: 'legacy-B', companyName: 'Legacy B' })
  io.provider.mockReset().mockResolvedValue(undefined)
  io.dispatch.mockReset().mockResolvedValue(undefined)
  io.clientId.mockReset().mockResolvedValue(undefined)
  io.selection.mockReset().mockResolvedValue({ billing_provider_environment: 'production' })
  io.retry.mockReset().mockResolvedValue({ processed: 1, stillNeedsReview: 0, failed: 0 })
  io.config.mockReset().mockResolvedValue({ authMode: 'oauth' })
  io.ping.mockReset().mockResolvedValue({ ok: true })
  io.audit.mockReset().mockResolvedValue(undefined)
})

async function call(action: () => Promise<void>, redirect: string | null) {
  if (redirect) await expect(action()).rejects.toThrow('NEXT_REDIRECT:/admin/billing/integrations?provider=' + redirect)
  else await expect(action()).resolves.toBeUndefined()
}
it.each(actions)('%s writes only to the company authorized by the tenant guard', async (_name, action, redirect, writer) => {
  await call(action, redirect)
  expect(writer).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'guard-A' }))
  expect(io.guard).toHaveBeenCalledWith({ anyOf: ['billing_underlay.export', 'pricing.write'] })
  expect(io.legacy).not.toHaveBeenCalled()
  expect(io.filters.filter(([key]) => key === 'company_id').every(([, value]) => value === 'guard-A')).toBe(true)
})

it.each(actions)('%s retains the explicitly selected platform company', async (_name, action, redirect, writer) => {
  io.platform = true
  await call(action, redirect)
  expect(writer).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'guard-A' }))
  expect(io.legacy).not.toHaveBeenCalled()
})

it.each([false, true])('refuses a missing canonical company before provider writes (platform=%s)', async platform => {
  io.companyId = null; io.platform = platform
  await expect(selectInvoiceProviderAction(form({ provider: 'capway_aptic' }))).rejects.toThrow()
  expect(io.provider).not.toHaveBeenCalled()
  expect(io.legacy).not.toHaveBeenCalled()
})

it('keeps the existing authenticated-user check before changing provider settings', async () => {
  io.user = false
  await expect(selectInvoiceProviderAction(form({ provider: 'capway_aptic' }))).rejects.toThrow('Unauthorized')
  expect(io.provider).not.toHaveBeenCalled()
})

it('propagates the action permission refusal before any provider write', async () => {
  io.guard.mockRejectedValue(new Error('permission_denied'))
  await expect(selectInvoiceProviderAction(form({ provider: 'capway_aptic' }))).rejects.toThrow('permission_denied')
  expect(io.provider).not.toHaveBeenCalled()
})

it('preserves provider business-readiness errors while applying them to the authorized company', async () => {
  io.dispatch.mockRejectedValue(new InvoiceProviderConfigError('invoice_provider_connection_not_ready', 'not ready'))
  await expect(setInvoiceDispatchEnabledAction(form({ enabled: 'true' }))).rejects.toThrow('NEXT_REDIRECT:/admin/billing/integrations?provider=invoice_provider_connection_not_ready')
  expect(io.dispatch).toHaveBeenCalledWith({ companyId: 'guard-A', enabled: true, actorUserId: 'operator' })
})

it('does not let an unrelated legacy selection failure redirect a canonical company write', async () => {
  io.legacy.mockRejectedValue(new Error('legacy_membership_unavailable'))
  await call(() => selectInvoiceProviderAction(form({ provider: 'capway_aptic' })), 'selected')
  expect(io.provider).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'guard-A' }))
  expect(io.legacy).not.toHaveBeenCalled()
})
