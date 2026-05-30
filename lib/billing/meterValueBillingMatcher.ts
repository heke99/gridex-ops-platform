// lib/billing/meterValueBillingMatcher.ts

import { supabaseService } from '@/lib/supabase/service'
import type { MeteringValueRow } from '@/lib/cis/types'

type BillingMatchStatus = 'billable_pending' | 'unmatched_for_billing' | 'billing_conflict'

function toDateOnly(value: string | null | undefined): string | null {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 10)
  return parsed.toISOString().slice(0, 10)
}

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
    .limit(1)
    .maybeSingle()

  if (existing.error) throw existing.error
  if (existing.data) return

  const { error } = await supabaseService
    .from('ediel_unresolved_items')
    .insert({
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
  contractId?: string | null
}) {
  const { error } = await supabaseService
    .from('metering_values')
    .update({
      customer_id: params.customerId ?? undefined,
      status: params.status,
      value_status: params.status,
    })
    .eq('id', params.meterValueId)
    .eq('company_id', params.companyId)

  if (error) throw error
}

export async function updateMeterValueBillingReadiness(params: {
  meterValue: MeteringValueRow
  sourceMessageId?: string | null
}): Promise<BillingMatchStatus> {
  const companyId = params.meterValue.company_id ?? null
  const meteringPointId = params.meterValue.metering_point_id
  const periodStart = toDateOnly(params.meterValue.period_start)
  const periodEnd = toDateOnly(params.meterValue.period_end)

  if (!companyId || !meteringPointId || !periodStart || !periodEnd) {
    if (companyId) {
      await updateMeterValueBillingStatus({
        meterValueId: params.meterValue.id,
        companyId,
        status: 'unmatched_for_billing',
      })
    }
    return 'unmatched_for_billing'
  }

  const { data: periods, error: periodsError } = await supabaseService
    .from('customer_supply_periods')
    .select('*')
    .eq('company_id', companyId)
    .eq('metering_point_id', meteringPointId)
    .in('status', ['active', 'confirmed_by_grid_owner'])
    .lte('start_date', periodEnd)
    .or(`end_date.is.null,end_date.gte.${periodStart}`)

  if (periodsError) throw periodsError

  if (!periods || periods.length === 0) {
    await updateMeterValueBillingStatus({
      meterValueId: params.meterValue.id,
      companyId,
      status: 'unmatched_for_billing',
    })
    await createBillingUnresolvedItem({
      companyId,
      sourceMessageId: params.sourceMessageId,
      issueType: 'billing_period_missing',
      severity: 'warning',
      identifiers: {
        meteringPointId,
        periodStart,
        periodEnd,
        meterValueId: params.meterValue.id,
      },
    })
    return 'unmatched_for_billing'
  }

  if (periods.length > 1) {
    await updateMeterValueBillingStatus({
      meterValueId: params.meterValue.id,
      companyId,
      status: 'billing_conflict',
    })
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

  const period = periods[0] as { customer_id?: string | null; contract_id?: string | null }
  if (!period.customer_id || !period.contract_id) {
    await updateMeterValueBillingStatus({
      meterValueId: params.meterValue.id,
      companyId,
      status: 'unmatched_for_billing',
      customerId: period.customer_id ?? null,
    })
    return 'unmatched_for_billing'
  }

  const { data: contract, error: contractError } = await supabaseService
    .from('customer_contracts')
    .select('id,status,price_version,contract_offer_id,starts_at,ends_at')
    .eq('id', period.contract_id)
    .eq('company_id', companyId)
    .maybeSingle()

  if (contractError) throw contractError

  if (!contract) {
    await updateMeterValueBillingStatus({
      meterValueId: params.meterValue.id,
      companyId,
      status: 'unmatched_for_billing',
      customerId: period.customer_id,
      contractId: period.contract_id,
    })
    return 'unmatched_for_billing'
  }

  await updateMeterValueBillingStatus({
    meterValueId: params.meterValue.id,
    companyId,
    status: 'billable_pending',
    customerId: period.customer_id,
    contractId: period.contract_id,
  })

  return 'billable_pending'
}
