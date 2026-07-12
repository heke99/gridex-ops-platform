import { supabaseService } from '@/lib/supabase/service'
import type { MeteringValueRow } from '@/lib/cis/types'
import { emitDomainEvent } from '@/lib/events/domainEvents'
import { isPriceArea, type PriceArea } from '@/lib/pricing/types'
import { assertPlatformSchemaReady } from '@/lib/platform/schemaReadiness'

export type MeteringDirection = 'consumption' | 'production' | 'net_consumption' | 'net_production'
export type MeteringUnit = 'Wh' | 'kWh' | 'MWh'

export type NormalizedMeteringValueInput = {
  companyId: string
  customerId?: string | null
  customerSiteId?: string | null
  siteId?: string | null
  meteringPointId?: string | null
  facilityId?: string | null
  gridOwnerId?: string | null
  sourceRequestId?: string | null
  priceArea?: PriceArea | string | null
  gridArea?: string | null
  periodStart: string
  periodEnd: string
  readAt?: string | null
  resolution?: string | null
  quantityKwh: number
  qualityStatus?: string | null
  readingType?: 'consumption' | 'production' | 'estimated' | 'adjustment'
  direction?: MeteringDirection
  unit?: MeteringUnit
  registerCode?: string | null
  productCode?: string | null
  correctionReason?: string | null
  sourceType: 'ediel_utilts' | 'brp_import' | 'manual' | 'api' | string
  sourceMessageId?: string | null
  sourceTransactionReference?: string | null
  sourceLineReference?: string | null
  rawPayload?: Record<string, unknown>
  createdBy?: string | null
}

export type NormalizeResult =
  | { status: 'stored'; meteringValueId: string; normalizedMeteringValueId: string; meteringValue: MeteringValueRow; warnings: string[] }
  | { status: 'needs_review' | 'blocked_duplicate'; warnings: string[]; reason: string }

function nonEmpty(value: string | null | undefined): string | null {
  return value && value.trim() ? value.trim() : null
}

function strictTimestamp(value: string, field: string): string {
  const parsed = new Date(value)
  if (!value || Number.isNaN(parsed.getTime())) throw new Error(`invalid_${field}`)
  return parsed.toISOString()
}

function readText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

async function resolveMeteringPoint(input: NormalizedMeteringValueInput): Promise<{
  meteringPointId: string | null
  customerId: string | null
  siteId: string | null
  customerSiteId: string | null
  warnings: string[]
}> {
  const warnings: string[] = []
  const explicitPoint = nonEmpty(input.meteringPointId)
  const facilityId = nonEmpty(input.facilityId)

  let query = supabaseService
    .from('metering_points')
    .select('id,company_id,customer_id,site_id,customer_site_id,meter_point_id,metering_point_id,normalized_metering_point_id,facility_id,site_facility_id,status')
    .eq('company_id', input.companyId)
    .limit(3)

  if (explicitPoint) {
    query = query.eq('id', explicitPoint)
  } else if (facilityId) {
    const escaped = facilityId.replace(/"/g, '\\"')
    query = query.or([
      `meter_point_id.eq.${escaped}`,
      `metering_point_id.eq.${escaped}`,
      `normalized_metering_point_id.eq.${escaped}`,
      `facility_id.eq.${escaped}`,
      `site_facility_id.eq.${escaped}`,
    ].join(','))
  } else {
    return { meteringPointId: null, customerId: null, siteId: null, customerSiteId: null, warnings: ['Varken kanoniskt mätpunkts-id eller anläggnings-id finns i mätdata.'] }
  }

  const { data, error } = await query
  if (error) throw error
  const rows = (data ?? []) as Array<Record<string, unknown>>
  if (rows.length === 0) return { meteringPointId: null, customerId: null, siteId: null, customerSiteId: null, warnings: ['Mätpunkt hittades inte entydigt inom bolaget.'] }
  if (rows.length > 1) return { meteringPointId: null, customerId: null, siteId: null, customerSiteId: null, warnings: ['Identifieraren matchade flera mätpunkter inom bolaget.'] }

  const row = rows[0]
  const canonicalCustomerId = readText(row.customer_id)
  const canonicalSiteId = readText(row.site_id)
  const canonicalCustomerSiteId = readText(row.customer_site_id)
  if (!canonicalCustomerId) {
    return { meteringPointId: null, customerId: null, siteId: null, customerSiteId: null, warnings: ['Mätpunkten saknar kanonisk kundkoppling.'] }
  }
  if (input.customerId && input.customerId !== canonicalCustomerId) {
    return { meteringPointId: null, customerId: null, siteId: null, customerSiteId: null, warnings: ['Angiven kund tillhör inte den kanoniska mätpunkten.'] }
  }
  if (input.siteId && canonicalSiteId && input.siteId !== canonicalSiteId) {
    return { meteringPointId: null, customerId: null, siteId: null, customerSiteId: null, warnings: ['Angiven anläggning tillhör inte den kanoniska mätpunkten.'] }
  }
  if (input.customerSiteId && canonicalCustomerSiteId && input.customerSiteId !== canonicalCustomerSiteId) {
    return { meteringPointId: null, customerId: null, siteId: null, customerSiteId: null, warnings: ['Angiven customer_site tillhör inte den kanoniska mätpunkten.'] }
  }

  return {
    meteringPointId: String(row.id),
    customerId: canonicalCustomerId,
    siteId: canonicalSiteId ?? canonicalCustomerSiteId,
    customerSiteId: canonicalCustomerSiteId ?? canonicalSiteId,
    warnings,
  }
}

function canonicalKey(input: NormalizedMeteringValueInput, meteringPointId: string, periodStart: string, periodEnd: string): string {
  return [
    input.companyId,
    meteringPointId,
    periodStart,
    periodEnd,
    nonEmpty(input.registerCode) ?? 'default-register',
    nonEmpty(input.productCode) ?? 'default-product',
    input.direction ?? (input.readingType === 'production' ? 'production' : 'consumption'),
    input.unit ?? 'kWh',
  ].join('|')
}

/**
 * Legacy compatibility only. New ingestion paths must use normalizeAndStoreMeteringValue,
 * which writes both representations in one database transaction.
 */
export async function projectMeteringValueToNormalized(input: {
  companyId: string
  meteringValueId: string
}): Promise<{ status: 'stored' | 'duplicate' | 'skipped'; normalizedMeteringValueId?: string | null }> {
  await assertPlatformSchemaReady()
  const { data, error } = await supabaseService
    .from('normalized_metering_values')
    .select('id')
    .eq('company_id', input.companyId)
    .eq('source_metering_value_id', input.meteringValueId)
    .eq('revision_status', 'current')
    .limit(2)
  if (error) throw error
  if ((data ?? []).length > 1) throw new Error('normalized_metering_projection_ambiguous')
  const id = readText((data?.[0] as Record<string, unknown> | undefined)?.id)
  return id ? { status: 'duplicate', normalizedMeteringValueId: id } : { status: 'skipped' }
}

export async function normalizeAndStoreMeteringValue(input: NormalizedMeteringValueInput): Promise<NormalizeResult> {
  await assertPlatformSchemaReady()
  const warnings: string[] = []
  if (!input.companyId) return { status: 'needs_review', reason: 'company_id saknas.', warnings }
  if (!Number.isFinite(input.quantityKwh)) return { status: 'needs_review', reason: 'kWh-värde saknas eller är ogiltigt.', warnings }

  let periodStart: string
  let periodEnd: string
  try {
    periodStart = strictTimestamp(input.periodStart, 'period_start')
    periodEnd = strictTimestamp(input.periodEnd, 'period_end')
  } catch (error) {
    return { status: 'needs_review', reason: error instanceof Error ? error.message : 'invalid_metering_period', warnings }
  }
  if (periodStart >= periodEnd) return { status: 'needs_review', reason: 'Mätperiodens slut måste ligga efter start.', warnings }

  const resolved = await resolveMeteringPoint(input)
  warnings.push(...resolved.warnings)
  if (!resolved.meteringPointId || !resolved.customerId) {
    return { status: 'needs_review', reason: warnings[0] ?? 'Mätpunkt kunde inte matchas säkert.', warnings }
  }

  const priceArea = isPriceArea(input.priceArea ?? undefined) ? input.priceArea : null
  const direction = input.direction ?? (input.readingType === 'production' ? 'production' : 'consumption')
  const unit = input.unit ?? 'kWh'
  const dedupeKey = canonicalKey(input, resolved.meteringPointId, periodStart, periodEnd)

  const { data, error } = await supabaseService.rpc('gridex_ingest_metering_value_atomic', {
    p_payload: {
      company_id: input.companyId,
      customer_id: resolved.customerId,
      site_id: resolved.siteId,
      customer_site_id: resolved.customerSiteId,
      metering_point_id: resolved.meteringPointId,
      facility_id: input.facilityId ?? null,
      grid_owner_id: input.gridOwnerId ?? null,
      source_request_id: input.sourceRequestId ?? null,
      reading_type: input.readingType ?? (direction.includes('production') ? 'production' : 'consumption'),
      direction,
      unit,
      value_kwh: input.quantityKwh,
      quality_code: input.qualityStatus ?? null,
      read_at: strictTimestamp(input.readAt ?? periodEnd, 'read_at'),
      period_start: periodStart,
      period_end: periodEnd,
      source_system: input.sourceType,
      source_ediel_message_id: input.sourceMessageId ?? null,
      source_transaction_reference: input.sourceTransactionReference ?? null,
      source_line_reference: input.sourceLineReference ?? null,
      price_area: priceArea,
      grid_area: input.gridArea ?? null,
      resolution: input.resolution ?? null,
      register_code: input.registerCode ?? null,
      product_code: input.productCode ?? null,
      canonical_dedupe_key: dedupeKey,
      correction_reason: input.correctionReason ?? null,
      raw_payload: input.rawPayload ?? {},
      created_by: input.createdBy ?? null,
    },
  })
  if (error) throw error
  const meterValue = data as MeteringValueRow | null
  if (!meterValue?.id) throw new Error('atomic_metering_ingest_missing_result')

  const { data: normalizedRows, error: normalizedError } = await supabaseService
    .from('normalized_metering_values')
    .select('id')
    .eq('company_id', input.companyId)
    .eq('source_metering_value_id', meterValue.id)
    .eq('revision_status', 'current')
    .limit(2)
  if (normalizedError) throw normalizedError
  if ((normalizedRows ?? []).length !== 1) throw new Error('atomic_metering_projection_missing_or_ambiguous')
  const normalizedMeteringValueId = String((normalizedRows as Array<{ id: string }>)[0].id)

  await emitDomainEvent({
    companyId: input.companyId,
    eventType: 'metering_values.updated',
    aggregateType: 'metering_point',
    aggregateId: resolved.meteringPointId,
    subjectCustomerId: resolved.customerId,
    actorUserId: input.createdBy ?? null,
    source: input.sourceType,
    payload: {
      metering_value_id: meterValue.id,
      normalized_metering_value_id: normalizedMeteringValueId,
      metering_point_id: resolved.meteringPointId,
      customer_site_id: resolved.customerSiteId,
      facility_id: input.facilityId ?? null,
      price_area: priceArea,
      period_start: periodStart,
      period_end: periodEnd,
      resolution: input.resolution ?? null,
      quantity_kwh: input.quantityKwh,
      source_type: input.sourceType,
      direction,
      unit,
      register_code: input.registerCode ?? null,
      product_code: input.productCode ?? null,
      revision_number: meterValue.revision_number ?? 1,
      status: 'stored',
    },
    idempotencyKey: `metering-values-updated:${meterValue.id}`,
  })

  return { status: 'stored', meteringValueId: meterValue.id, normalizedMeteringValueId, meteringValue: meterValue, warnings }
}
