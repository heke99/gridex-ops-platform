import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
type QueryReceipt = { table: string; fields: string; filters: Array<[string, string, unknown]>; orders: Array<[string, boolean]>; limit: number; single: boolean }
const port = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>, queries: [] as QueryReceipt[],
  rpcCalls: [] as Array<{ name: string; args: Row }>, updates: [] as Array<{ table: string; filters: Array<[string, string, unknown]> }>,
  readiness: [] as Array<{ companyId: string; clientId: string }>, redirects: [] as string[],
  rowCap: Infinity, adminDenied: false, generatedCredentials: 0,
  rpcError: { code: 'FINITE_STOP_BEFORE_RPC_EFFECT', message: 'Declared external RPC refusal; no database effects executed.' },
}))

// Only external transports and framework/auth/readiness/provider boundaries are
// finite ports. The selector, summary, action and FULL provisioning module are
// real; the canonical RPC always refuses before any database effect.
vi.mock('@/lib/supabase/service', () => {
  class Query {
    fields = '*'; filters: Array<[string, string, unknown]> = []; orders: Array<[string, boolean]> = []
    maximum = Infinity; patch: Row | null = null
    constructor(readonly table: string) {}
    select(fields: string) { this.fields = fields; return this }
    eq(key: string, value: unknown) { this.filters.push(['eq', key, value]); return this }
    is(key: string, value: unknown) { this.filters.push(['is', key, value]); return this }
    in(key: string, value: unknown[]) { this.filters.push(['in', key, value]); return this }
    order(key: string, options: { ascending: boolean }) { this.orders.push([key, options.ascending]); return this }
    limit(value: number) { this.maximum = value; return this }
    update(value: Row) { this.patch = value; return this }
    async run(single = false) {
      const table = port.tables[this.table]
      if (!table) throw Error(`Undeclared selection table ${this.table}`)
      let rows = table.filter(row => this.filters.every(([operation, key, value]) =>
        operation === 'in' ? (value as unknown[]).includes(row[key]) : (row[key] ?? null) === value))
      rows = [...rows].sort((left, right) => {
        for (const [key, ascending] of this.orders) {
          const a = String(left[key]), b = String(right[key])
          if (a !== b) return (a < b ? -1 : 1) * (ascending ? 1 : -1)
        }
        return 0
      })
      rows = rows.slice(0, Math.min(this.maximum, this.table === 'integration_api_clients' ? port.rowCap : Infinity))
      if (this.patch) {
        if (this.table !== 'companies') throw Error(`Unexpected pre-RPC write ${this.table}`)
        const patch = this.patch
        rows.forEach(row => Object.assign(row, patch))
        port.updates.push({ table: this.table, filters: structuredClone(this.filters) })
      }
      port.queries.push({ table: this.table, fields: this.fields, filters: structuredClone(this.filters), orders: [...this.orders], limit: this.maximum, single })
      // Alias fields are precomputed by PostgreSQL below, never decoded or
      // guessed from JSON numbers/objects by this transport.
      const projected = rows.map(row => this.fields === '*' ? structuredClone(row) : Object.fromEntries(
        this.fields.split(',').map(field => { const alias = field.split(':')[0]; return [alias, structuredClone(row[alias])] }),
      ))
      return { data: single ? projected[0] ?? null : projected, error: single && projected.length > 1 ? { code: 'PGRST116', message: 'Multiple rows' } : null }
    }
    maybeSingle() { return this.run(true) }
    then(done: (result: unknown) => unknown, failed?: (reason: unknown) => unknown) { return this.run().then(done, failed) }
  }
  return { supabaseService: {
    from: (table: string) => new Query(table),
    rpc: async (name: string, args: Row) => {
      if (name !== 'gridex_provision_tenant_website_client_v1') throw Error(`Unexpected RPC ${name}`)
      port.rpcCalls.push({ name, args: structuredClone(args) })
      return { data: null, error: port.rpcError }
    },
  } }
})
vi.mock('@/lib/admin/guards', () => ({ requirePlatformAdminActionAccess: async () => {
  if (port.adminDenied) throw Error('platform_admin_denied')
  return { userId: '20000000-0000-4000-8000-000000000001', email: 'actor@example.invalid' }
} }))
vi.mock('next/navigation', () => ({ redirect: (url: string) => { port.redirects.push(url); throw Error('FINITE_REDIRECT') } }))
vi.mock('next/cache', () => ({ revalidatePath: () => { throw Error('unexpected_post_RPC_revalidation') } }))
vi.mock('@/lib/audit/actionLogger', () => ({ logAdminActionAndUsage: () => { throw Error('unexpected_post_RPC_audit') } }))
vi.mock('@/lib/integrations/apiClientSecrets', () => ({ generateIntegrationApiToken: () => {
  port.generatedCredentials++
  return { token: 'finite-unused-token', keyPrefix: 'finite-unused-prefix', secretHash: 'finite-unused-hash' }
} }))
vi.mock('@/lib/integrations/tenantWebsiteReadiness', () => ({
  loadTenantWebsiteFlowReadiness: async ({ companyId, client }: { companyId: string; client: { id: string } }) => {
    port.readiness.push({ companyId, clientId: client.id })
    return { clientReady: true }
  },
  reconcileTenantWebsiteCapabilities: () => { throw Error('unexpected_post_RPC_readiness') },
}))
vi.mock('@/lib/ediel/certificationEvidence', () => ({ REQUIRED_PRODUCTION_EVIDENCE: [], recordEdielCertificationEvidence: () => { throw Error('unexpected_certification') } }))
vi.mock('@/lib/website/publicContracts', () => ({ listPublicContractOffers: () => { throw Error('unexpected_post_RPC_offers') }, publicContractResponse: () => { throw Error('unexpected_post_RPC_offers') } }))
vi.mock('@/lib/external-contracts/publicationDto', () => ({ mapContractPublicationToPublicDto: () => { throw Error('unexpected_post_RPC_publication') } }))
vi.mock('@/lib/integrations/tenantContext', () => ({ loadExternalTenantContext: () => { throw Error('unexpected_post_RPC_context') } }))

import { getTenantWebsiteGoLiveSummary } from '@/lib/integrations/tenantWebsiteGoLive'
import { verifyTenantWebsiteGoLiveAction } from '@/app/admin/platform/go-live/actions'

const COMPANY = '10000000-0000-4000-8000-000000000001'
const FOREIGN = '10000000-0000-4000-8000-000000000002'
const ACTOR = '20000000-0000-4000-8000-000000000001'
let db: PGlite
beforeAll(() => { db = new PGlite() })
afterAll(async () => { await db.close() })
beforeEach(() => {
  port.tables = {
    companies: [{ id: COMPANY, name: 'Finite company', status: 'active', website: 'https://tenant.example.invalid', branding: {}, customer_portal_url: 'https://tenant.example.invalid', external_tenant_reference: 'finite-tenant' }],
    integration_api_clients: [], tenant_website_installation_receipts: [],
  }
  port.queries = []; port.rpcCalls = []; port.updates = []; port.readiness = []; port.redirects = []
  port.rowCap = Infinity; port.adminDenied = false; port.generatedCredentials = 0
  port.rpcError = { code: 'FINITE_STOP_BEFORE_RPC_EFFECT', message: 'Declared external RPC refusal; no database effects executed.' }
})

async function client(id: string, raw = '{"primary":true,"environment":"production"}', overrides: Row = {}): Promise<Row> {
  // SELECT-only oracle copies the actual source predicates. No schema, native
  // harness, canonical function, hosted table or business transaction is run.
  const row = (await db.query<Row>(`select metadata, metadata->>'primary' as primary_text, metadata->>'environment' as environment_text,
    lower(coalesce(metadata->>'primary','true')) not in ('false','0','no') as canonical_primary,
    coalesce(nullif(metadata->>'environment',''),'production') = 'production' as canonical_environment
    from (select $1::jsonb as metadata) q`, [raw])).rows[0]
  return { id, company_id: COMPANY, name: id, status: 'active', profile_key: 'tenant_website', deleted_at: null, revoked_at: null,
    created_at: '2026-10-01T00:00:00Z', rate_limit_per_minute: 120, allowed_origins: ['https://tenant.example.invalid'], scopes: ['website_contracts.read'], ...row, ...overrides }
}
function form() {
  const value = new FormData()
  value.set('company_id', COMPANY); value.set('customer_portal_url', 'https://tenant.example.invalid'); value.set('allowed_origins', 'https://tenant.example.invalid')
  return value
}
async function assertSelected(id: string, rate: number) {
  const before = structuredClone(port.tables.integration_api_clients)
  const summary = await getTenantWebsiteGoLiveSummary(COMPANY)
  // Invoke the action before making selection assertions, so both real paths
  // reach their observable boundary even when the old summary is incorrect.
  await expect(verifyTenantWebsiteGoLiveAction(form())).rejects.toMatchObject({ code: port.rpcError.code })
  expect(summary?.client).toMatchObject({ id, rate_limit_per_minute: rate })
  expect(port.readiness).toEqual([{ companyId: COMPANY, clientId: id }])
  expect(port.rpcCalls).toEqual([{ name: 'gridex_provision_tenant_website_client_v1', args: expect.objectContaining({
    p_company_id: COMPANY, p_actor_user_id: ACTOR, p_environment: 'production', p_client_name: id,
    p_rate_limit_per_minute: rate, p_idempotency_key: `tenant-website:${COMPANY}:production`, p_allowed_origins: ['https://tenant.example.invalid'],
  }) }])
  expect(port.rpcCalls[0].args).not.toHaveProperty('p_client_id')
  expect(port.generatedCredentials).toBe(1) // Real provisioning reached its generator and RPC.
  expect(port.updates).toEqual([{ table: 'companies', filters: [['eq', 'id', COMPANY]] }])
  expect(port.tables.integration_api_clients).toEqual(before)
}
async function assertBlocked() {
  const summary = await getTenantWebsiteGoLiveSummary(COMPANY)
  await expect(verifyTenantWebsiteGoLiveAction(form())).rejects.toThrow('FINITE_REDIRECT')
  expect(summary?.client).toBeNull(); expect(port.readiness).toEqual([])
  expect(new URL(port.redirects[0], 'https://finite.invalid').searchParams.get('status')).toBe('blocked')
  expect(port.rpcCalls).toEqual([]); expect(port.updates).toEqual([]); expect(port.generatedCredentials).toBe(0)
}

const contrasts = [
  ['explicit primary with newer false secondary', '{"primary":true}', 'active', '{"primary":false}', 'active'],
  ['legacy primary with newer false secondary', '{}', 'active', '{"primary":false}', 'active'],
  ['newer revoked-status primary', '{"primary":true}', 'active', '{"primary":true}', 'revoked'],
  ['newer staging active primary', '{"primary":true}', 'active', '{"primary":true,"environment":"staging"}', 'active'],
  ['newer paused primary with existing active', '{"primary":true}', 'active', '{"primary":true}', 'paused'],
  ['adoptable paused primary with newer false secondary', '{"primary":true}', 'paused', '{"primary":false}', 'active'],
] as const

describe('actual tenant website summary and verification provisioning input', () => {
  it.each(contrasts)('preserves rate120 for %s', async (_name, ownRaw, ownStatus, newerRaw, newerStatus) => {
    port.tables.integration_api_clients = [
      await client('primary', ownRaw, { status: ownStatus, launch_blockers: [{ code: 'canonical_readiness_required' }] }),
      await client('newer', newerRaw, { status: newerStatus, rate_limit_per_minute: 240, created_at: '2026-10-03T00:00:00Z' }),
    ]
    await assertSelected('primary', 120)
  })

  it.each(['single explicit', 'single legacy', 'newest primary', 'foreign company', 'deleted secondary', 'foreign profile', 'past expiry'])('retains %s control and a configured nondefault rate', async name => {
    const primary = await client('primary', name === 'single legacy' ? '{}' : '{"primary":true}', { rate_limit_per_minute: 347 })
    const other = await client('other', '{"primary":false}', { rate_limit_per_minute: 240, created_at: '2026-10-03T00:00:00Z' })
    if (name === 'newest primary') { primary.created_at = '2026-10-04T00:00:00Z'; port.tables.integration_api_clients = [other, primary] }
    else if (name === 'foreign company') { other.company_id = FOREIGN; other.metadata = { primary: true }; other.primary_text = 'true'; port.tables.integration_api_clients = [primary, other] }
    else if (name === 'deleted secondary') { other.deleted_at = '2026-10-04T00:00:00Z'; port.tables.integration_api_clients = [primary, other] }
    else if (name === 'foreign profile') { other.profile_key = 'customer_portal'; other.metadata = { primary: true }; other.primary_text = 'true'; port.tables.integration_api_clients = [primary, other] }
    else { if (name === 'past expiry') primary.expires_at = '2020-01-01T00:00:00Z'; port.tables.integration_api_clients = [primary] }
    await assertSelected('primary', 347)
  })

  it('denies platform admin before client read, generation or provisioning', async () => {
    port.adminDenied = true
    await expect(verifyTenantWebsiteGoLiveAction(form())).rejects.toThrow('platform_admin_denied')
    expect(port.queries).toEqual([]); expect(port.rpcCalls).toEqual([]); expect(port.generatedCredentials).toBe(0)
  })

  it.each(['DUPLICATE_PRIMARY_TENANT_WEBSITE_CLIENT', 'TENANT_WEBSITE_ACTIVE_CLIENT_REVOKED', 'TENANT_WEBSITE_PAUSED_CLIENT_REQUIRES_OPERATOR_REVIEW', 'TENANT_NOT_FOUND', 'TENANT_WEBSITE_ENVIRONMENT_INVALID'])('propagates source-owned %s refusal without client effects', async code => {
    port.tables.integration_api_clients = [await client('primary', '{"primary":true}', { revoked_at: '2026-10-04T00:00:00Z' })]
    port.rpcError = { code, message: 'Predefined external refusal; SQL guard not executed by this test.' }
    await assertSelected('primary', 120)
    expect(port.redirects).toEqual([])
  })

  it('keeps a revoked active candidate in duplicate counts delegated to RPC', async () => {
    port.tables.integration_api_clients = [await client('primary'), await client('newer', '{"primary":true}', { revoked_at: '2026-10-04T00:00:00Z', created_at: '2026-10-03T00:00:00Z', rate_limit_per_minute: 240 })]
    port.rpcError = { code: 'DUPLICATE_PRIMARY_TENANT_WEBSITE_CLIENT', message: 'Predefined duplicate refusal; no native database policy execution.' }
    await assertSelected('newer', 240)
  })

  it('blocks an eligible active primary beyond the server cap without choosing paused', async () => {
    port.rowCap = 2
    port.tables.integration_api_clients = [await client('hidden-primary'),
      await client('nonprimary-new', '{"primary":false}', { created_at: '2026-10-04T00:00:00Z' }),
      await client('nonprimary-next', '{"primary":false}', { created_at: '2026-10-03T00:00:00Z' }),
      await client('paused-newest', '{"primary":true}', { status: 'paused', created_at: '2026-10-05T00:00:00Z', rate_limit_per_minute: 240 })]
    await assertBlocked()
    for (const query of port.queries.filter(row => row.table === 'integration_api_clients')) {
      expect(query.orders).toEqual([['status', true], ['created_at', false]])
      expect(query.filters).toContainEqual(['in', 'status', ['active', 'paused']])
    }
  })

  it.each(['primary_text', 'environment_text'])('blocks the whole selection for missing %s on active before an otherwise eligible paused row', async field => {
    const active = await client('unreadable-active')
    delete active[field]
    port.tables.integration_api_clients = [active, await client('paused', '{}', { status: 'paused', created_at: '2026-10-05T00:00:00Z', rate_limit_per_minute: 240 })]
    await assertBlocked()
  })

  it.each([
    ['primary_text', undefined], ['primary_text', false], ['primary_text', 0], ['primary_text', {}], ['primary_text', []],
    ['environment_text', undefined], ['environment_text', false], ['environment_text', 0], ['environment_text', {}], ['environment_text', []],
  ])('blocks the whole selection for malformed %s=%j before paused fallback', async (field, value) => {
    port.tables.integration_api_clients = [await client('unreadable-active', '{}', { [field as string]: value }),
      await client('paused', '{}', { status: 'paused', created_at: '2026-10-05T00:00:00Z', rate_limit_per_minute: 240 })]
    await assertBlocked()
  })

  it('keeps an older active primary visible ahead of a newer paused row at cap1', async () => {
    port.rowCap = 1
    port.tables.integration_api_clients = [await client('primary'), await client('paused', '{"primary":true}', { status: 'paused', created_at: '2026-10-05T00:00:00Z', rate_limit_per_minute: 240 })]
    await assertSelected('primary', 120)
  })

  it.each(['disabled', 'false-primary', 'staging-only', 'blank-spaces-environment'])('blocks %s before provisioning and hidden credential generation', async reason => {
    const raw = reason === 'false-primary' ? '{"primary":false}' : reason === 'staging-only' ? '{"environment":"staging"}' : reason === 'blank-spaces-environment' ? '{"environment":" "}' : '{}'
    port.tables.integration_api_clients = [await client('ineligible', raw, { status: reason === 'disabled' ? 'disabled' : 'active' })]
    await assertBlocked()
  })
})

const metadataCases = [
  ['missing', '{}'], ['null', '{"primary":null}'], ['boolean false', '{"primary":false}'], ['boolean true', '{"primary":true}'],
  ['integer zero', '{"primary":0}'], ['decimal zero', '{"primary":0.0}'], ['decimal zero scale2', '{"primary":0.00}'],
  ['string false', '{"primary":"false"}'], ['uppercase false', '{"primary":"FALSE"}'], ['no', '{"primary":"no"}'], ['zero text', '{"primary":"0"}'],
  ['space false', '{"primary":" false "}'], ['off', '{"primary":"off"}'], ['f', '{"primary":"f"}'], ['n', '{"primary":"n"}'],
  ['object primary', '{"primary":{}}'], ['array primary', '{"primary":[]}'], ['unknown text', '{"primary":"invalid"}'],
  ['null environment', '{"environment":null}'], ['empty environment', '{"environment":""}'], ['production environment', '{"environment":"production"}'],
  ['space environment', '{"environment":" production "}'], ['case environment', '{"environment":"Production"}'],
  ['boolean environment', '{"environment":true}'], ['object environment', '{"environment":{}}'],
] as const

describe('actual consumers preserve PostgreSQL JSON text legacy semantics', () => {
  it.each(metadataCases)('matches the finite original SQL expression for %s', async (_name, raw) => {
    const candidate = await client('candidate', raw, { created_at: '2026-10-03T00:00:00Z' })
    const fallback = await client('fallback', '{"primary":true}', { status: 'paused', rate_limit_per_minute: 347, launch_blockers: [{ code: 'canonical_readiness_required' }] })
    port.tables.integration_api_clients = [fallback, candidate]
    const eligible = candidate.canonical_primary === true && candidate.canonical_environment === true
    await assertSelected(eligible ? 'candidate' : 'fallback', eligible ? 120 : 347)
  })
})
