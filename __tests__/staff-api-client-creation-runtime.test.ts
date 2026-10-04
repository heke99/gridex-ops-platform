import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  denied: false, currentPlatformAdmin: true, companyStatus: 'active', companyActive: true, companyMissing: false,
  failAt: '', reads: [] as string[], clients: [] as Record<string, unknown>[], audits: [] as Record<string, unknown>[],
}))
const companyId = '11111111-1111-4111-8111-111111111111'
const actorId = '22222222-2222-4222-8222-222222222222'
vi.mock('@/lib/admin/guards', () => ({ requirePlatformAdminActionAccess: async () => {
  if (state.denied) throw new Error('Not a platform administrator')
  return { userId: actorId }
} }))
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }))
vi.mock('@/lib/integrations/tenantWebsiteProvisioning', () => ({ provisionTenantWebsiteIntegration: () => { throw new Error('Staff creation must never provision the primary website client') } }))
vi.mock('@/lib/integrations/tenantWebsiteReadiness', () => ({ reconcileTenantWebsiteCapabilities: () => { throw new Error('Staff creation must never reconcile website readiness') } }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  rpc: async (name: string, input: Record<string, unknown>) => {
    if (name !== 'staff_api_is_platform_admin' || input.p_user_id !== actorId) throw new Error('Wrong platform actor authority lookup')
    return { data: state.currentPlatformAdmin, error: null }
  },
  from: (table: string) => {
  let operation = 'select'; let payload: Record<string, unknown> = {}; const filters: Record<string, unknown> = {}
  const result = () => {
    if (state.failAt === `${table}:${operation}`) return { data: null, error: { message: 'sensitive-provider-diagnostic' } }
    if (table === 'companies') {
      state.reads.push(table)
      return { data: state.companyMissing ? null : { id: companyId, status: state.companyStatus, is_active: state.companyActive }, error: null }
    }
    if (table === 'integration_api_clients') {
      if (operation === 'insert') state.clients.push({ ...payload })
      const row = state.clients.find((entry) => Object.entries(filters).every(([key, value]) => (entry[key] ?? null) === value)) ?? null
      if (operation === 'update' && row) Object.assign(row, payload)
      if (operation === 'delete' && row) state.clients.splice(state.clients.indexOf(row), 1)
      return { data: row && { ...row }, error: null }
    }
    if (table === 'audit_logs') { state.audits.push({ ...payload }); return { data: null, error: null } }
    throw new Error(`Unexpected staff provisioning table: ${table}`)
  }
  const query = {
    select: () => query,
    eq: (key: string, value: unknown) => { filters[key] = value; return query },
    is: (key: string, value: unknown) => { filters[key] = value; return query },
    insert: (value: Record<string, unknown>) => { operation = 'insert'; payload = value; return query },
    update: (value: Record<string, unknown>) => { operation = 'update'; payload = value; return query },
    delete: () => { operation = 'delete'; return query },
    maybeSingle: async () => result(), single: async () => result(),
    then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
  }
  return query
} } }))

import { createStaffIntegrationApiClientAction } from '@/app/admin/platform/api-clients/staffActions'
import { deleteIntegrationApiClientAction, rotateIntegrationApiClientTokenAction, setIntegrationApiClientStatusAction, updateIntegrationApiClientPermissionsAction } from '@/app/admin/platform/api-clients/actions'

function form() {
  const data = new FormData()
  data.set('companyId', companyId); data.set('name', 'Gridex support')
  return data
}
beforeEach(() => {
  Object.assign(state, { denied: false, currentPlatformAdmin: true, companyStatus: 'active', companyActive: true, companyMissing: false, failAt: '' })
  state.reads.length = 0; state.clients.length = 0; state.audits.length = 0
})

describe('dedicated native staff integration client creation', () => {
  it('creates a separate tenant key with fixed staff grants while preserving the website client', async () => {
    const primary = { id: '33333333-3333-4333-8333-333333333333', company_id: companyId, profile_key: 'tenant_website', key_prefix: 'primary', scopes: ['website_contracts.read'], status: 'active' }
    state.clients.push(structuredClone(primary))
    const data = form(); data.set('scopes', '*'); data.set('allowedOrigins', 'https://attacker.invalid'); data.set('profile_key', 'tenant_website'); data.set('actorUserId', 'attacker')
    const response = await createStaffIntegrationApiClientAction({ ok: false, message: '' }, data)
    expect(response.ok).toBe(true)
    expect(response.token).toMatch(/^gdxp_[a-f0-9]{7}\.[A-Za-z0-9_-]{43}$/)
    expect(state.clients[0]).toEqual(primary)
    const created = state.clients[1]
    expect(created).toMatchObject({ company_id: companyId, created_by: actorId, profile_key: 'custom', status: 'active', allowed_origins: ['https://support123.gridex.se'], scopes: ['staff_sessions.write', 'staff_context.read', 'staff_customers.read', 'staff_support.read', 'staff_support.write'] })
    expect(created.secret_hash).toBe(createHash('sha256').update(response.token!).digest('hex'))
    expect(JSON.stringify({ clients: state.clients, audits: state.audits })).not.toContain(response.token)
    expect(state.audits).toHaveLength(1)
    expect(state.audits[0]).toMatchObject({ company_id: companyId, actor_user_id: actorId, entity_id: response.clientId, action: 'api_client.staff_created' })
    expect(Object.keys(response).sort()).toEqual(['clientId', 'keyPrefix', 'message', 'ok', 'token'])
  })

  it('denies an ordinary administrator before any privileged reads or writes', async () => {
    state.denied = true
    expect((await createStaffIntegrationApiClientAction({ ok: false, message: '' }, form())).ok).toBe(false)
    expect(state.reads).toEqual([]); expect(state.clients).toEqual([]); expect(state.audits).toEqual([])
  })

  it('rejects an expired or inactive platform role even when the legacy console classifies it as platform admin', async () => {
    state.currentPlatformAdmin = false
    const response = await createStaffIntegrationApiClientAction({ ok: false, message: '' }, form())
    expect(response.ok).toBe(false); expect(response.token).toBeUndefined()
    expect(state.reads).toEqual([]); expect(state.clients).toEqual([]); expect(state.audits).toEqual([])
  })

  it.each([{ companyStatus: 'paused' }, { companyActive: false }, { companyMissing: true }])('refuses a non-operational or missing company: %j', async (input) => {
    Object.assign(state, input)
    const response = await createStaffIntegrationApiClientAction({ ok: false, message: '' }, form())
    expect(response.ok).toBe(false); expect(response.token).toBeUndefined(); expect(state.clients).toEqual([])
  })

  it('does not publish an unaudited credential or activate the client after an audit failure', async () => {
    state.failAt = 'audit_logs:insert'
    const response = await createStaffIntegrationApiClientAction({ ok: false, message: '' }, form())
    expect(response.ok).toBe(false); expect(response.token).toBeUndefined()
    expect(response.message).not.toContain('sensitive-provider-diagnostic')
    expect(state.clients).toHaveLength(1); expect(state.clients[0].status).toBe('paused')
  })

  it.each(['integration_api_clients:insert', 'integration_api_clients:update'])('does not disclose credentials after a storage failure: %s', async (failAt) => {
    state.failAt = failAt
    const response = await createStaffIntegrationApiClientAction({ ok: false, message: '' }, form())
    expect(response.ok).toBe(false); expect(response.token).toBeUndefined()
    expect(response.message).not.toContain('sensitive-provider-diagnostic')
    expect(state.clients.every((client) => client.status !== 'active')).toBe(true)
  })

  it('prevents the legacy website permission action from promoting a dedicated staff client', async () => {
    const client = { id: '44444444-4444-4444-8444-444444444444', company_id: companyId, profile_key: 'custom', status: 'active', metadata: { integration_kind: 'staff_support_v1' }, scopes: ['staff_sessions.write'] }
    state.clients.push(structuredClone(client))
    const data = new FormData(); data.set('clientId', client.id); data.append('scopes', 'website_contracts.read')
    await expect(updateIntegrationApiClientPermissionsAction(data)).rejects.toThrow(/staff/i)
    expect(state.clients).toEqual([client]); expect(state.audits).toEqual([])
  })

  it.each(['active', 'paused', 'revoked', 'delete', 'rotate'])('rejects expired platform authority before staff client lifecycle effects: %s', async (operation) => {
    state.currentPlatformAdmin = false
    const client = { id: '44444444-4444-4444-8444-444444444444', company_id: companyId, profile_key: 'custom', status: operation === 'delete' ? 'revoked' : operation === 'active' ? 'paused' : 'active', metadata: { integration_kind: 'staff_support_v1' }, key_prefix: 'existing', secret_hash: 'existing-hash', scopes: ['staff_sessions.write'] }
    state.clients.push(structuredClone(client))
    const data = new FormData(); data.set('clientId', client.id); data.set('status', operation)
    const action = operation === 'delete' ? deleteIntegrationApiClientAction : operation === 'rotate' ? rotateIntegrationApiClientTokenAction : setIntegrationApiClientStatusAction
    await expect(action(data)).rejects.toThrow(/platform/i)
    expect(state.clients).toEqual([client]); expect(state.audits).toEqual([])
  })

  it('preserves the existing website lifecycle policy for unrelated clients', async () => {
    state.currentPlatformAdmin = false
    state.clients.push({ id: '44444444-4444-4444-8444-444444444444', company_id: companyId, profile_key: 'tenant_website', status: 'active', metadata: {}, scopes: ['website_contracts.read'] })
    const data = new FormData(); data.set('clientId', String(state.clients[0].id)); data.set('status', 'paused')
    await setIntegrationApiClientStatusAction(data)
    expect(state.clients[0].status).toBe('paused'); expect(state.audits).toHaveLength(1)
  })
})
