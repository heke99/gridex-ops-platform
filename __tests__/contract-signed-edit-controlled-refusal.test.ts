import {beforeEach, describe, expect, it, vi} from 'vitest'

const io = vi.hoisted(() => ({
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
vi.mock('@/lib/supabase/service', () => ({supabaseService: {from: (table: string) => {
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
  addCustomerContractEvent: async (input: Record<string, unknown>) => { if (io.eventError) throw io.eventError; io.events.push(input) },
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

import {updateContractAction} from '@/components/admin/customers/contracts/actions'
import {saveContractWithFeedbackAction} from '@/app/admin/customers/[id]/contracts/[contractId]/signature/actions'

const SIGNED = 'Signerat avtal kan inte ändras – använd avtalsåtgärder.'
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

beforeEach(() => { io.row = base(); io.updateCalls = []; io.updateError = null; io.events = []; io.eventError = null; io.lifecycleCalls = []; io.lifecycleError = null; io.db = {payloads: [], filters: [], result: null} })

describe('customer-card edit of signed contracts', () => {
  it('still edits an unsigned draft through the existing writer', async () => {
    await expect(updateContractAction(form())).resolves.toBeUndefined()
    expect(io.updateCalls).toHaveLength(1)
  })

  const sealed = () => ({...base(), status: 'active', signed_at: '2026-10-01T10:00:00Z', locked_at: '2026-10-01T10:00:00Z', starts_at: '2026-10-05', invoice_fee_sek: 19})

  it('records a termination notice and reason on an active contract via the event, without the full-row writer', async () => {
    io.row = sealed()
    const f = form(); f.set('status', 'active'); f.set('termination_notice_date', '2026-11-01'); f.set('termination_reason', 'switch_supplier'); f.set('invoice_fee_sek', '19')
    await expect(updateContractAction(f)).resolves.toBeUndefined()
    expect(io.updateCalls).toHaveLength(0)
    expect(io.events[0]).toMatchObject({eventType: 'termination_notice_received', happenedAt: '2026-11-01', companyId: 'company-a', customerId: 'customer-a'})
    expect(io.lifecycleCalls).toEqual([{id: 'contract-a', customerId: 'customer-a', companyId: 'company-a', currentStatus: 'active', terminationReason: 'switch_supplier', actorUserId: 'staff-a'}])
  })

  it('lets signed -> active through the lifecycle writer only', async () => {
    io.row = {...sealed(), status: 'signed'}
    const f = form(); f.set('status', 'active')
    await expect(updateContractAction(f)).resolves.toBeUndefined()
    expect(io.updateCalls).toHaveLength(0)
    expect(io.lifecycleCalls[0]).toMatchObject({currentStatus: 'signed', status: 'active'})
    expect(io.events.map((e) => e.eventType)).toEqual(['updated'])
  })

  it.each([['signed', 'cancelled'], ['active', 'terminated'], ['active', 'cancelled']])('records terminal %s -> %s only through the event RPC that sets ended_at and status_reason_code', async (from, to) => {
    io.row = {...sealed(), status: from}
    const f = form(); f.set('status', to); f.set('termination_reason', 'move_out')
    await expect(updateContractAction(f)).resolves.toBeUndefined()
    expect(io.updateCalls).toHaveLength(0); expect(io.lifecycleCalls).toHaveLength(0)
    expect(io.events).toEqual([expect.objectContaining({eventType: to, companyId: 'company-a', customerId: 'customer-a', customerContractId: 'contract-a', metadata: expect.objectContaining({reason_code: 'move_out', termination_reason: 'move_out'})})])
  })

  it('validates a refused status change before writing a termination notice', async () => {
    io.row = sealed()
    const f = form(); f.set('termination_notice_date', '2026-11-01'); f.set('status', 'expired')
    await expect(updateContractAction(f)).rejects.toThrow('Statusbytet är inte tillåtet')
    expect(io.events).toHaveLength(0); expect(io.lifecycleCalls).toHaveLength(0); expect(io.updateCalls).toHaveLength(0)
  })

  it('maps a refused transition to a controlled message', async () => {
    io.row = sealed()
    const f = form(); f.set('status', 'draft')
    await expect(saveContractWithFeedbackAction(f)).resolves.toEqual({status: 'invalid', message: 'Statusbytet är inte tillåtet för ett signerat avtal – använd avtalsåtgärder.'})
    expect(io.updateCalls).toHaveLength(0)
  })

  it.each([['invoice_fee_sek', '25'], ['starts_at', '2026-12-01'], ['binding_months', '24'], ['site_id', 'other-site']])('refuses a changed sealed %s without any DB call', async (field, value) => {
    io.row = sealed()
    const f = form(); f.set(field, value)
    await expect(updateContractAction(f)).rejects.toThrow(SIGNED)
    expect(io.updateCalls).toHaveLength(0); expect(io.lifecycleCalls).toHaveLength(0); expect(io.events).toHaveLength(0)
  })

  it('refuses replacing a recorded termination notice with a controlled message', async () => {
    io.row = {...sealed(), termination_notice_date: '2026-10-20'}
    const f = form(); f.set('termination_notice_date', '2026-11-01')
    await expect(updateContractAction(f)).rejects.toThrow('Uppsägningsdatum är redan registrerat')
    expect(io.events).toHaveLength(0); expect(io.lifecycleCalls).toHaveLength(0)
  })

  it('maps #938 notice errors raised by the event command', async () => {
    io.row = sealed(); io.eventError = {code: 'P0001', message: 'termination_notice_before_contract_start'}
    const f = form(); f.set('termination_notice_date', '2026-09-01')
    await expect(updateContractAction(f)).rejects.toThrow('Uppsägningsdatum kan inte vara före avtalets startdatum.')
  })

  it('maps a database 55000 immutability error to a controlled message', async () => {
    io.updateError = {code: '55000', message: 'signed_customer_contract_immutable:price_snapshot'}
    const error = await updateContractAction(form()).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe(SIGNED)
    expect(io.events).toHaveLength(0)
  })

  it.each([
    ['termination_notice_already_recorded', 'Uppsägningsdatum är redan registrerat'],
    ['termination_notice_before_contract_start', 'Uppsägningsdatum kan inte vara före avtalets startdatum'],
  ])('maps %s to a controlled Swedish message', async (code, expected) => {
    io.updateError = {code: 'P0001', message: code}
    const error = await updateContractAction(form()).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain(expected)
    expect(io.events).toHaveLength(0)
  })

  it('keeps unknown database errors unchanged', async () => {
    const unknown = {code: 'XX000', message: 'boom'}
    io.updateError = unknown
    await expect(updateContractAction(form())).rejects.toBe(unknown)
  })
})

describe('customer-card feedback wrapper returns controlled answers', () => {
  it('returns invalid for a signed contract without writing', async () => {
    io.row = {...base(), status: 'signed', signed_at: '2026-10-01T10:00:00Z'}
    const f = form(); f.set('contract_name', 'Renamed sealed agreement')
    await expect(saveContractWithFeedbackAction(f)).resolves.toEqual({status: 'invalid', message: SIGNED})
    expect(io.lifecycleCalls).toHaveLength(0)
    expect(io.updateCalls).toHaveLength(0)
  })

  it('returns invalid for termination_notice_already_recorded from the database', async () => {
    io.updateError = {code: 'P0001', message: 'termination_notice_already_recorded'}
    await expect(saveContractWithFeedbackAction(form())).resolves.toEqual({
      status: 'invalid', field: 'termination_notice_date',
      message: 'Uppsägningsdatum är redan registrerat och kan inte ändras här – använd avtalsåtgärder.',
    })
  })
})

describe('updateSealedCustomerContractLifecycle (real db.ts)', () => {
  const load = async () => (await vi.importActual<typeof import('@/lib/customer-contracts/db')>('@/lib/customer-contracts/db')).updateSealedCustomerContractLifecycle
  const row = () => ({id: 'contract-a', customer_id: 'customer-a', company_id: 'company-a', status: 'signed', price_snapshot: {a: 1}, ends_at: '2027-10-01', signed_version: 'v1'})

  it('writes only status and audit metadata, scoped by id, customer, company and current status', async () => {
    io.db.result = row()
    const fn = await load()
    await expect(fn({id: 'contract-a', customerId: 'customer-a', companyId: 'company-a', currentStatus: 'signed', status: 'active', actorUserId: 'staff-a'})).resolves.toMatchObject({status: 'active'})
    expect(Object.keys(io.db.payloads[0]).sort()).toEqual(['status', 'updated_at', 'updated_by'])
    for (const key of ['price_snapshot', 'ends_at', 'signed_version']) expect(io.db.payloads[0]).not.toHaveProperty(key)
    expect(io.db.filters).toEqual([['id', 'contract-a'], ['customer_id', 'customer-a'], ['company_id', 'company-a'], ['status', 'signed']])
  })

  it.each([['signed', 'terminated'], ['signed', 'cancelled'], ['active', 'terminated'], ['active', 'cancelled'], ['signed', 'draft'], ['active', 'signed'], ['active', 'expired'], ['terminated', 'active']])('refuses %s -> %s before any DB call', async (from, to) => {
    const fn = await load()
    await expect(fn({id: 'contract-a', customerId: 'customer-a', companyId: 'company-a', currentStatus: from as 'signed', status: to as 'active', actorUserId: 'staff-a'})).rejects.toThrow('Statusbytet är inte tillåtet')
    expect(io.db.payloads).toHaveLength(0)
  })

  it('gives a controlled no-match for a foreign company', async () => {
    io.db.result = row()
    const fn = await load()
    await expect(fn({id: 'contract-a', customerId: 'customer-a', companyId: 'company-b', currentStatus: 'signed', status: 'active', actorUserId: 'staff-a'})).rejects.toThrow('Kundavtalet hittades inte för valt bolag')
  })
})
