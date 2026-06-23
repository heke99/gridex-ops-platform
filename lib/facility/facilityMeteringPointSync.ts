import { supabaseService } from '@/lib/supabase/service'

type JsonRecord = Record<string, unknown>

type UpsertFacilityMeteringPointInput = {
  companyId: string
  customerId: string
  customerSiteId: string
  gridOwnerId?: string | null
  facilityId?: string | null
  meteringPointId?: string | null
  gridAreaCode?: string | null
  priceAreaCode?: string | null
  actorUserId?: string | null
  source?: 'manual' | 'ediel_inbound' | 'system'
  rawPayload?: JsonRecord | null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function isMissingSchema(error: unknown): boolean {
  const code = String((error as { code?: unknown } | null)?.code ?? '')
  const message = String((error as { message?: unknown } | null)?.message ?? '')
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code) || /schema cache|does not exist|column .* does not exist/i.test(message)
}

function normalizeStatus(value: unknown): string {
  const raw = String(value ?? '').toLowerCase()
  return raw === 'verified' ? 'active' : raw || 'active'
}

async function findExisting(input: UpsertFacilityMeteringPointInput): Promise<JsonRecord | null> {
  const meter = text(input.meteringPointId)
  const facility = text(input.facilityId)

  let base = supabaseService
    .from('metering_points')
    .select('*')
    .eq('company_id', input.companyId)
    .limit(10)

  const { data, error } = await base
  if (error) {
    if (isMissingSchema(error)) return null
    throw error
  }

  const rows = ((data ?? []) as JsonRecord[]).filter((row) => {
    const siteMatches = row.site_id === input.customerSiteId || row.customer_site_id === input.customerSiteId
    const customerMatches = !row.customer_id || row.customer_id === input.customerId
    if (!siteMatches || !customerMatches) return false
    const ids = [
      row.id,
      row.meter_point_id,
      row.metering_point_id,
      row.ediel_metering_point_id,
      row.ediel_reference,
      row.facility_id,
      row.site_facility_id,
    ].map(text)
    return Boolean((meter && ids.includes(meter)) || (facility && ids.includes(facility)))
  })

  return rows[0] ?? null
}

function buildBasePayload(input: UpsertFacilityMeteringPointInput): JsonRecord {
  const now = new Date().toISOString()
  const meter = text(input.meteringPointId)
  const facility = text(input.facilityId)
  return {
    company_id: input.companyId,
    customer_id: input.customerId,
    site_id: input.customerSiteId,
    customer_site_id: input.customerSiteId,
    meter_point_id: meter,
    metering_point_id: meter,
    ediel_metering_point_id: meter,
    ediel_reference: meter,
    facility_id: facility,
    site_facility_id: facility,
    grid_owner_id: text(input.gridOwnerId),
    grid_area_code: text(input.gridAreaCode),
    price_area_code: text(input.priceAreaCode),
    status: 'active',
    measurement_type: 'consumption',
    reading_frequency: 'manual',
    facility_data_verified_at: now,
    data_quality_status: 'verified',
    verification_status: 'verified',
    metadata: {
      source: input.source ?? 'system',
      facility_lookup_sync: true,
      raw_payload: input.rawPayload ?? null,
    },
    updated_at: now,
    updated_by: text(input.actorUserId),
  }
}

async function safeUpdate(id: string, payload: JsonRecord): Promise<JsonRecord | null> {
  const variants: JsonRecord[] = [
    payload,
    Object.fromEntries(Object.entries(payload).filter(([key]) => !['customer_site_id', 'ediel_metering_point_id', 'metadata', 'data_quality_status', 'verification_status'].includes(key))),
    Object.fromEntries(Object.entries(payload).filter(([key]) => ['company_id', 'customer_id', 'site_id', 'meter_point_id', 'ediel_reference', 'site_facility_id', 'grid_owner_id', 'grid_area_code', 'price_area_code', 'status', 'facility_data_verified_at', 'updated_at', 'updated_by'].includes(key))),
  ]

  for (const variant of variants) {
    const { data, error } = await supabaseService
      .from('metering_points')
      .update(variant)
      .eq('id', id)
      .select('*')
      .maybeSingle()
    if (!error) return (data as JsonRecord | null) ?? null
    if (!isMissingSchema(error)) throw error
  }
  return null
}

async function safeInsert(payload: JsonRecord): Promise<JsonRecord | null> {
  const variants: JsonRecord[] = [
    payload,
    Object.fromEntries(Object.entries(payload).filter(([key]) => !['customer_site_id', 'ediel_metering_point_id', 'metadata', 'data_quality_status', 'verification_status'].includes(key))),
    Object.fromEntries(Object.entries(payload).filter(([key]) => ['company_id', 'customer_id', 'site_id', 'meter_point_id', 'ediel_reference', 'site_facility_id', 'grid_owner_id', 'grid_area_code', 'price_area_code', 'status', 'measurement_type', 'reading_frequency', 'facility_data_verified_at', 'updated_at', 'updated_by'].includes(key))),
  ]

  for (const variant of variants) {
    const { data, error } = await supabaseService
      .from('metering_points')
      .insert({ ...variant, created_at: new Date().toISOString() })
      .select('*')
      .maybeSingle()
    if (!error) return (data as JsonRecord | null) ?? null
    const code = String((error as { code?: unknown }).code ?? '')
    if (code === '23505') return null
    if (!isMissingSchema(error)) throw error
  }
  return null
}

export async function upsertFacilityMeteringPoint(input: UpsertFacilityMeteringPointInput): Promise<{ row: JsonRecord | null; id: string | null; created: boolean }> {
  const meter = text(input.meteringPointId)
  const facility = text(input.facilityId)
  if (!meter && !facility) return { row: null, id: null, created: false }

  const existing = await findExisting(input)
  const payload = buildBasePayload(input)

  if (existing?.id) {
    const row = await safeUpdate(String(existing.id), payload)
    return { row, id: text(row?.id) ?? String(existing.id), created: false }
  }

  const row = await safeInsert(payload)
  return { row, id: text(row?.id), created: Boolean(row?.id) }
}

export function hasVerifiedMeteringPointIdentity(row: JsonRecord | null): boolean {
  if (!row) return false
  return Boolean(text(row.meter_point_id) ?? text(row.metering_point_id) ?? text(row.ediel_reference) ?? text(row.ediel_metering_point_id))
}

export function normalizeMeteringPointStatus(row: JsonRecord | null): string | null {
  return row ? normalizeStatus(row.status) : null
}
