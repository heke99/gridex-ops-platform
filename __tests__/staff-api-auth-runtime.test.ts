import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  key: true, scopes: ['staff_sessions.write', 'staff_context.read', 'staff_support.read', 'staff_support.write', 'staff_customers.read'], company: '10000000-0000-4000-8000-000000000001', client: '20000000-0000-4000-8000-000000000001',
  user: '30000000-0000-4000-8000-000000000001', nativeSid: '40000000-0000-4000-8000-000000000001', nativeLive: true, eligible: true, staff: true, platform: false, platformGrantActive: true,
  permissions: ['cases.read', 'cases.write', 'customers.read'], inactivePermissions: [] as string[], roles: ['support'], factors: [] as { id: string; method: string; friendly_name: string | null }[], aal: 'aal1', passwordRequired: false,
  providerFailure: false, finalizeFailure: false, rejectOtp: false, refreshCalls: 0, passwordCalls: 0, nativeLogouts: 0, challengeCalls: 0, verifyCalls: 0, recoveryCalls: 0,
  pauseRefresh: null as null | (() => Promise<void>), rows: new Map<string, Record<string, unknown>>(), operations: new Map<string, Record<string, unknown>>(), budgets: new Map<string, number>(),
}))
const user = () => ({ id: state.user, email: 'staff@example.se', email_confirmed_at: '2026-01-01', user_metadata: { full_name: 'Personal' } })
const nativeToken = () => `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ session_id: state.nativeSid, aal: state.aal })).toString('base64url')}.native-signature`
const nativeSession = () => ({ access_token: nativeToken(), refresh_token: 'native-refresh-secret', user: user() })

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({
  auth: {
    signInWithPassword: async ({ password }: { password: string }) => password === 'wrong' ? { error: { status: 400 }, data: { session: null } } : { error: null, data: { user: user(), session: nativeSession() } },
    getUser: async () => state.providerFailure ? { data: { user: null }, error: { status: 503 } } : { data: { user: user() }, error: null },
    refreshSession: async () => { state.refreshCalls++; await state.pauseRefresh?.(); return state.providerFailure ? { data: { session: null }, error: { status: 503 } } : { data: { session: nativeSession() }, error: null } },
    setSession: async () => ({ data: { session: nativeSession() }, error: null }),
    updateUser: async () => { state.passwordCalls++; return { data: { user: user() }, error: null } },
    verifyOtp: async () => ({ data: { session: nativeSession() }, error: null }),
    mfa: { challenge: async () => { state.challengeCalls++; return { data: { id: 'native-challenge', expires_at: Math.floor(Date.now() / 1000) + 300 }, error: null } }, verify: async () => { state.verifyCalls++; if (state.rejectOtp) return { data: null, error: { status: 400 } }; state.aal = 'aal2'; return { data: nativeSession(), error: null } } },
  },
  rpc: async (name: string, args?: Record<string, unknown>) => name === 'gridex_is_current_session_allowed'
    ? { data: state.eligible, error: null }
    : { data: { authorized: state.eligible, user_id: state.user, selected_company_id: args?.p_selected_company_id === state.company ? state.company : null, permissions: state.permissions, roles: state.roles, is_platform_admin: state.platform }, error: null },
}) }))

function builder(table: string) {
  const filters: ((r: Record<string, unknown>) => boolean)[] = []; let inserted: Record<string, unknown> | null = null; let patch: Record<string, unknown> | null = null
  const rows = () => inserted ? [inserted] : [...state.rows.values()].filter((r) => filters.every((f) => f(r)))
  const api = {
    select: () => api,
    eq: (field: string, value: unknown) => { filters.push((r) => r[field] === value); return api },
    or: (value: string) => { const hashes = value.split(',').map((s) => s.split('.').at(-1)); filters.push((r) => hashes.includes(String(r.refresh_hash)) || hashes.includes(String(r.previous_refresh_hash))); return api },
    insert: (row: Record<string, unknown>) => { inserted = structuredClone(row); state.rows.set(String(row.id), inserted); return api },
    update: (value: Record<string, unknown>) => { patch = value; return api },
    maybeSingle: async () => ({ data: rows()[0] ? structuredClone(rows()[0]) : null, error: null }),
    then: (resolve: (r: unknown) => unknown) => { if (table === 'user_profiles' && patch?.must_change_password === false) state.passwordRequired = false; return resolve({ data: inserted, error: null }) },
  }
  return api
}

vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from: (table: string) => builder(table),
  auth: { admin: { signOut: async () => { state.nativeLogouts++; state.nativeLive = false; return { error: null } }, generateLink: async () => { state.recoveryCalls++; return { data: { user: user(), properties: { hashed_token: 'hashed-recovery-token' } }, error: null } } } },
  rpc: async (name: string, p: Record<string, unknown>) => {
    const result = (data: unknown) => ({ data, error: null })
    const row = state.rows.get(String(p.p_session_id))
    if (name === 'staff_api_consume_auth_budget') { const key = String(p.p_budget_key); const n = (state.budgets.get(key) ?? 0) + 1; state.budgets.set(key, n); return result(n <= Number(p.p_limit)) }
    if (name === 'staff_api_is_tenant_staff') return result(state.staff)
    if (name === 'staff_api_current_permissions') return result(state.permissions.filter((p) => !state.inactivePermissions.includes(p)))
    if (name === 'staff_api_is_platform_admin') return result(state.platform && state.platformGrantActive)
    if (name === 'staff_api_recovery_identity') return result(state.eligible && state.staff && state.roles.some((r) => r !== 'customer') && p.p_company_id === '10000000-0000-4000-8000-000000000001' ? state.user : null)
    if (name === 'staff_api_native_account_state') return result({ eligible: state.eligible && state.nativeLive && p.p_user_id === state.user && p.p_native_session_id === state.nativeSid, password_change_required: state.passwordRequired, aal: state.aal, factors: state.factors })
    if (name === 'staff_api_revoke_session') { if (row && (p.p_status === 'revoked' || row.status === 'active')) Object.assign(row, { status: p.p_status, lease_id: null, lease_expires_at: null }); return result(true) }
    if (name === 'staff_api_acquire_session_operation') {
      if (!row || row.api_client_id !== p.p_client_id || row.company_id !== p.p_company_id) return result({ state: 'invalid' })
      const key = `${p.p_session_id}:${p.p_operation_key}`; const old = state.operations.get(key)
      if (old) {
        if (old.command !== p.p_command || old.digest !== p.p_request_hash) return result({ state: 'conflict' })
        if (old.status === 'completed' && old.revision === row.revision && row.status === 'active') return result({ state: 'replay', session: structuredClone(row), receipt: old.receipt })
      }
      if (row.status !== 'active' || (p.p_revision !== null && p.p_revision !== row.revision) || (p.p_refresh_hash !== null && p.p_refresh_hash !== row.refresh_hash)) return result({ state: 'invalid' })
      if (row.lease_id) return result({ state: 'busy' })
      const lease = `lease-${state.operations.size}`; row.lease_id = lease
      state.operations.set(key, { command: p.p_command, digest: p.p_request_hash, status: 'pending', lease })
      return result({ state: 'acquired', lease_id: lease, session: structuredClone(row) })
    }
    if (name === 'staff_api_complete_session_operation') {
      if (state.finalizeFailure || !row || row.status !== 'active' || row.lease_id !== p.p_lease_id) return { data: null, error: { code: '42501' } }
      if (p.p_advance_revision) row.revision = Number(row.revision) + 1
      if (p.p_refresh_hash) { row.previous_refresh_hash = row.refresh_hash; row.refresh_hash = p.p_refresh_hash }
      Object.assign(row, { encrypted_payload: p.p_encrypted_payload, native_session_id: p.p_native_session_id, stage: p.p_stage, native_aal: p.p_native_aal, lease_id: null })
      for (const operation of state.operations.values()) if (operation.lease === p.p_lease_id) Object.assign(operation, { status: 'completed', receipt: p.p_encrypted_receipt, revision: row.revision })
      return result(row.revision)
    }
    if (name === 'staff_api_logout_session') {
      const key = `${p.p_session_id}:${p.p_operation_key}`; const old = state.operations.get(key)
      if (old && (old.command !== 'logout' || old.digest !== p.p_request_hash)) return result({ state: 'conflict' })
      if (!row) return result({ state: 'invalid' })
      Object.assign(row, { status: 'revoked', lease_id: null }); state.operations.set(key, { command: 'logout', digest: p.p_request_hash, status: 'completed' })
      return result({ state: 'revoked' })
    }
    throw new Error(`Unexpected RPC ${name}`)
  },
} }))
vi.mock('@/lib/integrations/apiAuth', () => ({ requireIntegrationApiAccess: async (_r: unknown, scopes: string[]) => state.key && scopes.every((s) => state.scopes.includes(s)) ? { ok: true, client: { id: state.client, company_id: state.company, scopes: state.scopes }, context: {}, rateLimit: { limit: 120, count: 1, remaining: 119, resetAt: '2026-10-03T23:00:00Z' } } : { ok: false, status: state.key ? 403 : 401, errorCode: 'api_scope_missing', error: 'Denied' } }))
vi.mock('@/lib/auth/smtpTransactionalEmail', () => ({ getAuthSmtpReadiness: () => ({ ready: true }), sendTransactionalEmail: async () => undefined }))
vi.mock('@/lib/tenant/emailBranding', () => ({ getTenantEmailBranding: async () => ({ displayName: 'Gridex' }), renderTenantEmailLayout: () => '<p>recovery</p>' }))

import { POST as login } from '@/app/api/v1/staff/sessions/route'
import { POST as refresh } from '@/app/api/v1/staff/sessions/refresh/route'
import { POST as logout } from '@/app/api/v1/staff/sessions/logout/route'
import { POST as challenge } from '@/app/api/v1/staff/sessions/mfa/challenge/route'
import { POST as verify } from '@/app/api/v1/staff/sessions/mfa/verify/route'
import { POST as password } from '@/app/api/v1/staff/sessions/password/route'
import { POST as recoveryVerify } from '@/app/api/v1/staff/sessions/recovery/verify/route'
import { POST as recovery } from '@/app/api/v1/staff/sessions/recovery/route'
import { GET as me } from '@/app/api/v1/staff/me/route'
import { requireStaffApi } from '@/lib/staff-api/auth'

function request(path: string, data?: unknown, proof?: string, key?: string) {
  return new NextRequest(`https://app.gridex.se/api/v1/staff/${path}`, { method: data === undefined ? 'GET' : 'POST', headers: { authorization: 'Bearer machine-key', 'content-type': 'application/json', ...(proof ? { 'x-gridex-staff-authorization': `Bearer ${proof}` } : {}), ...(key ? { 'idempotency-key': key } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) })
}
async function signIn() { const response = await login(request('sessions', { email: 'staff@example.se', password: 'correct-password' })); expect(response.status).toBe(200); return (await response.json()).data }

beforeEach(() => {
  process.env.GRIDEX_STAFF_SIGNING_KEY = Buffer.alloc(32, 1).toString('base64'); process.env.GRIDEX_STAFF_VAULT_KEY = Buffer.alloc(32, 2).toString('base64')
  Object.assign(state, { key: true, scopes: ['staff_sessions.write', 'staff_context.read', 'staff_support.read', 'staff_support.write', 'staff_customers.read'], company: '10000000-0000-4000-8000-000000000001', client: '20000000-0000-4000-8000-000000000001', user: '30000000-0000-4000-8000-000000000001', nativeSid: '40000000-0000-4000-8000-000000000001', nativeLive: true, eligible: true, staff: true, platform: false, platformGrantActive: true, permissions: ['cases.read', 'cases.write', 'customers.read'], inactivePermissions: [], roles: ['support'], factors: [], aal: 'aal1', passwordRequired: false, providerFailure: false, finalizeFailure: false, rejectOtp: false, refreshCalls: 0, passwordCalls: 0, nativeLogouts: 0, challengeCalls: 0, verifyCalls: 0, recoveryCalls: 0, pauseRefresh: null })
  state.rows.clear(); state.operations.clear(); state.budgets.clear()
})

describe('mounted staff authentication API and live authorization', () => {
  it('requires machine key plus personal proof, denies customer login, and keeps native tokens in the vault', async () => {
    const receipt = await signIn()
    expect(receipt).not.toHaveProperty('user_id'); expect(JSON.stringify(receipt)).not.toContain('native-refresh-secret')
    const stored = [...state.rows.values()][0]; expect(String(stored.encrypted_payload)).not.toContain('native-refresh-secret')
    expect((await me(request('me'))).status).toBe(401)
    state.roles = ['customer']; state.staff = false
    expect((await login(request('sessions', { email: 'customer@example.se', password: 'correct-password' }))).status).toBe(401)
    state.key = false
    expect((await me(request('me', undefined, receipt.staff_access_token))).status).toBe(401)
  })
  it('uses current native session, account, tenant, client and permissions on the next operation', async () => {
    const receipt = await signIn()
    state.permissions = ['customers.read']
    const denied = await requireStaffApi(request('support/cases', undefined, receipt.staff_access_token), { scope: 'staff_support.read', permission: 'cases.read' }); expect(denied.ok).toBe(false); if (!denied.ok) expect(denied.response.status).toBe(403)
    state.company = '10000000-0000-4000-8000-000000000002'; expect((await me(request('me', undefined, receipt.staff_access_token))).status).toBe(401)
    state.company = '10000000-0000-4000-8000-000000000001'; state.client = 'other-client'; expect((await me(request('me', undefined, receipt.staff_access_token))).status).toBe(401)
    state.client = '20000000-0000-4000-8000-000000000001'; state.nativeLive = false; expect((await me(request('me', undefined, receipt.staff_access_token))).status).toBe(401)
  })
  it('excludes disabled permission definitions from live context and both read/write guards', async () => {
    const original = await signIn(); state.inactivePermissions = ['cases.read', 'cases.write']
    const current = await me(request('me', undefined, original.staff_access_token)); expect(current.status).toBe(200); expect((await current.json()).data.permissions).toEqual(['customers.read'])
    for (const mutation of [false, true]) { const denied = await requireStaffApi(request('support/cases', undefined, original.staff_access_token), { scope: mutation ? 'staff_support.write' : 'staff_support.read', permission: mutation ? 'cases.write' : 'cases.read', mutation }); expect(denied.ok).toBe(false); if (!denied.ok) expect(denied.response.status).toBe(403) }
  })
  it('rotates once, safely replays the lost refresh response, and rejects same key with another credential', async () => {
    const original = await signIn(); const key = 'refresh-operation-0001'
    const first = await refresh(request('sessions/refresh', { refresh_token: original.refresh_token }, undefined, key)); expect(first.status).toBe(200); const rotated = (await first.json()).data
    const replay = await refresh(request('sessions/refresh', { refresh_token: original.refresh_token }, undefined, key)); expect(replay.status).toBe(200); expect((await replay.json()).data).toMatchObject({ refresh_token: rotated.refresh_token, session_reference: rotated.session_reference, status: rotated.status })
    expect(state.refreshCalls).toBe(2) // replay freshly reauthorizes, but does not rotate API proof again
    expect((await refresh(request('sessions/refresh', { refresh_token: rotated.refresh_token }, undefined, key))).status).toBe(409)
    expect((await me(request('me', undefined, original.staff_access_token))).status).toBe(401)
    expect((await me(request('me', undefined, rotated.staff_access_token))).status).toBe(200)
  })
  it('serializes parallel refresh and lets logout defeat an in-flight provider result', async () => {
    const original = await signIn(); let release!: () => void; let started!: () => void
    const began = new Promise<void>((resolve) => { started = resolve }); state.pauseRefresh = () => { started(); return new Promise<void>((resolve) => { release = resolve }) }
    const first = refresh(request('sessions/refresh', { refresh_token: original.refresh_token }, undefined, 'refresh-operation-0001')); await began
    const second = await refresh(request('sessions/refresh', { refresh_token: original.refresh_token }, undefined, 'refresh-operation-0002')); expect(second.status).toBe(409)
    expect((await logout(request('sessions/logout', { refresh_token: original.refresh_token }, undefined, 'logout-operation-00001'))).status).toBe(200)
    release(); expect((await first).status).toBe(401); expect([...state.rows.values()][0].status).toBe('revoked')
  })
  it('never resumes uncertain provider/finalization outcomes or reads data through them', async () => {
    const original = await signIn(); state.finalizeFailure = true
    expect((await refresh(request('sessions/refresh', { refresh_token: original.refresh_token }, undefined, 'refresh-operation-0001'))).status).toBe(403)
    expect([...state.rows.values()][0].status).toBe('blocked')
    expect((await me(request('me', undefined, original.staff_access_token))).status).toBe(401)
  })
  it('treats competing read validation as retryable without revoking the valid session', async () => {
    const original = await signIn(); let release!: () => void; let started!: () => void
    const began = new Promise<void>((resolve) => { started = resolve }); state.pauseRefresh = () => { started(); return new Promise<void>((resolve) => { release = resolve }) }
    const first = me(request('me', undefined, original.staff_access_token)); await began
    const second = await me(request('me', undefined, original.staff_access_token)); expect(second.status).toBe(409); expect((await second.json()).error).toMatchObject({ code: 'staff_session_busy', retryable: true }); expect([...state.rows.values()][0].status).toBe('active')
    release(); expect((await first).status).toBe(200); state.pauseRefresh = null; expect((await me(request('me', undefined, original.staff_access_token))).status).toBe(200)
  })
  it('applies the per-actor/client/tenant read budget before native provider work', async () => {
    const original = await signIn()
    for (let i = 0; i < 60; i++) expect((await me(request('me', undefined, original.staff_access_token))).status).toBe(200)
    const calls = state.refreshCalls
    const limited = await me(request('me', undefined, original.staff_access_token)); expect(limited.status).toBe(429); expect(limited.headers.get('retry-after')).toBe('60'); expect((await limited.json()).error).toMatchObject({ code: 'staff_rate_limited', retryable: true }); expect(state.refreshCalls).toBe(calls)
  })
  it('enforces MFA, owned challenges, password recovery restriction, and upgrades only native aal2', async () => {
    state.factors = [{ id: 'factor-one', method: 'totp', friendly_name: 'App' }]; state.passwordRequired = true
    const original = await signIn(); expect(original.status).toBe('mfa_required'); expect((await me(request('me', undefined, original.staff_access_token))).status).toBe(403)
    const challenged = await challenge(request('sessions/mfa/challenge', { factor_reference: original.factors[0].factor_reference }, original.staff_access_token)); expect(challenged.status).toBe(200)
    const data = (await challenged.json()).data
    const upgraded = await verify(request('sessions/mfa/verify', { challenge_reference: data.challenge_reference, code: '123456' }, original.staff_access_token, 'mfa-operation-000001')); expect(upgraded.status).toBe(200); const next = (await upgraded.json()).data; expect(next.status).toBe('password_change_required')
    const replay = await verify(request('sessions/mfa/verify', { code: '123456', challenge_reference: data.challenge_reference }, original.staff_access_token, 'mfa-operation-000001')); expect(replay.status).toBe(200); expect((await replay.json()).data.refresh_token).toBe(next.refresh_token); expect(state.verifyCalls).toBe(1)
    expect((await verify(request('sessions/mfa/verify', { challenge_reference: data.challenge_reference, code: '654321' }, original.staff_access_token, 'mfa-operation-000001'))).status).toBe(409)
    expect((await me(request('me', undefined, next.staff_access_token))).status).toBe(403)
    const changed = await password(request('sessions/password', { password: 'new-secure-password' }, next.staff_access_token, 'password-operation-0001')); expect(changed.status).toBe(200); expect((await changed.json()).data.status).toBe('authenticated'); expect(state.passwordCalls).toBe(1)
    state.aal = 'aal1'; state.factors = []; const recovery = await recoveryVerify(request('sessions/recovery/verify', { token_hash: 'recovery-token-hash' })); expect(recovery.status).toBe(200); expect((await recovery.json()).data.status).toBe('password_change_required')
  })
  it('allows a new OTP attempt after a definite rejection and replays the rejection without resubmitting', async () => {
    state.factors = [{ id: 'factor-one', method: 'totp', friendly_name: 'App' }]; const original = await signIn()
    const challenged = await challenge(request('sessions/mfa/challenge', { factor_reference: original.factors[0].factor_reference }, original.staff_access_token)); const data = (await challenged.json()).data
    state.rejectOtp = true
    const bad = { challenge_reference: data.challenge_reference, code: '111111' }
    expect((await verify(request('sessions/mfa/verify', bad, original.staff_access_token, 'mfa-operation-bad001'))).status).toBe(422)
    expect([...state.rows.values()][0].status).toBe('active')
    expect((await verify(request('sessions/mfa/verify', bad, original.staff_access_token, 'mfa-operation-bad001'))).status).toBe(422); expect(state.verifyCalls).toBe(1)
    state.rejectOtp = false
    expect((await verify(request('sessions/mfa/verify', { ...bad, code: '123456' }, original.staff_access_token, 'mfa-operation-good01'))).status).toBe(200)
  })
  it('returns generic recovery acceptance without native issuance for customer, disabled or other-tenant accounts', async () => {
    process.env.GRIDEX_STAFF_RECOVERY_ORIGIN = 'https://support123.gridex.se'
    const address = { email: 'staff@example.se' }
    state.roles = ['customer']; expect((await recovery(request('sessions/recovery', address))).status).toBe(202)
    state.roles = ['support']; state.eligible = false; expect((await recovery(request('sessions/recovery', address))).status).toBe(202)
    state.eligible = true; state.company = '10000000-0000-4000-8000-000000000002'; expect((await recovery(request('sessions/recovery', address))).status).toBe(202)
    expect(state.recoveryCalls).toBe(0)
    state.company = '10000000-0000-4000-8000-000000000001'; expect((await recovery(request('sessions/recovery', address))).status).toBe(202); expect(state.recoveryCalls).toBe(1)
  })
  it('blocks unsupported verified native factors and keeps platform reads tenant scoped while denying writes', async () => {
    state.factors = [{ id: 'phone', method: 'phone', friendly_name: null }]
    expect((await login(request('sessions', { email: 'staff@example.se', password: 'correct-password' }))).status).toBe(403)
    state.factors = []; state.nativeLive = true; state.platform = true; state.staff = false; state.roles = ['platform_admin']; state.permissions = []
    const original = await signIn(); const read = await requireStaffApi(request('support/cases', undefined, original.staff_access_token), { scope: 'staff_support.read', permission: 'cases.read' }); expect(read.ok).toBe(true); if (read.ok) expect(read.context.companyId).toBe(state.company)
    const write = await requireStaffApi(request('support/cases', undefined, original.staff_access_token), { scope: 'staff_support.write', permission: 'cases.write', mutation: true }); expect(write.ok).toBe(false); if (!write.ok) expect(write.response.status).toBe(403)
    state.platformGrantActive = false
    expect((await me(request('me', undefined, original.staff_access_token))).status).toBe(401)
  })
  it('fails closed on provider outage with canonical safe no-store errors', async () => {
    const original = await signIn(); state.providerFailure = true
    const response = await me(request('me', undefined, original.staff_access_token)); expect(response.status).toBe(503); expect(response.headers.get('cache-control')).toBe('private, no-store'); expect(response.headers.get('x-gridex-contract-version')).toBe('2026-10-03.1'); expect(response.headers.get('x-ratelimit-limit')).toBe('120'); expect(response.headers.get('x-ratelimit-remaining')).toBe('119')
    expect((await response.json()).error).toMatchObject({ retryable: true, code: 'staff_auth_provider_unavailable' })
  })
})
