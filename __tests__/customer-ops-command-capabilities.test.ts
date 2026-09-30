import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ claims: vi.fn(), user: vi.fn(), rpc: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({ auth: { getClaims: io.claims, getUser: io.user } }) }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: io.rpc } }))

const companyId = '10000000-0000-4000-8000-000000000001'
const customerId = '10000000-0000-4000-8000-000000000002'
const userId = '20000000-0000-4000-8000-000000000001'
const sessionId = '30000000-0000-4000-8000-000000000001'
const denied = {
  canEditContact: false, canEditAddresses: false, canEditBilling: false,
  canEditLegalProfile: false, canCloseLifecycle: false, canEditSites: false,
}
const allowed = Object.fromEntries(Object.keys(denied).map((key) => [key, true]))
const payload = (capabilities = denied) => ({ companyId, customerId, actorUserId: userId, sessionId, ...capabilities })

async function capabilities() {
  expect(existsSync('lib/customer-operations/opsCommandCapabilities.ts'), 'selected-resource capability projection is missing').toBe(true)
  const { getCustomerOpsCommandCapabilities } = await import('@/lib/customer-operations/opsCommandCapabilities')
  return getCustomerOpsCommandCapabilities
}

beforeEach(() => {
  io.claims.mockReset().mockResolvedValue({ data: { claims: { sub: userId, session_id: sessionId } }, error: null })
  io.user.mockReset().mockResolvedValue({ data: { user: { id: userId } }, error: null })
  io.rpc.mockReset().mockResolvedValue({ data: payload(allowed as typeof denied), error: null })
})

describe('selected-customer command capabilities', () => {
  it('binds one privileged read to the selected customer/company and the verified current actor/session', async () => {
    const read = await capabilities()
    expect(await read({ companyId, customerId, expectedUserId: userId })).toEqual({ status: 'ready', ...allowed })
    expect(io.rpc).toHaveBeenCalledExactlyOnceWith('gridex_customer_ops_command_capabilities_v1', {
      p_company_id: companyId, p_customer_id: customerId, p_user_id: userId, p_session_id: sessionId,
    })
  })

  it('does not promote a global platform role when the selected company command gate denies authority', async () => {
    const read = await capabilities()
    io.user.mockResolvedValue({ data: { user: { id: userId, app_metadata: { role: 'superadmin' } } }, error: null })
    io.rpc.mockResolvedValue({ data: payload(), error: null })
    expect(await read({ companyId, customerId, expectedUserId: userId })).toEqual({ status: 'read_only', ...denied })
  })

  it('keeps masterdata, legal/lifecycle and site permissions separate', async () => {
    const read = await capabilities()
    io.rpc.mockResolvedValueOnce({ data: payload({ ...denied, canEditContact: true, canEditAddresses: true, canEditBilling: true }), error: null })
    expect(await read({ companyId, customerId, expectedUserId: userId })).toEqual({ status: 'ready', ...denied, canEditContact: true, canEditAddresses: true, canEditBilling: true })
    io.rpc.mockResolvedValueOnce({ data: payload({ ...denied, canEditLegalProfile: true, canCloseLifecycle: true, canEditSites: true }), error: null })
    expect(await read({ companyId, customerId, expectedUserId: userId })).toEqual({ status: 'ready', ...denied, canEditLegalProfile: true, canCloseLifecycle: true, canEditSites: true })
  })

  it('fails closed before the privileged read on a malformed resource or a mismatched verified user', async () => {
    const read = await capabilities()
    for (const input of [{ companyId: 'invalid', customerId, expectedUserId: userId }, { companyId, customerId: 'invalid', expectedUserId: userId }, { companyId, customerId, expectedUserId: companyId }]) {
      expect(await read(input)).toEqual({ status: 'unavailable', ...denied })
    }
    expect(io.rpc).not.toHaveBeenCalled()
  })

  it('does not trust Auth getUser without a verified matching session claim', async () => {
    const read = await capabilities()
    io.claims.mockResolvedValue({ data: { claims: { sub: userId } }, error: null })
    expect(await read({ companyId, customerId, expectedUserId: userId })).toEqual({ status: 'unavailable', ...denied })
    expect(io.rpc).not.toHaveBeenCalled()
  })

  it('fails closed without exposing schema or network errors', async () => {
    const read = await capabilities()
    io.rpc.mockResolvedValueOnce({ data: payload(allowed as typeof denied), error: { code: 'PGRST202', message: 'private schema detail' } })
    expect(await read({ companyId, customerId, expectedUserId: userId })).toEqual({ status: 'unavailable', ...denied })
    io.rpc.mockRejectedValueOnce(new Error('private transport detail'))
    expect(await read({ companyId, customerId, expectedUserId: userId })).toEqual({ status: 'unavailable', ...denied })
  })

  it('preserves Next.js redirect control flow during verified-session lookup', async () => {
    const read = await capabilities()
    const redirect = Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/admin/login;307;' })
    io.user.mockRejectedValueOnce(redirect)
    await expect(read({ companyId, customerId, expectedUserId: userId })).rejects.toBe(redirect)
    expect(io.rpc).not.toHaveBeenCalled()
  })

  it.each([
    null, [], { ...payload(allowed as typeof denied), companyId: customerId },
    { ...payload(allowed as typeof denied), customerId: companyId },
    { ...payload(allowed as typeof denied), actorUserId: companyId },
    { ...payload(allowed as typeof denied), sessionId: companyId },
    { ...payload(allowed as typeof denied), canEditBilling: 'true' },
    { ...payload(allowed as typeof denied), canEditLegalProfile: undefined },
  ])('rejects a malformed or differently bound capability response %#', async (data) => {
    const read = await capabilities()
    io.rpc.mockResolvedValue({ data, error: null })
    expect(await read({ companyId, customerId, expectedUserId: userId })).toEqual({ status: 'unavailable', ...denied })
  })

  it('rechecks current authority for each render instead of caching a prior grant', async () => {
    const read = await capabilities()
    io.rpc.mockResolvedValueOnce({ data: payload(allowed as typeof denied), error: null }).mockResolvedValueOnce({ data: payload(), error: null })
    expect((await read({ companyId, customerId, expectedUserId: userId })).canEditBilling).toBe(true)
    expect((await read({ companyId, customerId, expectedUserId: userId })).canEditBilling).toBe(false)
    expect(io.rpc).toHaveBeenCalledTimes(2)
    expect(io.user).toHaveBeenCalledTimes(2)
  })
})

describe('customer page capability boundary', () => {
  it('uses selected command authority and the persisted address revision for the editable cards', () => {
    const page = readFileSync('app/admin/customers/[id]/page.part-4.tsx', 'utf8')
    expect(page.includes('getCustomerOpsCommandCapabilities')).toBe(true)
    expect(page).not.toMatch(/const canEdit(?:Legal)?Customer\s*=\s*isPlatformAdmin/)
    expect(page).toContain('addressBookRevision={customer.address_book_revision}')
    expect(page).toContain('commandKey={randomUUID()}')
    expect(page).toContain('commandCapabilities.canEditSites')
    expect(page).toContain('Läsläge')
  })

  it('keeps the capability RPC service-only, resource-bound and free of write or authority-lock statements', () => {
    const migrations = readdirSync('supabase/migrations').filter((name) => name.endsWith('_customer_ops_command_capabilities.sql'))
    expect(migrations, 'CLI-created read capability migration is missing').toHaveLength(1)
    const sql = readFileSync(`supabase/migrations/${migrations[0]}`, 'utf8')
    expect(sql).toMatch(/current_user\s*<>\s*'service_role'/)
    expect(sql).toMatch(/revoke all on function public\.gridex_customer_ops_command_capabilities_v1\(uuid,uuid,uuid,uuid\)\s+from public,anon,authenticated,service_role/)
    expect(sql).toMatch(/grant execute on function public\.gridex_customer_ops_command_capabilities_v1\(uuid,uuid,uuid,uuid\)\s+to service_role/)
    expect(sql).toContain('c.id=p_customer_id and c.company_id=p_company_id')
    expect(sql).toContain('m.company_id=p_company_id and m.user_id=p_user_id')
    expect(sql).toContain("m.is_active and m.status='active'")
    expect(sql).toContain('s.id=p_session_id and s.user_id=p_user_id')
    expect(sql).toContain('s.not_after>clock_timestamp()')
    for (const permission of ['masterdata.write', 'customers.write', 'sites.write']) expect(sql).toContain(`'${permission}'`)
    expect(sql).not.toMatch(/for\s+(share|update)|gridex_profile_authority_lock|is_platform_admin|\binsert into\b|\bupdate public\b|\bdelete from\b/i)
  })
})
