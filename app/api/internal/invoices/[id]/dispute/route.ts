import { NextResponse } from 'next/server'
import { requireAdminApiAccess } from '@/lib/admin/apiGuards'
import { assertUserCanOperateCompany, requireOperationalCompanyId } from '@/lib/tenant/scope'
import { supabaseService } from '@/lib/supabase/service'
import { createCapwayApticClient } from '@/lib/integrations/billing/capway/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: Props) {
  const access = await requireAdminApiAccess(['billing.write'])
  if (access.response) return access.response
  try {
    const { id } = await params
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const companyId = typeof body.companyId === 'string' ? await assertUserCanOperateCompany(access.guard.userId, body.companyId) : await requireOperationalCompanyId(access.guard.userId)
    const { data: item, error } = await supabaseService.from('invoice_export_items').select('*').eq('company_id', companyId).eq('id', id).single()
    if (error) throw error
    const invoiceGuid = typeof item.provider_invoice_guid === 'string' ? item.provider_invoice_guid : ''
    if (!invoiceGuid) return NextResponse.json({ error: 'Exportposten saknar Capway invoiceGuid.' }, { status: 400 })
    const client = await createCapwayApticClient({ companyId, environment: item.environment === 'production' ? 'production' : 'test' })
    const result = await client.dispute(invoiceGuid, { reason: typeof body.reason === 'string' ? body.reason : 'Bestridd via Gridex', disputedAt: new Date().toISOString(), isDisputed: true })
    await supabaseService.from('invoice_export_items').update({ provider_status: 'disputed', status_payload: { dispute: result }, updated_at: new Date().toISOString() }).eq('company_id', companyId).eq('id', id)
    return NextResponse.json({ data: result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Kunde inte registrera bestridande.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
