import { beforeEach, describe, expect, it, vi } from 'vitest'
import { notFound, redirect } from 'next/navigation'

vi.mock('server-only', () => ({}))
const f = vi.hoisted(() => ({
  guard: vi.fn(), user: vi.fn(), read: vi.fn(), tenant: vi.fn(), manual: vi.fn(), audit: vi.fn(), refresh: vi.fn(),
  filters: [] as Array<[string, unknown]>, tables: [] as string[],
}))
vi.mock('@/lib/admin/guards', () => ({ requirePlatformAdminActionAccess: f.guard }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({ auth: { getUser: f.user } }) }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: (table: string) => {
  f.tables.push(table)
  const query = { select: () => query, eq: (key: string, value: unknown) => { f.filters.push([key, value]); return query }, maybeSingle: f.read }
  return query
} } }))
vi.mock('@/lib/email/emailOutbox', () => ({ requeueUncertainTenantEmail: f.tenant }))
vi.mock('@/lib/email/manualEmailOutbox', () => ({ requeueUncertainManualEmail: f.manual }))
vi.mock('@/lib/audit/actionLogger', () => ({ logAdminActionAndUsage: f.audit }))
vi.mock('next/cache', () => ({ revalidatePath: f.refresh }))
import { requeueUncertainEmailAction } from '@/app/admin/system-health/actions'

const A = '00000000-0000-4000-8000-000000000001', B = '00000000-0000-4000-8000-000000000002'
const row = { id: '00000000-0000-4000-8000-000000000003', company_id: A, status: 'delivery_uncertain' }
function form(kind = 'tenant', company = A) {
  const data = new FormData()
  data.set('outbox_id', row.id); data.set('outbox_kind', kind); data.set('company_id', company)
  return data
}
describe('actual uncertain-delivery operator recovery action', () => {
  beforeEach(() => {
    vi.clearAllMocks(); f.filters = []; f.tables = []
    f.guard.mockResolvedValue({ userId: 'current-platform-actor' })
    f.user.mockResolvedValue({ data: { user: { id: 'current-platform-actor' } }, error: null })
    f.read.mockResolvedValue({ data: row, error: null })
    f.tenant.mockResolvedValue({ ok: true, outboxId: row.id }); f.manual.mockResolvedValue({ ok: true, outboxId: row.id })
    f.audit.mockResolvedValue(undefined); f.refresh.mockReturnValue(undefined)
  })

  it.each(['tenant', 'manual'])('records current row company, actor and immutable target for %s recovery', async kind => {
    await requeueUncertainEmailAction(form(kind))
    expect(f.audit).toHaveBeenCalledWith(expect.objectContaining({ companyId: A, actorUserId: 'current-platform-actor', entityId: row.id, action: 'email_delivery_uncertain_requeued' }))
    expect(f.tables).toEqual([kind === 'tenant' ? 'tenant_email_outbox' : 'manual_email_outbox'])
    expect(f.filters).toEqual([['id', row.id], ['company_id', A]])
    expect(kind === 'tenant' ? f.tenant : f.manual).toHaveBeenCalledWith({ outboxId: row.id, companyId: A, actorUserId: 'current-platform-actor' })
  })

  it('preserves committed requeue when view refresh throws without logging private error data', async () => {
    f.refresh.mockImplementation(() => { throw new Error('PRIVATE_RECOVERY_CACHE_DETAILS') })
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      await expect(requeueUncertainEmailAction(form())).resolves.toBeUndefined()
      expect(f.tenant).toHaveBeenCalledOnce(); expect(f.audit).toHaveBeenCalledOnce()
      expect(JSON.stringify(warning.mock.calls)).not.toContain('PRIVATE_RECOVERY_CACHE_DETAILS')
    } finally { warning.mockRestore() }
  })

  it.each([
    ['redirect', () => redirect('/admin/system-health')],
    ['notFound', () => notFound()],
  ] as const)('preserves actual Next %s control flow after the saved recovery receipt', async (_name, controlFlow) => {
    let actualNextError: unknown
    try { controlFlow() } catch (error) { actualNextError = error }
    expect(actualNextError).toBeInstanceOf(Error)
    f.refresh.mockImplementation(() => { throw actualNextError })
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      await expect(requeueUncertainEmailAction(form())).rejects.toBe(actualNextError)
      expect(f.tenant).toHaveBeenCalledOnce(); expect(f.audit).toHaveBeenCalledOnce()
      expect(warning).not.toHaveBeenCalled()
    } finally { warning.mockRestore() }
  })

  it.each([null, { ...row, company_id: B }, { ...row, status: 'sent' }])('denies missing, foreign or changed current target before recovery', async current => {
    f.read.mockResolvedValue({ data: current, error: null })
    await expect(requeueUncertainEmailAction(form())).rejects.toThrow()
    expect(f.tenant).not.toHaveBeenCalled(); expect(f.manual).not.toHaveBeenCalled(); expect(f.audit).not.toHaveBeenCalled()
  })

  it('keeps current platform guard and actual signed-in user ahead of reads and mutations', async () => {
    f.guard.mockRejectedValueOnce(new Error('current_platform_authority_denied'))
    await expect(requeueUncertainEmailAction(form())).rejects.toThrow('current_platform_authority_denied')
    expect(f.user).not.toHaveBeenCalled(); expect(f.tables).toEqual([])
    f.user.mockResolvedValueOnce({ data: { user: null } })
    await expect(requeueUncertainEmailAction(form())).rejects.toThrow('Unauthorized')
    expect(f.tables).toEqual([]); expect(f.tenant).not.toHaveBeenCalled()
  })

  it.each([
    { data: { user: { id: 'different-current-auth-user' } }, error: null },
    { data: { user: { id: 'current-platform-actor' } }, error: new Error('PRIVATE_AUTH_READ_ERROR') },
  ])('denies guard/Auth identity mismatch or Auth error before any target read', async actualAuth => {
    f.user.mockResolvedValue(actualAuth)
    await expect(requeueUncertainEmailAction(form())).rejects.toThrow('Unauthorized')
    expect(f.tables).toEqual([])
    expect(f.read).not.toHaveBeenCalled(); expect(f.tenant).not.toHaveBeenCalled(); expect(f.manual).not.toHaveBeenCalled()
    expect(f.audit).not.toHaveBeenCalled(); expect(f.refresh).not.toHaveBeenCalled()
  })

  it('does not report or audit recovery after the existing conditional writer denies a changed row', async () => {
    f.tenant.mockResolvedValue({ ok: false, error: 'Row changed before recovery' })
    await expect(requeueUncertainEmailAction(form())).rejects.toThrow('Row changed before recovery')
    expect(f.audit).not.toHaveBeenCalled(); expect(f.refresh).not.toHaveBeenCalled()
  })
})
