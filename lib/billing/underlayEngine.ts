import { supabaseService } from '@/lib/supabase/service'
import { isPriceArea } from '@/lib/pricing/types'

function monthBounds(billingMonth: string) {
  if (!/^\d{4}-\d{2}$/.test(billingMonth)) throw new Error('Fakturamånad måste anges som YYYY-MM.')
  const [yearRaw, monthRaw] = billingMonth.split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  const start = `${billingMonth}-01T00:00:00.000Z`
  const end = new Date(Date.UTC(year, month, 1)).toISOString()
  return { year, month, start, end }
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function numberValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value.replace(',', '.'))
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function pickPriceArea(row: Record<string, unknown>): string | null {
  const rawPayload = row.raw_payload && typeof row.raw_payload === 'object' && !Array.isArray(row.raw_payload)
    ? row.raw_payload as Record<string, unknown>
    : {}
  const area = stringValue(row.price_area) ?? stringValue(rawPayload.price_area)
  return isPriceArea(area) ? area : null
}

async function loadActiveContract(companyId: string, customerId: string | null, meteringPointId: string | null, periodStart: string): Promise<Record<string, unknown> | null> {
  if (!customerId) return null
  let query = supabaseService
    .from('customer_contracts')
    .select('*')
    .eq('company_id', companyId)
    .eq('customer_id', customerId)
    .in('status', ['active', 'signed'])
    .or(`starts_at.is.null,starts_at.lte.${periodStart.slice(0, 10)}`)
    .order('starts_at', { ascending: false })
    .limit(1)

  if (meteringPointId) query = query.or(`metering_point_id.eq.${meteringPointId},metering_point_id.is.null`)

  const { data, error } = await query.maybeSingle()
  if (error && error.code !== 'PGRST116') throw error
  return (data as Record<string, unknown> | null) ?? null
}

export async function generateBillingUnderlaysForMonth(input: {
  companyId: string
  billingMonth: string
  createdBy?: string | null
}) {
  const bounds = monthBounds(input.billingMonth)
  const { data, error } = await supabaseService
    .from('metering_values')
    .select('*')
    .eq('company_id', input.companyId)
    .gte('period_start', bounds.start)
    .lt('period_start', bounds.end)
    .eq('is_current', true)
    .neq('value_status', 'void')
    .limit(20_000)

  if (error) throw error

  const rows = (data ?? []) as Record<string, unknown>[]
  const grouped = new Map<string, Record<string, unknown>[]>()

  for (const row of rows) {
    const customerId = stringValue(row.customer_id)
    const meteringPointId = stringValue(row.metering_point_id)
    const key = [customerId ?? 'missing_customer', meteringPointId ?? 'missing_metering_point'].join('|')
    grouped.set(key, [...(grouped.get(key) ?? []), row])
  }

  const results: Array<{ underlayId: string | null; status: string; warnings: string[] }> = []

  for (const groupRows of grouped.values()) {
    const first = groupRows[0]
    const customerId = stringValue(first.customer_id)
    const meteringPointId = stringValue(first.metering_point_id)
    const siteId = stringValue(first.site_id)
    const priceArea = pickPriceArea(first)
    const totalKwh = groupRows.reduce((sum, row) => sum + numberValue(row.value_kwh), 0)
    const warnings: string[] = []

    if (!customerId) warnings.push('Kund saknas på mätdata.')
    if (!meteringPointId) warnings.push('Mätpunkt saknas på mätdata.')
    if (!priceArea) warnings.push('Elområde saknas på mätdata eller mätpunkt.')

    const contract = await loadActiveContract(input.companyId, customerId, meteringPointId, bounds.start)
    if (!contract) warnings.push('Aktivt avtal saknas för perioden.')

    const status = warnings.length > 0 ? 'needs_review' : 'ready_for_pricing'
    const readinessStatus = warnings.length > 0 ? 'blocked' : 'ready'
    const readinessIssues = warnings.map((message) => ({ code: 'billing_underlay_issue', message }))

    const { data: underlay, error: upsertError } = await supabaseService
      .from('billing_underlays')
      .upsert({
        company_id: input.companyId,
        customer_id: customerId,
        site_id: siteId,
        customer_site_id: siteId,
        metering_point_id: meteringPointId,
        contract_id: stringValue(contract?.id),
        price_plan_id: stringValue(contract?.contract_offer_id),
        campaign_id: null,
        price_area: priceArea,
        underlay_month: bounds.month,
        underlay_year: bounds.year,
        billing_period_start: bounds.start,
        billing_period_end: bounds.end,
        status,
        readiness_status: readinessStatus,
        readiness_issues: readinessIssues,
        total_kwh: totalKwh,
        currency: 'SEK',
        source_system: 'metering_values',
        payload: {
          billing_month: input.billingMonth,
          meter_value_ids: groupRows.map((row) => row.id),
          price_area: priceArea,
          generated_from: 'metering_values',
        },
        received_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        created_by: input.createdBy ?? null,
        updated_by: input.createdBy ?? null,
      }, { onConflict: 'company_id,customer_id,metering_point_id,underlay_year,underlay_month' })
      .select('id')
      .single()

    if (upsertError) throw upsertError
    const underlayId = (underlay as { id: string }).id

    const itemRows = groupRows.map((row) => ({
      company_id: input.companyId,
      billing_underlay_id: underlayId,
      meter_value_id: stringValue(row.id),
      customer_id: customerId,
      customer_site_id: siteId,
      site_id: siteId,
      metering_point_id: meteringPointId,
      contract_id: stringValue(contract?.id),
      price_plan_id: stringValue(contract?.contract_offer_id),
      campaign_id: null,
      price_area: priceArea,
      period_start: stringValue(row.period_start),
      period_end: stringValue(row.period_end),
      quantity_kwh: numberValue(row.value_kwh),
      resolution: stringValue((row.raw_payload as Record<string, unknown> | null)?.resolution) ?? null,
      status: warnings.length > 0 ? 'needs_review' : 'ready_for_pricing',
      warnings: readinessIssues,
    }))

    if (itemRows.length > 0) {
      const { error: itemError } = await supabaseService
        .from('billing_underlay_items')
        .upsert(itemRows, { onConflict: 'company_id,billing_underlay_id,meter_value_id' })
      if (itemError) throw itemError
    }

    await supabaseService.from('billing_underlay_events').insert({
      company_id: input.companyId,
      billing_underlay_id: underlayId,
      event_type: 'underlay_generated',
      message: warnings.length > 0 ? 'Fakturaunderlag kräver granskning.' : 'Fakturaunderlag är redo för prisberäkning.',
      metadata: { billing_month: input.billingMonth, warnings },
      created_by: input.createdBy ?? null,
    })

    results.push({ underlayId, status, warnings })
  }

  return {
    billingMonth: input.billingMonth,
    sourceRows: rows.length,
    underlays: results.length,
    readyForPricing: results.filter((row) => row.status === 'ready_for_pricing').length,
    needsReview: results.filter((row) => row.status === 'needs_review').length,
    results,
  }
}
