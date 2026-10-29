import {beforeEach, describe, expect, it, vi} from 'vitest'

const io = vi.hoisted(() => ({
  row: {} as Record<string, unknown>,
  updateCalls: [] as Array<Record<string, unknown>>,
  updateError: null as unknown,
  events: [] as Array<Record<string, unknown>>,
}))

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({revalidatePath: () => undefined}))
vi.mock('next/navigation', () => ({redirect: (url: string) => { throw Error('REDIRECT:' + url) }, unstable_rethrow: (e: unknown) => { if (e instanceof Error && e.message.startsWith('REDIRECT:')) throw e }}))
vi.mock('@/lib/admin/guards', () => ({requireAdminActionAccess: async () => ({userId: 'staff-a'})}))
vi.mock('@/lib/supabase/server', () => ({createSupabaseServerClient: async () => ({auth: {getUser: async () => ({data: {user: {id: 'staff-a'}}})}})}))
vi.mock('@/lib/supabase/service', () => ({supabaseService: {}}))
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
  addCustomerContractEvent: async (input: Record<string, unknown>) => { io.events.push(input) },
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

beforeEach(() => { io.row = base(); io.updateCalls = []; io.updateError = null; io.events = [] })

describe('customer-card edit of signed contracts', () => {
  it('still edits an unsigned draft through the existing writer', async () => {
    await expect(updateContractAction(form())).resolves.toBeUndefined()
    expect(io.updateCalls).toHaveLength(1)
  })

  it.each([
    ['status signed', {status: 'signed'}],
    ['status active', {status: 'active'}],
    ['status terminated', {status: 'terminated'}],
    ['status cancelled', {status: 'cancelled'}],
    ['status expired', {status: 'expired'}],
    ['signed_at', {status: 'pending_signature', signed_at: '2026-10-01T10:00:00Z'}],
    ['locked_at', {status: 'draft', locked_at: '2026-10-01T10:00:00Z'}],
  ])('refuses %s with a controlled message and no write', async (_label, patch) => {
    io.row = {...base(), ...patch}
    await expect(updateContractAction(form())).rejects.toThrow(SIGNED)
    expect(io.updateCalls).toHaveLength(0)
    expect(io.events).toHaveLength(0)
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
    await expect(saveContractWithFeedbackAction(form())).resolves.toEqual({status: 'invalid', message: SIGNED})
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
