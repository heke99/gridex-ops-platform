import { supabaseService } from '@/lib/supabase/service'
import { emitDomainEvent } from '@/lib/events/domainEvents'
import { isPriceArea, type PriceArea } from '@/lib/pricing/types'

export type NormalizedMeteringValueInput = {
  companyId: string
  customerId?: string | null
  customerSiteId?: string | null
  siteId?: string | null
  meteringPointId?: string | null
  facilityId?: string | null
  priceArea?: PriceArea | string | null
  gridArea?: string | null
  periodStart: string
  periodEnd: string
  resolution?: string | null
  quantityKwh: number
  qualityStatus?: string | null
  sourceType: 'ediel_utilts' | 'brp_import' | 'manual' | 'api' | string
  sourceMessageId?: string | null
  sourceTransactionReference?: string | null
  sourceLineReference?: string | null
  rawPayload?: Record<string, unknown>
  createdBy?: string | null
}

export type NormalizeResult =
  | { status: 'stored'; meteringValueId: string; normalizedMeteringValueId?: string | null; warnings: string[] }
  | { status: 'needs_review' | 'blocked_duplicate'; warnings: string[]; reason: string }

function nonEmpty(value: string | null | undefined): string | null {
  return value && value.trim() ? value.trim() : null
}

async function resolveMeteringPoint(input: NormalizedMeteringValueInput): Promise<{ meteringPointId: string | null; customerId: string | null; siteId: string | null; customerSiteId: string | null; warnings: string[] }> {
  const warnings: string[] = []
  const explicitPoint = nonEmpty(input.meteringPointId)
  if (explicitPoint) {
    const { data, error } = await supabaseService
      .from('metering_points')
      .select('id, customer_id, site_id, customer_site_id, price_area, grid_area')
      .eq('company_id', input.companyId)
      .eq('id', explicitPoint)
      .maybeSingle()
    if (error && error.code !== 'PGRST116') throw error
    if (!data) return { meteringPointId: null, customerId: null, siteId: null, customerSiteId: null, warnings: ['Mätpunkt hittades inte inom bolaget.'] }
    const row = data as Record<string, unknown>
    return {
      meteringPointId: String(row.id),
      customerId: nonEmpty(input.customerId) ?? (typeof row.customer_id === 'string' ? row.customer_id : null),
      siteId: nonEmpty(input.siteId) ?? (typeof row.site_id === 'string' ? row.site_id : null),
      customerSiteId: nonEmpty(input.customerSiteId) ?? (typeof row.customer_site_id === 'string' ? row.customer_site_id : null),
      warnings,
    }
  }

  const facilityId = nonEmpty(input.facilityId)
  if (!facilityId) {
    return { meteringPointId: null, customerId: null, siteId: null, customerSiteId: null, warnings: ['Varken mätpunkt eller anläggnings-id finns i mätdata.'] }
  }

  const { data, error } = await supabaseService
    .from('metering_points')
    .select('id, customer_id, site_id, customer_site_id')
    .eq('company_id', input.companyId)
    .or(`meter_point_id.eq.${facilityId},metering_point_id.eq.${facilityId},facility_id.eq.${facilityId}`)
    .limit(2)
  if (error) throw error

  const rows = (data ?? []) as Record<string, unknown>[]
  if (rows.length === 0) return { meteringPointId: null, customerId: null, siteId: null, customerSiteId: null, warnings: ['Anläggning kunde inte matchas till unik mätpunkt inom bolaget.'] }
  if (rows.length > 1) return { meteringPointId: null, customerId: null, siteId: null, customerSiteId: null, warnings: ['Anläggnings-id matchade flera mätpunkter inom bolaget.'] }

  const row = rows[0]
  return {
    meteringPointId: String(row.id),
    customerId: nonEmpty(input.customerId) ?? (typeof row.customer_id === 'string' ? row.customer_id : null),
    siteId: nonEmpty(input.siteId) ?? (typeof row.site_id === 'string' ? row.site_id : null),
    customerSiteId: nonEmpty(input.customerSiteId) ?? (typeof row.customer_site_id === 'string' ? row.customer_site_id : null),
    warnings,
  }
}

// Projects an already-ingested metering_values row into normalized_metering_values
// without re-writing metering_values. Used by the inbound UTILTS path (which writes
// metering_values via ingestMeteringValue) so billing underlay generation — which
// prefers normalized rows — sees UTILTS data. Idempotent: duplicate rows (unique
// dedupe index) are ignored, so re-processing the same UTILTS message never double
// counts consumption.
export async function projectMeteringValueToNormalized(input: {
  companyId: string
  meteringValueId: string
  customerId?: string | null
  customerSiteId?: string | null
  siteId?: string | null
  meteringPointId: string
  facilityId?: string | null
  priceArea?: PriceArea | string | null
  gridArea?: string | null
  periodStart: string | null
  periodEnd: string | null
  resolution?: string | null
  quantityKwh: number
  qualityStatus?: string | null
  sourceType: 'ediel_utilts' | 'brp_import' | 'manual' | 'api' | string
  sourceMessageId?: string | null
  sourceTransactionReference?: string | null
  sourceLineReference?: string | null
  rawPayload?: Record<string, unknown>
  createdBy?: string | null
}): Promise<{ status: 'stored' | 'duplicate' | 'skipped'; normalizedMeteringValueId?: string | null }> {
  if (!input.companyId || !nonEmpty(input.meteringPointId)) return { status: 'skipped' }
  if (!Number.isFinite(input.quantityKwh)) return { status: 'skipped' }
  const periodStart = nonEmpty(input.periodStart)
  const periodEnd = nonEmpty(input.periodEnd)
  if (!periodStart || !periodEnd) return { status: 'skipped' }
  const priceArea = isPriceArea(input.priceArea ?? undefined) ? input.priceArea : null

  const { data, error } = await supabaseService
    .from('normalized_metering_values')
    .insert({
      company_id: input.companyId,
      customer_id: input.customerId ?? null,
      customer_site_id: input.customerSiteId ?? null,
      site_id: input.siteId ?? null,
      metering_point_id: input.meteringPointId,
      facility_id: input.facilityId ?? null,
      price_area: priceArea,
      grid_area: input.gridArea ?? null,
      period_start: periodStart,
      period_end: periodEnd,
      resolution: input.resolution ?? null,
      quantity_kwh: input.quantityKwh,
      quality_status: input.qualityStatus ?? null,
      source_type: input.sourceType,
      source_message_id: input.sourceMessageId ?? null,
      source_transaction_reference: input.sourceTransactionReference ?? null,
      source_line_reference: input.sourceLineReference ?? null,
      source_metering_value_id: input.meteringValueId,
      raw_payload: input.rawPayload ?? {},
      status: 'stored',
      created_by: input.createdBy ?? null,
    })
    .select('id')
    .single()

  if (error) {
    // 23505 = unique violation (duplicate already normalized) → idempotent no-op.
    const code = String((error as { code?: unknown }).code ?? '')
    if (code === '23505') return { status: 'duplicate' }
    // Missing table/column (older schema) → skip silently; metering_values still saved.
    if (['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code)) return { status: 'skipped' }
    throw error
  }

  return { status: 'stored', normalizedMeteringValueId: (data as { id: string }).id }
}

export async function normalizeAndStoreMeteringValue(input: NormalizedMeteringValueInput): Promise<NormalizeResult> {
  const warnings: string[] = []
  if (!input.companyId) return { status: 'needs_review', reason: 'company_id saknas.', warnings }
  if (!Number.isFinite(input.quantityKwh)) return { status: 'needs_review', reason: 'kWh-värde saknas eller är ogiltigt.', warnings }

  const resolved = await resolveMeteringPoint(input)
  warnings.push(...resolved.warnings)
  if (!resolved.meteringPointId) {
    return { status: 'needs_review', reason: warnings[0] ?? 'Mätpunkt kunde inte matchas säkert.', warnings }
  }

  const priceArea = isPriceArea(input.priceArea ?? undefined) ? input.priceArea : null
  const canonicalDedupeKey = [
    input.companyId,
    resolved.meteringPointId,
    input.periodStart,
    input.periodEnd,
    input.sourceType,
    nonEmpty(input.sourceTransactionReference) ?? nonEmpty(input.sourceLineReference) ?? 'no-source-ref',
  ].join('|')

  const { data: existing, error: existingError } = await supabaseService
    .from('metering_values')
    .select('id')
    .eq('company_id', input.companyId)
    .eq('canonical_dedupe_key', canonicalDedupeKey)
    .maybeSingle()
  if (existingError && existingError.code !== 'PGRST116') throw existingError
  if (existing) return { status: 'blocked_duplicate', reason: 'Mätvärdet finns redan för samma mätpunkt och period.', warnings }

  const { data: meterValue, error } = await supabaseService
    .from('metering_values')
    .insert({
      company_id: input.companyId,
      customer_id: resolved.customerId,
      site_id: resolved.siteId ?? resolved.customerSiteId,
      customer_site_id: resolved.customerSiteId,
      metering_point_id: resolved.meteringPointId,
      reading_type: 'consumption',
      value_kwh: input.quantityKwh,
      quality_code: input.qualityStatus ?? null,
      read_at: input.periodEnd,
      period_start: input.periodStart,
      period_end: input.periodEnd,
      source_system: input.sourceType,
      raw_payload: {
        ...(input.rawPayload ?? {}),
        facility_id: input.facilityId ?? null,
        price_area: priceArea,
        grid_area: input.gridArea ?? null,
        resolution: input.resolution ?? null,
        source_transaction_reference: input.sourceTransactionReference ?? null,
        source_line_reference: input.sourceLineReference ?? null,
      },
      source_ediel_message_id: input.sourceMessageId ?? null,
      canonical_dedupe_key: canonicalDedupeKey,
      created_by: input.createdBy ?? null,
    })
    .select('id')
    .single()
  if (error) throw error

  let normalizedId: string | null = null
  const { data: normalized, error: normalizedError } = await supabaseService
    .from('normalized_metering_values')
    .insert({
      company_id: input.companyId,
      customer_id: resolved.customerId,
      customer_site_id: resolved.customerSiteId,
      site_id: resolved.siteId,
      metering_point_id: resolved.meteringPointId,
      facility_id: input.facilityId ?? null,
      price_area: priceArea,
      grid_area: input.gridArea ?? null,
      period_start: input.periodStart,
      period_end: input.periodEnd,
      resolution: input.resolution ?? null,
      quantity_kwh: input.quantityKwh,
      quality_status: input.qualityStatus ?? null,
      source_type: input.sourceType,
      source_message_id: input.sourceMessageId ?? null,
      source_transaction_reference: input.sourceTransactionReference ?? null,
      source_line_reference: input.sourceLineReference ?? null,
      source_metering_value_id: (meterValue as { id: string }).id,
      raw_payload: input.rawPayload ?? {},
      status: 'stored',
      created_by: input.createdBy ?? null,
    })
    .select('id')
    .single()

  if (!normalizedError) normalizedId = (normalized as { id: string }).id
  else warnings.push('Mätvärdet sparades i metering_values men inte i normalized_metering_values. Kontrollera att senaste migrationen är körd.')

  await emitDomainEvent({
    companyId: input.companyId,
    eventType: 'metering_values.updated',
    aggregateType: 'metering_point',
    aggregateId: resolved.meteringPointId,
    subjectCustomerId: resolved.customerId,
    actorUserId: input.createdBy ?? null,
    source: input.sourceType,
    payload: {
      metering_value_id: (meterValue as { id: string }).id,
      normalized_metering_value_id: normalizedId,
      metering_point_id: resolved.meteringPointId,
      customer_site_id: resolved.customerSiteId,
      facility_id: input.facilityId ?? null,
      price_area: priceArea,
      period_start: input.periodStart,
      period_end: input.periodEnd,
      resolution: input.resolution ?? null,
      quantity_kwh: input.quantityKwh,
      source_type: input.sourceType,
      status: 'stored',
    },
    idempotencyKey: `metering-values-updated:${(meterValue as { id: string }).id}`,
  }).catch(() => null)

  return { status: 'stored', meteringValueId: (meterValue as { id: string }).id, normalizedMeteringValueId: normalizedId, warnings }
}
