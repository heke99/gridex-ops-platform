import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  access: vi.fn(), companyAccess: vi.fn(), writable: vi.fn(), sync: vi.fn(),
  revalidate: vi.fn(), audit: vi.fn(), updateRequest: vi.fn(), updateExport: vi.fn(),
  updateOutbound: vi.fn(), ingest: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: state.revalidate }))
vi.mock('@/lib/admin/guards', () => ({ requireAdminActionAccess: state.access }))
vi.mock('@/lib/tenant/scope', () => ({ assertUserCanOperateCompany: state.companyAccess }))
vi.mock('@/lib/tenant/governance', () => ({ requireCompanyOperationalForWrites: state.writable }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: 'actor' } } }) },
  from: () => ({ insert: state.audit }),
}) }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: () => ({
  insert: state.audit,
  select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { company_id: 'company-a' }, error: null }) }) }),
}) } }))
vi.mock('@/lib/cis/db', () => ({
  updateGridOwnerDataRequestStatus: state.updateRequest,
  updatePartnerExportStatus: state.updateExport,
  updateOutboundRequestStatus: state.updateOutbound,
  syncGridOwnerDataRequestFromOutbound: async () => null,
  ingestMeteringValue: state.ingest,
}))
vi.mock('@/lib/operations/db', () => ({ syncCustomerOperationsForCustomer: state.sync }))
vi.mock('@/lib/masterdata/db', () => ({}))
vi.mock('@/lib/ediel/orchestrator', () => ({}))
vi.mock('@/lib/cis/edielAutomation', () => ({}))
vi.mock('@/app/admin/operations/control-actions', () => ({}))

import {
  ingestMeteringValueAction, updateGridOwnerDataRequestStatusAction,
  updateOutboundRequestStatusAction, updatePartnerExportStatusAction,
} from '@/app/admin/cis/actions'

const form = (fields: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

describe('admin CIS actions use the saved record customer for follow-up work', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    state.access.mockResolvedValue({ userId: 'actor' })
    state.audit.mockResolvedValue({ error: null })
    state.updateRequest.mockResolvedValue({ id: 'request-a', company_id: 'company-a', customer_id: 'customer-a', status: 'received' })
    state.updateExport.mockResolvedValue({ id: 'export-a', company_id: 'company-a', customer_id: 'customer-a', status: 'acknowledged' })
    state.updateOutbound.mockResolvedValue({ id: 'outbound-a', company_id: 'company-a', customer_id: 'customer-a', status: 'prepared', request_type: 'other' })
    state.ingest.mockResolvedValue({ id: 'value-a', company_id: 'company-a', customer_id: 'customer-a' })
  })

  it.each([
    ['metering request', updateGridOwnerDataRequestStatusAction, 'request_id', 'request-a', 'received'],
    ['partner export', updatePartnerExportStatusAction, 'export_id', 'export-a', 'acknowledged'],
    ['outbound request', updateOutboundRequestStatusAction, 'outbound_request_id', 'outbound-a', 'prepared'],
  ] as const)('%s ignores a forged customer_id in follow-up work', async (_name, action, key, id, status) => {
    await action(form({ [key]: id, customer_id: 'customer-b', status }))
    expect(state.companyAccess).toHaveBeenCalledWith('actor', 'company-a')
    expect(state.sync).toHaveBeenCalledWith(expect.anything(), 'customer-a')
    expect(state.sync).not.toHaveBeenCalledWith(expect.anything(), 'customer-b')
    expect(state.audit).toHaveBeenCalledWith(expect.objectContaining({ company_id: 'company-a', metadata: expect.objectContaining({ customerId: 'customer-a' }) }))
    expect(state.revalidate).toHaveBeenCalledWith('/admin/customers/customer-a')
    expect(state.revalidate).not.toHaveBeenCalledWith('/admin/customers/customer-b')
  })

  it('stops before any write when the actor cannot operate the record company', async () => {
    state.companyAccess.mockRejectedValue(new Error('company_access_denied'))
    await expect(updateGridOwnerDataRequestStatusAction(form({ request_id: 'request-a', customer_id: 'customer-a', status: 'received' }))).rejects.toThrow('company_access_denied')
    expect(state.updateRequest).not.toHaveBeenCalled()
    expect(state.sync).not.toHaveBeenCalled()
  })

  it('stops before any write when the action permission is denied', async () => {
    state.access.mockRejectedValue(new Error('permission_denied'))
    await expect(updateGridOwnerDataRequestStatusAction(form({ request_id: 'request-a', customer_id: 'customer-a' }))).rejects.toThrow('permission_denied')
    expect(state.companyAccess).not.toHaveBeenCalled()
    expect(state.updateRequest).not.toHaveBeenCalled()
  })

  it('does not run follow-up work after a database failure', async () => {
    state.updateRequest.mockRejectedValue(new Error('database_failure'))
    await expect(updateGridOwnerDataRequestStatusAction(form({ request_id: 'request-a', customer_id: 'customer-a' }))).rejects.toThrow('database_failure')
    expect(state.sync).not.toHaveBeenCalled()
    expect(state.audit).not.toHaveBeenCalled()
  })

  it('parses Swedish decimal input and checks the customer company before ingesting', async () => {
    await ingestMeteringValueAction(form({ customer_id: 'customer-a', metering_point_id: 'point-a', value_kwh: '12,75', read_at: '2026-10-05T12:00', reading_type: 'consumption', source_system: 'manual' }))
    expect(state.companyAccess).toHaveBeenCalledWith('actor', 'company-a')
    expect(state.ingest).toHaveBeenCalledWith(expect.objectContaining({ customerId: 'customer-a', meteringPointId: 'point-a', valueKwh: 12.75, sourceSystem: 'manual' }))
    expect(state.audit).toHaveBeenCalledWith(expect.objectContaining({ company_id: 'company-a', action: 'metering_value_ingested' }))
    expect(state.sync).toHaveBeenCalledWith(expect.anything(), 'customer-a')
  })

  it('rejects non-finite values before database writes', async () => {
    await expect(ingestMeteringValueAction(form({ customer_id: 'customer-a', metering_point_id: 'point-a', value_kwh: 'Infinity' }))).rejects.toThrow('value_kwh krävs')
    expect(state.ingest).not.toHaveBeenCalled()
  })
})
