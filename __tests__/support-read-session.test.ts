import { beforeEach, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ claims: vi.fn(), user: vi.fn(), rpc: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({ auth: { getClaims: io.claims, getUser: io.user } }) }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: io.rpc } }))
const companyId = '10000000-0000-4000-8000-000000000001'
const userId = '20000000-0000-4000-8000-000000000001'
const sessionId = '30000000-0000-4000-8000-000000000001'
beforeEach(() => {
  io.claims.mockReset().mockResolvedValue({ data: { claims: { sub: userId, session_id: sessionId } }, error: null })
  io.user.mockReset().mockResolvedValue({ data: { user: { id: userId } }, error: null })
  io.rpc.mockReset().mockResolvedValue({ data: true, error: null })
})

it('binds the OPS read authorization to the verified current user and session', async () => {
  const { requireCurrentOpsSupportReadSession } = await import('@/lib/customer-operations/supportSession')
  expect(await requireCurrentOpsSupportReadSession(companyId, userId)).toEqual({ kind: 'ops', userId, sessionId })
  expect(io.rpc).toHaveBeenCalledWith('gridex_support_ops_read_access_v1', {
    p_company_id: companyId, p_user_id: userId, p_session_id: sessionId,
  })
})

it('denies an expired but still present session even when Auth getUser succeeds', async () => {
  const { requireCurrentOpsSupportReadSession } = await import('@/lib/customer-operations/supportSession')
  io.rpc.mockResolvedValue({ data: false, error: null })
  await expect(requireCurrentOpsSupportReadSession(companyId, userId)).rejects.toMatchObject({ code: 'support_actor_forbidden', status: 403 })
  expect(io.user).toHaveBeenCalledOnce()
})

it('does not send a mismatched user or malformed tenant to the privileged read gate', async () => {
  const { requireCurrentOpsSupportReadSession } = await import('@/lib/customer-operations/supportSession')
  await expect(requireCurrentOpsSupportReadSession(companyId, companyId)).rejects.toMatchObject({ status: 403 })
  await expect(requireCurrentOpsSupportReadSession('invalid', userId)).rejects.toMatchObject({ status: 403 })
  expect(io.rpc).not.toHaveBeenCalled()
})

it('fails closed with neutral errors if the live read gate is unavailable or returns an invalid result', async () => {
  const { requireCurrentOpsSupportReadSession } = await import('@/lib/customer-operations/supportSession')
  io.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'private schema detail' } })
  await expect(requireCurrentOpsSupportReadSession(companyId, userId)).rejects.toMatchObject({ code: 'support_schema_unavailable', status: 503 })
  io.rpc.mockResolvedValueOnce({ data: { authorized: true }, error: null })
  await expect(requireCurrentOpsSupportReadSession(companyId, userId)).rejects.toMatchObject({ code: 'support_actor_forbidden', status: 403 })
})
