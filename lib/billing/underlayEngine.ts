import { supabaseService } from '@/lib/supabase/service'
import { isPriceArea } from '@/lib/pricing/types'

type BillingSourceTable = 'normalized_metering_values' | 'metering_values'

type BillingSourceRows = {
  sourceTable: BillingSourceTable
  rows: Record<string, unknown>[]
}

function monthBounds(billingMonth: string) {
  if (!/^\d{4}-\d{2}$/.test(billingMonth)) throw new Error('Fakturamånad måste anges som YYYY-MM.')
  const [yearRaw, monthRaw] = billingMonth.split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  const start = `${billingMonth}-01T00:00:00.000Z`
  const end = new Date(Date.UTC(year, month, 1)).toISOString()
  return { year, month, start, end, startDate: `${billingMonth}-01` }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
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
  const rawPayload = isObject(row.raw_payload) ? row.raw_payload : {}
  const area =
    stringValue(row.price_area) ??
    stringValue(row.bidding_zone_code) ??
    stringValue(row.price_area_code) ??
    stringValue(rawPayload.price_area) ??
    stringValue(rawPayload.bidding_zone_code)
  return isPriceArea(area) ? area : null
}

function pickQuantityKwh(row: Record<string, unknown>, sourceTable: BillingSourceTable): number {
  if (sourceTable === 'normalized_metering_values') return numberValue(row.quantity_kwh)
  return numberValue(row.value_kwh) || numberValue(row.quantity_kwh) || numberValue(row.quantity)
}

function pickCustomerSiteId(row: Record<string, unknown>): string | null {
  return stringValue(row.customer_site_id) ?? stringValue(row.site_id)
}

function pickGridArea(row: Record<string, unknown>): string | null {
  return stringValue(row.grid_area) ?? stringValue(row.grid_area_code)
}

function pickFacilityId(row: Record<string, unknown>): string | null {
  return stringValue(row.facility_id) ?? stringValue(row.site_facility_id) ?? stringValue(row.anlage_id)
}

function buildReadinessIssues(warnings: string[]) {
  return warnings.map((message) => ({ code: 'billing_underlay_issue', message }))
}

async function loadBillingSourceRows(input: { companyId: string; start: string; end: string }): Promise<BillingSourceRows> {
  const normalized = await supabaseService
    .from('normalized_metering_values')
    .select('*')
    .eq('company_id', input.companyId)
    .gte('period_start', input.start)
    .lt('period_start', input.end)
    .neq('status', 'void')
    .limit(20_000)

  if (normalized.error && normalized.error.code !== '42P01' && normalized.error.code !== 'PGRST205') throw normalized.error

  const normalizedRows = (normalized.data ?? []) as Record<string, unknown>[]
  if (normalizedRows.length > 0) return { sourceTable: 'normalized_metering_values', rows: normalizedRows }

  const legacy = await supabaseService
    .from('metering_values')
    .select('*')
    .eq('company_id', input.companyId)
    .gte('period_start', input.start)
    .lt('period_start', input.end)
    .eq('is_current', true)
    .neq('value_status', 'void')
    .limit(20_000)

  if (legacy.error) throw legacy.error
  return { sourceTable: 'metering_values', rows: (legacy.data ?? []) as Record<string, unknown>[] }
}

function contractMatchesScope(contract: Record<string, unknown>, input: { meteringPointId: string | null; customerSiteId: string | null; siteId: string | null }) {
  const contractMeteringPointId = stringValue(contract.metering_point_id)
  if (contractMeteringPointId && input.meteringPointId && contractMeteringPointId !== input.meteringPointId) return false

  const contractCustomerSiteId = stringValue(contract.customer_site_id)
  if (contractCustomerSiteId && input.customerSiteId && contractCustomerSiteId !== input.customerSiteId) return false

  const contractSiteId = stringValue(contract.site_id)
  if (contractSiteId && input.siteId && contractSiteId !== input.siteId) return false
  if (contractSiteId && input.customerSiteId && contractSiteId !== input.customerSiteId) return false

  return true
}

async function loadActiveContract(input: {
  companyId: string
  customerId: string | null
  customerSiteId: string | null
  siteId: string | null
  meteringPointId: string | null
  periodStart: string
}): Promise<Record<string, unknown> | null> {
  if (!input.customerId) return null

  const { data, error } = await supabaseService
    .from('customer_contracts')
    .select('*')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .in('status', ['active', 'signed'])
    .or(`starts_at.is.null,starts_at.lte.${input.periodStart.slice(0, 10)}`)
    .order('starts_at', { ascending: false })
    .limit(25)

  if (error && error.code !== 'PGRST116') throw error

  const rows = ((data ?? []) as Record<string, unknown>[])
  return rows.find((row) => contractMatchesScope(row, input)) ?? null
}

async function loadContractPriceSnapshot(input: {
  companyId: string
  contractId: string | null
  periodStart: string
}): Promise<Record<string, unknown> | null> {
  if (!input.contractId) return null

  const { data, error } = await supabaseService
    .from('contract_price_snapshots')
    .select('*')
    .eq('company_id', input.companyId)
    .eq('contract_id', input.contractId)
    .lte('valid_from', input.periodStart.slice(0, 10))
    .or(`valid_to.is.null,valid_to.gte.${input.periodStart.slice(0, 10)}`)
    .order('valid_from', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error && error.code !== 'PGRST116') throw error
  return (data as Record<string, unknown> | null) ?? null
}

function snapshotPayload(snapshot: Record<string, unknown> | null) {
  if (!snapshot) return {}
  const snapshotJson = isObject(snapshot.snapshot_json) ? snapshot.snapshot_json : {}
  return {
    ...snapshotJson,
    contract_price_snapshot_id: stringValue(snapshot.id),
    pricing_model: stringValue(snapshot.pricing_model) ?? stringValue(snapshotJson.pricing_model),
    base_price_components: Array.isArray(snapshot.base_price_components_snapshot) ? snapshot.base_price_components_snapshot : [],
    price_components: Array.isArray(snapshot.price_components_snapshot) ? snapshot.price_components_snapshot : [],
  }
}

export async function generateBillingUnderlaysForMonth(input: {
  companyId: string
  billingMonth: string
  createdBy?: string | null
}) {
  const bounds = monthBounds(input.billingMonth)
  const source = await loadBillingSourceRows({ companyId: input.companyId, start: bounds.start, end: bounds.end })
  const rows = source.rows
  const grouped = new Map<string, Record<string, unknown>[]>()

  for (const row of rows) {
    const customerId = stringValue(row.customer_id)
    const customerSiteId = pickCustomerSiteId(row)
    const meteringPointId = stringValue(row.metering_point_id)
    const key = [customerId ?? 'missing_customer', customerSiteId ?? 'missing_site', meteringPointId ?? 'missing_metering_point'].join('|')
    grouped.set(key, [...(grouped.get(key) ?? []), row])
  }

  const results: Array<{ underlayId: string | null; status: string; sourceTable: BillingSourceTable; sourceRows: number; warnings: string[] }> = []

  for (const groupRows of grouped.values()) {
    const first = groupRows[0]
    const customerId = stringValue(first.customer_id)
    const meteringPointId = stringValue(first.metering_point_id)
    const siteId = stringValue(first.site_id) ?? pickCustomerSiteId(first)
    const customerSiteId = pickCustomerSiteId(first)
    const priceArea = pickPriceArea(first)
    const gridArea = pickGridArea(first)
    const facilityId = pickFacilityId(first)
    const totalKwh = groupRows.reduce((sum, row) => sum + pickQuantityKwh(row, source.sourceTable), 0)
    const warnings: string[] = []

    if (!customerId) warnings.push('Kund saknas på mätdata.')
    if (!meteringPointId) warnings.push('Mätpunkt saknas på mätdata.')
    if (!priceArea) warnings.push('Elområde saknas på mätdata eller mätpunkt.')
    if (totalKwh <= 0) warnings.push('Mätförbrukning saknas eller är noll för perioden.')

    const contract = await loadActiveContract({
      companyId: input.companyId,
      customerId,
      customerSiteId,
      siteId,
      meteringPointId,
      periodStart: bounds.start,
    })
    if (!contract) warnings.push('Aktivt avtal saknas för perioden.')

    const snapshot = await loadContractPriceSnapshot({
      companyId: input.companyId,
      contractId: stringValue(contract?.id),
      periodStart: bounds.start,
    })
    if (contract && !snapshot) warnings.push('Prissnapshot saknas för avtalet och perioden.')

    const status = warnings.length > 0 ? 'needs_review' : 'ready_for_pricing'
    const readinessStatus = warnings.length > 0 ? 'blocked' : 'ready'
    const readinessIssues = buildReadinessIssues(warnings)
    const pricePlanVersionId = stringValue(snapshot?.price_plan_version_id)

    const { data: underlay, error: upsertError } = await supabaseService
      .from('billing_underlays')
      .upsert({
        company_id: input.companyId,
        customer_id: customerId,
        site_id: siteId,
        customer_site_id: customerSiteId,
        metering_point_id: meteringPointId,
        contract_id: stringValue(contract?.id),
        pricing_snapshot_id: stringValue(snapshot?.id),
        price_plan_id: pricePlanVersionId,
        campaign_id: stringValue(snapshot?.campaign_version_id),
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
        source_system: source.sourceTable,
        source_meter_value_count: groupRows.length,
        missing_values_count: 0,
        payload: {
          billing_month: input.billingMonth,
          source_table: source.sourceTable,
          source_row_ids: groupRows.map((row) => row.id),
          price_area: priceArea,
          grid_area: gridArea,
          facility_id: facilityId,
          generated_from: source.sourceTable,
        },
        pricing_snapshot: snapshotPayload(snapshot),
        received_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        created_by: input.createdBy ?? null,
        updated_by: input.createdBy ?? null,
      }, { onConflict: 'company_id,customer_id,metering_point_id,underlay_year,underlay_month' })
      .select('id')
      .single()

    if (upsertError) throw upsertError
    const underlayId = (underlay as { id: string }).id

    const { error: deleteItemsError } = await supabaseService
      .from('billing_underlay_items')
      .delete()
      .eq('company_id', input.companyId)
      .eq('billing_underlay_id', underlayId)
    if (deleteItemsError) throw deleteItemsError

    const itemRows = groupRows.map((row) => ({
      company_id: input.companyId,
      billing_underlay_id: underlayId,
      meter_value_id: source.sourceTable === 'metering_values' ? stringValue(row.id) : null,
      source_normalized_metering_value_id: source.sourceTable === 'normalized_metering_values' ? stringValue(row.id) : null,
      customer_id: customerId,
      customer_site_id: customerSiteId,
      site_id: siteId,
      metering_point_id: meteringPointId,
      contract_id: stringValue(contract?.id),
      price_plan_id: pricePlanVersionId,
      campaign_id: stringValue(snapshot?.campaign_version_id),
      facility_id: pickFacilityId(row) ?? facilityId,
      price_area: pickPriceArea(row) ?? priceArea,
      grid_area: pickGridArea(row) ?? gridArea,
      source_table: source.sourceTable,
      source_transaction_reference: stringValue(row.source_transaction_reference),
      source_line_reference: stringValue(row.source_line_reference),
      period_start: stringValue(row.period_start) ?? bounds.start,
      period_end: stringValue(row.period_end) ?? bounds.end,
      quantity: pickQuantityKwh(row, source.sourceTable),
      quantity_kwh: pickQuantityKwh(row, source.sourceTable),
      unit: stringValue(row.unit) ?? 'kWh',
      product_code: stringValue(row.product_code),
      register_code: stringValue(row.register_code),
      quality_code: stringValue(row.quality_code) ?? stringValue(row.quality_status) ?? stringValue(row.quality),
      resolution: stringValue(row.resolution) ?? stringValue(row.measurement_resolution),
      status: warnings.length > 0 ? 'needs_review' : 'ready_for_pricing',
      warnings: readinessIssues,
      metadata: {
        source_table: source.sourceTable,
        source_row_id: stringValue(row.id),
        raw_payload: isObject(row.raw_payload) ? row.raw_payload : {},
      },
      updated_at: new Date().toISOString(),
    }))

    if (itemRows.length > 0) {
      const { error: itemError } = await supabaseService
        .from('billing_underlay_items')
        .insert(itemRows)
      if (itemError) throw itemError
    }

    await supabaseService.from('billing_underlay_events').insert({
      company_id: input.companyId,
      billing_underlay_id: underlayId,
      event_type: 'underlay_generated',
      message: warnings.length > 0 ? 'Fakturaunderlag kräver granskning.' : 'Fakturaunderlag är redo för prisberäkning.',
      metadata: { billing_month: input.billingMonth, warnings, source_table: source.sourceTable, source_rows: groupRows.length },
      created_by: input.createdBy ?? null,
    })

    results.push({ underlayId, status, sourceTable: source.sourceTable, sourceRows: groupRows.length, warnings })
  }

  return {
    billingMonth: input.billingMonth,
    sourceTable: source.sourceTable,
    sourceRows: rows.length,
    underlays: results.length,
    readyForPricing: results.filter((row) => row.status === 'ready_for_pricing').length,
    needsReview: results.filter((row) => row.status === 'needs_review').length,
    results,
  }
}
