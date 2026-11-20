import { NextResponse } from 'next/server'
import { internalApiError } from '@/lib/http/apiError'
import { requireAdminApiAccess, requireAdminOperationalCompany } from '@/lib/admin/apiGuards'
import { assertUserCanOperateCompany } from '@/lib/tenant/scope'
import { supabaseService } from '@/lib/supabase/service'
import { requestCapwayInvoicePurchase } from '@/lib/integrations/billing/capway/purchase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ id: string }> }

const MANUAL_PURCHASE_RECONCILIATION = 'manual_purchase_reconciliation'
const AUTOMATIC_PURCHASE_RECONCILIATION = 'automatic_purchase_reconciliation'

function purchaseNeedsReconciliation() {
  return NextResponse.json({
    error: 'Fakturaköpet behöver avstämmas innan det kan begäras igen.',
    code: 'invoice_purchase_reconciliation_required',
  }, { status: 409 })
}

export async function POST(request: Request, { params }: Props) {
  try {
    const { id } = await params
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const requestedCompanyId = typeof body.companyId === 'string' ? body.companyId : typeof body.company_id === 'string' ? body.company_id : null
    const access = await requireAdminApiAccess(['billing_underlay.export'], { companyId: requestedCompanyId })
    if (access.response) return access.response
    const companyId = requestedCompanyId?.trim() ? await assertUserCanOperateCompany(access.guard.userId, requestedCompanyId) : await requireAdminOperationalCompany(access.guard)
    const financingMode = body.financing_mode === 'factoring_with_recourse' || body.financingMode === 'factoring_with_recourse' ? 'factoring_with_recourse' : 'factoring_without_recourse'

    const { data: item, error } = await supabaseService
      .from('invoice_export_items')
      .select('*')
      .eq('company_id', companyId)
      .eq('id', id)
      .single()
    if (error) throw error
    const invoiceGuid = typeof item.provider_invoice_guid === 'string' ? item.provider_invoice_guid : ''
    if (!invoiceGuid.trim()) return NextResponse.json({ error: 'Exportposten saknar Capway invoiceGuid.' }, { status: 400 })
    const environment = item.environment
    if (item.provider !== 'capway_aptic' || (environment !== 'production' && environment !== 'test')) {
      return NextResponse.json({ error: 'Exportposten har ingen giltig Capway-miljö.', code: 'invoice_purchase_scope_mismatch' }, { status: 409 })
    }
    if (item.status !== 'sent') {
      return NextResponse.json({ error: 'Fakturan måste vara bekräftat skickad innan den kan köpas.', code: 'invoice_purchase_invoice_not_sent' }, { status: 409 })
    }

    const providerStatus = item.provider_status ?? null
    if (providerStatus === 'cancelled') {
      return NextResponse.json({ error: 'Fakturan är annullerad hos fakturapartnern.', code: 'invoice_purchase_provider_cancelled' }, { status: 409 })
    }

    const responsePayload = item.response_payload && typeof item.response_payload === 'object' && !Array.isArray(item.response_payload)
      ? item.response_payload
      : {}
    const purchaseStatus = item.purchase_status
    if (item.provider_purchase_confirmed_at !== null ||
      (purchaseStatus !== null && purchaseStatus !== 'service' && purchaseStatus !== 'own_ledger') ||
      (responsePayload.purchase !== null && responsePayload.purchase !== undefined) ||
      Object.hasOwn(responsePayload, MANUAL_PURCHASE_RECONCILIATION) ||
      Object.hasOwn(responsePayload, AUTOMATIC_PURCHASE_RECONCILIATION)) {
      return purchaseNeedsReconciliation()
    }

    // Claim the purchase before external I/O. The claim remains across lost replies and worker restarts.
    const reservedAt = new Date().toISOString()
    const reservationQuery = supabaseService.from('invoice_export_items').update({
      response_payload: {
        ...responsePayload,
        [MANUAL_PURCHASE_RECONCILIATION]: {
          company_id: companyId,
          invoice_export_item_id: id,
          export_run_id: item.export_run_id,
          actor_user_id: access.guard.userId,
          provider: 'capway_aptic',
          environment,
          invoice_guid: invoiceGuid,
          financing_mode: financingMode,
          reserved_at: reservedAt,
        },
      },
      updated_at: reservedAt,
    }).eq('company_id', companyId).eq('id', id).eq('export_run_id', item.export_run_id)
      .eq('provider', 'capway_aptic').eq('environment', environment).eq('provider_invoice_guid', invoiceGuid)
      .eq('status', 'sent').eq('updated_at', item.updated_at).is('provider_purchase_confirmed_at', null)
      .is(`response_payload->${MANUAL_PURCHASE_RECONCILIATION}`, null)
      .is(`response_payload->${AUTOMATIC_PURCHASE_RECONCILIATION}`, null)
      .is('response_payload->>purchase', null)
    const providerBoundReservation = providerStatus === null
      ? reservationQuery.is('provider_status', null)
      : reservationQuery.eq('provider_status', providerStatus)
    const { data: reservation, error: reservationError } = await (purchaseStatus === null
      ? providerBoundReservation.is('purchase_status', null)
      : providerBoundReservation.eq('purchase_status', purchaseStatus)).select('id').maybeSingle()
    if (reservationError) throw reservationError
    if (!reservation) return purchaseNeedsReconciliation()

    const result = await requestCapwayInvoicePurchase({
      companyId,
      environment,
      invoiceGuid,
      financingMode,
      recourseDays: typeof body.recourse_days === 'number' ? body.recourse_days : typeof body.recourseDays === 'number' ? body.recourseDays : null,
      note: typeof body.note === 'string' ? body.note : `Gridex fakturaköp ${id}`,
    })

    // Event and export-item status are recorded together; a failure here must not look like success.
    const { data: auditReceipt, error: recordError } = await supabaseService.rpc('gridex_record_invoice_purchase_request_v1', {
      p_company_id: companyId,
      p_invoice_export_item_id: id,
      p_financing_mode: financingMode,
      p_payload: result as unknown as Record<string, unknown>,
      p_actor_user_id: access.guard.userId,
    })
    if (recordError) throw recordError
    if (!auditReceipt || typeof auditReceipt !== 'object' || !('event_id' in auditReceipt) ||
      typeof auditReceipt.event_id !== 'string' || !auditReceipt.event_id.trim()) {
      throw new Error('Fakturaköpets händelsekvitto saknas.')
    }

    return NextResponse.json({ data: result })
  } catch (error) {
    return internalApiError({ context: 'invoice_purchase_failed', error, code: 'invoice_purchase_failed', message: 'Fakturaköp kunde inte begäras.' })
  }
}
