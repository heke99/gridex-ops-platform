import { NextResponse } from 'next/server'
import { internalApiError } from '@/lib/http/apiError'
import { OutboundFrozenError } from '@/lib/platform/outboundFreeze'
import { requireAdminApiAccess, requireAdminOperationalCompany } from '@/lib/admin/apiGuards'
import { assertUserCanOperateCompany } from '@/lib/tenant/scope'
import { requireUuid, UuidValidationError } from '@/lib/validation/uuid'
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

function readPurchaseCompany(body: Record<string, unknown>): string | null | undefined {
  const values = [body.companyId, body.company_id].filter(value => value !== undefined)
  if (values.some(value => typeof value !== 'string')) return undefined
  try {
    const companyIds = values.map(value => requireUuid(value, 'companyId'))
    if (new Set(companyIds).size > 1) return undefined
    return companyIds[0] ?? null
  } catch (error) {
    if (error instanceof UuidValidationError) return undefined
    throw error
  }
}

export async function POST(request: Request, { params }: Props) {
  try {
    const { id } = await params
    const input: unknown = await request.json().catch(() => null)
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return NextResponse.json({ error: 'Fakturaköp kräver ett giltigt JSON-objekt.', code: 'invoice_purchase_invalid_body' }, { status: 400 })
    }
    const body = input as Record<string, unknown>
    const requestedCompanyId = readPurchaseCompany(body)
    if (requestedCompanyId === undefined) {
      return NextResponse.json({ error: 'Ange ett giltigt och entydigt bolag för fakturaköpet.', code: 'invoice_purchase_invalid_company' }, { status: 400 })
    }
    const access = await requireAdminApiAccess(['billing_underlay.export'], { companyId: requestedCompanyId })
    if (access.response) return access.response
    const companyId = requestedCompanyId ? await assertUserCanOperateCompany(access.guard.userId, requestedCompanyId) : await requireAdminOperationalCompany(access.guard)
    const requestedModes = [body.financing_mode, body.financingMode].filter(mode => mode !== undefined)
    if (requestedModes.some(mode => mode !== 'factoring_with_recourse' && mode !== 'factoring_without_recourse') ||
      new Set(requestedModes).size > 1) {
      return NextResponse.json({ error: 'Ange ett giltigt finansieringssätt för fakturaköpet.', code: 'invoice_purchase_invalid_financing_mode' }, { status: 400 })
    }
    const financingMode = requestedModes[0] === 'factoring_with_recourse' ? 'factoring_with_recourse' : 'factoring_without_recourse'

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

    // The native owner serializes the company freeze and export-item claim before external I/O.
    if (!item.updated_at) return purchaseNeedsReconciliation()
    const reserve = supabaseService.rpc.bind(supabaseService) as unknown as (
      name: 'gridex_reserve_manual_capway_purchase_v1',
      args: {
        p_company_id: string
        p_invoice_export_item_id: string
        p_export_run_id: string
        p_actor_user_id: string
        p_environment: 'production' | 'test'
        p_invoice_guid: string
        p_financing_mode: 'factoring_with_recourse' | 'factoring_without_recourse'
        p_expected_updated_at: string
        p_expected_provider_status: string | null
        p_expected_purchase_status: string | null
      },
    ) => Promise<{ data: boolean | null; error: { code: string; message: string } | null }>
    const { data: claimed, error: reservationError } = await reserve('gridex_reserve_manual_capway_purchase_v1', {
      p_company_id: companyId,
      p_invoice_export_item_id: id,
      p_export_run_id: item.export_run_id,
      p_actor_user_id: access.guard.userId,
      p_environment: environment,
      p_invoice_guid: invoiceGuid,
      p_financing_mode: financingMode,
      p_expected_updated_at: item.updated_at,
      p_expected_provider_status: providerStatus,
      p_expected_purchase_status: purchaseStatus,
    })
    if (reservationError?.code === '23514' && reservationError.message === 'invoice_export_outbound_frozen') {
      throw new OutboundFrozenError('invoice_export', null)
    }
    if (reservationError?.code === '42501' && reservationError.message === 'invoice_purchase_actor_forbidden') {
      return NextResponse.json({ error: 'Saknar behörighet för fakturaköp i detta bolag.', code: 'invoice_purchase_forbidden' }, { status: 403 })
    }
    if (reservationError?.code === '55P03') return purchaseNeedsReconciliation()
    if (reservationError) throw reservationError
    if (claimed !== true) return purchaseNeedsReconciliation()

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
    if (error instanceof OutboundFrozenError) {
      return NextResponse.json({ error: 'Utgående fakturor är spärrade för bolaget.', code: error.code }, { status: error.status })
    }
    return internalApiError({ context: 'invoice_purchase_failed', error, code: 'invoice_purchase_failed', message: 'Fakturaköp kunde inte begäras.' })
  }
}
