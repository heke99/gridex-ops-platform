import { beforeEach, expect, it, vi } from 'vitest'
const rpc = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc } }))
import { readCustomerLifeEventExportProjection } from '@/lib/ediel/production/customerLifeEventExport'
const input = { companyId: 'company-A', customerId: 'customer-A', actorUserId: 'actor-A' }
const projection = { status: 'authorized', companyId: input.companyId, customerId: input.customerId, sourceMessageId: 'source-A', customerVersion: 2, effectiveVersionCount: 2, customerFields: { full_name: 'Own confirmed name' }, endUserMasterdata: { street: ['Own', 'Street'], city: 'Own city', postCode: '12345' } }
beforeEach(() => rpc.mockReset())

it('reads exact owned customer/actor and returns literal source fields separately from invoicee data', async () => {
  rpc.mockResolvedValue({ data: projection, error: null })
  expect(await readCustomerLifeEventExportProjection(input)).toEqual(projection)
  expect(rpc).toHaveBeenCalledWith('ediel_customer_life_event_export_projection_v1', { p_company_id: input.companyId, p_customer_id: input.customerId, p_actor_user_id: input.actorUserId })
})

it('preserves the no-history path but never falls back through a missing witness or native failure', async () => {
  rpc.mockResolvedValueOnce({ data: { status: 'not_applicable' }, error: null })
  expect(await readCustomerLifeEventExportProjection(input)).toBeNull()
  rpc.mockResolvedValueOnce({ data: { status: 'held', missing: ['current_primary_customer_event_owner'] }, error: null })
  await expect(readCustomerLifeEventExportProjection(input)).rejects.toThrow('customer_life_event_export_source_held')
  const error = new Error('source_identity_unavailable')
  rpc.mockResolvedValueOnce({ data: null, error })
  await expect(readCustomerLifeEventExportProjection(input)).rejects.toBe(error)
})

it.each([{ companyId: 'other' }, { customerId: 'other' }, { customerFields: { billing_street: 'Not UD' } }, { endUserMasterdata: { street: 'flattened' } }, { effectiveVersionCount: 1, sourceMessageId: null }])('holds a foreign or malformed projection %j', async changed => {
  rpc.mockResolvedValue({ data: { ...projection, ...changed }, error: null })
  await expect(readCustomerLifeEventExportProjection(input)).rejects.toThrow('customer_life_event_export_projection_invalid')
})


it('uses the exact requested source date and checks native projection parity', async () => {
  const asOf = '2026-09-30T11:00:00Z'
  rpc.mockResolvedValue({ data: { ...projection, asOf: '2026-09-30T12:00:00+01:00' }, error: null })
  expect(await readCustomerLifeEventExportProjection({ ...input, asOf })).toEqual({ ...projection, asOf: '2026-09-30T12:00:00+01:00' })
  expect(rpc).toHaveBeenCalledWith('ediel_customer_life_event_export_at_v1', { p_company_id: input.companyId, p_customer_id: input.customerId, p_actor_user_id: input.actorUserId, p_as_of: asOf })
  rpc.mockResolvedValue({ data: { ...projection, asOf: '2026-10-01T11:00:00Z' }, error: null })
  await expect(readCustomerLifeEventExportProjection({ ...input, asOf })).rejects.toThrow('projection_invalid')
})

it.each(['2026-09-30', 'invalid'])('rejects an unbound source date %s before reading', async asOf => {
  await expect(readCustomerLifeEventExportProjection({ ...input, asOf })).rejects.toThrow('export_date_required')
  expect(rpc).not.toHaveBeenCalled()
})
