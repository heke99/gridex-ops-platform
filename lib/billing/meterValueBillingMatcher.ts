import { supabaseService } from '@/lib/supabase/service'
import type { MeteringValueRow } from '@/lib/cis/types'
import { assertPlatformSchemaReady } from '@/lib/platform/schemaReadiness'
import { stockholmDateForInstant } from '@/lib/time/stockholm'
import { evaluateBillingGate, type BillingGateStatus } from '@/lib/billing/billingGate'
import { loadQualifiedBillingValues } from './sourceBasis'
import { BILLED_SUPPLY_PERIOD_STATUSES, supplyPeriodEndInstant, supplyPeriodStartInstant } from './supplyPeriodEnd'

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
  const normalizedValue = (await loadQualifiedBillingValues(companyId, [String(normalizedRows[0].id)])).get(String(normalizedRows[0].id))!
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
    // 'ending' is still supplied up to its received end (FINDINGS H2).
    .in('status', [...BILLED_SUPPLY_PERIOD_STATUSES])
    .lte('start_date', periodStart)
    .or(`end_date.is.null,end_date.gte.${periodEnd}`)
    .limit(3)
  if (periodsResponse.error) throw periodsResponse.error
  // A received market end (Z05) is exclusive: a value on the first day after it belongs to the next
  // supply, never to the ended period (FINDINGS H1). The query above reads end_date as the last day.
  // A received market start is the grid owner's instant, 00:00 Ediel fixed normal time (ENV-08): in summer the
  // first civil hour of the start date (22:00Z–23:00Z) is not ours. The query above reads start_date as a civil
  // day; such a value lies outside the period and is never offered to the database as billable (FINDINGS F108:
  // it was refused there and recorded as an unqualified supply source).
  // The received end is the market instant itself (00:00 +0100): in summer the civil hour 22:00Z-23:00Z before a
  // Z05 end on the 1st is still ours and is matched to the ending period (FINDINGS F108 M5); a manual end stays
  // civil midnight after its last supplied day.
  const valueStartMs = Date.parse(periodStartRaw)
  const valueEndMs = Date.parse(periodEndRaw)
  const periods = ((periodsResponse.data ?? []) as Array<Record<string, unknown>>).filter((row) => {
    const endMs = supplyPeriodEndInstant(row)
    const startMs = supplyPeriodStartInstant(row)
    return (endMs === null || endMs >= valueEndMs) && (startMs === null || startMs <= valueStartMs)
  })
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
  const sourceMessage = normalizedValue.billing_source_message as Record<string, unknown> | null;

  const evaluated = evaluateBillingGate({
    normalizedValue: { ...normalizedValue, source_message_id: sourceMessageId },
    supplyPeriod: period,
    supplyPeriodCandidateCount: periods.length,
    contract: contracts.length === 1 ? contracts[0] : null,
    contractCandidateCount: contracts.length,
    sourceMessage,
    allowEstimatedValues: params.allowEstimatedValues,
  })
  let gate: Pick<typeof evaluated, 'status' | 'eligible' | 'reasons' | 'snapshot'> = evaluated
  const persist = () => persistBillingGate({
    meterValueId: params.meterValue.id,
    normalizedValueId,
    companyId,
    status: canonicalStatus(gate.status),
    gateStatus: gate.status,
    gateReasons: gate.reasons,
    gateSnapshot: gate.snapshot,
    customerId,
    supplyPeriodId: typeof period?.id === 'string' ? period.id : null,
    sourceMessageId,
  })

  try {
    await persist()
  } catch (error) {
    // The database also requires the supply period to rest on a qualified Ediel
    // market basis (switch confirmation or received supply start), which this
    // gate does not see. It stays the authority: record the value as blocked
    // with that reason instead of aborting ingestion of the rest of the file.
    if (!gate.eligible || (error as { message?: unknown } | null)?.message !== 'billing_gate_qualified_supply_source_required') throw error
    gate = {
      status: 'blocked',
      eligible: false,
      reasons: [...gate.reasons, { code: 'supply_source_unqualified', message: 'Leveransperioden saknar kvalificerat Ediel-underlag (bekräftat byte eller mottagen leveransstart).' }],
      snapshot: { ...gate.snapshot, supply_source_qualified: false },
    }
    await persist()
  }
  const status = canonicalStatus(gate.status)

  if (!gate.eligible) {
    const issueType = periods.length > 1 ? 'billing_period_conflict' : periods.length === 0 ? 'billing_period_missing' : 'billing_gate_blocked'
    // An unqualified supply source blocks every value of the period for the same
    // reason; one open item per supply period, not one per quarter-hour.
    const periodWide = gate.reasons.some((entry) => entry.code === 'supply_source_unqualified')
    // Values outside every supply period (or between two) are held for the same reason for a whole file:
    // one open item per metering point and received file, not one per quarter-hour (96 per day, ≈2 976 per
    // month and facility; reality scenario J2, J2-08).
    const fileWide = !periodWide && issueType !== 'billing_gate_blocked'
    await createBillingUnresolvedItem({
      companyId,
      sourceMessageId,
      issueType,
      severity: gate.status === 'conflict' ? 'critical' : 'warning',
      identifiers: periodWide
        ? { meteringPointId, supplyPeriodIds: periods.map((row) => row.id), reasonCodes: ['supply_source_unqualified'] }
        : fileWide
        ? { meteringPointId, sourceMessageId, supplyPeriodIds: periods.map((row) => row.id), reasonCodes: [...new Set(gate.reasons.map((entry) => entry.code))].sort() }
        : {
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
