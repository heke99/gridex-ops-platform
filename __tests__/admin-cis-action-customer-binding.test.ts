import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))

const state = vi.hoisted(() => ({
  access: vi.fn(), companyAccess: vi.fn(), writable: vi.fn(), sync: vi.fn(),
  revalidate: vi.fn(), audit: vi.fn(), updateRequest: vi.fn(), updateExport: vi.fn(),
  updateOutbound: vi.fn(), syncOutboundGridOwner: vi.fn(), ingest: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: state.revalidate }))
vi.mock('@/lib/admin/guards', () => ({ requireAdminActionAccess: state.access, isPlatformAdminContext: (ctx: { isPlatformAdmin?: boolean }) => ctx.isPlatformAdmin === true }))
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
  updateGridOwnerDataRequestBusiness: state.updateRequest,
  updatePartnerExportStatus: state.updateExport,
  updateOutboundRequestBusiness: state.updateOutbound,
  syncGridOwnerDataRequestFromOutbound: state.syncOutboundGridOwner,
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
    state.access.mockResolvedValue({ userId: 'actor', companyId: 'company-a' })
    state.audit.mockResolvedValue({ error: null })
    state.updateRequest.mockResolvedValue({ id: 'request-a', company_id: 'company-a', customer_id: 'customer-a', status: 'received' })
    state.updateExport.mockResolvedValue({ id: 'export-a', company_id: 'company-a', customer_id: 'customer-a', status: 'acknowledged' })
    state.updateOutbound.mockResolvedValue({ id: 'outbound-a', company_id: 'company-a', customer_id: 'customer-a', status: 'prepared', request_type: 'other' })
    state.ingest.mockResolvedValue({ id: 'value-a', company_id: 'company-a', customer_id: 'customer-a' })
  })

  it('uses the scoped saved export customer for an intentional status change', async () => {
    await updatePartnerExportStatusAction(form({
      export_id: 'export-a', customer_id: 'customer-a', original_status: 'queued', status: 'failed',
    }))
    expect(state.companyAccess).toHaveBeenCalledWith('actor', 'company-a')
    expect(state.updateExport).toHaveBeenCalledWith({
      actorUserId: 'actor', companyId: 'company-a', customerId: 'customer-a', exportId: 'export-a',
      originalStatus: 'queued', changes: { status: 'failed' },
    })
    expect(state.sync).toHaveBeenCalledWith(expect.anything(), 'customer-a')
    expect(state.audit).toHaveBeenCalledWith(expect.objectContaining({
      company_id: 'company-a', metadata: expect.objectContaining({ customerId: 'customer-a' }),
    }))
    expect(state.revalidate).toHaveBeenCalledWith('/admin/customers/customer-a')
  })

  it('refuses manual delivery statuses on a partner export before the write', async () => {
    for (const status of ['sent', 'acknowledged']) {
      await expect(updatePartnerExportStatusAction(form({
        export_id: 'export-a', customer_id: 'customer-a', original_status: 'queued', status,
      }))).rejects.toThrow('Partnerintegrationen ansvarar för exportens leveransstatus och kvitton.')
    }
    expect(state.updateExport).not.toHaveBeenCalled()
    expect(state.sync).not.toHaveBeenCalled()
    expect(state.audit).not.toHaveBeenCalled()
  })

  it('does not run partner follow-up work after the scoped writer rejects a different customer', async () => {
    state.updateExport.mockRejectedValueOnce(new Error('export_scope_or_status_changed'))
    await expect(updatePartnerExportStatusAction(form({
      export_id: 'export-a', customer_id: 'customer-b', original_status: 'queued', status: 'failed',
    }))).rejects.toThrow('export_scope_or_status_changed')
    expect(state.updateExport).toHaveBeenCalledWith(expect.objectContaining({ customerId: 'customer-b' }))
    expect(state.sync).not.toHaveBeenCalled()
    expect(state.audit).not.toHaveBeenCalled()
  })

  it('saves an outbound note from an older form without syncing its source requests or customer operations', async () => {
    state.updateOutbound.mockResolvedValueOnce({
      id: 'outbound-a', company_id: 'company-a', customer_id: 'customer-a', status: 'acknowledged',
      request_type: 'supplier_switch', source_type: 'supplier_switch_request', source_id: 'switch-a',
    })
    await updateOutboundRequestStatusAction(form({
      outbound_request_id: 'outbound-a', customer_id: 'customer-a', original_status: 'sent', status: 'sent',
      external_reference: 'OLD-REF', original_external_reference: 'OLD-REF',
      failure_reason: 'Previously shown transport diagnostic', original_failure_reason: 'Previously shown transport diagnostic',
      response_payload_note: 'Ny notering', original_response_payload_note: '',
      dispatch_step: '', original_dispatch_step: '',
    }))
    expect(state.updateOutbound).toHaveBeenCalledWith({
      actorUserId: 'actor', companyId: 'company-a', customerId: 'customer-a', outboundRequestId: 'outbound-a',
      originalStatus: 'sent', changes: { admin_note: 'Ny notering' },
    })
    expect(state.syncOutboundGridOwner).not.toHaveBeenCalled()
    expect(state.sync).not.toHaveBeenCalled()
    expect(state.audit).toHaveBeenCalledWith(expect.objectContaining({
      company_id: 'company-a', metadata: expect.objectContaining({ customerId: 'customer-a', status: 'acknowledged' }),
    }))
  })

  it('lets a note retain an outbound status set by the EDIEL overdue worker', async () => {
    await updateOutboundRequestStatusAction(form({
      outbound_request_id: 'outbound-a', customer_id: 'customer-a',
      original_status: 'waiting_attention', status: 'waiting_attention',
      response_payload_note: 'Handläggaren granskar ärendet', original_response_payload_note: '',
    }))
    expect(state.updateOutbound).toHaveBeenCalledWith(expect.objectContaining({
      originalStatus: 'waiting_attention', changes: { admin_note: 'Handläggaren granskar ärendet' },
    }))
    expect(state.syncOutboundGridOwner).not.toHaveBeenCalled()
  })

  it('syncs the saved customer and source requests after an explicit outbound status change', async () => {
    const saved = {
      id: 'outbound-a', company_id: 'company-a', customer_id: 'customer-a', status: 'sent', request_type: 'other',
    }
    state.updateOutbound.mockResolvedValueOnce(saved)
    await updateOutboundRequestStatusAction(form({
      outbound_request_id: 'outbound-a', customer_id: 'customer-a',
      original_status: 'failed', status: 'sent', dispatch_step: 'send', manual_delivery_reference: '  signed-mail-123  ',
    }))
    expect(state.writable).toHaveBeenCalledWith('company-a')
    expect(state.updateOutbound).toHaveBeenCalledWith(expect.objectContaining({
      companyId: 'company-a', customerId: 'customer-a', originalStatus: 'failed',
      changes: { status: 'sent', dispatch_step: 'send', manual_delivery_reference: 'signed-mail-123' },
    }))
    expect(state.syncOutboundGridOwner).toHaveBeenCalledWith({ actorUserId: 'actor', outboundRequest: saved })
    expect(state.sync).toHaveBeenCalledWith(expect.anything(), 'customer-a')
  })

  it('requires a separate receipt reference before recording sent or acknowledged', async () => {
    for (const status of ['sent', 'acknowledged']) {
      await expect(updateOutboundRequestStatusAction(form({
        outbound_request_id: 'outbound-a', customer_id: 'customer-a',
        original_status: status === 'sent' ? 'prepared' : 'sent', status, manual_delivery_reference: '  ',
      }))).rejects.toThrow('Ange referensen till det manuella kvittot.')
    }
    expect(state.updateOutbound).not.toHaveBeenCalled()
    expect(state.sync).not.toHaveBeenCalled()
    expect(state.audit).not.toHaveBeenCalled()
  })

  it('checks outbound company access before writing and skips follow-up work after a scope rejection', async () => {
    const submit = () => updateOutboundRequestStatusAction(form({
      outbound_request_id: 'outbound-a', customer_id: 'customer-b', original_status: 'sent', status: 'failed',
    }))
    state.companyAccess.mockRejectedValueOnce(new Error('company_access_denied'))
    await expect(submit()).rejects.toThrow('company_access_denied')
    expect(state.updateOutbound).not.toHaveBeenCalled()

    state.updateOutbound.mockRejectedValueOnce(new Error('Utskicket har ändrats eller är inte tillgängligt.'))
    await expect(submit()).rejects.toThrow('Utskicket har ändrats eller är inte tillgängligt.')
    expect(state.updateOutbound).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'company-a', customerId: 'customer-b' }))
    expect(state.syncOutboundGridOwner).not.toHaveBeenCalled()
    expect(state.sync).not.toHaveBeenCalled()
    expect(state.audit).not.toHaveBeenCalled()
  })

  it('binds an outbound note and status command to the selected tenant even when the actor has another membership', async () => {
    state.access.mockResolvedValueOnce({ userId: 'actor', companyId: 'company-b' })
    const command = form({
      outbound_request_id: 'outbound-a', customer_id: 'customer-a',
      original_status: 'sent', status: 'sent', response_payload_note: 'Ny notering',
    })
    await expect(updateOutboundRequestStatusAction(command)).rejects.toThrow('Utskicket tillhör inte det valda bolaget.')
    expect(state.companyAccess).toHaveBeenCalledWith('actor', 'company-a')
    expect(state.updateOutbound).not.toHaveBeenCalled()
    expect(state.audit).not.toHaveBeenCalled()
    expect(state.syncOutboundGridOwner).not.toHaveBeenCalled()
  })

  it('lets a canonical platform actor operate the actual outbound row company', async () => {
    state.access.mockResolvedValueOnce({ userId: 'actor', companyId: null, isPlatformAdmin: true })
    await updateOutboundRequestStatusAction(form({
      outbound_request_id: 'outbound-a', customer_id: 'customer-a',
      original_status: 'prepared', status: 'prepared', response_payload_note: 'Kontrollerad notering',
    }))
    expect(state.updateOutbound).toHaveBeenCalledWith(expect.objectContaining({
      companyId: 'company-a', changes: { admin_note: 'Kontrollerad notering' },
    }))
  })

  it('saves only edited notes and preserves the status and transport failure reason from the older form', async () => {
    await updateGridOwnerDataRequestStatusAction(form({
      request_id: 'request-a', customer_id: 'customer-a', original_status: 'sent', status: 'sent',
      external_reference: 'OLD-REF', original_external_reference: 'OLD-REF',
      notes: 'Ny verksamhetsanteckning', original_notes: '',
      response_payload_note: 'Ny svarsanteckning', original_response_payload_note: '',
      failure_reason: '',
    }))
    expect(state.updateRequest).toHaveBeenCalledWith({
      actorUserId: 'actor', companyId: 'company-a', customerId: 'customer-a', requestId: 'request-a',
      originalStatus: 'sent', changes: { notes: 'Ny verksamhetsanteckning', admin_note: 'Ny svarsanteckning' },
    })
    expect(state.sync).toHaveBeenCalledWith(expect.anything(), 'customer-a')
  })

  it('scopes a requested status change and propagates a stale or different-customer rejection without follow-up', async () => {
    state.updateRequest.mockRejectedValue(new Error('request_scope_or_status_changed'))
    await expect(updateGridOwnerDataRequestStatusAction(form({
      request_id: 'request-a', customer_id: 'customer-b', original_status: 'sent', status: 'received',
    }))).rejects.toThrow('request_scope_or_status_changed')
    expect(state.updateRequest).toHaveBeenCalledWith({
      actorUserId: 'actor', companyId: 'company-a', customerId: 'customer-b', requestId: 'request-a',
      originalStatus: 'sent', changes: { status: 'received' },
    })
    expect(state.sync).not.toHaveBeenCalled()
    expect(state.audit).not.toHaveBeenCalled()
  })

  it('does not submit a write for an unchanged form or for a form missing the shown status', async () => {
    await updateGridOwnerDataRequestStatusAction(form({
      request_id: 'request-a', customer_id: 'customer-a', original_status: 'sent', status: 'sent',
    }))
    await expect(updateGridOwnerDataRequestStatusAction(form({
      request_id: 'request-a', customer_id: 'customer-a', status: 'sent', notes: 'Ny',
    }))).rejects.toThrow('Ladda om nätägarbegäran')
    expect(state.updateRequest).not.toHaveBeenCalled()
  })

  it('lets a platform operator deliberately clear a previously shown failure reason', async () => {
    state.access.mockResolvedValue({ userId: 'actor', isPlatformAdmin: true })
    await updateGridOwnerDataRequestStatusAction(form({
      request_id: 'request-a', customer_id: 'customer-a', original_status: 'failed', status: 'failed',
      failure_reason: '', original_failure_reason: 'Tidigare diagnostik',
    }))
    expect(state.updateRequest).toHaveBeenCalledWith(expect.objectContaining({ changes: { failure_reason: null } }))
  })

  it('stops before any write when the actor cannot operate the record company', async () => {
    state.companyAccess.mockRejectedValue(new Error('company_access_denied'))
    await expect(updateGridOwnerDataRequestStatusAction(form({ request_id: 'request-a', customer_id: 'customer-a', original_status: 'sent', status: 'received' }))).rejects.toThrow('company_access_denied')
    expect(state.updateRequest).not.toHaveBeenCalled()
    expect(state.sync).not.toHaveBeenCalled()
  })

  it('stops before any write when the action permission is denied', async () => {
    state.access.mockRejectedValue(new Error('permission_denied'))
    await expect(updateGridOwnerDataRequestStatusAction(form({ request_id: 'request-a', customer_id: 'customer-a', original_status: 'sent', status: 'received' }))).rejects.toThrow('permission_denied')
    expect(state.companyAccess).not.toHaveBeenCalled()
    expect(state.updateRequest).not.toHaveBeenCalled()
  })

  it('does not run follow-up work after a database failure', async () => {
    state.updateRequest.mockRejectedValue(new Error('database_failure'))
    await expect(updateGridOwnerDataRequestStatusAction(form({ request_id: 'request-a', customer_id: 'customer-a', original_status: 'sent', status: 'received' }))).rejects.toThrow('database_failure')
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
