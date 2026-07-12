import { supabaseService } from '@/lib/supabase/service'
import type { MeteringValueRow } from '@/lib/cis/types'
import { assertPlatformSchemaReady } from '@/lib/platform/schemaReadiness'
import { stockholmDateForInstant } from '@/lib/time/stockholm'

type BillingMatchStatus = 'billable_pending' | 'unmatched_for_billing' | 'billing_conflict'

async function createBillingUnresolvedItem(params: {
  companyId: string
  sourceMessageId?: string | null
  issueType: 'billing_period_missing' | 'billing_period_conflict'
  severity: 'warning' | 'critical'
  identifiers: Record<string, unknown>
}) {
  const existing = await supabaseService
    .from('ediel_unresolved_items')
    .select('id')
    .eq('company_id', params.companyId)
    .eq('issue_type', params.issueType)
    .eq('status', 'open')
    .contains('extracted_identifiers', params.identifiers)
    .limit(2)
  if (existing.error) throw existing.error
  if ((existing.data ?? []).length > 1) throw new Error('billing_unresolved_item_ambiguous')
  if ((existing.data ?? []).length === 1) return

  const { error } = await supabaseService.from('ediel_unresolved_items').insert({
    company_id: params.companyId,
    source_message_id: params.sourceMessageId ?? null,
    issue_type: params.issueType,
    severity: params.severity,
    extracted_identifiers: params.identifiers,
    suggested_matches: [],
    status: 'open',
  })
  if (error) throw error
}

async function updateMeterValueBillingStatus(params: {
  meterValueId: string
  companyId: string
  status: BillingMatchStatus
  customerId?: string | null
}) {
  const meterUpdate = await supabaseService
    .from('metering_values')
    .update({
      customer_id: params.customerId ?? undefined,
      billing_status: params.status,
    })
    .eq('id', params.meterValueId)
    .eq('company_id', params.companyId)
    .select('id')
  if (meterUpdate.error) throw meterUpdate.error
  if ((meterUpdate.data ?? []).length !== 1) throw new Error('metering_billing_status_update_missed')

  const normalizedUpdate = await supabaseService
    .from('normalized_metering_values')
    .update({ billing_status: params.status, updated_at: new Date().toISOString() })
    .eq('source_metering_value_id', params.meterValueId)
    .eq('company_id', params.companyId)
    .eq('revision_status', 'current')
    .select('id')
  if (normalizedUpdate.error) throw normalizedUpdate.error
  if ((normalizedUpdate.data ?? []).length !== 1) throw new Error('normalized_metering_billing_status_update_missed')
}

export async function updateMeterValueBillingReadiness(params: {
  meterValue: MeteringValueRow
  sourceMessageId?: string | null
}): Promise<BillingMatchStatus> {
  await assertPlatformSchemaReady()
  const companyId = params.meterValue.company_id ?? null
  const meteringPointId = params.meterValue.metering_point_id
  const periodStartRaw = params.meterValue.period_start
  const periodEndRaw = params.meterValue.period_end

  if (!companyId || !meteringPointId || !periodStartRaw || !periodEndRaw) {
    if (companyId) {
      await updateMeterValueBillingStatus({ meterValueId: params.meterValue.id, companyId, status: 'unmatched_for_billing' })
    }
    return 'unmatched_for_billing'
  }

  const periodStart = stockholmDateForInstant(periodStartRaw)
  const periodEnd = stockholmDateForInstant(new Date(new Date(periodEndRaw).getTime() - 1))
  const { data: periods, error: periodsError } = await supabaseService
    .from('customer_supply_periods')
    .select('id,company_id,customer_id,contract_id,metering_point_id,start_date,end_date,status')
    .eq('company_id', companyId)
    .eq('metering_point_id', meteringPointId)
    .in('status', ['active', 'confirmed_by_grid_owner'])
    .lte('start_date', periodStart)
    .or(`end_date.is.null,end_date.gte.${periodEnd}`)
    .limit(3)
  if (periodsError) throw periodsError

  if (!periods || periods.length === 0) {
    await updateMeterValueBillingStatus({ meterValueId: params.meterValue.id, companyId, status: 'unmatched_for_billing' })
    await createBillingUnresolvedItem({
      companyId,
      sourceMessageId: params.sourceMessageId,
      issueType: 'billing_period_missing',
      severity: 'warning',
      identifiers: { meteringPointId, periodStart, periodEnd, meterValueId: params.meterValue.id },
    })
    return 'unmatched_for_billing'
  }

  if (periods.length > 1) {
    await updateMeterValueBillingStatus({ meterValueId: params.meterValue.id, companyId, status: 'billing_conflict' })
    await createBillingUnresolvedItem({
      companyId,
      sourceMessageId: params.sourceMessageId,
      issueType: 'billing_period_conflict',
      severity: 'critical',
      identifiers: {
        meteringPointId,
        periodStart,
        periodEnd,
        meterValueId: params.meterValue.id,
        supplyPeriodIds: periods.map((row: { id: string }) => row.id),
      },
    })
    return 'billing_conflict'
  }

  const period = periods[0] as { id: string; customer_id?: string | null; contract_id?: string | null }
  if (!period.customer_id || !period.contract_id) {
    await updateMeterValueBillingStatus({
      meterValueId: params.meterValue.id,
      companyId,
      status: 'unmatched_for_billing',
      customerId: period.customer_id ?? null,
    })
    return 'unmatched_for_billing'
  }

  const { data: contracts, error: contractError } = await supabaseService
    .from('customer_contracts')
    .select('id,company_id,customer_id,metering_point_id,status,starts_at,ends_at')
    .eq('id', period.contract_id)
    .eq('company_id', companyId)
    .eq('customer_id', period.customer_id)
    .eq('metering_point_id', meteringPointId)
    .in('status', ['signed', 'active'])
    .lte('starts_at', periodStart)
    .or(`ends_at.is.null,ends_at.gte.${periodEnd}`)
    .limit(2)
  if (contractError) throw contractError

  if ((contracts ?? []).length !== 1) {
    await updateMeterValueBillingStatus({
      meterValueId: params.meterValue.id,
      companyId,
      status: (contracts ?? []).length > 1 ? 'billing_conflict' : 'unmatched_for_billing',
      customerId: period.customer_id,
    })
    return (contracts ?? []).length > 1 ? 'billing_conflict' : 'unmatched_for_billing'
  }

  await updateMeterValueBillingStatus({
    meterValueId: params.meterValue.id,
    companyId,
    status: 'billable_pending',
    customerId: period.customer_id,
  })
  return 'billable_pending'
}
