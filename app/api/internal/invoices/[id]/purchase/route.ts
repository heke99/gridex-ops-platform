import { NextResponse } from 'next/server'
import { unstable_rethrow } from 'next/navigation'
import { internalApiError } from '@/lib/http/apiError'
import { requireAdminApiAccess } from '@/lib/admin/apiGuards'
import { assertUserCanOperateCompany, requireOperationalCompanyId } from '@/lib/tenant/scope'
import { supabaseService } from '@/lib/supabase/service'
import { buildPurchasePayload, requestCapwayInvoicePurchase } from '@/lib/integrations/billing/capway/purchase'
import { currentSupportSession } from '@/lib/customer-operations/supportSession'
import { claimManualPurchase, completeManualPurchase, manualPurchaseItemBinding, ManualPurchaseIntentError, resolveManualPurchaseConfiguration } from '@/lib/billing/manualPurchaseIntentReconstructed'
import { classifyInvoiceExportError } from '@/lib/integrations/billing/exportErrorClassification'
import type { ManualPurchaseCommand } from '@/lib/billing/manualPurchaseIntentReconstructed'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: Props) {
  const access = await requireAdminApiAccess(['billing.write', 'billing.export'])
  if (access.response) return access.response
  try {
    const { id } = await params
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const requestedCompanyId = typeof body.companyId === 'string' ? body.companyId : typeof body.company_id === 'string' ? body.company_id : null
    const companyId = requestedCompanyId ? await assertUserCanOperateCompany(access.guard.userId, requestedCompanyId) : await requireOperationalCompanyId(access.guard.userId)
    if (!access.guard.isPlatformAdmin && access.guard.companyId !== companyId) return NextResponse.json({ error: 'Ej behörig' }, { status: 403 })
    const actor = await currentSupportSession('ops', access.guard.userId)
    const financingMode = body.financing_mode === 'factoring_with_recourse' || body.financingMode === 'factoring_with_recourse' ? 'factoring_with_recourse' : 'factoring_without_recourse'

    const { data: item, error } = await supabaseService
      .from('invoice_export_items')
      .select('*')
      .eq('company_id', companyId)
      .eq('id', id)
      .single()
    if (error) throw error
    const invoiceGuid = typeof item.provider_invoice_guid === 'string' ? item.provider_invoice_guid : ''
    if (!invoiceGuid) return NextResponse.json({ error: 'Exportposten saknar Capway invoiceGuid.' }, { status: 400 })
    if (!['test','production'].includes(item.environment)) throw new ManualPurchaseIntentError(409)
    const providerContext = await resolveManualPurchaseConfiguration(companyId, item.environment)

    const input = {
      companyId,
      environment: item.environment as 'test' | 'production',
      invoiceGuid,
      financingMode,
      recourseDays: typeof body.recourse_days === 'number' ? body.recourse_days : typeof body.recourseDays === 'number' ? body.recourseDays : null,
      note: typeof body.note === 'string' ? body.note : `Gridex fakturaköp ${id}`,
    } as const
    const command: ManualPurchaseCommand = { companyId, itemId: id, actorUserId: actor.userId, sessionId: actor.sessionId,
      financingMode, payload: buildPurchasePayload(input), itemBinding: manualPurchaseItemBinding(item), connectionJson: providerContext.connectionJson }
    const receipt = await claimManualPurchase(command)
    if (!receipt.shouldPost) {
      if (receipt.status === 'response_observed' && receipt.response) return NextResponse.json({ data: receipt.response })
      throw new ManualPurchaseIntentError(409)
    }
    let result: Record<string, unknown>
    try { result = await requestCapwayInvoicePurchase({ ...input, resolvedConfiguration: providerContext.configuration }) }
    catch (error) {
      unstable_rethrow(error)
      const classified = classifyInvoiceExportError(error)
      // Even a definite rejection consumes the permanent barrier. A network,
      // timeout or lost response never authorizes another purchase attempt.
      await completeManualPurchase(command, receipt, classified.outcome === 'rejected' ? 'rejected' : 'uncertain', {
        errorCode: classified.errorCode, outcome: classified.outcome, httpStatus: classified.httpStatus,
      })
      throw error
    }
    await completeManualPurchase(command, receipt, 'response_observed', result)
    return NextResponse.json({ data: result })
  } catch (error) {
    unstable_rethrow(error)
    return internalApiError({ context: 'invoice_purchase_failed', error, code: 'invoice_purchase_failed', message: 'Fakturaköp kunde inte begäras.', status: error instanceof ManualPurchaseIntentError ? error.status : 500 })
  }
}
