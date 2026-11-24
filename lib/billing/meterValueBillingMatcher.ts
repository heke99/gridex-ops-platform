import { supabaseService } from '@/lib/supabase/service'
import type { MeteringValueRow } from '@/lib/cis/types'
import { assertPlatformSchemaReady } from '@/lib/platform/schemaReadiness'
import { stockholmDateForInstant } from '@/lib/time/stockholm'
import { evaluateBillingGate, type BillingGateStatus } from '@/lib/billing/billingGate'
import { loadQualifiedBillingValues } from './sourceBasis'
import { readReplacedBoundProjection } from '@/lib/metering/normalizeMeteringValues'

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

type GateMeterValue = Pick<MeteringValueRow,
  'id' | 'company_id' | 'metering_point_id' | 'period_start' | 'period_end' | 'source_ediel_message_id' | 'canonical_dedupe_key' | 'source_transaction_reference'> &
  Partial<Pick<MeteringValueRow, 'source_system'>>

export type MeterValueBillingGateCommand = {
  p_company_id: string
  p_metering_value_id: string
  p_normalized_value_id: string
  p_gate: {
    customer_id: string | null
    supply_period_id: string | null
    source_message_id: string | null
    billing_status: CanonicalBillingStatus
    billing_gate_status: BillingGateStatus
    billing_gate_reasons: Array<{ code: string; message: string }>
    billing_gate_snapshot: Record<string, unknown>
    billing_gate_evaluated_at: string
  }
}

type CommitBillingGate = (command: MeterValueBillingGateCommand) => Promise<void>

async function isReplacedBillingRevision(meteringValue: GateMeterValue, companyId: string, expectedProjectionId?: string): Promise<boolean> {
  const dedupeKey = meteringValue.canonical_dedupe_key
  if (meteringValue.source_system !== 'ediel_utilts' || !dedupeKey) return false

  const projectionId = await readReplacedBoundProjection(companyId, meteringValue, dedupeKey)
  return projectionId !== null && (expectedProjectionId === undefined || projectionId === expectedProjectionId)
}

async function persistBillingGate(params: {
  meterValue: GateMeterValue
  normalizedValueId: string
  companyId: string
  status: CanonicalBillingStatus
  gateStatus: BillingGateStatus
  gateReasons: Array<{ code: string; message: string }>
  gateSnapshot: Record<string, unknown>
  customerId?: string | null
  supplyPeriodId?: string | null
  sourceMessageId?: string | null
}, commit?: CommitBillingGate): Promise<'persisted' | 'replaced'> {
  const command: MeterValueBillingGateCommand = {
    p_company_id: params.companyId,
    p_metering_value_id: params.meterValue.id,
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
  }
  if (commit) {
    await commit(command)
    return 'persisted'
  }
  const { error } = await supabaseService.rpc('gridex_set_metering_billing_gate', command)
  if (!error) return 'persisted'

  // The source wrapper can reject an eligible request before the inner
  // current-row check. Both refusals still require exact replacement proof.
  const couldBeReplacement = error.code === '23514' && (
    error.message === 'normalized_metering_value_not_current_or_not_linked' ||
    (params.gateStatus === 'eligible' && error.message === 'billing_gate_qualified_final_source_required')
  )
  if (couldBeReplacement && await isReplacedBillingRevision(params.meterValue, params.companyId, params.normalizedValueId)) {
    return 'replaced'
  }
  throw error
}

export async function updateMeterValueBillingReadiness(params: {
  meterValue: GateMeterValue
  sourceMessageId?: string | null
  allowEstimatedValues?: boolean
  commitBillingGate?: CommitBillingGate
  qualifiedValues?: ReadonlyMap<string, Record<string, unknown>>
}): Promise<CanonicalBillingStatus | 'replaced'> {
  await assertPlatformSchemaReady()
  const companyId = params.meterValue.company_id ?? null
  const meteringPointId = params.meterValue.metering_point_id
  const periodStartRaw = params.meterValue.period_start
  const periodEndRaw = params.meterValue.period_end
  if (!companyId) return 'pending_match'

  const normalizedResponse = await supabaseService
    .from('normalized_metering_values')
    .select('id')
    .eq('company_id', companyId)
    .eq('source_metering_value_id', params.meterValue.id)
    .eq('revision_status', 'current')
    .limit(2)
  if (normalizedResponse.error) throw normalizedResponse.error
  const normalizedRows = (normalizedResponse.data ?? []) as Array<Record<string, unknown>>
  if (normalizedRows.length === 0 && !params.commitBillingGate && await isReplacedBillingRevision(params.meterValue, companyId)) return 'replaced'
  if (normalizedRows.length !== 1) throw new Error(normalizedRows.length > 1 ? 'normalized_metering_current_revision_conflict' : 'normalized_metering_current_revision_missing')
  const normalizedValueId = String(normalizedRows[0].id)
  const qualified = params.qualifiedValues
  if (qualified && !params.commitBillingGate) throw new Error('billing_source_batch_requires_guarded_writer')
  const normalizedValue = (qualified ?? await loadQualifiedBillingValues(companyId, [normalizedValueId])).get(normalizedValueId)
  if (!normalizedValue || normalizedValue.id !== normalizedValueId ||
      (qualified && (normalizedValue.company_id !== companyId ||
        normalizedValue.source_metering_value_id !== params.meterValue.id ||
        normalizedValue.source_message_id !== params.sourceMessageId))) {
    throw new Error('billing_source_batch_scope_invalid')
  }
  if (!params.commitBillingGate && normalizedValue.revision_status === 'replaced' &&
      await isReplacedBillingRevision(params.meterValue, companyId, normalizedValueId)) {
    return 'replaced'
  }

  if (!meteringPointId || !periodStartRaw || !periodEndRaw) {
    const gate = evaluateBillingGate({ normalizedValue, allowEstimatedValues: params.allowEstimatedValues })
    const persisted = await persistBillingGate({
      meterValue: params.meterValue,
      normalizedValueId,
      companyId,
      status: canonicalStatus(gate.status),
      gateStatus: gate.status,
      gateReasons: gate.reasons,
      gateSnapshot: gate.snapshot,
      sourceMessageId: params.sourceMessageId ?? params.meterValue.source_ediel_message_id ?? null,
    }, params.commitBillingGate)
    return persisted === 'replaced' ? persisted : canonicalStatus(gate.status)
  }

  const periodStart = stockholmDateForInstant(periodStartRaw)
  const periodEnd = stockholmDateForInstant(new Date(new Date(periodEndRaw).getTime() - 1))
  const periodsResponse = await supabaseService
    .from('customer_supply_periods')
    .select('*')
    .eq('company_id', companyId)
    .eq('metering_point_id', meteringPointId)
    .in('status', ['active', 'confirmed_by_grid_owner', 'ending', 'ended'])
    .lte('start_date', periodStart)
    .or(`end_date.is.null,end_date.gte.${periodEnd}`)
    .or(`market_start_at.is.null,and(market_start_at.lte.${periodStartRaw},or(market_end_at.is.null,market_end_at.gte.${periodEndRaw}))`)
    .or(`status.neq.ending,and(market_start_at.lte.${periodStartRaw},market_end_at.gte.${periodEndRaw},source_end_message_id.not.is.null,end_date.not.is.null)`)
    .order('market_start_at', { ascending: true, nullsFirst: false })
    .limit(3)
  if (periodsResponse.error) throw periodsResponse.error
  const civilCandidates = (periodsResponse.data ?? []) as Array<Record<string, unknown>>
  // Only source periods with exact market boundaries can authorize readiness.
  // Preserve legacy no-proof diagnostics if no exact candidate was returned.
  const exactCandidates = civilCandidates.filter(row => typeof row.market_start_at === 'string')
  const periods = exactCandidates.length > 0 ? exactCandidates : civilCandidates
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
    qualifyTerminatedSupplyOnWrite: true,
    allowEstimatedValues: params.allowEstimatedValues,
  })
  let gate: Pick<typeof evaluated, 'status' | 'eligible' | 'reasons' | 'snapshot'> = evaluated
  const persist = () => persistBillingGate({
    meterValue: params.meterValue,
    normalizedValueId,
    companyId,
    status: canonicalStatus(gate.status),
    gateStatus: gate.status,
    gateReasons: gate.reasons,
    gateSnapshot: gate.snapshot,
    customerId,
    supplyPeriodId: typeof period?.id === 'string' ? period.id : null,
    sourceMessageId,
  }, params.commitBillingGate)

  try {
    if (await persist() === 'replaced') return 'replaced'
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
    if (await persist() === 'replaced') return 'replaced'
  }
  const status = canonicalStatus(gate.status)

  if (!gate.eligible) {
    const issueType = periods.length > 1 ? 'billing_period_conflict' : periods.length === 0 ? 'billing_period_missing' : 'billing_gate_blocked'
    // An unqualified supply source blocks every value of the period for the same
    // reason; one open item per supply period, not one per quarter-hour.
    const periodWide = gate.reasons.some((entry) => entry.code === 'supply_source_unqualified')
    await createBillingUnresolvedItem({
      companyId,
      sourceMessageId,
      issueType,
      severity: gate.status === 'conflict' ? 'critical' : 'warning',
      identifiers: periodWide
        ? { meteringPointId, supplyPeriodIds: periods.map((row) => row.id), reasonCodes: ['supply_source_unqualified'] }
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
