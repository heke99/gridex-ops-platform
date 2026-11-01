import {beforeEach, describe, expect, it, vi} from 'vitest'

const io = vi.hoisted(() => ({
  atomic: false,
  rpcError: null as null | {code: string; message: string},
  rpcCalls: 0,
  row: {} as Record<string, unknown>,
  updateCalls: [] as Array<Record<string, unknown>>,
  updateError: null as unknown,
  events: [] as Array<Record<string, unknown>>,
  eventError: null as unknown,
  lifecycleCalls: [] as Array<Record<string, unknown>>,
  lifecycleError: null as unknown,
  db: {payloads: [] as Array<Record<string, unknown>>, filters: [] as Array<[string, unknown]>, result: null as unknown},
}))

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({revalidatePath: () => undefined}))
vi.mock('next/navigation', () => ({redirect: (url: string) => { throw Error('REDIRECT:' + url) }, unstable_rethrow: (e: unknown) => { if (e instanceof Error && e.message.startsWith('REDIRECT:')) throw e }}))
vi.mock('@/lib/admin/guards', () => ({requireAdminActionAccess: async () => ({userId: 'staff-a'})}))
vi.mock('@/lib/supabase/server', () => ({createSupabaseServerClient: async () => ({auth: {getUser: async () => ({data: {user: {id: 'staff-a'}}})}})}))
vi.mock('@/lib/customer-contracts/revision', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/customer-contracts/revision')>()
  return {...actual,
    usesAtomicUnsignedEdit: (row: never) => io.atomic || actual.usesAtomicUnsignedEdit(row),
    prepareUnsignedContractEdit: (row: never, f: FormData) => io.atomic ? {ok: true, editId: 'edit-1', expectedUpdatedAt: '2026-10-29T10:00:00Z', patch: {}, acknowledgeCurrentTerms: false} : actual.prepareUnsignedContractEdit(row, f),
  }
})
vi.mock('@/lib/supabase/service', () => ({supabaseService: {rpc: async () => { io.rpcCalls += 1; return io.rpcError ? {data: null, error: io.rpcError} : {data: {ok: true, contract_id: 'contract-a'}, error: null} }, from: (table: string) => {
  if (table !== 'customer_contracts') throw Error('unexpected table')
  const q = {
    update: (payload: Record<string, unknown>) => { io.db.payloads.push(payload); return q },
    eq: (column: string, value: unknown) => { io.db.filters.push([column, value]); return q },
    select: () => q,
    maybeSingle: async () => {
      const f = Object.fromEntries(io.db.filters)
      const row = io.db.result as Record<string, unknown> | null
      const hit = row && f.id === row.id && f.customer_id === row.customer_id && f.company_id === row.company_id && f.status === row.status
      return {data: hit ? {...row, ...io.db.payloads.at(-1)} : null, error: null}
    },
  }
  return q
}}}))
vi.mock('@/lib/customer-contracts/autoSendSigningLink', () => ({autoSendSigningLinkAfterCreate: async () => undefined, contractHasValidSigningSite: () => true, SIGNING_LINK_SITE_REQUIRED_MESSAGE: 'site'}))
vi.mock('@/lib/customer-contracts/onlineSigning', () => ({sendOnlineContractSignatureRequest: async () => undefined}))
vi.mock('@/lib/customer-contracts/importSignedAgreement', () => ({importSignedAgreementForContract: async () => undefined}))
vi.mock('@/lib/tenant/entityGuards', () => ({
  loadCustomerTenantContext: async () => ({companyId: 'company-a'}),
  assertContractTenant: async () => undefined,
  assertCustomerSiteTenant: async () => undefined,
  assertMeteringPointTenant: async () => undefined,
}))
vi.mock('@/lib/customer-contracts/db', () => ({
  getCustomerContractById: async (id: string, options: {companyId: string}) => {
    if (id !== 'contract-a' || options.companyId !== 'company-a') throw Error('unscoped lookup')
    return io.row
  },
  updateCustomerContract: async (input: Record<string, unknown>) => {
    io.updateCalls.push(input)
    if (io.updateError) throw io.updateError
    return {...io.row, status: input.status, site_id: input.siteId}
  },
  addCustomerContractEvent: async (input: Record<string, unknown>) => { if (io.eventError) throw io.eventError; io.events.push(input); if (input.eventType === 'termination_notice_received') io.row.termination_notice_date = input.happenedAt },
  updateSealedCustomerContractLifecycle: async (input: Record<string, unknown>) => {
    io.lifecycleCalls.push(input)
    if (io.lifecycleError) throw io.lifecycleError
    return {...io.row, ...(input.status ? {status: input.status} : {}), ...('terminationReason' in input ? {termination_reason: input.terminationReason} : {})}
  },
  SEALED_CONTRACT_LIFECYCLE_TRANSITIONS: {signed: ['active', 'cancelled'], active: ['terminated', 'cancelled']},
  SEALED_CONTRACT_TRANSITION_REFUSED_MESSAGE: 'Statusbytet är inte tillåtet för ett signerat avtal – använd avtalsåtgärder.',
  createCustomerContract: async () => { throw Error('not used') },
  getContractOfferById: async () => null,
}))

import {saveContractWithFeedbackAction} from '@/app/admin/customers/[id]/contracts/[contractId]/signature/actions'

const base = () => ({
  id: 'contract-a', customer_id: 'customer-a', company_id: 'company-a', status: 'draft',
  signed_at: null, locked_at: null, contract_offer_id: null, energy_direction: 'consumption',
  contract_name: 'Synthetic agreement', site_id: null, metering_point_id: null, vat_rate: 0.25,
  price_snapshot: {}, auto_renew_enabled: false, termination_notice_date: null,
})
const form = () => {
  const f = new FormData()
  f.set('customer_id', 'customer-a'); f.set('customer_contract_id', 'contract-a'); f.set('vat_rate', '25')
  return f
}

beforeEach(() => { io.atomic = false; io.rpcError = null; io.rpcCalls = 0; io.row = base(); io.updateCalls = []; io.updateError = null; io.events = []; io.eventError = null; io.lifecycleCalls = []; io.lifecycleError = null; io.db = {payloads: [], filters: [], result: null} })

// Finite command ports exercise the real action and feedback wrapper; no database/native claim.
describe('partial sealed lifecycle feedback', () => {
  beforeEach(() => { io.row = {...base(), status: 'active', signed_at: '2026-10-01T10:00:00Z', locked_at: '2026-10-01T10:00:00Z', starts_at: '2026-10-05', invoice_fee_sek: 19} })
  const noticeForm = () => {
    const f = form(); f.set('termination_notice_date', '2026-11-01'); f.set('termination_reason', 'switch_supplier'); return f
  }
  it('rejects ordinary invalid feedback when the notice succeeded before a lifecycle conflict', async () => {
    const conflict = new Error('Kundavtalet hittades inte för valt bolag eller har ändrats. Ladda om sidan.')
    io.lifecycleError = conflict
    const result = await saveContractWithFeedbackAction(noticeForm()).then(value => value, error => error)
    expect(io.row.termination_notice_date).toBe('2026-11-01')
    expect(io.events.map(e => e.eventType)).toEqual(['termination_notice_received'])
    expect(result).toBeInstanceOf(Error)
    expect(result).toHaveProperty('cause', conflict)
  })
  it('preserves first-command validation with no successful write', async () => {
    io.eventError = {code: 'P0001', message: 'termination_notice_before_contract_start'}
    await expect(saveContractWithFeedbackAction(noticeForm())).resolves.toMatchObject({status: 'invalid'})
    expect(io.events).toHaveLength(0); expect(io.lifecycleCalls).toHaveLength(0)
    expect(io.row.termination_notice_date).toBeNull()
  })
  it('preserves an unknown first-command error unchanged', async () => {
    const error = new Error('unknown command failure'); io.eventError = error
    await expect(saveContractWithFeedbackAction(noticeForm())).rejects.toBe(error)
  })
  it('preserves successful command order and saved feedback', async () => {
    await expect(saveContractWithFeedbackAction(noticeForm())).resolves.toMatchObject({status: 'saved'})
    expect(io.events.map(e => e.eventType)).toEqual(['termination_notice_received', 'updated'])
    expect(io.lifecycleCalls).toHaveLength(1); expect(io.updateCalls).toHaveLength(0)
  })
})
