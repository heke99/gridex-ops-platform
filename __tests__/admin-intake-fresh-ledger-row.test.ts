// FINDINGS F56: the manual intake treated the idempotency ledger row it had just inserted (status 'received',
// updated now) as an identical intake already in progress, so the first submission never created a customer.
// FINDINGS F59: an uploaded signed agreement is imported only for contracts.create; without it the customer,
// site, power of attorney and contract were written first and the intake then failed half-registered.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  ledger: { created: true, intake: { id: 'intake-1', status: 'received', updated_at: new Date().toISOString(), result: null, customer_id: null } as Record<string, unknown> },
  graphCalls: 0,
  ledgerCalls: 0,
  permissions: ['customers.write'] as string[],
  signedAgreementFile: null as File | null,
}))

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/admin/guards', () => ({
  requireAdminActionAccess: vi.fn(async () => ({ permissions: state.permissions })),
  requireCompanyScopedActionAccess: vi.fn(), isPlatformAdminContext: () => false,
}))
vi.mock('@/lib/tenant/scope', () => ({ requireOperationalCompanyId: vi.fn(async () => 'company-a') }))
vi.mock('@/lib/tenant/governance', () => ({ requireCompanyOperationalForWrites: vi.fn(async () => undefined) }))
vi.mock('@/lib/intakes/customerApplicationIntakes', () => ({
  getOrCreateCustomerApplicationIntake: vi.fn(async () => { state.ledgerCalls += 1; return state.ledger }),
  completeCustomerApplicationIntake: vi.fn(async () => undefined),
  failCustomerApplicationIntake: vi.fn(async () => undefined),
}))
vi.mock('@/app/admin/customers/actions.part-1', async importOriginal => ({
  ...(await importOriginal<object>()),
  getActorUserId: vi.fn(async () => 'actor-1'),
  buildCreateCustomerParams: vi.fn(() => ({ companyId: 'company-a', customerType: 'private', firstName: 'E2E', lastName: 'Kund', gridOwnerId: 'go-1', signedAgreementFile: state.signedAgreementFile })),
  resolveOrCreateGridOwnerForIntake: vi.fn(async () => ({ gridOwnerId: 'go-1', warnings: [] })),
  resolveOrCreateCurrentSupplierForIntake: vi.fn(async () => ({ supplierId: null, name: null, orgNumber: null, warnings: [] })),
}))
vi.mock('@/app/admin/customers/actions.part-2', async importOriginal => ({
  ...(await importOriginal<object>()),
  createCustomerGraph: vi.fn(async () => { state.graphCalls += 1; return { id: 'customer-1', customer_number: 'K-1' } }),
}))

import { createCustomerAction } from '@/app/admin/customers/actions.part-3'

const submit = () => createCustomerAction({} as never, new FormData())

beforeEach(() => {
  state.graphCalls = 0; state.ledgerCalls = 0; state.permissions = ['customers.write']; state.signedAgreementFile = null
})

describe('manual intake idempotency ledger', () => {
  it('creates the customer when the ledger row was inserted by this submission', async () => {
    state.ledger = { created: true, intake: { id: 'intake-1', status: 'received', updated_at: new Date().toISOString(), result: null, customer_id: null } }
    const result = await submit()
    expect(result.status).toBe('success')
    expect(result.createdCustomerId).toBe('customer-1')
    expect(state.graphCalls).toBe(1)
  })

  it('still refuses a concurrent identical submission whose row is fresh and was not created here', async () => {
    state.ledger = { created: false, intake: { id: 'intake-1', status: 'received', updated_at: new Date().toISOString(), result: null, customer_id: null } }
    const result = await submit()
    expect(result.status).toBe('error')
    expect(result.message).toContain('En identisk intagning bearbetas redan')
    expect(state.graphCalls).toBe(0)
  })

  it('replays a completed intake without creating a second customer', async () => {
    state.ledger = { created: false, intake: { id: 'intake-1', status: 'completed', updated_at: new Date().toISOString(), result: { customer_id: 'customer-1' }, customer_id: 'customer-1' } }
    const result = await submit()
    expect(result.status).toBe('success')
    expect(result.createdCustomerId).toBe('customer-1')
    expect(state.graphCalls).toBe(0)
  })

  it('retries an existing row that is stale or failed', async () => {
    for (const intake of [
      { id: 'intake-1', status: 'received', updated_at: new Date(Date.now() - 11 * 60 * 1000).toISOString(), result: null, customer_id: null },
      { id: 'intake-1', status: 'failed', updated_at: new Date().toISOString(), result: null, customer_id: null },
    ]) {
      state.ledger = { created: false, intake }
      expect((await submit()).status).toBe('success')
    }
    expect(state.graphCalls).toBe(2)
  })
})

describe('manual intake with an uploaded signed agreement', () => {
  const signed = () => new File([Buffer.from('%PDF-1.4 signed')], 'avtal.pdf', { type: 'application/pdf' })

  it('refuses before any write when the employee lacks contracts.create', async () => {
    state.permissions = ['customers.write', 'contracts.write']; state.signedAgreementFile = signed()
    const result = await submit()
    expect(result.status).toBe('error')
    expect(result.fieldErrors.signedAgreementFile).toContain('contracts.create')
    expect(state.ledgerCalls).toBe(0)
    expect(state.graphCalls).toBe(0)
  })

  it('registers the customer when the employee holds contracts.create', async () => {
    state.permissions = ['customers.write', 'contracts.create']; state.signedAgreementFile = signed()
    state.ledger = { created: true, intake: { id: 'intake-1', status: 'received', updated_at: new Date().toISOString(), result: null, customer_id: null } }
    expect((await submit()).status).toBe('success')
    expect(state.graphCalls).toBe(1)
  })
})
