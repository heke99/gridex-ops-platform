/** Mounted contract proof with synthetic Auth/native/storage ports; no native SQL qualification. */
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const seam = vi.hoisted(() => ({ access: vi.fn(), context: vi.fn(), rpc: vi.fn(), completionFails: false }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', async () => {
  const { serviceMock } = await import('../__tests__/helpers/supportPortalHarness')
  return { SUPABASE_SERVICE_URL: 'https://cccccccccccccccccccc.supabase.co', supabaseService: {
    ...serviceMock.supabaseService, rpc: (...args: unknown[]) => seam.rpc(...args),
    from: (table: string) => {
      const query = serviceMock.supabaseService.from(table)
      // Extend only the storage adapter's LIKE operator, leaving route filters real.
      query.like = (field: string, pattern: string) => {
        expect(pattern).toBe('tenant\\_support\\_%')
        const rows = query.rows as () => Record<string, unknown>[]
        query.rows = () => rows().filter(row => String(row[field]).startsWith('tenant_support_'))
        return query
      }
      const update = query.update as (value: Record<string, unknown>) => unknown
      query.update = (value: Record<string, unknown>) => {
        update(value)
        if (table === 'customer_portal_write_idempotency' && seam.completionFails && value.status === 'completed') {
          query.maybeSingle = async () => ({ data: null, error: { code: 'synthetic_storage_outage' } })
        }
        return query
      }
      return query
    },
  } }
})
vi.mock('@/lib/integrations/apiAuth', async original => ({
  ...await original<typeof import('@/lib/integrations/apiAuth')>(),
  requireIntegrationApiAccess: (...args: unknown[]) => seam.access(...args),
}))
vi.mock('@/lib/staff-api/context', async original => ({
  ...await original<typeof import('@/lib/staff-api/context')>(),
  requireStaffApiContext: (...args: unknown[]) => seam.context(...args),
}))

import { db, resetSupportDb, TENANT_A, TENANT_B, CUSTOMER_A1 } from '../__tests__/helpers/supportPortalHarness'
import { createStaffIdentityResolutionHandler, type StaffIdentityResolutionPorts } from '@/lib/staff-api/identityResolution'
import { createStaffApiContextResolver } from '@/lib/staff-api/context'
import { resolveCurrentStaffIdentity, validateCurrentStaffIdentityBinding } from '@/lib/staff-api/identityAuthority'
import { getRegisteredStaffTenantAuthUser, registeredStaffTenantAuth } from '@/lib/staff-api/tenantAuth'
import { postStaffCase, getStaffCase } from '@/lib/staff-api/caseHandlers'
import { getStaffCustomers } from '@/lib/staff-api/customerHandlers'
import { logIntegrationApiRequest, type IntegrationApiClient } from '@/lib/integrations/apiAuth'
import { publicReference } from '@/lib/integrations/publicReferences'

const CENTRAL = 'cccccccccccccccccccc', TENANT = 'tttttttttttttttttttt'
const API = 'https://api.example.com', ISSUER = 'https://staff.example.com'
const AUTH = `https://${TENANT}.supabase.co`, AUTH_ISSUER = `${AUTH}/auth/v1`
const LOCAL = '11111111-1111-4111-8111-111111111111', ACTOR = '22222222-2222-4222-8222-222222222222'
const CLIENT = '33333333-3333-4333-8333-333333333333', PROVIDER = '44444444-4444-4444-8444-444444444444'
const BINDING = '55555555-5555-4555-8555-555555555555'
const MACHINE = 'synthetic-machine-secret', BEARER = 'synthetic-local-bearer'
const AUTH_KEY = 'sb_publishable_synthetic_public_key_1234567890'
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...keys.publicKey.export({ format: 'jwk' }), kid: 'reference-test', alg: 'RS256' }
const binding = { actor_user_id: ACTOR, binding_id: BINDING, binding_version: 3 }
const provider = { id: PROVIDER, company_id: TENANT_A, purpose: 'staff', is_active: true, kind: 'tenant_key' as const,
  display_name: 'Synthetic', issuer: ISSUER, audience: 'reference-staff', public_jwk: jwk, jwks_uri: null, subject_claim: 'sub', enforcement: 'enforce' as const }
const modulePath = resolve('docs/examples/tenant-staff-reference-client.mjs')
type Result = { status: number; requestId: string; replayed: boolean; data: Record<string, unknown> }
type Client = { resolveIdentity(): Promise<Result>; listCustomers(): Promise<Result>; createCase(payload: Record<string, unknown>, key: string): Promise<Result>; getCase(reference: string): Promise<Result> }
type Factory = (options: Record<string, unknown>) => Client
async function factory(): Promise<Factory> {
  const imported = await import(modulePath).catch(() => ({}))
  expect(typeof imported.createStaffReferenceClient, 'the importer-safe Staff factory is required').toBe('function')
  return imported.createStaffReferenceClient
}
function claims(token: string): Record<string, unknown> { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) }
function replaceProof(token: string, patch: Record<string, unknown>) {
  const head = token.split('.')[0], body = Buffer.from(JSON.stringify({ ...claims(token), ...patch })).toString('base64url')
  return `${head}.${body}.${sign('RSA-SHA256', Buffer.from(`${head}.${body}`), keys.privateKey).toString('base64url')}`
}

function mounted() {
  const client: IntegrationApiClient = { id: CLIENT, company_id: TENANT_A, name: 'Synthetic', status: 'active', key_prefix: 'synthetic', secret_hash: '',
    rate_limit_per_minute: 60, allowed_ips: [], expires_at: null, scopes: ['staff_users.read', 'staff_customers.read', 'staff_cases.read', 'staff_cases.write'],
    allowed_origins: [ISSUER], metadata: { staff_onboarding_origin: ISSUER, staff_tenant_auth: { url: AUTH, public_key: AUTH_KEY } } }
  let currentLocal = LOCAL, active = true, bindingActive = true
  const authRequests: Array<{ url: string; bearer: string | null; apikey: string | null }> = []
  const authFetch: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers)
    authRequests.push({ url: String(input), bearer: headers.get('authorization'), apikey: headers.get('apikey') })
    return Response.json({ id: currentLocal, email: 'fixture@example.invalid', email_confirmed_at: '2026-10-01T00:00:00Z', is_anonymous: false })
  }
  const verification = vi.fn(async () => {
    const user = await getRegisteredStaffTenantAuthUser(registeredStaffTenantAuth(client, TENANT_A, CLIENT, 'staff_users.read'), BEARER, authFetch)
    return { user, accessToken: BEARER, authIssuer: AUTH_ISSUER }
  })
  const serverAuth = vi.fn<StaffIdentityResolutionPorts['getAuthUser']>((registration, token) => getRegisteredStaffTenantAuthUser(registration, token, authFetch))
  const consumed = new Set<string>()
  const consumeJti = vi.fn(async (company: string, jti: string) => {
    expect(company).toBe(TENANT_A)
    if (consumed.has(jti)) return false
    consumed.add(jti); return true
  })
  seam.access.mockImplementation(async (request: NextRequest) => {
    if (request.headers.get('authorization') !== `Bearer ${MACHINE}`) return { ok: false, status: 401, error: 'Denied', errorCode: 'invalid_api_token' }
    return { ok: true, client }
  })
  const commands: Array<{ name: string; args: Record<string, unknown> }> = []
  const effects: Array<Record<string, unknown>> = []
  seam.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    commands.push({ name, args })
    if (name === 'gridex_resolve_staff_identity_v1') return { data: binding, error: null }
    if (name === 'gridex_validate_staff_identity_binding_v1') return { data: bindingActive ? binding : null, error: null }
    if (name === 'gridex_staff_customer_search_v1') return { data: { customer_ids: [], total: 0 }, error: null }
    if (name === 'gridex_staff_customer_id_for_reference_v1') return { data: args.p_company_id === TENANT_A && args.p_reference === publicReference('customer', TENANT_A, CUSTOMER_A1) ? CUSTOMER_A1 : null, error: null }
    if (name === 'gridex_create_staff_support_case_v1') {
      effects.push(structuredClone(args))
      const id = randomUUID(), at = new Date().toISOString()
      const row = { id, company_id: args.p_company_id, customer_id: args.p_customer_id, title: args.p_title, description: args.p_description,
        reason_category: args.p_category, priority: args.p_priority, status: 'open', assigned_to: null, source: 'tenant_support_staff_api', case_type: 'other',
        billing_blocked: false, billing_manual_review: false, cancellation_required: false,
        metadata: { ...(args.p_metadata as object), support_case: true, support_public_reference: publicReference('support_case', TENANT_A, id) },
        created_at: at, updated_at: at, resolved_at: null, closed_at: null }
      db.customer_cases.push(row)
      db.customer_case_events.push({ id: randomUUID(), company_id: TENANT_A, customer_id: CUSTOMER_A1, customer_case_id: id, event_type: 'created', message: 'Synthetic case', payload: {}, created_by: ACTOR, created_at: at })
      db.audit_logs.push({ company_id: args.p_company_id, actor_user_id: args.p_actor_user_id, channel: 'staff_api' })
      return { data: { case: row, reused: false }, error: null }
    }
    throw new Error('Unexpected synthetic RPC')
  })
  seam.context.mockImplementation(createStaffApiContextResolver({ apiAccess: seam.access, loadProvider: async () => provider,
    loadMembership: async (_company, actor) => active ? { user_id: actor, role_key: 'tenant_admin', membership_role: 'admin', status: 'active', is_active: true } : null,
    loadOverrides: async () => [], consumeJti, validateBinding: validateCurrentStaffIdentityBinding, isHistoricallyExternal: async () => true }))
  const identity = createStaffIdentityResolutionHandler({ apiAccess: seam.access, getAuthUser: serverAuth, loadProvider: async () => provider,
    consumeJti, resolveIdentity: resolveCurrentStaffIdentity, logRequest: logIntegrationApiRequest })
  const attempts: Array<{ request: NextRequest; body: string; proof: Record<string, unknown>; verified: number; response?: Response; responseBody?: Record<string, unknown> }> = []
  let transform: ((request: NextRequest) => Promise<NextRequest> | NextRequest) | undefined
  const transport: typeof fetch = async (input, init) => {
    let request = new NextRequest(String(input), { ...init, signal: init?.signal ?? undefined })
    if (transform) request = await transform(request)
    const attempt = { request, body: await request.clone().text(), proof: claims(request.headers.get('x-gridex-staff-assertion')!), verified: verification.mock.calls.length } as typeof attempts[number]
    attempts.push(attempt)
    let response: Response
    if (request.nextUrl.pathname === '/api/v1/staff-onboarding/identity/resolve') response = await identity(request)
    else if (request.nextUrl.pathname === '/api/v1/staff/customers') response = await getStaffCustomers(request)
    else if (request.nextUrl.pathname === '/api/v1/staff/cases') response = await postStaffCase(request)
    else response = await getStaffCase(request, { params: Promise.resolve({ reference: request.nextUrl.pathname.split('/').at(-1)! }) })
    attempt.response = response; attempt.responseBody = await response.clone().json()
    return response
  }
  return { client, verification, serverAuth, consumeJti, authRequests, commands, effects, attempts,
    changeUser: () => { currentLocal = '99999999-9999-4999-8999-999999999999' }, revoke: () => { active = false }, revokeBinding: () => { bindingActive = false },
    tamper: (fn: typeof transform) => { transform = fn }, transport,
    options: { apiOrigin: API, expectedProjectRef: CENTRAL, companyId: TENANT_A, tenantAuthIssuer: AUTH_ISSUER,
      providerIssuer: ISSUER, providerAudience: 'reference-staff', providerKeyId: 'reference-test', providerPublicJwk: jwk,
      signingPrivateKey: keys.privateKey, machineCredential: MACHINE, getVerifiedTenantSession: verification, fetchImpl: transport } }
}
const payload = { customer_reference: publicReference('customer', TENANT_A, CUSTOMER_A1), title: 'Synthetic support request', description: 'Fixture only', category: 'support', priority: 'normal' }
beforeEach(() => { vi.clearAllMocks(); resetSupportDb(); seam.completionFails = false })

describe('independent Staff server reference mounted contract', () => {
  it('resolves local identity, reads, writes, reads back and replays once with current verification and fresh proofs', async () => {
    const make = await factory(), h = mounted(), client = make(h.options)
    const resolved = await client.resolveIdentity()
    expect(resolved).toMatchObject({ status: 200, data: binding, replayed: false })
    expect(resolved.requestId).toBe(h.attempts[0].responseBody!.request_id)
    expect(ACTOR).not.toBe(LOCAL)
    expect((await client.listCustomers()).data).toEqual({ customers: [], pagination: { page: 1, page_size: 25, total: 0, total_pages: 1 } })
    const created = await client.createCase(payload, 'case-logical-operation-01')
    expect(created).toMatchObject({ status: 201, replayed: false, data: { title: payload.title, customer_reference: payload.customer_reference } })
    expect(created.requestId).toBe(h.attempts.at(-1)!.responseBody!.request_id)
    const reference = created.data.case_reference as string
    expect(reference).toMatch(/^support_case_[A-Za-z0-9_-]{32}$/)
    expect((await client.getCase(reference)).data).toMatchObject({ case_reference: reference, title: payload.title, events: [{ event_type: 'created', author_user_id: ACTOR }] })
    expect(await client.createCase(payload, 'case-logical-operation-01')).toMatchObject({ status: 201, replayed: true, data: { case_reference: reference } })
    await expect(client.createCase({ ...payload, title: 'Changed operation' }, 'case-logical-operation-01')).rejects.toMatchObject({ status: 409, code: 'idempotency_conflict' })
    expect(h.effects).toHaveLength(1); expect(db.customer_cases).toHaveLength(1); expect(db.audit_logs).toHaveLength(1)
    expect(h.effects[0]).toMatchObject({ p_company_id: TENANT_A, p_customer_id: CUSTOMER_A1, p_actor_user_id: ACTOR, p_api_client_id: CLIENT,
      p_metadata: { opened_by: 'staff', actor_user_id: ACTOR, api_client_id: CLIENT, support_channel: 'staff_api' } })
    expect(h.effects[0].p_idempotency_key).toBe(createHash('sha256').update(JSON.stringify(['staff_api', CLIENT, ACTOR, 'case-logical-operation-01'])).digest('hex'))
    expect(db.customer_portal_write_idempotency[0]).toMatchObject({ company_id: TENANT_A, api_client_id: CLIENT, customer_id: CUSTOMER_A1, status: 'completed' })
    expect(h.commands.find(command => command.name === 'gridex_resolve_staff_identity_v1')!.args).toMatchObject({ p_command: {
      company_id: TENANT_A, api_client_id: CLIENT, provider_id: PROVIDER, local_user_id: LOCAL, local_auth_issuer: AUTH_ISSUER, local_auth_url: AUTH,
      verified_client: { secret_hash: createHash('sha256').update(MACHINE).digest('hex'), staff_tenant_auth: { url: AUTH, public_key: AUTH_KEY } },
      verified_provider: { issuer: ISSUER, audience: 'reference-staff', public_jwk: jwk, subject_claim: 'sub', enforcement: 'enforce' },
    } })
    expect(h.commands.filter(command => command.name === 'gridex_validate_staff_identity_binding_v1').every(command => {
      const value = command.args.p_command as Record<string, unknown>
      return value.company_id === TENANT_A && value.api_client_id === CLIENT && value.local_user_id === LOCAL
        && value.actor_user_id === ACTOR && value.binding_id === BINDING && value.binding_version === 3
    })).toBe(true)
    const first = h.attempts[0]
    expect(first.body).toBe('{}')
    expect(first.proof).toEqual({ iss: ISSUER, aud: 'reference-staff', sub: LOCAL, company_id: TENANT_A, token_use: 'staff_identity_resolution', iat: expect.any(Number), exp: expect.any(Number), jti: expect.any(String) })
    expect(Number.isInteger(first.proof.iat)).toBe(true); expect(Number(first.proof.exp) - Number(first.proof.iat)).toBeLessThanOrEqual(60)
    expect(first.request.headers.get('x-gridex-support-auth-token')).toBe(BEARER)
    for (const [index, attempt] of h.attempts.entries()) {
      expect(attempt.verified).toBe(index + 1)
      expect(attempt.request.headers.get('x-gridex-expected-project-ref')).toBe(CENTRAL)
      const protectedHeader = JSON.parse(Buffer.from(attempt.request.headers.get('x-gridex-staff-assertion')!.split('.')[0], 'base64url').toString())
      expect(protectedHeader).toEqual({ alg: 'RS256', typ: 'JWT', kid: 'reference-test' })
      if (index > 0) {
        expect(attempt.request.headers.has('x-gridex-support-auth-token')).toBe(false)
        expect(attempt.proof).toMatchObject({ sub: ACTOR, token_use: 'staff_access', company_id: TENANT_A, local_auth_subject: LOCAL,
          local_auth_issuer: AUTH_ISSUER, staff_binding_id: BINDING, staff_binding_version: 3 })
      }
      const id = attempt.response!.headers.get('x-request-id')
      expect(id).toBe(attempt.responseBody!.request_id)
      expect(db.integration_api_requests.filter(row => row.request_id === id)).toHaveLength(1)
    }
    expect(new Set(h.attempts.map(attempt => attempt.proof.jti)).size).toBe(h.attempts.length)
    expect(h.authRequests).toHaveLength(h.attempts.length + 1)
    expect(h.authRequests.every(req => req.url === `${AUTH}/auth/v1/user` && req.bearer === `Bearer ${BEARER}` && req.apikey === AUTH_KEY)).toBe(true)
    const logs = JSON.stringify(db.integration_api_requests)
    for (const secret of [MACHINE, BEARER, h.attempts[0].request.headers.get('x-gridex-staff-assertion')!]) expect(logs).not.toContain(secret)
    expect(db.integration_api_requests.slice(1).every(row => (row.metadata as Record<string, unknown>).actor_user_id === ACTOR)).toBe(true)
  })

  it('treats a new key as a separate operation, never as a retry', async () => {
    const h = mounted(), client = (await factory())(h.options)
    await client.resolveIdentity(); await client.createCase(payload, 'first-operation'); await client.createCase(payload, 'second-operation')
    expect(h.effects).toHaveLength(2)
  })

  it('does not resend a committed write after lost acknowledgement; explicit same-operation retry replays', async () => {
    const h = mounted()
    let loseAcknowledgement = true
    const client = (await factory())({ ...h.options, fetchImpl: async (input: Parameters<typeof fetch>[0], init: RequestInit) => {
      const response = await h.transport(input, init)
      if (init.method === 'POST' && String(input).endsWith('/staff/cases') && loseAcknowledgement) throw new Error('private lost acknowledgement')
      return response
    } })
    await client.resolveIdentity()
    await expect(client.createCase(payload, 'lost-ack-operation')).rejects.toMatchObject({ code: 'transport_outcome_unknown' })
    expect(h.attempts).toHaveLength(2); expect(h.effects).toHaveLength(1)
    const previous = h.attempts.at(-1)!.proof.jti
    loseAcknowledgement = false
    const replay = await client.createCase(payload, 'lost-ack-operation')
    expect(replay.replayed).toBe(true)
    expect(replay.data.case_reference).toBe(publicReference('support_case', TENANT_A, db.customer_cases[0].id))
    expect(h.effects).toHaveLength(1); expect(h.verification).toHaveBeenCalledTimes(3)
    expect(h.attempts.at(-1)!.proof.jti).not.toBe(previous)
  })

  it('executes real closed JSON validation before identity or business authority', async () => {
    const h = mounted(), client = (await factory())(h.options)
    h.tamper(request => new NextRequest(request.url, { method: request.method, headers: request.headers, body: JSON.stringify({ company_id: TENANT_A }) }))
    await expect(client.resolveIdentity()).rejects.toMatchObject({ status: 422 })
    expect(h.serverAuth).not.toHaveBeenCalled(); expect(h.consumeJti).not.toHaveBeenCalled()
    h.tamper(undefined); await client.resolveIdentity()
    h.tamper(request => new NextRequest(request.url, { method: request.method, headers: request.headers, body: JSON.stringify({ ...payload, actor_user_id: LOCAL }) }))
    await expect(client.createCase(payload, 'closed-body-operation')).rejects.toMatchObject({ status: 422, code: 'invalid_request' })
    expect(h.effects).toHaveLength(0); expect(db.customer_portal_write_idempotency).toHaveLength(0)
  })

  it('denies malformed signed binding claims before reaching the native write', async () => {
    const h = mounted(), client = (await factory())(h.options)
    await client.resolveIdentity()
    h.tamper(request => {
      request.headers.set('x-gridex-staff-assertion', replaceProof(request.headers.get('x-gridex-staff-assertion')!, { staff_binding_version: 0 }))
      return request
    })
    await expect(client.createCase(payload, 'bad-binding-operation')).rejects.toMatchObject({ status: 401, code: 'staff_identity_binding_invalid' })
    expect(h.effects).toHaveLength(0); expect(db.customer_portal_write_idempotency).toHaveLength(0)
  })

  it('refuses wrong central project before server auth/JTI/log/domain effects', async () => {
    const h = mounted(), client = (await factory())({ ...h.options, expectedProjectRef: 'wwwwwwwwwwwwwwwwwwww' })
    await expect(client.resolveIdentity()).rejects.toMatchObject({ status: 412, code: 'storage_project_mismatch' })
    expect(seam.access).not.toHaveBeenCalled(); expect(h.serverAuth).not.toHaveBeenCalled(); expect(h.consumeJti).not.toHaveBeenCalled()
    expect(db.integration_api_requests ?? []).toHaveLength(0); expect(h.effects).toHaveLength(0)
  })

  it.each(['purpose', 'binding', 'membership', 'scope', 'replay'] as const)('denies %s before a new or stored-replay write', async variant => {
    const h = mounted(), client = (await factory())(h.options)
    await client.resolveIdentity(); await client.createCase(payload, 'revocation-operation')
    const original = h.attempts.at(-1)!.request.headers.get('x-gridex-staff-assertion')!
    if (variant === 'membership') h.revoke()
    if (variant === 'binding') h.revokeBinding()
    if (variant === 'scope') h.client.scopes = h.client.scopes.filter(scope => scope !== 'staff_cases.write')
    if (variant === 'purpose' || variant === 'replay') h.tamper(request => {
      request.headers.set('x-gridex-staff-assertion', variant === 'replay' ? original : replaceProof(request.headers.get('x-gridex-staff-assertion')!, { token_use: 'staff_identity_resolution' }))
      return request
    })
    const expected = { purpose: [401, 'staff_assertion_purpose_invalid'], binding: [403, 'staff_identity_binding_invalid'], membership: [403, 'staff_membership_inactive'], scope: [403, 'api_scope_missing'], replay: [401, 'staff_assertion_replayed'] }[variant]
    await expect(client.createCase(payload, 'revocation-operation')).rejects.toMatchObject({ status: expected[0], code: expected[1] })
    expect(h.effects).toHaveLength(1); expect(db.customer_cases).toHaveLength(1)
  })

  it('rejects a synthetic foreign customer without any business or replay delta', async () => {
    const h = mounted(), client = (await factory())(h.options)
    await client.resolveIdentity()
    const before = structuredClone({ cases: db.customer_cases, events: db.customer_case_events, audit: db.audit_logs, replay: db.customer_portal_write_idempotency })
    await expect(client.createCase({ ...payload, customer_reference: publicReference('customer', TENANT_B, CUSTOMER_A1) }, 'foreign-operation')).rejects.toMatchObject({ status: 404, code: 'customer_not_found' })
    expect({ cases: db.customer_cases, events: db.customer_case_events, audit: db.audit_logs, replay: db.customer_portal_write_idempotency }).toEqual(before)
  })

  it('keeps uncertain completion and stale processing distinct without another domain call', async () => {
    const h = mounted(), client = (await factory())(h.options)
    await client.resolveIdentity(); seam.completionFails = true
    await expect(client.createCase(payload, 'uncertain-operation')).rejects.toMatchObject({ status: 503, code: 'idempotency_completion_uncertain' })
    expect(h.effects).toHaveLength(1); expect(h.attempts).toHaveLength(2)
    db.customer_portal_write_idempotency[0].started_at = new Date(Date.now() - 11 * 60_000).toISOString()
    await expect(client.createCase(payload, 'uncertain-operation')).rejects.toMatchObject({ status: 409, code: 'idempotency_reconciliation_required' })
    expect(h.effects).toHaveLength(1)
  })

  it('rechecks local Auth and refuses cached authority after the local user changes', async () => {
    const h = mounted(), client = (await factory())(h.options)
    await client.resolveIdentity(); h.changeUser()
    await expect(client.listCustomers()).rejects.toMatchObject({ code: 'identity_resolution_required' })
    expect(h.verification).toHaveBeenCalledTimes(2); expect(h.attempts).toHaveLength(1)
  })
})

describe('reference transport and configuration safety', () => {
  it.each(['apiOrigin', 'expectedProjectRef', 'companyId', 'tenantAuthIssuer', 'providerIssuer', 'providerAudience', 'providerKeyId', 'providerPublicJwk', 'signingPrivateKey', 'machineCredential', 'getVerifiedTenantSession'])('rejects absent %s before Auth or transport', async option => {
    const h = mounted(), options = { ...h.options } as Record<string, unknown>; delete options[option]
    const make = await factory()
    expect(() => make(options)).toThrow()
    expect(h.verification).not.toHaveBeenCalled(); expect(h.attempts).toHaveLength(0)
  })
  it.each(['http://api.example.com', 'https://secret@api.example.com', 'https://api.example.com/path', 'https://api.example.com?q=secret', 'https://api.example.com/#secret'])('rejects unsafe origin %s without requests', async apiOrigin => {
    const h = mounted(), make = await factory()
    expect(() => make({ ...h.options, apiOrigin })).toThrow()
    expect(h.verification).not.toHaveBeenCalled(); expect(h.attempts).toHaveLength(0)
  })
  it('rejects nonmatching signing key and invalid operation input before network work', async () => {
    const h = mounted(), make = await factory()
    expect(() => make({ ...h.options, signingPrivateKey: generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey })).toThrow()
    const client = make(h.options)
    await expect(client.createCase(payload, '')).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(client.createCase({ ...payload, actor_user_id: ACTOR }, 'valid-operation')).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(client.getCase('https://foreign.example.com/secret')).rejects.toMatchObject({ code: 'invalid_input' })
    expect(h.verification).not.toHaveBeenCalled(); expect(h.attempts).toHaveLength(0)
  })
  it('rejects central Auth substitution and unverified local session output before signing', async () => {
    const h = mounted(), make = await factory()
    expect(() => make({ ...h.options, tenantAuthIssuer: `https://${CENTRAL}.supabase.co/auth/v1` })).toThrow()
    const client = make({ ...h.options, getVerifiedTenantSession: async () => ({ user: { id: LOCAL, email: 'fixture@example.invalid' }, accessToken: BEARER, authIssuer: AUTH_ISSUER }) })
    await expect(client.resolveIdentity()).rejects.toMatchObject({ code: 'tenant_session_invalid' })
    expect(h.attempts).toHaveLength(0)
  })
  it.each(['redirect', 'invalid_json', 'envelope', 'version', 'attestation', 'request_id', 'binding_extra', 'binding_version', 'oversize', 'transport'] as const)('fails closed on %s with one sanitized attempt', async variant => {
    const h = mounted(), secret = 'PRIVATE-BACKEND-SECRET', calls: RequestInit[] = []
    const transport: typeof fetch = async (_input, init) => {
      calls.push(init!)
      if (variant === 'transport') throw new Error(secret)
      if (variant === 'redirect') return new Response(null, { status: 307, headers: { location: 'https://foreign.example.com/' } })
      const requestId = randomUUID()
      const body: Record<string, unknown> = { data: { ...binding }, request_id: requestId, contract_schema_version: '2026-10-05.2' }
      const headers: Record<string, string> = { 'content-type': 'application/json', 'x-gridex-project-ref': CENTRAL, 'x-gridex-contract-version': '2026-10-05.2', 'x-request-id': requestId }
      if (variant === 'envelope') { delete body.data; body.secret = secret }
      if (variant === 'version') body.contract_schema_version = '2020-01-01.1'
      if (variant === 'attestation') headers['x-gridex-project-ref'] = TENANT
      if (variant === 'request_id') headers['x-request-id'] = 'different'
      if (variant === 'binding_extra') (body.data as Record<string, unknown>).private = secret
      if (variant === 'binding_version') (body.data as Record<string, unknown>).binding_version = 0
      return new Response(variant === 'oversize' ? secret.repeat(30_000) : variant === 'invalid_json' ? secret : JSON.stringify(body), { headers })
    }
    const client = (await factory())({ ...h.options, fetchImpl: transport })
    const error = await client.resolveIdentity().catch(error => error)
    expect(error).toBeInstanceOf(Error)
    expect(JSON.stringify(error) + String(error)).not.toContain(secret)
    expect(calls).toHaveLength(1); expect(calls[0].redirect).toBe('error')
    await expect(client.listCustomers()).rejects.toMatchObject({ code: 'identity_resolution_required' })
    expect(calls).toHaveLength(1)
  })
  it('bounds a stalled response body and never resends after timeout', async () => {
    const h = mounted(), transport = vi.fn(async () => new Response(new ReadableStream({ start() { /* Deliberately never finishes. */ } }), { headers: { 'content-type': 'application/json' } }))
    const client = (await factory())({ ...h.options, fetchImpl: transport, timeoutMs: 30 })
    const started = Date.now()
    await expect(client.resolveIdentity()).rejects.toMatchObject({ code: 'transport_outcome_unknown' })
    expect(Date.now() - started).toBeLessThan(1000); expect(transport).toHaveBeenCalledTimes(1)
  })
  it('cancels an oversized streaming response after bounded bytes rather than draining it', async () => {
    let pulls = 0, cancelled = false
    const h = mounted(), transport = vi.fn(async () => new Response(new ReadableStream({
      pull(controller) { pulls++; controller.enqueue(new Uint8Array(16_384)) },
      cancel() { cancelled = true },
    })))
    const client = (await factory())({ ...h.options, fetchImpl: transport })
    await expect(client.resolveIdentity()).rejects.toMatchObject({ code: 'invalid_response' })
    expect(pulls).toBeLessThanOrEqual(17); expect(cancelled).toBe(true); expect(transport).toHaveBeenCalledTimes(1)
  })
  it('keeps import, no-argument and help execution offline and never echoes unknown arguments', async () => {
    const guard = 'data:text/javascript,globalThis.fetch=()=>{process.exit(91)}'
    for (const args of [[], ['--help'], ['secret-token-do-not-echo']]) {
      const result = spawnSync(process.execPath, ['--import', guard, modulePath, ...args], { encoding: 'utf8', timeout: 3000 })
      expect(result.error).toBeUndefined()
      expect(result.status).toBe(args.length && args[0] !== '--help' ? 2 : 0)
      expect(result.stdout + result.stderr).not.toContain('secret-token-do-not-echo')
      expect(result.stdout + result.stderr).toContain('server')
    }
    const freshImport = spawnSync(process.execPath, ['--import', guard, '--input-type=module', '--eval', `await import(${JSON.stringify(pathToFileURL(modulePath).href)})`], { encoding: 'utf8', timeout: 3000 })
    expect(freshImport.error).toBeUndefined(); expect(freshImport.status).toBe(0)
    expect(freshImport.stdout + freshImport.stderr).toBe('')
  })
})
