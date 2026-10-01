import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { redirect } from 'next/navigation'

type Row = Record<string, unknown>
const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const actor = '33333333-3333-4333-8333-333333333333'
const session = '44444444-4444-4444-8444-444444444444'
const itemId = '55555555-5555-4555-8555-555555555555'
const state = vi.hoisted(() => ({
  item: {} as Row, events: [] as Row[], intent: null as Row | null,
  calls: [] as Row[], rpc: [] as Row[], fault: '', providerError: null as unknown,
  selected: '', platform: false, permissions: ['billing.write'], userError: false,
  providerHook: null as null | (() => void),
  getCalls: [] as string[],
  receiptFault: '',
  connection: {} as Row, swapConnection: false, providerAccounts: [] as string[],
}))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: state.selected }) }) }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({
  auth: {
    getUser: async () => ({ data: { user: { id: actor } }, error: state.userError ? new Error('synthetic_auth_fault') : null }),
    getClaims: async () => ({ data: { claims: { sub: actor, session_id: session } }, error: null }),
  },
  rpc: async () => ({ data: { authorized: true, user_id: actor, selected_company_id: state.selected,
    permissions: state.permissions, roles: state.platform ? ['platform_admin'] : ['operations_manager'], is_platform_admin: state.platform }, error: null }),
}) }))
vi.mock('@/lib/tenant/scope', () => ({
  assertUserCanOperateCompany: async (_actor: string, company: string) => company,
  requireOperationalCompanyId: async () => A,
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from: (table: string) => {
    const filters: Row = {}; let insert: Row | null = null; let update: Row | null = null
    const q = {
      select: () => q, order: () => q, limit: () => q,
      in: (key: string, values: unknown[]) => { filters[key] = values; return q },
      eq: (key: string, value: unknown) => { filters[key] = value; return q },
      single: () => q, maybeSingle: () => q,
      insert: (value: Row) => { insert = value; return q }, update: (value: Row) => { update = value; return q },
      then: (resolve: (value: unknown) => unknown) => {
        if (table === 'invoice_purchase_events') {
          if (state.fault === 'event') return Promise.resolve({ data: null, error: { code: 'XX000', message: 'private-canary@example.invalid' } }).then(resolve)
          if (insert) state.events.push(structuredClone(insert))
        }
        if (table === 'invoice_export_items' && update) {
          if (state.fault === 'item') return Promise.resolve({ data: null, error: { code: 'XX000', message: 'private-canary@example.invalid' } }).then(resolve)
          Object.assign(state.item, update)
        }
        const row = table === 'billing_provider_connections' ? state.connection : state.item
        const matches = Object.entries(filters).every(([key, value]) => Array.isArray(value) ? value.includes(row[key]) : row[key] === value)
        return Promise.resolve({ data: matches ? structuredClone(row) : null, error: null }).then(resolve)
      },
    }
    return q
  },
  rpc: async (name: string, args: { p_command: Row }) => {
    const c = args.p_command; state.rpc.push({ name, command: structuredClone(c) })
    const requestHash = createHash('sha256').update(JSON.stringify([c.actorUserId,c.sessionId,c.financingMode,c.payload,c.itemBinding])).digest('hex')
    const receipt = { companyId: c.companyId, itemId: c.itemId, intentId: '66666666-6666-4666-8666-666666666666',
      requestHash, snapshotHash: 'a'.repeat(64), connectionHash: createHash('sha256').update(String(c.connectionJson)).digest('hex'), invoiceGuid: state.item.provider_invoice_guid,
      actorUserId: c.actorUserId, sessionId: c.sessionId, payload: c.payload, financingMode: c.financingMode, itemBinding: c.itemBinding,
      environment: state.item.environment, status: 'dispatch_started', shouldPost: false, response: null }
    if (name === 'gridex_claim_manual_invoice_purchase_v1') {
      if (state.fault === 'claim') return { data: null, error: { code: 'XX000', message: 'private-canary@example.invalid' } }
      if (state.intent) {
        if (state.intent.requestHash !== requestHash) return { data: null, error: { code: '23505', message: 'manual_purchase_conflict' } }
        return { data: { ...state.intent, shouldPost: false }, error: null }
      }
      if (state.item.purchase_status === 'purchased_without_recourse') return { data: null, error: { code: '55000', message: 'manual_purchase_ineligible' } }
      state.intent = structuredClone(receipt)
      if (state.swapConnection) state.connection.settings = { ...state.connection.settings as Row, base_url: 'https://changed-account.invalid' }
      return { data: { ...receipt, shouldPost: true, ...(state.receiptFault === 'claim-status' ? { status: 'response_observed', response: { old: true } } : {}) }, error: null }
    }
    if (name === 'gridex_complete_manual_invoice_purchase_v1') {
      if (['event', 'item'].includes(state.fault)) return { data: null, error: { code: 'XX000', message: 'private-canary@example.invalid' } }
      state.events.push({ event_type: 'purchase_response_observed_manual', payload: c.observation })
      if (c.outcome === 'response_observed' && state.item.purchase_status !== 'purchased_without_recourse') state.item.purchase_status = 'requested'
      state.intent = { ...state.intent, ...receipt, status: c.outcome, response: c.observation }
      return { data: { ...state.intent, shouldPost: false, ...(state.receiptFault === 'finish-id' ? { intentId: '77777777-7777-4777-8777-777777777777' } : {}),
        ...(state.receiptFault === 'finish-hash' ? { snapshotHash: 'b'.repeat(64) } : {}), ...(state.receiptFault === 'finish-status' ? { status: 'uncertain' } : {}) }, error: null }
    }
    throw new Error(`unexpected_rpc:${name}`)
  },
} }))
vi.mock('@/lib/integrations/billing/capway/client', async (original) => {
  const actual = await original<Record<string, unknown>>()
  class OuterClient {
    constructor(readonly config: Row) {}
    getInvoice = async () => { state.getCalls.push('invoice'); if (state.providerError) throw state.providerError; return { status: 2, financeStatus: 1 } };
    getFinancialDetails = async () => { state.getCalls.push('financial'); return { original: true } };
    getPurchase = async () => { state.getCalls.push('purchase'); return { original: true } };
    getRecourse = async () => { state.getCalls.push('recourse'); return { original: true } };
    async postPurchase(guid: string, payload: Row) {
    state.providerAccounts.push(String(this.config.baseUrl))
    state.calls.push({ guid, payload: structuredClone(payload), persistedBeforePost: state.intent !== null })
    state.providerHook?.()
    if (state.providerError) throw state.providerError
    return { accepted: true, invoiceGuid: guid }
    }
  }
  return { ...actual, CapwayApticClient: OuterClient, createCapwayApticClient: async () => new OuterClient({ baseUrl: (state.connection.settings as Row).base_url }) }
})
import { POST } from '@/app/api/internal/invoices/[id]/purchase/route'
import { GET } from '@/app/api/internal/invoices/[id]/provider-status/route'
import { CapwayApiError } from '@/lib/integrations/billing/capway/client'

function request(body: Row = {}) {
  return new Request('http://local.invalid/api/internal/invoices/'+itemId+'/purchase', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ companyId: A, ...body }),
  })
}
function run(body: Row = {}) { return POST(request(body), { params: Promise.resolve({ id: itemId }) }) }
beforeEach(() => {
  state.item = { id: itemId, company_id: A, provider: 'capway_aptic', environment: 'test',
    provider_invoice_guid: 'synthetic-provider-guid', status: 'sent', purchase_status: null,
    financing_mode: 'invoice_service', amount_inc_vat: 125, request_payload: { original: true } }
  state.events = []; state.intent = null; state.calls = []; state.rpc = []; state.fault = ''
  state.selected = A; state.platform = false; state.permissions = ['billing.write']; state.userError = false
  state.providerError = null; state.providerHook = null
  state.getCalls = []
  state.receiptFault = ''
  state.connection = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', company_id: A, provider: 'capway_aptic', environment: 'test', status: 'ready',
    settings: { base_url: 'https://original-account.invalid', auth_mode: 'apikey', api_key_header: 'X-Synthetic-Key' },
    secret_reference: { api_key_env: 'GRIDEX_SYNTHETIC_MANUAL_KEY' } }
  state.swapConnection = false; state.providerAccounts = []
  vi.stubEnv('GRIDEX_SYNTHETIC_MANUAL_KEY', 'synthetic-never-persist-this-key')
})
afterEach(() => { vi.unstubAllEnvs() })

describe('reconstructed provider status is an observation', () => {
  function get(company = A) { return GET(new Request('http://local.invalid/api/internal/invoices/'+itemId+'/provider-status?companyId='+company), { params: Promise.resolve({ id: itemId }) }) }
  beforeEach(() => { state.permissions = ['billing.read'] })
  it('does all four original reads without changing a paid/purchased graph', async () => {
    state.item.provider_status = 'paid'; state.item.purchase_status = 'purchased_without_recourse'
    const before = structuredClone(state.item)
    const r = await get(); expect(r.status).toBe(200)
    expect(state.getCalls).toEqual(['invoice','financial','purchase','recourse'])
    expect(await r.json()).toEqual({ data: { invoiceStatus: 'unpaid', financeStatus: 'service',
      invoice: { status: 'fulfilled', value: { status: 2, financeStatus: 1 } }, financial: { status: 'fulfilled', value: { original: true } },
      purchase: { status: 'fulfilled', value: { original: true } }, recourse: { status: 'fulfilled', value: { original: true } } } })
    expect(state.item).toEqual(before); expect(state.events).toHaveLength(0)
  })
  it('does not expose arbitrary provider error text in observations', async () => {
    state.providerError = new Error('private-canary@example.invalid secret=private-canary')
    const r = await get(); expect(r.status).toBe(200)
    expect(JSON.stringify(await r.json())).not.toContain('private-canary')
  })
  it('denies a nonplatform selected-company mismatch before all four reads', async () => {
    state.selected = B; expect((await get()).status).toBe(403); expect(state.getCalls).toHaveLength(0)
  })
  it('retains canonical global platform access to the exact requested company', async () => {
    state.selected = B; state.platform = true; state.permissions = []
    expect((await get()).status).toBe(200); expect(state.getCalls).toHaveLength(4)
  })
  it('does not infer platform authority from a role-like permission string', async () => {
    state.selected = B; state.permissions = ['billing.read','platform_admin']
    expect((await get()).status).toBe(403); expect(state.getCalls).toHaveLength(0)
  })
})

describe('reconstructed manual purchase exported caller (controlled outer boundaries)', () => {
  it('commits the durable barrier before the only provider POST', async () => {
    expect((await run()).status).toBe(200)
    expect(state.calls).toEqual([{ guid: 'synthetic-provider-guid', payload: {
      approved: true, purchaseFeePercentage: null, purchaseFeeAmount: null, purchaseFeeCurrency: null,
      recourseDays: null, depositAmount: null, note: 'Gridex fakturaköp '+itemId,
    }, persistedBeforePost: true }])
  })
  it('retains the exact pre-resolved canonical provider account across a post-claim connection swap', async () => {
    state.swapConnection = true
    expect((await run()).status).toBe(200)
    expect(state.providerAccounts).toEqual(['https://original-account.invalid'])
    expect(JSON.stringify(state.intent)).not.toContain('synthetic-never-persist-this-key')
  })
  it('derives the command actor and session from the actual server boundary despite forged body fields', async () => {
    expect((await run({actorUserId:B,sessionId:B,userId:B})).status).toBe(200)
    expect(state.rpc[0].command).toMatchObject({actorUserId:actor,sessionId:session})
  })
  it('preserves installed Next control flow after the durable barrier without inventing a settlement', async () => {
    let signal: unknown
    try { redirect('/synthetic-current-context') } catch (error) { signal=error }
    state.providerError=signal
    await expect(run()).rejects.toBe(signal)
    expect(state.calls).toHaveLength(1);expect(state.rpc).toHaveLength(1)
    expect(state.intent?.status).toBe('dispatch_started');expect(state.events).toHaveLength(0)
  })
  it('preserves the existing safe HTTP error identity and consumes a definite rejection without exposing raw provider text', async () => {
    state.providerError=new CapwayApiError({message:'private-canary@example.invalid secret=private-canary',kind:'http',httpStatus:422})
    const response=await run();expect(response.status).toBe(500)
    const body=await response.json();expect(body.code).toBe('invoice_purchase_failed')
    expect(JSON.stringify(body)).not.toContain('private-canary');expect(state.intent?.status).toBe('rejected')
    state.providerError=null;expect((await run()).status).toBe(409);expect(state.calls).toHaveLength(1)
  })
  it.each(['event', 'item'])('never claims completed when the atomic %s settlement fails, or blindly reposts', async fault => {
    state.fault = fault
    expect((await run()).status).toBe(500)
    expect(state.events).toHaveLength(0)
    expect(state.item.purchase_status).toBeNull()
    state.fault = ''
    expect((await run()).status).toBe(409)
    expect(state.calls).toHaveLength(1)
  })
  it('a lost network response holds the barrier for replay', async () => {
    state.providerError = new CapwayApiError({ message: 'private-canary@example.invalid', kind: 'network' })
    expect((await run()).status).toBe(500)
    state.providerError = null
    expect((await run()).status).toBe(409)
    expect(state.calls).toHaveLength(1)
  })
  it('the same fulfilled request replays its stored response without another POST or event', async () => {
    const first = await (await run()).json()
    const second = await (await run()).json()
    expect(second).toEqual(first); expect(state.calls).toHaveLength(1); expect(state.events).toHaveLength(1)
  })
  it('changed effective parameters conflict with the permanent item intent', async () => {
    await run({ financing_mode: 'factoring_with_recourse' })
    expect((await run({ financingMode: 'factoring_with_recourse', recourseDays: 31 })).status).toBe(409)
    expect(state.calls).toHaveLength(1)
  })
  it('does not reset purchased status arriving while the provider responds', async () => {
    state.providerHook = () => { state.item.purchase_status = 'purchased_without_recourse' }
    const first=await run();expect(first.status).toBe(200)
    expect(state.item.purchase_status).toBe('purchased_without_recourse')
    expect(state.item.financing_mode).toBe('invoice_service')
    expect(await (await run()).json()).toEqual(await first.json())
    expect(state.calls).toHaveLength(1);expect(state.events).toHaveLength(1)
  })
  it('denies a resolver/selected-company mismatch before any provider effect', async () => {
    state.selected = B
    expect((await run()).status).toBe(403)
    expect(state.calls).toHaveLength(0); expect(state.rpc).toHaveLength(0)
  })
  it('fails closed before transport when durable reservation fails', async () => {
    state.fault = 'claim'
    expect((await run()).status).toBe(500); expect(state.calls).toHaveLength(0)
  })
  it('rejects a claim reply that falsely grants POST with a completed outcome', async () => {
    state.receiptFault = 'claim-status'; expect((await run()).status).toBe(500); expect(state.calls).toHaveLength(0)
  })
  it.each(['finish-id', 'finish-hash', 'finish-status'])('does not report completed for a mismatched %s receipt', async fault => {
    state.receiptFault = fault; expect((await run()).status).toBe(500); expect(state.calls).toHaveLength(1)
  })
  it('does not send an already purchased invoice', async () => {
    state.item.purchase_status = 'purchased_without_recourse'
    expect((await run()).status).toBe(409); expect(state.calls).toHaveLength(0)
  })
  it('keeps the canonical original alternatives: billing.export is sufficient', async () => {
    state.permissions = ['billing.export']; expect((await run()).status).toBe(200)
  })
  it('actual guard denies read-only permission before resource reads or provider', async () => {
    state.permissions = ['billing.read']; expect((await run()).status).toBe(403)
    expect(state.calls).toHaveLength(0); expect(state.events).toHaveLength(0)
  })
  it('actual guard rejects Auth error before provider', async () => {
    state.userError = true; expect((await run()).status).toBe(401); expect(state.calls).toHaveLength(0)
  })
  it('retains the existing missing GUID response', async () => {
    state.item.provider_invoice_guid = null
    const r = await run(); expect(r.status).toBe(400)
    expect(await r.json()).toEqual({ error: 'Exportposten saknar Capway invoiceGuid.' })
    expect(state.calls).toHaveLength(0)
  })
})
