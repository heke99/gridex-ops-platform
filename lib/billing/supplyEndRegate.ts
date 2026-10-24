// Re-gating of metering values held only because their supply was ending (FINDINGS H2/H3, reality scenario H).
//
// A metering value is gated once, when the grid owner's file is received (meterValueBillingMatcher). Before
// 20261022150000 and the code-side acceptance in billingGate.ts, a value of a period that a PRODAT Z05 had
// put in 'ending', or whose contract the supply-end follow-up had terminated, was held for good:
// supply_period_missing / supply_period_not_active / contract_not_active. The monthly billing run now
// evaluates such values of the month again, with the same gate, before it builds underlays. Only values on a
// metering point with an 'ending' or 'ended' period of the tenant are considered; the gate decides, nothing
// is forced eligible, and every write goes through the service-role gate RPC with its own scope checks.
import { tenantSelect } from '@/lib/supabase/tenantQuery'
import { stockholmMonthBounds } from '@/lib/time/stockholm'
import { billingMonthLoadWindow } from './billingMonth'
import type { MeteringValueRow } from '@/lib/cis/types'
import { updateMeterValueBillingReadiness } from './meterValueBillingMatcher'

type Row = Record<string, unknown>
const SUPPLY_END_HOLD_REASONS = new Set(['supply_period_missing', 'supply_period_not_active', 'contract_not_active'])
const PAGE = 500
const ID_CHUNK = 100

export type SupplyEndRegateResult = { candidates: number; evaluated: number; billable: number; failed: number; errors: string[] }

function heldForSupplyEnd(value: Row) {
  const reasons = Array.isArray(value.billing_gate_reasons) ? value.billing_gate_reasons as Row[] : []
  return reasons.some(reason => SUPPLY_END_HOLD_REASONS.has(String(reason?.code ?? '')))
}

export async function regateSupplyEndValues(input: { companyId: string; billingMonth: string; limit?: number }): Promise<SupplyEndRegateResult> {
  const bounds = stockholmMonthBounds(input.billingMonth)
  // An Ediel-qualified supply is billed per Ediel month (00:00 +0100): in summer its last hour 22:00Z-23:00Z on the
  // last civil day lies after the civil month, e.g. the hour before a Z05 end on the 1st (FINDINGS F108 M5).
  const window = billingMonthLoadWindow(input.billingMonth)
  const limit = Math.min(Math.max(Math.floor(input.limit ?? 5_000), 1), 20_000)
  const result: SupplyEndRegateResult = { candidates: 0, evaluated: 0, billable: 0, failed: 0, errors: [] }
  // Metering points of this tenant whose supply received an end that overlaps the month.
  const periods = await tenantSelect(input.companyId, "customer_supply_periods", 'metering_point_id')
    .eq('company_id', input.companyId).in('status', ['ending', 'ended'])
    .lt('start_date', bounds.endDateExclusive).or(`end_date.is.null,end_date.gte.${bounds.startDate}`)
  if (periods.error) throw periods.error
  const points = [...new Set(((periods.data ?? []) as Row[]).map(row => String(row.metering_point_id ?? '')).filter(Boolean))]
  if (points.length === 0) return result

  const held: Row[] = []
  // At most ID_CHUNK ids per in-filter: the URL limit is reached at about 240 UUIDs (FINDINGS J2-15).
  for (let p = 0; p < points.length && held.length < limit; p += ID_CHUNK) {
    const pointChunk = points.slice(p, p + ID_CHUNK)
    for (let from = 0; held.length < limit; from += PAGE) {
      const page = await tenantSelect(input.companyId, "normalized_metering_values", 'id,company_id,metering_point_id,source_metering_value_id,source_message_id,billing_gate_status,billing_gate_reasons')
        .eq('company_id', input.companyId).in('metering_point_id', pointChunk).eq('revision_status', 'current')
        .neq('billing_gate_status', 'eligible').lt('period_start', window.end).gt('period_end', window.start)
        .order('period_start', { ascending: true }).order('id', { ascending: true }).range(from, from + PAGE - 1)
      if (page.error) throw page.error
      const rows = (page.data ?? []) as Row[]
      held.push(...rows.filter(heldForSupplyEnd))
      if (rows.length < PAGE) break
    }
  }
  result.candidates = held.length

  for (let i = 0; i < held.length; i += ID_CHUNK) {
    const slice = held.slice(i, i + ID_CHUNK)
    const raw = await tenantSelect(input.companyId, "metering_values", '*').eq('company_id', input.companyId)
      .in('id', slice.map(row => String(row.source_metering_value_id)))
    if (raw.error) throw raw.error
    const byId = new Map(((raw.data ?? []) as MeteringValueRow[]).map(row => [String(row.id), row]))
    for (const value of slice) {
      const meterValue = byId.get(String(value.source_metering_value_id))
      if (!meterValue) { result.failed += 1; continue }
      try {
        const status = await updateMeterValueBillingReadiness({ meterValue, sourceMessageId: typeof value.source_message_id === 'string' ? value.source_message_id : null })
        result.evaluated += 1
        if (status === 'billable') result.billable += 1
      } catch (error) {
        // One value never stops the month; it stays held with its previous decision.
        result.failed += 1
        if (result.errors.length < 10) result.errors.push(error instanceof Error ? error.message : String(error))
      }
    }
  }
  return result
}
