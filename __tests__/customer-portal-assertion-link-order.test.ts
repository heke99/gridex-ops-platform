import { generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Unit ports: authenticated integration access and a finite in-memory PostgREST store only.
 * The actual context factories, resolver, link persistence, assertion gate and JWS verification run.
 * No production authentication, provider, network, database or storage is contacted.
 */
type Row = Record<string, unknown>
type Write = { table: string; op: 'insert' | 'update'; payload: Row }
const state = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  writes: [] as Write[],
  events: [] as string[],
  replayAttempts: 0,
  customerReads: 0,
  freshLinkCustomer: null as 'missing' | 'disabled' | 'merged' | null,
}))

function builder(table: string) {
  const filters: Array<(row: Row) => boolean> = []
  let limit: number | undefined
  let op: Write['op'] | undefined
  let payload: Row = {}
  let completed: { data: Row[] | null; error: Row | null } | undefined
  const rows = () => (state.tables[table] ?? []).filter((row) => filters.every((filter) => filter(row))).slice(0, limit)
  const finish = () => {
    if (completed) return completed
    if (!op) {
      let data = rows()
      if (table === 'customers') {
        state.customerReads += 1
        // Actual resolver loads the candidate first; ensure then performs its fresh lifecycle read.
        if (state.customerReads > 1 && state.freshLinkCustomer) {
          data = state.freshLinkCustomer === 'missing' ? [] : data.map((row) => ({
            ...row,
            ...(state.freshLinkCustomer === 'disabled' ? { status: 'disabled' } : { merged_into_customer_id: FOREIGN_CUSTOMER }),
          }))
        }
      }
      return { data, error: null }
    }
    if (table === 'tenant_customer_assertion_replays') {
      state.replayAttempts += 1
      if ((state.tables[table] ?? []).some((row) => row.company_id === payload.company_id && row.jti === payload.jti)) {
        completed = { data: null, error: { code: '23505' } }
        return completed
      }
    }
    state.writes.push({ table, op, payload: { ...payload } })
    state.events.push(table)
    const stored = state.tables[table] ??= []
    if (op === 'insert') {
      const row = { id: `${table}-${state.writes.length}`, ...payload }
      stored.push(row)
      completed = { data: [row], error: null }
    } else {
      const matched = rows()
      for (const row of matched) Object.assign(row, payload)
      completed = { data: matched, error: null }
    }
    return completed
  }
  const api = {
    select: () => api,
    eq: (field: string, value: unknown) => { filters.push((row) => row[field] === value); return api },
    not: (field: string, _operator: string, value: unknown) => {
      filters.push((row) => value === null ? row[field] !== null && row[field] !== undefined : row[field] !== value)
      return api
    },
    limit: (value: number) => { limit = value; return api },
    insert: (value: Row) => { op = 'insert'; payload = value; return api },
    update: (value: Row) => { op = 'update'; payload = value; return api },
    maybeSingle: async () => { const result = finish(); return { ...result, data: result.data?.[0] ?? null } },
    then: (resolve: (value: { data: Row[] | null; error: Row | null }) => unknown) => Promise.resolve(finish()).then(resolve),
  }
  return api
}

vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from: (table: string) => builder(table),
    rpc: async (name: string, input: Row) => {
      if (name !== 'resolve_portal_customer_identity_v1') throw new Error(`Unexpected unit RPC: ${name}`)
      const data = (state.tables.customers ?? [])
        .filter((row) => row.company_id === input.p_company_id)
        .map((row) => ({ ...row, matched_factor_count: Number(Boolean(input.p_email && row.email === input.p_email)) + Number(Boolean(input.p_customer_number && row.customer_number === input.p_customer_number)) }))
        .filter((row) => row.matched_factor_count > 0)
        .sort((a, b) => b.matched_factor_count - a.matched_factor_count)
      return { data, error: null }
    },
  },
}))
vi.mock('@/lib/supabase/tenantQuery', () => ({
  tenantSelect: (companyId: string, table: string) => builder(table).eq('company_id', companyId),
  tenantInsert: (companyId: string, table: string, values: Row) => builder(table).insert({ ...values, company_id: companyId }),
}))
vi.mock('@/lib/integrations/apiAuth', () => ({
  // Declared authenticated API-access unit port; no user-session or assertion is fabricated here.
  requireIntegrationApiAccess: async () => ({ ok: true, client: { id: 'unit-client', company_id: COMPANY } }),
  logIntegrationApiRequest: vi.fn(async () => undefined),
  currentIntegrationApiResponseContext: () => null,
}))

const COMPANY = '00000000-0000-4000-8000-000000000001'
const FOREIGN_COMPANY = '00000000-0000-4000-8000-000000000002'
const CUSTOMER = '10000000-0000-4000-8000-000000000001'
const FOREIGN_CUSTOMER = '10000000-0000-4000-8000-000000000002'
const SUBJECT = 'tenant-login:customer-1'
const STORED_SUBJECT = '20000000-0000-4000-8000-000000000001'
const EMAIL = 'unit-customer@example.test'
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const wrongKey = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey
const publicJwk = publicKey.export({ format: 'jwk' })

type Factory = 'request' | 'identifiers'
async function context(factory: Factory, request: NextRequest, options: { mode?: 'read' | 'link'; enforceBinding?: boolean; allowIdentifierBoundWrite?: boolean } = { mode: 'link' }, identifiers: Row = {}) {
  const api = await import('@/lib/customer-portal/externalApi')
  return factory === 'request'
    ? api.requireCustomerPortalApiContext(request, ['customer_sync.write'], options)
    : api.requireCustomerPortalApiContextForIdentifiers(request, identifiers, ['customer_sync.write'], options)
}

function assertion(overrides: Row = {}, key = privateKey) {
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ iss: 'https://unit-login.example.test', aud: 'unit-customer-api', sub: SUBJECT, iat: now, exp: now + 300, jti: randomUUID(), ...overrides })).toString('base64url')
  return `${header}.${payload}.${sign('sha256', Buffer.from(`${header}.${payload}`), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`
}

function request(token: string | null = null, headers: Record<string, string> = {}, method = 'POST') {
  return new NextRequest('https://unit-ops.example.test/api/v1/customer/sync', {
    method,
    headers: {
      'x-gridex-customer-portal-user-id': SUBJECT,
      'x-gridex-customer-number': 'K0000001',
      'x-gridex-customer-email': EMAIL,
      ...(token ? { 'x-gridex-customer-assertion': token } : {}),
      ...headers,
    },
  })
}
const bindingWrites = () => state.writes.filter((write) => ['customer_portal_accounts', 'customer_portal_identities'].includes(write.table))

beforeEach(async () => {
  vi.stubEnv('GRIDEX_PORTAL_IDENTITY_ENFORCEMENT', 'enforce')
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  state.writes = []
  state.events = []
  state.replayAttempts = 0
  state.customerReads = 0
  state.freshLinkCustomer = null
  state.tables = {
    customers: [
      { id: CUSTOMER, company_id: COMPANY, customer_number: 'K0000001', external_customer_id: 'unit-web-1', email: EMAIL, status: 'active' },
      { id: FOREIGN_CUSTOMER, company_id: FOREIGN_COMPANY, customer_number: 'K0000002', email: 'foreign@example.test', status: 'active' },
    ],
    customer_profiles: [], tenant_portal_customer_links: [], customer_portal_accounts: [], customer_portal_identities: [],
    tenant_customer_assertion_replays: [],
    tenant_customer_identity_providers: [{
      id: 'unit-provider', company_id: COMPANY, purpose: 'customer', is_active: true,
      kind: 'tenant_key', display_name: 'Unit public signing key', issuer: 'https://unit-login.example.test', audience: 'unit-customer-api',
      jwks_uri: null, public_jwk: publicJwk, subject_claim: 'sub', enforcement: 'enforce',
    }],
  }
  const gate = await import('@/lib/customer-portal/customerAssertion')
  gate.resetCustomerIdentityProviderCache()
  gate.resetJwksCacheForTests()
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

describe.each<Factory>(['request', 'identifiers'])('%s factory assertion-before-link', (factory) => {
  it.each(['missing', 'signature', 'expired', 'subject', 'replayed'] as const)('denies %s proof with zero account or identity mutations', async (kind) => {
    const jti = randomUUID()
    if (kind === 'replayed') state.tables.tenant_customer_assertion_replays.push({ company_id: COMPANY, jti })
    const token = kind === 'missing' ? null : kind === 'signature' ? assertion({}, wrongKey)
      : kind === 'expired' ? assertion({ iat: Math.floor(Date.now() / 1000) - 900, exp: Math.floor(Date.now() / 1000) - 120 })
        : kind === 'subject' ? assertion({ sub: 'other-customer-login' }) : assertion({ jti })
    const result = await context(factory, request(token))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.response.status).toBe(403)
    expect(await result.response.json()).toMatchObject({ error: { code: kind === 'missing' ? 'customer_assertion_required' : 'customer_assertion_invalid' } })
    expect(bindingWrites()).toEqual([])
    expect(state.tables.customer_portal_accounts).toEqual([])
    expect(state.tables.customer_portal_identities).toEqual([])
    expect(state.replayAttempts).toBe(kind === 'replayed' ? 1 : 0)
  })

  it('accepts the intended subject, consumes one JTI before both actual binding writes, and does not verify it twice', async () => {
    const result = await context(factory, request(assertion()), { mode: 'link', allowIdentifierBoundWrite: true })
    expect(result).toMatchObject({ ok: true, identity: { customer_id: CUSTOMER, customer_portal_user_id: SUBJECT } })
    expect(bindingWrites().map((write) => write.table)).toEqual(['customer_portal_accounts', 'customer_portal_identities'])
    expect(state.replayAttempts).toBe(1)
    expect(state.events).toEqual(['tenant_customer_assertion_replays', 'customer_portal_accounts', 'customer_portal_identities'])
    expect(state.tables.customer_portal_accounts[0]).toMatchObject({ company_id: COMPANY, customer_id: CUSTOMER, external_account_id: SUBJECT, status: 'active', is_active: true })
    expect(state.tables.customer_portal_identities[0]).toMatchObject({ company_id: COMPANY, customer_id: CUSTOMER, external_account_id: SUBJECT, status: 'active' })
  })

  it.each(['missing', 'disabled', 'merged'] as const)('refuses cached proof when the fresh %s customer prevents link persistence, including actual sync machine options', async (freshState) => {
    state.freshLinkCustomer = freshState
    const result = await context(factory, request(assertion()), { mode: 'link', allowIdentifierBoundWrite: true })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.response.status).toBe(403)
    expect(await result.response.json()).toMatchObject({ error: { code: 'customer_identity_binding_required' } })
    expect(state.customerReads).toBe(2)
    expect(state.replayAttempts).toBe(1)
    expect(bindingWrites()).toEqual([])
    expect(state.events).toEqual(['tenant_customer_assertion_replays'])
  })

  it.each(['report', 'unconfigured'] as const)('preserves tenant policy %s without requiring a new global proof policy', async (policy) => {
    if (policy === 'report') state.tables.tenant_customer_identity_providers[0].enforcement = 'report'
    else state.tables.tenant_customer_identity_providers = []
    const result = await context(factory, request())
    expect(result.ok).toBe(true)
    expect(bindingWrites()).toHaveLength(2)
    expect(state.replayAttempts).toBe(0)
  })

  it('consumes a valid report-mode assertion once before link writes', async () => {
    state.tables.tenant_customer_identity_providers[0].enforcement = 'report'
    expect((await context(factory, request(assertion()))).ok).toBe(true)
    expect(state.replayAttempts).toBe(1)
    expect(state.events).toEqual(['tenant_customer_assertion_replays', 'customer_portal_accounts', 'customer_portal_identities'])
  })

  it('retains read mode refusal for an unlinked user with no writes or assertion consumption', async () => {
    const result = await context(factory, request(assertion(), {}, 'GET'), { mode: 'read' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(await result.response.json()).toMatchObject({ error: { code: 'customer_portal_link_required' } })
    expect(state.writes).toEqual([])
    expect(state.replayAttempts).toBe(0)
  })

  it('preserves existing external-account alias resolution and verifies the stored portal subject once', async () => {
    state.tables.customer_portal_accounts.push({ id: 'existing-alias', company_id: COMPANY, customer_id: CUSTOMER, external_account_id: SUBJECT, portal_user_id: STORED_SUBJECT, status: 'active', is_active: true })
    const result = await context(factory, request(assertion({ sub: STORED_SUBJECT })))
    expect(result).toMatchObject({ ok: true, identity: { customer_portal_user_id: STORED_SUBJECT } })
    expect(bindingWrites()).toEqual([])
    expect(state.replayAttempts).toBe(1)
  })

  it('keeps an existing linked read mutation-free while verifying its actual subject once', async () => {
    state.tables.customer_portal_accounts.push({ id: 'existing-read', company_id: COMPANY, customer_id: CUSTOMER, external_account_id: SUBJECT, portal_user_id: STORED_SUBJECT, status: 'active', is_active: true })
    const result = await context(factory, request(assertion({ sub: STORED_SUBJECT }), {}, 'GET'), { mode: 'read', enforceBinding: true })
    expect(result).toMatchObject({ ok: true, identity: { customer_portal_user_id: STORED_SUBJECT } })
    expect(bindingWrites()).toEqual([])
    expect(state.replayAttempts).toBe(1)
  })

  it('rejects a presented alias assertion when the existing link has a different stored subject', async () => {
    state.tables.customer_portal_accounts.push({ id: 'existing-alias', company_id: COMPANY, customer_id: CUSTOMER, external_account_id: SUBJECT, portal_user_id: STORED_SUBJECT, status: 'active', is_active: true })
    const result = await context(factory, request(assertion()))
    expect(result.ok).toBe(false)
    expect(bindingWrites()).toEqual([])
    expect(state.replayAttempts).toBe(0)
  })

  it.each(['mismatched_user_ids', 'disabled_customer', 'blocked_link', 'weak_first_link', 'foreign_customer'] as const)('retains %s protection with zero binding writes', async (kind) => {
    const headers: Record<string, string> = {}
    if (kind === 'mismatched_user_ids') headers['x-gridex-auth-user-id'] = 'another-user'
    if (kind === 'disabled_customer') state.tables.customers[0].status = 'disabled'
    if (kind === 'blocked_link') state.tables.customer_portal_accounts.push({ id: 'blocked', company_id: COMPANY, customer_id: CUSTOMER, external_account_id: SUBJECT, status: 'disabled', is_active: false })
    if (kind === 'weak_first_link') headers['x-gridex-customer-email'] = ''
    if (kind === 'foreign_customer') { headers['x-gridex-customer-number'] = 'K0000002'; headers['x-gridex-customer-email'] = 'foreign@example.test' }
    const result = await context(factory, request(assertion(), headers))
    expect(result.ok).toBe(false)
    expect(bindingWrites()).toEqual([])
    if (kind === 'mismatched_user_ids') {
      if (result.ok) return
      expect(result.response.status).toBe(422)
      expect(await result.response.json()).toMatchObject({ error: { code: 'portal_identity_mismatch' } })
      expect(state.replayAttempts).toBe(0)
    }
  })
})

describe('intended subject uses the actual resolver normalization and precedence', () => {
  it('trims payload portal subject and lets payload identifiers take nullish precedence over request headers', async () => {
    const result = await context('identifiers', request(assertion(), { 'x-gridex-customer-portal-user-id': 'wrong-header' }), { mode: 'link' }, { customerPortalUserId: `  ${SUBJECT}  ` })
    expect(result).toMatchObject({ ok: true, identity: { customer_portal_user_id: SUBJECT } })
    expect(state.tables.customer_portal_accounts[0].external_account_id).toBe(SUBJECT)
    expect(state.replayAttempts).toBe(1)
  })

  it('a blank explicit portal field masks its header and falls back to the trimmed effective auth subject', async () => {
    const result = await context('identifiers', request(assertion(), { 'x-gridex-customer-portal-user-id': 'masked-header' }), { mode: 'link' }, { customerPortalUserId: '   ', authUserId: ` ${SUBJECT} ` })
    expect(result).toMatchObject({ ok: true, identity: { customer_portal_user_id: SUBJECT } })
    expect(state.replayAttempts).toBe(1)
    expect(bindingWrites()).toHaveLength(2)
  })

  it('does not add an assertion requirement to direct trusted resolver callers that omit the optional hook', async () => {
    const { resolvePortalCustomer } = await import('@/lib/customer-portal/customerResolver')
    const result = await resolvePortalCustomer({ client: { id: 'unit-client', company_id: COMPANY } as never, request: request(), mode: 'link' })
    expect(result).toMatchObject({ ok: true, binding: 'portal_account' })
    expect(bindingWrites()).toHaveLength(2)
    expect(state.replayAttempts).toBe(0)
  })
})
