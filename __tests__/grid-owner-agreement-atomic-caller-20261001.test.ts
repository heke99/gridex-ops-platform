import { beforeEach, describe, expect, it, vi } from 'vitest'
import { redirect } from 'next/navigation'
const f = vi.hoisted(() => ({ guard: vi.fn(), claims: vi.fn(), user: vi.fn(), rpc: vi.fn(), upload: vi.fn(), remove: vi.fn(), refresh: vi.fn(), dml: [] as string[] }))
vi.mock('@/lib/admin/guards', () => ({ requirePlatformAdminActionAccess: f.guard }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({ auth: { getClaims: f.claims, getUser: f.user } }) }))
vi.mock('next/cache', () => ({ revalidatePath: f.refresh }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  rpc: f.rpc,
  from: (table: string) => {
    const data = table === 'grid_owners' ? [] : { id: '00000000-0000-4000-8000-000000000010', company_id: '00000000-0000-4000-8000-000000000001', revision: 1 }
    const q = { select: () => q, eq: () => q, or: () => q, limit: () => q,
      insert: () => { f.dml.push(table); return q }, update: () => { f.dml.push(table); return q },
      single: async () => ({ data: table === 'grid_owners' ? { id: '00000000-0000-4000-8000-000000000009' } : data, error: null }),
      maybeSingle: async () => ({ data, error: null }), then: (resolve: (value: unknown) => void) => resolve({ data, error: null }) }
    return q
  },
  storage: { from: () => ({ upload: f.upload, remove: f.remove }) },
} }))
import { archiveGridOwnerAgreementAction, saveGridOwnerAgreementAction } from '@/app/admin/agreements/grid-owners/actions'
const id = (n: number) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0')
const intent = { id: id(11), token: id(12), bucket: 'grid-owner-agreements', path: id(1) + '/' + id(7) + '/' + id(11) + '-safe.pdf' }
const result = { agreement: { id: id(10), company_id: id(1), revision: 1 }, changed: true, replayed: false, gridOwnerCreated: false }
function form(file = false, createOwner = false) {
  const value = new FormData()
  value.set('company_id', id(1)); value.set('agreement_scope', 'metering_access'); value.set('agreement_type', 'metering_access')
  value.set('status', 'draft'); value.set('idempotency_key', 'agreement-caller-owned-0001')
  if (createOwner) value.set('new_grid_owner_name', 'Atomic new owner'); else value.set('grid_owner_id', id(7))
  if (file) value.set('document_file', new File(['owned synthetic agreement'], 'safe.pdf', { type: 'application/pdf' }))
  return value
}
const operation = (call: unknown[]) => (call[1] as { p_command: { operation: string } }).p_command.operation
describe('actual platform agreement Action uses the bounded atomic writer', () => {
  beforeEach(() => {
    vi.clearAllMocks(); f.dml = []
    f.guard.mockResolvedValue({ userId: id(3) })
    f.user.mockResolvedValue({ data: { user: { id: id(3) } }, error: null })
    f.claims.mockResolvedValue({ data: { claims: { sub: id(3), session_id: id(4) } }, error: null })
    f.upload.mockResolvedValue({ data: { path: intent.path }, error: null }); f.remove.mockResolvedValue({ data: [], error: null })
    f.refresh.mockReturnValue(undefined)
    f.rpc.mockImplementation(async (_name, { p_command }: { p_command: { operation: string } }) => ({
      data: p_command.operation === 'prepare_upload' ? { intent } : p_command.operation === 'cleanup_complete' ? { cleaned: true }
        : p_command.operation === 'abort_upload' ? { committed: null, cleanup: intent } : result, error: null,
    }))
  })
  it('binds actual current guard/Auth session while ignoring forged actor form fields', async () => {
    const input = form(); input.set('actor_user_id', id(5)); input.set('session_id', id(6))
    await saveGridOwnerAgreementAction(input)
    expect(f.dml).toEqual([])
    expect(f.rpc).toHaveBeenCalledWith('gridex_grid_owner_agreement_command_v1', { p_command: expect.objectContaining({ operation: 'save', actorUserId: id(3), sessionId: id(4) }) })
  })
  it.each([
    { data: { user: { id: id(5) } }, error: null },
    { data: { user: { id: id(3) } }, error: { message: 'PRIVATE_AUTH_ERROR' } },
  ])('rejects current Auth mismatch or error before upload or database mutation', async auth => {
    f.user.mockResolvedValue(auth)
    await expect(saveGridOwnerAgreementAction(form(true))).rejects.toThrow()
    expect(f.rpc).not.toHaveBeenCalled(); expect(f.upload).not.toHaveBeenCalled(); expect(f.dml).toEqual([])
  })
  it.each([
    { data: { claims: { sub: id(3), session_id: id(4) } }, error: { message: 'PRIVATE_CLAIMS_ERROR' } },
    { data: { claims: { sub: id(5), session_id: id(4) } }, error: null },
    { data: { claims: { sub: id(3), session_id: 'unverified-session' } }, error: null },
  ])('rejects unverified claims before the durable intent or Storage', async claims => {
    f.claims.mockResolvedValue(claims)
    await expect(saveGridOwnerAgreementAction(form(true))).rejects.toThrow()
    expect(f.rpc).not.toHaveBeenCalled(); expect(f.upload).not.toHaveBeenCalled(); expect(f.dml).toEqual([])
  })
  it('does not read Auth or make side effects after the actual platform gate denies', async () => {
    f.guard.mockRejectedValue(new Error('platform_admin_required'))
    await expect(saveGridOwnerAgreementAction(form(true))).rejects.toThrow('platform_admin_required')
    expect(f.claims).not.toHaveBeenCalled(); expect(f.user).not.toHaveBeenCalled()
    expect(f.rpc).not.toHaveBeenCalled(); expect(f.upload).not.toHaveBeenCalled()
  })
  it('keeps optional grid-owner creation inside the denied atomic command', async () => {
    f.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'agreement_actor_forbidden' } })
    await expect(saveGridOwnerAgreementAction(form(false, true))).rejects.toThrow()
    expect(f.dml).toEqual([])
    expect(f.rpc).toHaveBeenCalledWith('gridex_grid_owner_agreement_command_v1', { p_command: expect.objectContaining({ payload: expect.objectContaining({ newGridOwner: expect.objectContaining({ name: 'Atomic new owner' }) }) }) })
    expect(f.refresh).not.toHaveBeenCalled()
  })
  it('prepares a durable exact upload intent before Storage and binds it to save', async () => {
    await saveGridOwnerAgreementAction(form(true))
    expect(f.rpc.mock.calls.map(operation)).toEqual(['prepare_upload', 'save'])
    expect(f.upload).toHaveBeenCalledWith(intent.path, expect.any(File), expect.objectContaining({ upsert: false }))
    expect(f.rpc.mock.calls[1][1].p_command).toEqual(expect.objectContaining({ uploadIntentId: intent.id, cleanupToken: intent.token }))
    expect(f.dml).toEqual([])
  })
  it('rejects a denied current database authority before upload', async () => {
    f.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'PRIVATE_DATABASE_AUTHORITY' } })
    await expect(saveGridOwnerAgreementAction(form(true))).rejects.toMatchObject({ code: 'agreement_actor_forbidden', status: 403 })
    expect(f.rpc.mock.calls.map(operation)).toEqual(['prepare_upload'])
    expect(f.upload).not.toHaveBeenCalled(); expect(f.refresh).not.toHaveBeenCalled()
  })
  it('keeps schema-unavailable as a safe failure before any upload', async () => {
    f.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'PRIVATE_MISSING_FUNCTION' } })
    await expect(saveGridOwnerAgreementAction(form(true))).rejects.toMatchObject({ code: 'agreement_schema_unavailable', status: 503 })
    expect(f.upload).not.toHaveBeenCalled(); expect(f.refresh).not.toHaveBeenCalled()
  })
  it.each([
    { ...intent, bucket: 'customer-support-quarantine' },
    { ...intent, path: '../foreign-object.pdf' },
    { ...intent, token: 'invalid-cleanup-receipt' },
  ])('rejects a malformed or foreign upload intent before Storage', async receipt => {
    f.rpc.mockResolvedValue({ data: { intent: receipt }, error: null })
    await expect(saveGridOwnerAgreementAction(form(true))).rejects.toMatchObject({ code: 'agreement_invalid_receipt', status: 503 })
    expect(f.upload).not.toHaveBeenCalled(); expect(f.remove).not.toHaveBeenCalled(); expect(f.refresh).not.toHaveBeenCalled()
  })
  it('a previously committed exact command requires no second upload or save', async () => {
    f.rpc.mockResolvedValue({ data: { committed: { ...result, replayed: true } }, error: null })
    await expect(saveGridOwnerAgreementAction(form(true))).resolves.toBeUndefined()
    expect(f.rpc.mock.calls.map(operation)).toEqual(['prepare_upload'])
    expect(f.upload).not.toHaveBeenCalled(); expect(f.remove).not.toHaveBeenCalled(); expect(f.refresh).toHaveBeenCalledOnce()
  })
  it('reconciles a rejected save before removing only the unattached object', async () => {
    f.rpc.mockImplementation(async (_name, { p_command }) => p_command.operation === 'save'
      ? { data: null, error: { code: 'PT409', message: 'agreement_revision_conflict' } }
      : { data: p_command.operation === 'prepare_upload' ? { intent } : p_command.operation === 'abort_upload' ? { committed: null, cleanup: intent } : { cleaned: true }, error: null })
    await expect(saveGridOwnerAgreementAction(form(true))).rejects.toThrow()
    expect(f.rpc.mock.calls.map(operation)).toEqual(['prepare_upload', 'save', 'abort_upload', 'cleanup_complete'])
    expect(f.remove).toHaveBeenCalledWith([intent.path]); expect(f.refresh).not.toHaveBeenCalled()
  })
  it('never blindly deletes after unavailable reconciliation', async () => {
    f.rpc.mockImplementation(async (_name, { p_command }) => p_command.operation === 'prepare_upload'
      ? { data: { intent }, error: null } : { data: null, error: { code: '503', message: 'PRIVATE_UNKNOWN_COMMIT' } })
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      await expect(saveGridOwnerAgreementAction(form(true))).rejects.toThrow()
      expect(f.remove).not.toHaveBeenCalled(); expect(f.refresh).not.toHaveBeenCalled()
      expect(JSON.stringify(warning.mock.calls)).not.toContain('PRIVATE_UNKNOWN_COMMIT')
    } finally { warning.mockRestore() }
  })
  it('keeps the failed save outcome and cleanup debt when Storage removal fails', async () => {
    f.rpc.mockImplementation(async (_name, { p_command }) => p_command.operation === 'save'
      ? { data: null, error: { code: 'PT409', message: 'PRIVATE_SAVE_CONFLICT' } }
      : { data: p_command.operation === 'prepare_upload' ? { intent } : { committed: null, cleanup: intent }, error: null })
    f.remove.mockResolvedValue({ data: null, error: { message: 'PRIVATE_STORAGE_REMOVE_ERROR' } })
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      await expect(saveGridOwnerAgreementAction(form(true))).rejects.toMatchObject({ code: 'agreement_command_conflict', status: 409 })
      expect(f.rpc.mock.calls.map(operation)).toEqual(['prepare_upload', 'save', 'abort_upload'])
      expect(f.refresh).not.toHaveBeenCalled()
      expect(JSON.stringify(warning.mock.calls)).not.toMatch(/PRIVATE_|safe\.pdf/)
    } finally { warning.mockRestore() }
  })
  it('preserves a reconciled committed receipt after transport uncertainty', async () => {
    f.rpc.mockImplementation(async (_name, { p_command }) => p_command.operation === 'prepare_upload'
      ? { data: { intent }, error: null } : p_command.operation === 'save'
        ? { data: null, error: { code: '503', message: 'PRIVATE_UNKNOWN_COMMIT' } }
        : { data: { committed: { ...result, replayed: true }, cleanup: null }, error: null })
    await expect(saveGridOwnerAgreementAction(form(true))).resolves.toBeUndefined()
    expect(f.remove).not.toHaveBeenCalled(); expect(f.refresh).toHaveBeenCalled()
  })
  it('preserves a saved outcome when ordinary view refresh fails', async () => {
    f.refresh.mockImplementation(() => { throw new Error('PRIVATE_REFRESH_DETAILS') })
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      await expect(saveGridOwnerAgreementAction(form())).resolves.toBeUndefined()
      expect(JSON.stringify(warning.mock.calls)).not.toContain('PRIVATE_REFRESH_DETAILS')
    } finally { warning.mockRestore() }
  })
  it('preserves actual installed Next control flow after commit', async () => {
    let signal: unknown; try { redirect('/admin/agreements/grid-owners') } catch (error) { signal = error }
    f.refresh.mockImplementation(() => { throw signal })
    await expect(saveGridOwnerAgreementAction(form())).rejects.toBe(signal)
  })
  it('archive binds the actual current row company/revision and ignores forged form authority', async () => {
    const input = new FormData()
    input.set('id', id(10)); input.set('company_id', id(2)); input.set('actor_user_id', id(5)); input.set('session_id', id(6)); input.set('revision', '99')
    await archiveGridOwnerAgreementAction(input)
    expect(f.rpc).toHaveBeenCalledWith('gridex_grid_owner_agreement_command_v1', { p_command: expect.objectContaining({
      operation: 'archive', id: id(10), companyId: id(1), expectedRevision: 1, actorUserId: id(3), sessionId: id(4),
    }) })
    expect(f.dml).toEqual([])
  })
})
