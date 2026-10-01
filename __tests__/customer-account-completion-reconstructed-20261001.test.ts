import { beforeEach, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const fixture = vi.hoisted(() => ({
  company: 'a1000000-0000-4000-8000-000000000001', customer: 'a2000000-0000-4000-8000-000000000001',
  user: 'a3000000-0000-4000-8000-000000000001', session: 'a4000000-0000-4000-8000-000000000001',
  site: 'a5000000-0000-4000-8000-000000000001', account: 'a6000000-0000-4000-8000-000000000001',
  rows: {} as Record<string, Row[]>, faults: new Set<string>(), calls: [] as Array<{ table: string; mode: string }>,
  rpc: [] as Row[], refreshed: [] as string[], cacheError: null as Error | null,
  userError: false, claimError: false, receiptError: false,
  claimsThrow: null as Error | null, createdRole: 'owner',
  claimsSub: '',claimsSession: '',
}))

// Only the outer Auth/persistence/cache transports are controlled here.
// The actual exported Action, actual verified-session helper and (after the
// reconstruction) actual atomic-command adapter execute. SQL durability is
// tested independently by the actual PostgreSQL business core/native packet.
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({ auth: {
  getUser: async () => ({ data: { user: { id: fixture.user, email: 'account@example.invalid' } }, error: fixture.userError ? { code: 'synthetic_auth_fault' } : null }),
  getClaims: async () => { if(fixture.claimsThrow) throw fixture.claimsThrow; return { data: { claims: { sub: fixture.claimsSub||fixture.user, session_id: fixture.claimsSession||fixture.session } }, error: fixture.claimError ? { code: 'synthetic_claims_fault' } : null } },
} }) }))
vi.mock('next/cache', () => ({ revalidatePath: (path: string) => {
  if (fixture.cacheError) throw fixture.cacheError
  fixture.refreshed.push(path)
} }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from(table: string) {
    const filters: Array<(row: Row) => boolean> = []
    let mode = 'select', payload: Row | null = null, max = Infinity
    let result: { data: Row[] | null; error: Row | null } | null = null
    const execute = () => {
      if (result) return result
      fixture.calls.push({ table, mode })
      if (mode !== 'select' && fixture.faults.has(table)) return result = { data: null, error: { code: 'P0001', message: 'synthetic_owned_late_write_failure' } }
      const rows = fixture.rows[table] ?? (fixture.rows[table] = [])
      let selected = rows.filter(row => filters.every(filter => filter(row))).slice(0, max)
      if (payload) {
        if (mode !== 'insert') throw new Error('unexpected_business_update')
        const row = { id: fixture.account, ...structuredClone(payload) }
        rows.push(row); selected = [row]
      }
      return result = { data: structuredClone(selected), error: null }
    }
    const q = {
      select: () => q, order: () => q,
      eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return q },
      in: (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return q },
      or: (filter: string) => { const parts = filter.split(',').map(part => part.split('.eq.')); filters.push(row => parts.some(([key, value]) => row[key] === value)); return q },
      limit: (count: number) => { max = count; return q },
      insert: (value: Row) => { mode = 'insert'; payload = value; return q },
      maybeSingle: async () => { const r = execute(); return { data: r.data?.[0] ?? null, error: r.error } },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(execute()).then(resolve),
    }
    return q
  },
  async rpc(name: string, args: Row) {
    if (name !== 'gridex_complete_customer_portal_account_v1') throw new Error('unexpected_reconstructed_rpc')
    const command = args.p_command as Row
    fixture.rpc.push(structuredClone(command))
    if (fixture.faults.size) return { data: null, error: { code: 'P0001', message: 'synthetic_owned_late_write_failure' } }
    if (fixture.receiptError) return { data: { status: 'created' }, error: null }
    const existing = fixture.rows.customer_portal_accounts[0]
    if (!existing) {
      fixture.rows.customer_portal_accounts.push({ id: fixture.account, company_id: fixture.company, customer_id: fixture.customer,
        user_id: fixture.user, portal_user_id: null, role: 'owner', status: 'active', is_active: true })
      fixture.rows.customer_portal_claims.push({ id: 'a7000000-0000-4000-8000-000000000001', status: 'approved' })
      fixture.rows.customer_portal_events.push({ id: 'a8000000-0000-4000-8000-000000000001', event_type: 'portal_account_verified' })
      fixture.rows.completion_receipts.push({ id: 'a9000000-0000-4000-8000-000000000001' })
    }
    const receipt = fixture.rows.completion_receipts[0]
    return { error: null, data: { status: existing ? receipt ? 'replayed' : 'existing' : 'created',
      companyId: fixture.company, customerId: fixture.customer, userId: fixture.user,
      accountId: fixture.account, role: existing?.role ?? fixture.createdRole,
      receiptId: receipt?.id ?? null, claimId: receipt ? 'a7000000-0000-4000-8000-000000000001' : null,
      eventId: receipt ? 'a8000000-0000-4000-8000-000000000001' : null } }
  },
} }))

import { claimPortalCustomerAction } from '@/lib/customer-portal/claim'
import { getRedirectError } from 'next/dist/client/components/redirect'
import { RedirectType } from 'next/navigation'

beforeEach(() => {
  fixture.faults.clear(); fixture.calls = []; fixture.rpc = []; fixture.refreshed = []; fixture.cacheError = null
  fixture.userError = false; fixture.claimError = false; fixture.receiptError = false
  fixture.claimsThrow=null; fixture.createdRole='owner'
  fixture.claimsSub='';fixture.claimsSession=''
  fixture.rows = {
    companies: [{ id: fixture.company, slug: 'synthetic-completion', status: 'active', is_active: true }],
    customers: [{ id: fixture.customer, company_id: fixture.company, customer_type: 'private', customer_number: 'SYN-COMP-1',
      first_name: 'Synthetic', last_name: 'Customer', full_name: 'Synthetic Customer', company_name: null,
      email: 'account@example.invalid', personal_number: '199001011234', profile_revision: 2, contact_revision: 3 }],
    customer_contacts: [], customer_sites: [{ id: fixture.site, company_id: fixture.company, customer_id: fixture.customer,
      facility_id: '735999000000001', site_revision: 4, address_revision: 5 }], metering_points: [],
    customer_portal_accounts: [], customer_portal_claims: [], customer_portal_events: [], completion_receipts: [],
  }
})
function form() {
  const data = new FormData()
  for (const [key, value] of Object.entries({ email: 'account@example.invalid', personal_number: '199001011234',
    full_name: 'Synthetic Customer', installation_id: '735999000000001', company_slug: 'synthetic-completion' })) data.set(key, value)
  return data
}
async function attempt() {
  try { return { state: await claimPortalCustomerAction({ ok: false, message: '' }, form()), error: null } }
  catch (error) { return { state: null, error } }
}
function ownGraph() {
  return Object.fromEntries(['customer_portal_accounts', 'customer_portal_claims', 'customer_portal_events', 'completion_receipts'].map(table => [table, structuredClone(fixture.rows[table])]))
}

it.each(['customer_portal_claims', 'customer_portal_events'])('actual Action leaves no newly linked account after late %s failure', async table => {
  fixture.faults.add(table)
  const before = ownGraph()
  await attempt()
  expect(ownGraph()).toEqual(before)
  expect(fixture.refreshed).toEqual([])
})
it('a failed first completion can retry into exactly one account, approved claim and event', async () => {
  fixture.faults.add('customer_portal_claims')
  await attempt()
  fixture.faults.clear()
  const result = await attempt()
  expect(result.error).toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') })
  expect(fixture.rows.customer_portal_accounts).toHaveLength(1)
  expect(fixture.rows.customer_portal_claims).toHaveLength(1)
  expect(fixture.rows.customer_portal_events).toHaveLength(1)
})
it.each(['billing', 'viewer'])('an existing native %s link retains every saved role/evidence field and creates no approval history', async role => {
  fixture.rows.customer_portal_accounts.push({ id: fixture.account, company_id: fixture.company, customer_id: fixture.customer,
    user_id: fixture.user, portal_user_id: fixture.user, role, status: 'active', is_active: true,
    verified_at: '2025-01-01T00:00:00Z', verified_identity_snapshot: { original: true }, metadata: { original: true } })
  const before = ownGraph()
  const result = await attempt()
  expect(result.error).toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') })
  expect(ownGraph()).toEqual(before)
})
it('the actual successful new-link control retains the existing mounted redirect', async () => {
  const result = await attempt()
  expect(result.error).toMatchObject({ digest: expect.stringContaining('/portal?kopplad=1') })
  expect(fixture.rows.customer_portal_accounts).toMatchObject([{ company_id: fixture.company, customer_id: fixture.customer, user_id: fixture.user, role: 'owner' }])
  expect(fixture.rows.customer_portal_claims).toHaveLength(1)
  expect(fixture.rows.customer_portal_events).toHaveLength(1)
})
it('the adapter refuses a created receipt that does not certify the new owner role', async()=>{
  fixture.createdRole='billing'
  const result=await attempt()
  expect(result.state).toMatchObject({ok:false})
  expect(fixture.refreshed).toEqual([])
})
it('actual Next control flow from verified-session loading survives the adapter', async()=>{
  fixture.claimsThrow=getRedirectError('/login',RedirectType.replace)
  const result=await attempt()
  expect(result.error).toBe(fixture.claimsThrow)
  expect(fixture.rpc).toEqual([])
})
it.each(['claim-error','different-user','invalid-session'])('the actual verified-session helper denies %s before the command',async failure=>{
  if(failure==='claim-error')fixture.claimError=true
  if(failure==='different-user')fixture.claimsSub=fixture.customer
  if(failure==='invalid-session')fixture.claimsSession='not-a-session'
  const before=ownGraph(),result=await attempt();expect(result.state).toMatchObject({ok:false})
  expect(fixture.rpc).toEqual([]);expect(ownGraph()).toEqual(before);expect(fixture.refreshed).toEqual([])
})
it('a populated Auth user accompanied by an actual Auth error redirects before any persistence read',async()=>{
  fixture.userError=true;const before=ownGraph();const result=await attempt()
  expect(result.error).toMatchObject({digest:expect.stringContaining('/login')});expect(fixture.calls).toEqual([]);expect(ownGraph()).toEqual(before)
})
it('a malformed committed-receipt response cannot be presented as a successful link',async()=>{
  fixture.receiptError=true;const result=await attempt();expect(result.state).toMatchObject({ok:false});expect(fixture.refreshed).toEqual([])
})
it('an ordinary postcommit cache fault retains the saved result and mounted redirect',async()=>{
  fixture.cacheError=new Error('synthetic_owned_cache_fault');const result=await attempt()
  expect(result.error).toMatchObject({digest:expect.stringContaining('/portal?kopplad=1')});expect(fixture.rows.completion_receipts).toHaveLength(1)
})
it('installed Next cache control flow remains intact after a saved receipt',async()=>{
  fixture.cacheError=getRedirectError('/login',RedirectType.replace);const result=await attempt()
  expect(result.error).toBe(fixture.cacheError);expect(fixture.rows.completion_receipts).toHaveLength(1)
})
