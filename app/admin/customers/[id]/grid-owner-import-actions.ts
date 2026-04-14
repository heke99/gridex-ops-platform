'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { ingestBillingUnderlay, ingestMeteringValue } from '@/lib/cis/db'
import { supabaseService } from '@/lib/supabase/service'

type ImportMode = 'meter_values' | 'billing_underlay'

type ParsedRow = Record<string, string>

function getString(formData: FormData, key: string): string {
  return String(formData.get(key) ?? '').trim()
}

function getNullableString(formData: FormData, key: string): string | null {
  const value = getString(formData, key)
  return value || null
}

function normalizeNumber(value: string | null | undefined): number | null {
  if (!value?.trim()) return null
  const parsed = Number(value.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeInteger(value: string | null | undefined): number | null {
  if (!value?.trim()) return null
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeReadingType(
  value: string | null | undefined
): 'consumption' | 'production' | 'estimated' | 'adjustment' {
  if (value === 'production') return 'production'
  if (value === 'estimated') return 'estimated'
  if (value === 'adjustment') return 'adjustment'
  return 'consumption'
}

function normalizeBillingStatus(
  value: string | null | undefined
): 'pending' | 'received' | 'validated' | 'exported' | 'failed' {
  if (value === 'pending') return 'pending'
  if (value === 'validated') return 'validated'
  if (value === 'exported') return 'exported'
  if (value === 'failed') return 'failed'
  return 'received'
}

function normalizeImportMode(value: string | null | undefined): ImportMode {
  return value === 'billing_underlay' ? 'billing_underlay' : 'meter_values'
}

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim()) ?? ''
  if (firstLine.includes('\t')) return '\t'
  if (firstLine.includes(';')) return ';'
  return ','
}

function parseDelimitedRows(text: string): ParsedRow[] {
  const delimiter = detectDelimiter(text)
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length < 2) return []

  const headers = lines[0].split(delimiter).map((part) => part.trim())

  return lines.slice(1).map((line) => {
    const cols = line.split(delimiter)
    const row: ParsedRow = {}

    headers.forEach((header, index) => {
      row[header] = String(cols[index] ?? '').trim()
    })

    return row
  })
}

function parseJsonRows(text: string): ParsedRow[] {
  const raw = JSON.parse(text) as unknown

  if (!Array.isArray(raw)) {
    throw new Error('JSON-filen måste innehålla en array av objekt')
  }

  return raw.map((entry) => {
    const record = entry as Record<string, unknown>
    const row: ParsedRow = {}

    Object.entries(record).forEach(([key, value]) => {
      row[key] = value === null || value === undefined ? '' : String(value)
    })

    return row
  })
}

async function getActorUserId(): Promise<string> {
  await requireAdminActionAccess(['metering.write'])

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error('Unauthorized')
  }

  return user.id
}

async function insertAuditLog(params: {
  actorUserId: string
  entityType: string
  entityId: string
  action: string
  oldValues?: unknown
  newValues?: unknown
  metadata?: unknown
}) {
  const { error } = await supabaseService.from('audit_logs').insert({
    actor_user_id: params.actorUserId,
    entity_type: params.entityType,
    entity_id: params.entityId,
    action: params.action,
    old_values: params.oldValues ?? null,
    new_values: params.newValues ?? null,
    metadata: params.metadata ?? null,
  })

  if (error) throw error
}

async function resolveCustomerContext(customerId: string) {
  const [{ data: sites, error: sitesError }, { data: points, error: pointsError }] =
    await Promise.all([
      supabaseService
        .from('customer_sites')
        .select('id, facility_id, site_name, grid_owner_id')
        .eq('customer_id', customerId),
      supabaseService
        .from('metering_points')
        .select('id, site_id, meter_point_id, grid_owner_id')
        .eq('customer_id', customerId as never)
        .limit(0),
    ])

  if (sitesError) throw sitesError

  const siteRows = (sites ?? []) as Array<{
    id: string
    facility_id: string | null
    site_name: string
    grid_owner_id: string | null
  }>

  let pointRows:
    | Array<{
        id: string
        site_id: string
        meter_point_id: string
        grid_owner_id: string | null
      }>
    | null = null

  if (pointsError) {
    const siteIds = siteRows.map((site) => site.id)
    if (siteIds.length === 0) {
      pointRows = []
    } else {
      const { data: pointsBySite, error: pointsBySiteError } = await supabaseService
        .from('metering_points')
        .select('id, site_id, meter_point_id, grid_owner_id')
        .in('site_id', siteIds)

      if (pointsBySiteError) throw pointsBySiteError

      pointRows = (pointsBySite ?? []) as Array<{
        id: string
        site_id: string
        meter_point_id: string
        grid_owner_id: string | null
      }>
    }
  } else {
    pointRows = (points ?? []) as Array<{
      id: string
      site_id: string
      meter_point_id: string
      grid_owner_id: string | null
    }>
  }

  return {
    sites: siteRows,
    points: pointRows,
  }
}

function pickValue(row: ParsedRow, keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key]
    if (value && value.trim()) return value.trim()
  }
  return null
}

export async function importGridOwnerFileAction(formData: FormData): Promise<void> {
  const actorUserId = await getActorUserId()

  const customerId = getString(formData, 'customer_id')
  const mode = normalizeImportMode(getNullableString(formData, 'import_mode'))
  const file = formData.get('file')

  if (!customerId) {
    throw new Error('customer_id saknas')
  }

  if (!(file instanceof File)) {
    throw new Error('Ingen fil laddades upp')
  }

  const text = await file.text()
  if (!text.trim()) {
    throw new Error('Filen är tom')
  }

  const rows =
    file.name.toLowerCase().endsWith('.json') || text.trim().startsWith('[')
      ? parseJsonRows(text)
      : parseDelimitedRows(text)

  if (rows.length === 0) {
    throw new Error('Filen innehåller inga tolkningsbara datarader')
  }

  const context = await resolveCustomerContext(customerId)

  const siteById = new Map(context.sites.map((site) => [site.id, site]))
  const siteByFacilityId = new Map(
    context.sites
      .filter((site) => site.facility_id)
      .map((site) => [String(site.facility_id), site])
  )

  const pointById = new Map(context.points.map((point) => [point.id, point]))
  const pointByMeterPointId = new Map(
    context.points.map((point) => [point.meter_point_id, point])
  )

  let imported = 0
  const errors: string[] = []

  for (const [index, row] of rows.entries()) {
    try {
      const fileMeterPointId = pickValue(row, [
        'meter_point_id',
        'metering_point_id',
        'ean',
        'ean_id',
      ])

      const fileSiteId = pickValue(row, ['site_id'])
      const fileFacilityId = pickValue(row, ['facility_id', 'anlaggnings_id'])

      const point =
        (fileMeterPointId
          ? pointByMeterPointId.get(fileMeterPointId) ?? pointById.get(fileMeterPointId)
          : null) ?? null

      const site =
        (fileSiteId ? siteById.get(fileSiteId) : null) ??
        (fileFacilityId ? siteByFacilityId.get(fileFacilityId) : null) ??
        (point ? siteById.get(point.site_id) : null) ??
        null

      if (mode === 'meter_values') {
        if (!point) {
          throw new Error('Kunde inte mappa mätpunkten från filraden')
        }

        const valueKwh = normalizeNumber(
          pickValue(row, ['value_kwh', 'kwh', 'value', 'meter_value_kwh'])
        )

        if (valueKwh === null) {
          throw new Error('value_kwh saknas eller är ogiltigt')
        }

        await ingestMeteringValue({
          actorUserId,
          customerId,
          siteId: site?.id ?? null,
          meteringPointId: point.id,
          sourceRequestId: pickValue(row, ['source_request_id', 'request_id']),
          gridOwnerId:
            pickValue(row, ['grid_owner_id']) ??
            point.grid_owner_id ??
            site?.grid_owner_id ??
            null,
          readingType: normalizeReadingType(
            pickValue(row, ['reading_type', 'type', 'reading'])
          ),
          valueKwh,
          qualityCode: pickValue(row, ['quality_code', 'quality']),
          readAt:
            pickValue(row, ['read_at', 'reading_at', 'timestamp']) ??
            new Date().toISOString(),
          periodStart: pickValue(row, ['period_start', 'from']),
          periodEnd: pickValue(row, ['period_end', 'to']),
          sourceSystem: 'grid_owner_file',
          rawPayload: row,
        })
      } else {
        await ingestBillingUnderlay({
          actorUserId,
          customerId,
          siteId: site?.id ?? null,
          meteringPointId: point?.id ?? null,
          sourceRequestId: pickValue(row, ['source_request_id', 'request_id']),
          gridOwnerId:
            pickValue(row, ['grid_owner_id']) ??
            point?.grid_owner_id ??
            site?.grid_owner_id ??
            null,
          underlayMonth: normalizeInteger(
            pickValue(row, ['underlay_month', 'month'])
          ),
          underlayYear: normalizeInteger(
            pickValue(row, ['underlay_year', 'year'])
          ),
          status: normalizeBillingStatus(
            pickValue(row, ['status', 'underlay_status'])
          ),
          totalKwh: normalizeNumber(
            pickValue(row, ['total_kwh', 'kwh', 'consumption_kwh'])
          ),
          totalSekExVat: normalizeNumber(
            pickValue(row, ['total_sek_ex_vat', 'sek_ex_vat', 'amount_ex_vat'])
          ),
          currency: pickValue(row, ['currency']) ?? 'SEK',
          sourceSystem: 'grid_owner_file',
          payload: row,
          failureReason: pickValue(row, ['failure_reason']),
        })
      }

      imported += 1
    } catch (error) {
      errors.push(
        `Rad ${index + 2}: ${error instanceof Error ? error.message : 'Okänt fel'}`
      )
    }
  }

  await insertAuditLog({
    actorUserId,
    entityType: 'grid_owner_file_import',
    entityId: customerId,
    action: 'grid_owner_file_import_completed',
    metadata: {
      customerId,
      mode,
      fileName: file.name,
      totalRows: rows.length,
      imported,
      failed: errors.length,
      firstError: errors[0] ?? null,
    },
  })

  revalidatePath(`/admin/customers/${customerId}`)
  revalidatePath(`/admin/customers/${customerId}/imports`)
  revalidatePath('/admin/billing')
  revalidatePath('/admin/metering')

  if (errors.length > 0) {
    throw new Error(
      `Import klar med ${imported} importerade rader och ${errors.length} fel. ${errors[0]}`
    )
  }
}