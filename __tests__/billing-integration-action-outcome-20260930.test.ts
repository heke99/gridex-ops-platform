import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement, type ReactNode } from 'react'

type Row = Record<string, unknown>
const fixture = vi.hoisted(() => ({
  guard: { userId: 'actor-a', companyId: 'company-a', email: 'synthetic@example.invalid', isPlatformAdmin: false, permissions: ['pricing.write'] as string[] },
  authId: 'actor-a', companyId: 'company-a', denied: false, row: { id: 'connection-a', readiness_issues: [{ code: 'connection_test_required' }] } as Row | null,
  loadError: false, failWrite: false, failFirstWrite: false, zeroRows: false, wrongIdentity: false, pingFails: false, calls: [] as Row[],
  ping: vi.fn(), retry: vi.fn(), audit: vi.fn(), refresh: vi.fn(),
  lists: [] as unknown[][],
}))
vi.mock('next/cache', () => ({ revalidatePath: fixture.refresh }))
vi.mock('next/navigation', () => ({ unstable_rethrow: (error: unknown) => { if (error instanceof Error && error.message === 'NEXT_REDIRECT') throw error } }))
vi.mock('@/lib/admin/guards', () => ({
  requireAdminActionAccess: async () => { if (fixture.denied) throw new Error('SQL PRIVATE authorization secret'); return fixture.guard },
  requireAdminPageKeyAccess: async () => fixture.guard,
}))
vi.mock('@/lib/tenant/scope', () => ({ getOperationalCompanyScope: async () => ({ companyId: fixture.companyId }) }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: fixture.authId } } }) } }) }))
vi.mock('@/lib/audit/actionLogger', () => ({ logAdminActionAndUsage: fixture.audit }))
vi.mock('@/lib/billing/providerEventProcessor', () => ({ retryReviewableInvoiceProviderEvents: fixture.retry }))
vi.mock('@/lib/integrations/billing/capway/auth', () => ({ resolveCapwayConnectionConfig: async () => ({ authMode: 'oauth' }) }))
vi.mock('@/lib/integrations/billing/capway/client', () => ({ CapwayApticClient: class { ping = fixture.ping } }))
vi.mock('@/components/admin/AdminHeader', () => ({ default: () => null }))
vi.mock('@/lib/pricing/adminData', () => ({ fmt: String, statusBadge: () => '', safeListRows: async (...args: unknown[]) => { fixture.lists.push(args); return [] } }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: (table: string) => {
  let update: Row | undefined
  const filters: Row = {}
  const result = () => {
    if (!update) return { data: fixture.row, error: fixture.loadError ? new Error('SQL PRIVATE secret') : null }
    fixture.calls.push({ table, update, filters: { ...filters } })
    return { data: fixture.zeroRows ? null : { id: fixture.wrongIdentity ? 'connection-other' : fixture.row?.id, ...update }, error: fixture.failWrite || (fixture.failFirstWrite && fixture.calls.length===1) ? new Error('SQL PRIVATE client_secret=private-token') : null }
  }
  const query = {
    select: () => query, update: (values: Row) => { update = values; return query },
    eq: (key: string, value: unknown) => { filters[key] = value; return query },
    maybeSingle: async () => result(), single: async () => result(),
    then: (resolve: (value: unknown) => void) => Promise.resolve(result()).then(resolve),
  }
  return query
} } }))

import { reprocessInvoiceProviderEventsAction, testCapwayConnectionAction } from '@/app/admin/billing/integrations/actions'
import BillingIntegrationsPage from '@/app/admin/billing/integrations/page'

function nodes(value: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(value)) return value.flatMap(nodes)
  if (!isValidElement(value)) return []
  const node = value as ReactElement<Record<string, unknown>>
  return [node, ...nodes(node.props.children as ReactNode)]
}

describe('actual billing integration actions return qualified effects', () => {
  beforeEach(() => {
    fixture.guard = { userId: 'actor-a', companyId: 'company-a', email: 'synthetic@example.invalid', isPlatformAdmin: false, permissions: ['pricing.write'] }
    fixture.authId = 'actor-a'; fixture.companyId = 'company-a'; fixture.denied = false
    fixture.row = { id: 'connection-a', readiness_issues: [{ code: 'connection_test_required' }] }
    fixture.loadError = false; fixture.failWrite = false; fixture.failFirstWrite = false; fixture.zeroRows = false; fixture.wrongIdentity = false
    fixture.calls = []; fixture.lists=[]; vi.clearAllMocks(); fixture.refresh.mockReset(); fixture.ping.mockResolvedValue({ ok: true }); fixture.retry.mockResolvedValue({ processed: 2, stillNeedsReview: 1, failed: 0 }); fixture.audit.mockResolvedValue(undefined)
  })
  it('returns visible success only after selected test connection state is persisted and qualified', async () => {
    expect(await testCapwayConnectionAction()).toMatchObject({ ok: true, message: expect.any(String) })
    expect(fixture.calls).toHaveLength(1)
    expect(fixture.calls[0].filters).toMatchObject({ id: 'connection-a', company_id: 'company-a' })
    expect(fixture.calls[0].update).toMatchObject({ status: 'ready', updated_by: 'actor-a', last_test_result: { ok: true, environment: 'test', billing_activation_allowed: false } })
  })
  it.each(['zeroRows','wrongIdentity'] as const)('does not confirm an unmatched %s write result', async field => {
    fixture[field] = true
    expect(await testCapwayConnectionAction()).toMatchObject({ ok: false })
    expect(fixture.calls).toHaveLength(1)
  })
  it('does not rewrite successful provider evidence as failed after a transient successful-result save fault', async () => {
    fixture.failFirstWrite=true
    expect(await testCapwayConnectionAction()).toMatchObject({ok:false,message:expect.stringMatching(/kunde inte sparas/i)})
    expect(fixture.ping).toHaveBeenCalledOnce();expect(fixture.calls).toHaveLength(1)
    expect(fixture.calls[0].update).toMatchObject({status:'ready',last_test_result:{ok:true}})
    expect(fixture.audit).not.toHaveBeenCalled()
  })
  it('does not mark the provider failed when the initial selected connection read fails', async () => {
    fixture.loadError=true
    expect(await testCapwayConnectionAction()).toMatchObject({ok:false})
    expect(fixture.ping).not.toHaveBeenCalled();expect(fixture.calls).toHaveLength(0)
  })
  it('does not ping when the selected connection is missing', async () => {
    fixture.row = null
    expect(await testCapwayConnectionAction()).toMatchObject({ ok: false })
    expect(fixture.ping).not.toHaveBeenCalled()
  })
  it('returns a safe visible provider failure only with confirmed failed-status persistence', async () => {
    fixture.ping.mockRejectedValue(new Error('Bearer PRIVATE_TOKEN client_secret=PRIVATE_SECRET SQL PRIVATE'))
    const result = await testCapwayConnectionAction()
    expect(result).toMatchObject({ ok: false, message: expect.any(String) })
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|SQL|Bearer|client_secret/)
    expect(fixture.calls[0].update).toMatchObject({ status: 'incomplete', last_test_result: { ok: false, environment: 'test' } })
  })
  it('reports failure-result save failure without pretending the failed test state was stored', async () => {
    fixture.ping.mockRejectedValue(new Error('Synthetic provider unavailable')); fixture.failWrite = true
    const result = await testCapwayConnectionAction()
    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/kunde inte sparas/i) })
    expect(JSON.stringify(result)).not.toMatch(/SQL PRIVATE|private-token/)
  })
  it.each(['actor','company','permission'])('denies changed %s authority before database, ping and retry effects', async field => {
    if (field==='actor') fixture.authId='actor-other'
    if (field==='company') fixture.companyId='company-other'
    if (field==='permission') fixture.denied=true
    expect(await testCapwayConnectionAction()).toMatchObject({ ok: false })
    expect(await reprocessInvoiceProviderEventsAction()).toMatchObject({ ok: false })
    expect(fixture.calls).toHaveLength(0); expect(fixture.ping).not.toHaveBeenCalled(); expect(fixture.retry).not.toHaveBeenCalled()
  })
  it('reports actual processed/review/failed counts instead of an empty action response', async () => {
    const result = await reprocessInvoiceProviderEventsAction()
    expect(result).toMatchObject({ ok: true, message: expect.stringContaining('2') })
    expect(result?.message).toContain('1')
    expect(fixture.retry).toHaveBeenCalledWith({ companyId: 'company-a', limit: 100 })
  })
  it('does not report full success when processing fails or counts are invalid', async () => {
    fixture.retry.mockResolvedValueOnce({ processed: 1, stillNeedsReview: 2, failed: 1 })
    expect(await reprocessInvoiceProviderEventsAction()).toMatchObject({ ok: false, message: expect.stringContaining('1') })
    fixture.retry.mockResolvedValueOnce({ processed: -1, stillNeedsReview: 0, failed: 0 })
    expect(await reprocessInvoiceProviderEventsAction()).toMatchObject({ ok: false })
  })
  it('keeps confirmed persistence successful when only refresh fails', async () => {
    fixture.refresh.mockImplementation(() => { throw new Error('Synthetic refresh failure') })
    expect(await testCapwayConnectionAction()).toMatchObject({ ok: true, message: expect.stringMatching(/läs|ladda/i) })
    expect(fixture.calls).toHaveLength(1)
  })
  it('binds actual returned outcomes and readonly controls for page users', async () => {
    fixture.guard.permissions = ['billing_underlay.read']
    const forms = nodes(await BillingIntegrationsPage()).filter(node => node.props.action)
    expect(forms).toHaveLength(2); expect(forms.every(form => form.props.disabled===true)).toBe(true)
    fixture.guard.permissions = ['pricing.write']
    const enabled = nodes(await BillingIntegrationsPage()).filter(node => node.props.action)
    expect(enabled.every(form => form.props.disabled===false)).toBe(true)
    const action = enabled[1].props.action as (previous: { ok: boolean; message: string }, data: FormData) => Promise<{ ok: boolean; message: string }>
    expect(await action({ ok: false, message: '' },new FormData())).toMatchObject({ ok: true })
  })
  it.each(['actor','company'])('does not broaden page reads to a null company when %s scope changes', async field=> {
    if(field==='actor') fixture.authId='actor-other'
    else fixture.companyId='company-other'
    const forms=nodes(await BillingIntegrationsPage()).filter(node=>node.props.action)
    expect(forms.every(form=>form.props.disabled===true)).toBe(true)
    expect(fixture.lists).toHaveLength(0)
  })
  it('returns safe outcome for thrown processor error and does not mask framework control flow', async()=> {
    fixture.retry.mockRejectedValueOnce(new Error('SQL PRIVATE exception'))
    expect(await reprocessInvoiceProviderEventsAction()).toMatchObject({ok:false,message:expect.any(String)})
    fixture.retry.mockRejectedValueOnce(new Error('NEXT_REDIRECT'))
    await expect(reprocessInvoiceProviderEventsAction()).rejects.toThrow('NEXT_REDIRECT')
  })
})
