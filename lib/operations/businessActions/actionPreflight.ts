import { supabaseService } from '@/lib/supabase/service'
import { assertUserCanOperateCompany, requireOperationalCompanyId } from '@/lib/tenant/scope'

export type BusinessActionPreflightIssue = {
  code: string
  label: string
  blocking: boolean
}

export type BusinessActionPreflightResult = {
  ok: boolean
  companyId: string
  customerId: string
  siteId: string | null
  meteringPointId: string | null
  gridOwnerId: string | null
  issues: BusinessActionPreflightIssue[]
}

export async function actionPreflight(input: {
  actorUserId: string
  customerId: string
  siteId?: string | null
  meteringPointId?: string | null
}): Promise<BusinessActionPreflightResult> {
  const scopedCompanyId = await requireOperationalCompanyId(input.actorUserId)
  const { data: customer, error: customerError } = await supabaseService
    .from('customers')
    .select('id, company_id, full_name, email, personal_number, org_number')
    .eq('id', input.customerId)
    .eq('company_id', scopedCompanyId)
    .maybeSingle()

  if (customerError) throw customerError
  if (!customer) throw new Error('Kunden hittades inte inom ditt bolag.')

  const companyId = await assertUserCanOperateCompany(input.actorUserId, (customer as { company_id: string }).company_id)

  const siteQuery = supabaseService
    .from('customer_sites')
    .select('*')
    .eq('customer_id', input.customerId)
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(1)
  if (input.siteId) siteQuery.eq('id', input.siteId)
  const { data: sites, error: siteError } = await siteQuery
  if (siteError) throw siteError
  const site = (sites ?? [])[0] as Record<string, unknown> | undefined

  const meteringQuery = supabaseService
    .from('metering_points')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(1)
  if (input.meteringPointId) meteringQuery.eq('id', input.meteringPointId)
  else if (site?.id) meteringQuery.eq('site_id', site.id)
  const { data: meteringPoints, error: meteringError } = await meteringQuery
  if (meteringError) throw meteringError
  const meteringPoint = (meteringPoints ?? [])[0] as Record<string, unknown> | undefined

  const issues: BusinessActionPreflightIssue[] = []
  if (!site?.id) issues.push({ code: 'site_missing', label: 'Anläggning saknas', blocking: true })
  if (!meteringPoint?.id) issues.push({ code: 'metering_point_missing', label: 'Anläggnings-id', blocking: true })
  const gridOwnerId = String(meteringPoint?.grid_owner_id ?? site?.grid_owner_id ?? '').trim() || null
  if (!gridOwnerId) issues.push({ code: 'grid_owner_missing', label: 'Nätägare', blocking: true })

  return {
    ok: !issues.some((issue) => issue.blocking),
    companyId,
    customerId: input.customerId,
    siteId: typeof site?.id === 'string' ? site.id : null,
    meteringPointId: typeof meteringPoint?.id === 'string' ? meteringPoint.id : null,
    gridOwnerId,
    issues,
  }
}
