import { supabaseService } from '@/lib/supabase/service'
import { evaluateEdielDeadline } from '@/lib/ediel/calendar/deadlineCalculator'
import { assertUserCanOperateCompany, requireOperationalCompanyId } from '@/lib/tenant/scope'
import type { MeteringPointRow } from '@/lib/masterdata/types'
import { hasMeteringPointIdentity } from '@/lib/customers/meteringIdentity'

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

function firstNonBlank(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

export async function actionPreflight(input: {
  actorUserId: string
  customerId: string
  siteId?: string | null
  meteringPointId?: string | null
  actionType?: string | null
  requestedDate?: string | null
  historicalStartDate?: string | null
  historicalEndDate?: string | null
}): Promise<BusinessActionPreflightResult> {
  const scopedCompanyId = await requireOperationalCompanyId(input.actorUserId)
  const { data: customer, error: customerError } = await supabaseService
    .from('customers')
    .select('id, company_id, status, full_name, email, personal_number, org_number')
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
    .eq('customer_id', input.customerId)
    .order('created_at', { ascending: false })
    .limit(1)
  if (input.meteringPointId) meteringQuery.eq('id', input.meteringPointId)
  if (site?.id) meteringQuery.eq('site_id', site.id)
  const { data: meteringPoints, error: meteringError } = await meteringQuery
  if (meteringError) throw meteringError
  const meteringPoint = (meteringPoints ?? [])[0] as Record<string, unknown> | undefined

  const issues: BusinessActionPreflightIssue[] = []
  if (String((customer as { status?: string | null }).status ?? '').toLowerCase() === 'archived') {
    issues.push({
      code: 'customer_archived',
      label: 'Kunden är arkiverad. Historik kan läsas, men nya aktiva kundåtgärder är spärrade.',
      blocking: true,
    })
  }
  if (!site?.id) issues.push({ code: 'site_missing', label: 'Anläggning saknas', blocking: true })
  const typedMeteringPoint = (meteringPoint as MeteringPointRow | undefined) ?? null
  if (!typedMeteringPoint) {
    issues.push({ code: 'metering_point_missing', label: 'Mätpunkt', blocking: true })
  } else if (!hasMeteringPointIdentity(typedMeteringPoint)) {
    issues.push({ code: 'meter_point_id_missing', label: 'Mätpunkts-ID', blocking: true })
  }

  const gridOwnerId = firstNonBlank(meteringPoint?.grid_owner_id, site?.grid_owner_id)
  if (!gridOwnerId) issues.push({ code: 'grid_owner_missing', label: 'Nätägare', blocking: true })

  const gridAreaCode = firstNonBlank(meteringPoint?.grid_area_code, site?.grid_area_code)
  if (!gridAreaCode) issues.push({ code: 'grid_area_missing', label: 'Nätområde', blocking: true })

  if (input.actionType) {
    const deadline = await evaluateEdielDeadline({
      actionType: input.actionType,
      messageFamily: 'PRODAT',
      businessCode:
        input.actionType === 'request_historical_metering_access'
          ? 'Z13VH'
          : input.actionType === 'terminate_metering_access'
            ? 'Z18'
            : input.actionType === 'start_supplier_switch'
              ? 'Z03'
              : 'Z13',
      requestedDate: input.requestedDate,
      historicalStartDate: input.historicalStartDate,
      historicalEndDate: input.historicalEndDate,
      networkContractStartDate: firstNonBlank(site?.move_in_date),
    })

    for (const message of deadline.issues) {
      issues.push({ code: 'market_deadline_failed', label: message, blocking: true })
    }
  }

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
