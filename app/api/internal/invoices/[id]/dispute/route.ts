import { NextResponse } from 'next/server'
import { internalApiError } from '@/lib/http/apiError'
import { requireAdminApiAccess, requireAdminOperationalCompany } from '@/lib/admin/apiGuards'
import { assertUserCanOperateCompany } from '@/lib/tenant/scope'
import { supabaseService } from '@/lib/supabase/service'
import { createCapwayApticClient } from '@/lib/integrations/billing/capway/client'
import { emitDomainEvent } from '@/lib/events/domainEvents'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: Props) {
  let providerDisputeSaved = false
  try {
    const { id } = await params
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const requestedCompanyId = typeof body.companyId === 'string' ? body.companyId : null
    const access = await requireAdminApiAccess(['billing.write'], { companyId: requestedCompanyId })
    if (access.response) return access.response
    const companyId = requestedCompanyId?.trim() ? await assertUserCanOperateCompany(access.guard.userId, requestedCompanyId) : await requireAdminOperationalCompany(access.guard)
    const { data: item, error } = await supabaseService.from('invoice_export_items').select('*').eq('company_id', companyId).eq('id', id).single()
    if (error) throw error
    const invoiceGuid = typeof item.provider_invoice_guid === 'string' ? item.provider_invoice_guid : ''
    if (!invoiceGuid) return NextResponse.json({ error: 'Exportposten saknar Capway invoiceGuid.' }, { status: 400 })
    const client = await createCapwayApticClient({ companyId, environment: item.environment === 'production' ? 'production' : 'test' })
    const result = await client.dispute(invoiceGuid, { reason: typeof body.reason === 'string' ? body.reason : 'Bestridd via Gridex', disputedAt: new Date().toISOString(), isDisputed: true })
    providerDisputeSaved = true
    // The dispute is already registered at the provider; failing to store it locally must not look like success.
    let saved = false
    for (let attempt = 0; attempt < 5 && !saved; attempt += 1) {
      const current = await supabaseService.from('invoice_export_items').select('provider_status,status_payload,updated_at').eq('company_id', companyId).eq('id', id).maybeSingle()
      if (current.error) throw current.error
      if (!current.data) throw new Error('Exportpostens aktuella kvitto kunde inte läsas.')
      const snapshot = current.data
      const payload = snapshot.status_payload && typeof snapshot.status_payload === 'object' && !Array.isArray(snapshot.status_payload) ? snapshot.status_payload as Record<string, unknown> : {}
      const nextStatus = ['credited', 'cancelled'].includes(String(snapshot.provider_status)) ? snapshot.provider_status : 'disputed'
      let update = supabaseService.from('invoice_export_items').update({ provider_status: nextStatus, status_payload: { ...payload, dispute: result }, updated_at: new Date().toISOString() }).eq('company_id', companyId).eq('id', id)
      update = snapshot.updated_at == null ? update.is('updated_at', null) : update.eq('updated_at', snapshot.updated_at)
      // Compare the complete JSONB receipt as well; timestamps alone can collide.
      update = snapshot.status_payload == null ? update.is('status_payload', null) : update.eq('status_payload', JSON.stringify(snapshot.status_payload))
      const receipt = await update.select('id').maybeSingle()
      if (receipt.error) throw receipt.error
      saved = Boolean(receipt.data)
    }
    if (!saved) throw new Error('Exportpostens kvitto ändrades samtidigt för många gånger.')
    await emitDomainEvent({
      companyId,
      eventType: 'invoice.disputed',
      aggregateType: 'invoice_export_item',
      aggregateId: id,
      subjectCustomerId: typeof item.customer_id === 'string' ? item.customer_id : null,
      actorUserId: access.guard.userId,
      source: 'billing_invoice_dispute',
      payload: {
        invoice_export_item_id: id,
        customer_number: typeof item.customer_number === 'string' ? item.customer_number : null,
        reason: typeof body.reason === 'string' ? body.reason : 'Bestridd via Gridex',
        provider_invoice_guid: invoiceGuid,
        status: 'disputed',
      },
      idempotencyKey: `invoice-disputed:${id}`,
    }).catch(() => null)
    return NextResponse.json({ data: result })
  } catch (error) {
    return internalApiError({ context: 'invoice_dispute_failed', error, code: providerDisputeSaved ? 'invoice_dispute_completion_uncertain' : 'invoice_dispute_failed', message: providerDisputeSaved ? 'Bestridandet registrerades hos leverantören, men det lokala kvittot kunde inte bekräftas.' : 'Bestridandet kunde inte registreras.', status: providerDisputeSaved ? 503 : 500 })
  }
}
