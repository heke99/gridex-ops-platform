import { supabaseService } from '@/lib/supabase/service'
import type { MeteringValueRow } from '@/lib/cis/types'
import { assertPlatformSchemaReady } from '@/lib/platform/schemaReadiness'
import { stockholmDateForInstant } from '@/lib/time/stockholm'
import { evaluateBillingGate, type BillingGateStatus } from '@/lib/billing/billingGate'

type CanonicalBillingStatus = 'pending_match' | 'billable' | 'blocked' | 'conflict'

function canonicalStatus(gateStatus: BillingGateStatus): CanonicalBillingStatus {
  if (gateStatus === 'eligible') return 'billable'
  return gateStatus
}

async function createBillingUnresolvedItem(params: {
  companyId: string
  sourceMessageId?: string | null
  issueType: 'billing_period_missing' | 'billing_period_conflict' | 'billing_gate_blocked'
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

async function persistBillingGate(params: {
  meterValueId: string
  normalizedValueId: string
  companyId: string
  status: CanonicalBillingStatus
  gateStatus: BillingGateStatus
  gateReasons: Array<{ code: string; message: string }>
  gateSnapshot: Record<string, unknown>
  customerId?: string | null
  supplyPeriodId?: string | null
  sourceMessageId?: string | null
}) {
  const { error } = await supabaseService.rpc('gridex_set_metering_billing_gate', {
    p_company_id: params.companyId,
    p_metering_value_id: params.meterValueId,
    p_normalized_value_id: params.normalizedValueId,
    p_gate: {
      customer_id: params.customerId ?? null,
      supply_period_id: params.supplyPeriodId ?? null,
      source_message_id: params.sourceMessageId ?? null,
      billing_status: params.status,
      billing_gate_status: params.gateStatus,
      billing_gate_reasons: params.gateReasons,
      billing_gate_snapshot: params.gateSnapshot,
      billing_gate_evaluated_at: new Date().toISOString(),
    },
  })
  if (error) throw error
}


export async function updateMeterValueBillingReadiness(params: {
  meterValue: MeteringValueRow
  sourceMessageId?: string | null
  allowEstimatedValues?: boolean
}): Promise<CanonicalBillingStatus> {
  await assertPlatformSchemaReady()
  const companyId = params.meterValue.company_id ?? null
  const meteringPointId = params.meterValue.metering_point_id
  const periodStartRaw = params.meterValue.period_start
  const periodEndRaw = params.meterValue.period_end
  if (!companyId) return 'pending_match'

  const normalizedResponse = await supabaseService
    .from('normalized_metering_values')
    .select('*')
    .eq('company_id', companyId)
    .eq('source_metering_value_id', params.meterValue.id)
    .eq('revision_status', 'current')
    .limit(2)
  if (normalizedResponse.error) throw normalizedResponse.error
  const normalizedRows = (normalizedResponse.data ?? []) as Array<Record<string, unknown>>
  if (normalizedRows.length !== 1) throw new Error(normalizedRows.length > 1 ? 'normalized_metering_current_revision_conflict' : 'normalized_metering_current_revision_missing')
  const normalizedValue = normalizedRows[0]
  const normalizedValueId = String(normalizedValue.id)

  if (!meteringPointId || !periodStartRaw || !periodEndRaw) {
    const gate = evaluateBillingGate({ normalizedValue, allowEstimatedValues: params.allowEstimatedValues })
    await persistBillingGate({
      meterValueId: params.meterValue.id,
      normalizedValueId,
      companyId,
      status: canonicalStatus(gate.status),
      gateStatus: gate.status,
      gateReasons: gate.reasons,
      gateSnapshot: gate.snapshot,
      sourceMessageId: params.sourceMessageId ?? params.meterValue.source_ediel_message_id ?? null,
    })
    return canonicalStatus(gate.status)
  }

  const periodStart = stockholmDateForInstant(periodStartRaw)
  const periodEnd = stockholmDateForInstant(new Date(new Date(periodEndRaw).getTime() - 1))
  const periodsResponse = await supabaseService
    .from('customer_supply_periods')
    .select('*')
    .eq('company_id', companyId)
    .eq('metering_point_id', meteringPointId)
    .in('status', ['active', 'confirmed_by_grid_owner'])
    .lte('start_date', periodStart)
    .or(`end_date.is.null,end_date.gte.${periodEnd}`)
    .limit(3)
  if (periodsResponse.error) throw periodsResponse.error
  const periods = (periodsResponse.data ?? []) as Array<Record<string, unknown>>
  const period = periods.length === 1 ? periods[0] : null

  const contractId = typeof period?.contract_id === 'string' ? period.contract_id : null
  const customerId = typeof period?.customer_id === 'string' ? period.customer_id : null
  let contracts: Array<Record<string, unknown>> = []
  if (contractId && customerId) {
    const contractResponse = await supabaseService
      .from('customer_contracts')
      .select('*')
      .eq('id', contractId)
      .eq('company_id', companyId)
      .eq('customer_id', customerId)
      .eq('metering_point_id', meteringPointId)
      .limit(2)
    if (contractResponse.error) throw contractResponse.error
    contracts = (contractResponse.data ?? []) as Array<Record<string, unknown>>
  }

  const sourceMessageId = params.sourceMessageId ?? params.meterValue.source_ediel_message_id ?? (typeof normalizedValue.source_message_id === 'string' ? normalizedValue.source_message_id : null)
  let sourceMessage: Record<string, unknown> | null = null
  if (sourceMessageId) {
    const sourceResponse = await supabaseService
      .from('ediel_messages')
      .select('id,company_id,message_family,message_code,status,validated_at,processing_status')
      .eq('id', sourceMessageId)
      .eq('company_id', companyId)
      .maybeSingle()
    if (sourceResponse.error) throw sourceResponse.error
    sourceMessage = (sourceResponse.data as Record<string, unknown> | null) ?? null
  }

  const gate = evaluateBillingGate({
    normalizedValue: { ...normalizedValue, source_message_id: sourceMessageId },
    supplyPeriod: period,
    supplyPeriodCandidateCount: periods.length,
    contract: contracts.length === 1 ? contracts[0] : null,
    contractCandidateCount: contracts.length,
    sourceMessage,
    allowEstimatedValues: params.allowEstimatedValues,
  })
  const status = canonicalStatus(gate.status)

  await persistBillingGate({
    meterValueId: params.meterValue.id,
    normalizedValueId,
    companyId,
    status,
    gateStatus: gate.status,
    gateReasons: gate.reasons,
    gateSnapshot: gate.snapshot,
    customerId,
    supplyPeriodId: typeof period?.id === 'string' ? period.id : null,
    sourceMessageId,
  })

  if (!gate.eligible) {
    const issueType = periods.length > 1 ? 'billing_period_conflict' : periods.length === 0 ? 'billing_period_missing' : 'billing_gate_blocked'
    await createBillingUnresolvedItem({
      companyId,
      sourceMessageId,
      issueType,
      severity: gate.status === 'conflict' ? 'critical' : 'warning',
      identifiers: {
        meterValueId: params.meterValue.id,
        normalizedValueId,
        meteringPointId,
        periodStart,
        periodEnd,
        supplyPeriodIds: periods.map((row) => row.id),
        reasonCodes: gate.reasons.map((entry) => entry.code),
      },
    })
  }

  return status
}
