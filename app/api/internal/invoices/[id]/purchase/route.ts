import { NextResponse } from 'next/server'
import { requireAdminApiAccess } from '@/lib/admin/apiGuards'
import { assertUserCanOperateCompany, requireOperationalCompanyId } from '@/lib/tenant/scope'
import { supabaseService } from '@/lib/supabase/service'
import { requestCapwayInvoicePurchase } from '@/lib/integrations/billing/capway/purchase'

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

    const result = await requestCapwayInvoicePurchase({
      companyId,
      environment: item.environment === 'production' ? 'production' : 'test',
      invoiceGuid,
      financingMode,
      recourseDays: typeof body.recourse_days === 'number' ? body.recourse_days : typeof body.recourseDays === 'number' ? body.recourseDays : null,
      note: typeof body.note === 'string' ? body.note : `Gridex fakturaköp ${id}`,
    })

    await supabaseService.from('invoice_purchase_events').insert({
      company_id: companyId,
      invoice_export_item_id: id,
      event_type: 'purchase_requested_manual',
      purchase_status: 'requested',
      finance_status: financingMode,
      payload: result,
      created_by: access.guard.userId,
    })
    await supabaseService.from('invoice_export_items').update({ purchase_status: 'requested', financing_mode: financingMode, updated_at: new Date().toISOString() }).eq('company_id', companyId).eq('id', id)

    return NextResponse.json({ data: result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Kunde inte begära fakturaköp.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
