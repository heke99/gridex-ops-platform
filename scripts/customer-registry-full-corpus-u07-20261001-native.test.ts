import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { listCustomersPage } from '@/lib/customers/getCustomers'
import { REGISTRY_API, REGISTRY_BODY_SHA256, createRegistryReadFixture, registryInstalledOwner,
  registryNativeEnvironment, registryPersistentSnapshot, registrySql, type RegistryReadFixture } from './customer-registry-full-corpus-u07-20261001-native.fixture'

const environment = registryNativeEnvironment(process.env)
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
const service = createClient(REGISTRY_API, environment.serviceKey, options)
const anonymous = createClient(REGISTRY_API, environment.anonKey, options)
const originalFetch = globalThis.fetch
type Row = { id: string; company_id: string; site_count: number; active_site_count: number; metering_point_count: number;
  contract_count: number; has_missing_grid_owner: boolean; has_signed_power_of_attorney: boolean;
  possible_duplicate: null; duplicate_review_status: null; consolidated_invoice: null; billing_level: null }
type Page = { rows: Row[]; total: number; page: number; pageSize: number; totalPages: number; counts: Record<string, number> }
let f: RegistryReadFixture
let authenticated: SupabaseClient
let baseline: ReturnType<typeof registryPersistentSnapshot>

function parameters(overrides: Record<string, unknown> = {}) {
  return { p_company_id: f.company, p_query: f.token, p_status: 'all', p_contract_filter: 'all', p_customer_type: 'all',
    p_flag: 'all', p_exclude_test_data: false, p_page: 1, p_page_size: 100, ...overrides }
}
async function read(overrides: Record<string, unknown> = {}): Promise<Page> {
  const result = await service.rpc('gridex_customer_registry_page_v1', parameters(overrides))
  if (result.error || !result.data) throw new Error('u07_native_installed_read_failed')
  return result.data as Page
}
function unchanged() { expect(registryPersistentSnapshot()).toEqual(baseline) }
beforeAll(async () => {
  // Both GoTrue and PostgREST use only the explicitly owned local stack.
  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.origin !== REGISTRY_API) throw new Error('u07_native_external_transport_forbidden')
    return originalFetch(input, init)
  }) as typeof fetch
  const owner = registryInstalledOwner()
  expect(owner).toEqual({ stable: 's', invoker: true, config: ['search_path=pg_catalog, public'],
    service: true, anon: false, authenticated: false, bodySha256: REGISTRY_BODY_SHA256 })
  const email = `u07-native-reader-${randomUUID()}@example.invalid`, password = randomUUID() + 'A1!'
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true })
  if (created.error || !created.data.user) throw new Error('u07_native_gotrue_create_failed')
  authenticated = createClient(REGISTRY_API, environment.anonKey, options)
  const login = await authenticated.auth.signInWithPassword({ email, password })
  if (login.error || !login.data.session || login.data.user?.id !== created.data.user.id) {
    throw new Error('u07_native_gotrue_session_failed')
  }
  const current = await authenticated.auth.getUser()
  if (current.error || current.data.user?.id !== created.data.user.id) throw new Error('u07_native_gotrue_current_user_failed')
  f = createRegistryReadFixture()
  expect(registrySql<Record<string, number>>(`SELECT jsonb_build_object(
    'customers',(SELECT count(*) FROM public.customers WHERE company_id='${f.company}'::uuid),
    'sites',(SELECT count(*) FROM public.customer_sites WHERE company_id='${f.company}'::uuid),
    'points',(SELECT count(*) FROM public.metering_points WHERE company_id='${f.company}'::uuid),
    'contracts',(SELECT count(*) FROM public.customer_contracts WHERE company_id='${f.company}'::uuid),
    'poas',(SELECT count(*) FROM public.powers_of_attorney WHERE company_id='${f.company}'::uuid));`))
    .toEqual({ customers: 1001, sites: 1003, points: 1002, contracts: 1002, poas: 1002 })
  // Service success precedes low-privilege calls; missing schema/cache/function
  // cannot be mistaken for an EXECUTE denial.
  expect((await read()).total).toBe(1001)
  baseline = registryPersistentSnapshot()
  writeFileSync(join(f.folder, 'baseline-digests.json'), JSON.stringify(baseline), { mode: 0o600, flag: 'wx' })
})
afterAll(() => {
  globalThis.fetch = originalFetch
  // Own immutable histories remain in this disposable stack until its normal
  // teardown. No deletion/cascade, session mutation or held service is needed.
})

it('real installed service RPC searches the complete literal corpus and the actual exported consumer parses it', async () => {
  const result = await read({ p_query: "_%(,).'" })
  expect(result.rows.map(row => row.id)).toEqual([f.oldest]); expect(result.total).toBe(1)
  expect(result.rows[0].company_id).toBe(f.company)
  const projected = await listCustomersPage({ companyId: f.company, query: "_%(,).'", page: 1, pageSize: 100 })
    .catch(() => { throw new Error('u07_native_exported_consumer_failed') })
  expect(projected.rows.map(row => row.id)).toEqual([f.oldest]); expect(projected.total).toBe(1)
  expect(Object.hasOwn(projected.rows[0], 'company_id')).toBe(false)
  for (const key of ['possible_duplicate','duplicate_review_status','consolidated_invoice','billing_level'] as const) {
    expect(projected.rows[0][key]).toBeNull()
  }
  expect((await read({ p_query: 'literalX' })).rows.length).toBe(0)
  unchanged()
})

it('complete customer ranges retain exact1001 totals and stable one-hundred-row pages including off-end', async () => {
  const ids: string[] = []
  for (let page = 1; page <= 11; page++) {
    const result = await read({ p_page: page })
    expect(result.total).toBe(1001); expect(result.totalPages).toBe(11); expect(result.counts.all).toBe(1001)
    expect(result.rows).toHaveLength(page === 11 ? 1 : 100)
    expect(result.rows.every(row => row.company_id === f.company)).toBe(true)
    ids.push(...result.rows.map(row => row.id))
  }
  expect(new Set(ids).size).toBe(1001); expect(ids[0]).toBe(f.newest); expect(ids.at(-1)).toBe(f.oldest)
  const offEnd = await read({ p_page: 12 }); expect(offEnd.rows.length).toBe(0); expect(offEnd.total).toBe(1001)
  unchanged()
})

it('all four stored relation corpora exceed1000 and the oldest exact tuple remains visible', async () => {
  const result = await read({ p_customer_type: 'business', p_flag: 'multi_site' })
  expect(result.rows.map(row => [row.id,row.site_count,row.metering_point_count,row.contract_count]))
    .toEqual([[f.newest,1001,1001,1001],[f.oldest,2,1,1]])
  expect(result.rows.every(row => row.has_missing_grid_owner && !row.has_signed_power_of_attorney)).toBe(true)
  expect((await read({ p_contract_filter: 'none' })).total).toBe(999)
  // Drafts, including equal-timestamp contract rows, do not become signed or
  // closed/latest facts merely because a customer owns one or many contracts.
  expect((await read({ p_contract_filter: 'signed' })).total).toBe(0)
  expect((await read({ p_contract_filter: 'closed' })).total).toBe(0)
  expect((await read({ p_flag: 'ready_for_switch' })).total).toBe(0)
  const missing = await read({ p_flag: 'missing_authorization' })
  expect(missing.total).toBe(1001)
  unchanged()
})

it('query/type/flag chip counts precede selected status and contract within the same installed read', async () => {
  const result = await read({ p_customer_type: 'business', p_flag: 'multi_site', p_status: 'active' })
  expect(result.rows.map(row => row.id)).toEqual([f.newest]); expect(result.total).toBe(1)
  expect(result.counts).toMatchObject({ all: 2, active: 1, blocked: 1 })
  const none = await read({ p_customer_type: 'business', p_flag: 'multi_site', p_status: 'active', p_contract_filter: 'none' })
  expect(none.rows.length).toBe(0); expect(none.total).toBe(0)
  expect(none.counts).toMatchObject({ all: 2, active: 1, blocked: 1 })
  unchanged()
})

it('exact quiet-company graph is independent and service null-company compatibility retains both scoped corpora', async () => {
  const quiet = await read({ p_company_id: f.quietCompany })
  expect(quiet.rows.map(row => [row.company_id,row.id,row.site_count,row.metering_point_count,row.contract_count]))
    .toEqual([[f.quietCompany,f.quietCustomer,1,1,1]])
  const own = await read({ p_query: f.token + '-quiet' }); expect(own.rows.length).toBe(0); expect(own.total).toBe(0)
  const global = await read({ p_company_id: null, p_query: f.token + '-', p_customer_type: 'business' })
  expect(global.rows.map(row => row.id)).toEqual([f.newest,f.oldest]); expect(global.total).toBe(2)
  const both = await read({ p_company_id: null, p_query: f.token + '-', p_page: 11 })
  expect(both.total).toBe(1002); expect(both.rows).toHaveLength(2)
  unchanged()
})

it('installed malformed graph and unsupported facts fail explicitly without writing or becoming empty success', async () => {
  for (const [overrides, code] of [
    [{ p_company_id: f.malformedCompany, p_query: 'Synthetic malformed alias graph' },'55000'],
    [{ p_flag: 'possible_duplicate' },'55000'], [{ p_flag: 'consolidated_invoice' },'55000'],
    [{ p_page: 0 },'22023'], [{ p_page_size: 101 },'22023'],
  ] as Array<[Record<string, unknown>, string]>) {
    const result = await service.rpc('gridex_customer_registry_page_v1', parameters(overrides))
    expect(result.error?.code).toBe(code); expect(result.data === null).toBe(true)
  }
  unchanged()
})

it('real GoTrue authenticated and anonymous callers receive genuine42501 EXECUTE denial after service success', async () => {
  expect((await read()).total).toBe(1001)
  for (const client of [anonymous, authenticated]) {
    const result = await client.rpc('gridex_customer_registry_page_v1', parameters())
    expect(result.error?.code).toBe('42501'); expect([401,403]).toContain(result.status); expect(result.data === null).toBe(true)
  }
  unchanged()
  console.log('U07_REGISTRY_NATIVE_PASS installed_owner=true complete_read=true business_catalog_unchanged=true gotrue_execute_denial=true signed_journey=false server_guard_browser_rls_unqualified=true')
})
