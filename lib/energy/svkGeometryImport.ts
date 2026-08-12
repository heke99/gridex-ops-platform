import { supabaseService } from '@/lib/supabase/service'

export const DEFAULT_SVK_GRID_AREA_SERVICE_URL = 'https://services2.arcgis.com/L8WLzcxhwLqd80Jx/ArcGIS/rest/services/Natomraden_250526/FeatureServer'
export const DEFAULT_SVK_GRID_AREA_LAYER_ID = 3
const ALLOWED_ORIGIN = 'https://services2.arcgis.com'
const ALLOWED_PATH_PREFIX = '/L8WLzcxhwLqd80Jx/arcgis/rest/services/'
export const SVK_IMPORT_PAGE_SIZE = 250

export type SvkImportResult = {
  ok: boolean
  runId: string | null
  seen: number
  upserted: number
  errors: string[]
  nextOffset: number | null
  hasMore: boolean
  geodataVersion: string
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

type SvkErrorDetails = {
  message: string
  code: string | null
  details: string | null
  hint: string | null
}

export function serializeSvkImportError(error: unknown): SvkErrorDetails {
  const value = error && typeof error === 'object' ? error as Record<string, unknown> : {}
  return {
    message: clean(value.message) ?? (error instanceof Error ? error.message : 'svk_geometry_import_failed'),
    code: clean(value.code),
    details: clean(value.details),
    hint: clean(value.hint),
  }
}

const SVK_FIELD_ALIASES = {
  gridAreaCode: ['Natomrade', 'NATOMRADE', 'natomrade', 'NATOMRADESKOD', 'NÄTOMRÅDESKOD', 'grid_area_code'],
  gridAreaName: ['Namn', 'NAMN', 'namn', 'NATOMRADESNAMN', 'NÄTOMRÅDESNAMN', 'grid_area_name'],
  gridOwnerName: ['Agare', 'AGARE', 'agare', 'Ägare', 'ELNATSFORETAG', 'ELNÄTSFÖRETAG', 'grid_owner_name'],
  priceArea: ['Elomrade', 'ELOMRADE', 'elomrade', 'Elområde', 'ELOMRÅDE', 'price_area'],
} as const

function firstPropertyText(properties: Record<string, unknown>, aliases: readonly string[]): string | null {
  for (const alias of aliases) {
    const value = clean(properties[alias])
    if (value) return value
  }
  return null
}

export function validateSvkFeatureProperties(properties: Record<string, unknown>, id: string): void {
  const gridAreaCode = firstPropertyText(properties, SVK_FIELD_ALIASES.gridAreaCode)
  const gridAreaName = firstPropertyText(properties, SVK_FIELD_ALIASES.gridAreaName)
  const gridOwnerName = firstPropertyText(properties, SVK_FIELD_ALIASES.gridOwnerName)
  const priceArea = firstPropertyText(properties, SVK_FIELD_ALIASES.priceArea)?.toUpperCase() ?? null
  const missing = [
    !gridAreaCode ? 'Natomrade' : null,
    !gridAreaName ? 'Namn' : null,
    !gridOwnerName ? 'Agare' : null,
    !priceArea ? 'Elomrade' : null,
  ].filter((value): value is string => Boolean(value))
  if (missing.length > 0) {
    throw new Error(`SVK-feature ${id} saknar canonicala fält: ${missing.join(', ')}.`)
  }
  if (!['SE1', 'SE2', 'SE3', 'SE4'].includes(priceArea!)) {
    throw new Error(`SVK-feature ${id} har ogiltigt Elomrade: ${priceArea}.`)
  }
}

export function safeSvkServiceUrl(value: unknown): string {
  const candidate = clean(value) ?? DEFAULT_SVK_GRID_AREA_SERVICE_URL
  const parsed = new URL(candidate)
  if (
    parsed.protocol !== 'https:' ||
    parsed.origin !== ALLOWED_ORIGIN ||
    !parsed.pathname.toLowerCase().startsWith(ALLOWED_PATH_PREFIX.toLowerCase())
  ) {
    throw new Error('service_url är inte en tillåten Svenska kraftnät ArcGIS-tjänst.')
  }
  if (parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash) {
    throw new Error('service_url har ett ogiltigt format.')
  }
  return parsed.toString().replace(/\/$/, '')
}

function positiveInt(value: unknown, fallback: number, max: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return fallback
  return Math.min(Math.floor(parsed), max)
}

function featureId(feature: Record<string, unknown>, index: number): string {
  const properties = feature.properties && typeof feature.properties === 'object' ? feature.properties as Record<string, unknown> : {}
  return String(feature.id ?? properties.OBJECTID ?? properties.objectid ?? properties.FID ?? `feature-${index}`)
}

async function activeGeodataVersion(input: { serviceUrl: string; layerId: number }): Promise<{ id: string; versionKey: string } | null> {
  const { data, error } = await supabaseService
    .from('energy_geodata_versions')
    .select('id,version_key,source_url,metadata')
    .eq('provider', 'svk_arcgis')
    .eq('status', 'importing')
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const metadata = data.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata)
    ? data.metadata as Record<string, unknown>
    : {}
  if (clean(data.source_url) !== input.serviceUrl || Number(metadata.layer_id) !== input.layerId) {
    throw new Error('En pågående SVK-import använder en annan tjänst eller layer och måste avslutas innan en ny version startas.')
  }
  return { id: String(data.id), versionKey: String(data.version_key) }
}

async function createGeodataVersion(input: { serviceUrl: string; layerId: number; offset: number }): Promise<{ id: string; versionKey: string }> {
  const versionKey = `svk_arcgis:${new Date().toISOString().replace(/[-:.TZ]/g, '')}`
  const { data, error } = await supabaseService
    .from('energy_geodata_versions')
    .insert({
      provider: 'svk_arcgis',
      version_key: versionKey,
      status: 'importing',
      source_url: input.serviceUrl,
      cursor_offset: input.offset,
      coverage_status: 'partial',
      metadata: { service_url: input.serviceUrl, layer_id: input.layerId },
    })
    .select('id,version_key')
    .single()
  if (error) {
    const existing = await activeGeodataVersion({ serviceUrl: input.serviceUrl, layerId: input.layerId })
    if (existing) return existing
    throw error
  }
  return { id: String(data.id), versionKey: String(data.version_key) }
}

async function insertImportRun(metadata: Record<string, unknown>) {
  const { data, error } = await supabaseService
    .from('platform_data_import_runs')
    .insert({ source: 'svk_arcgis', import_type: 'grid_area_geometries', status: 'running', metadata })
    .select('id')
    .maybeSingle()
  if (error) throw error
  return typeof data?.id === 'string' ? data.id : null
}

async function loadRunGeodataVersion(runId: string): Promise<{ id: string; versionKey: string } | null> {
  const { data, error } = await supabaseService
    .from('platform_data_import_runs')
    .select('metadata')
    .eq('id', runId)
    .maybeSingle()
  if (error) throw error
  const metadata = data?.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata)
    ? data.metadata as Record<string, unknown>
    : {}
  const versionKey = clean(metadata.geodata_version)
  if (!versionKey) return null
  const version = await supabaseService
    .from('energy_geodata_versions')
    .select('id,version_key')
    .eq('version_key', versionKey)
    .maybeSingle()
  if (version.error) throw version.error
  return version.data ? { id: String(version.data.id), versionKey: String(version.data.version_key) } : null
}

export async function updateSvkImportRun(runId: string | null, patch: Record<string, unknown>) {
  if (!runId) return
  const { error } = await supabaseService
    .from('platform_data_import_runs')
    .update(patch)
    .eq('id', runId)
  if (error) console.warn('[svk-geometry-import] could not update import run', error.message)
}

export async function runSvkGeometryImport(input: {
  serviceUrl?: unknown
  layerId?: unknown
  limit?: unknown
  offset?: unknown
  runId?: string | null
  actorUserId?: string | null
} = {}): Promise<SvkImportResult> {
  const serviceUrl = safeSvkServiceUrl(input.serviceUrl)
  const layerId = positiveInt(input.layerId, DEFAULT_SVK_GRID_AREA_LAYER_ID, 50)
  const limit = Math.max(1, positiveInt(input.limit, SVK_IMPORT_PAGE_SIZE, SVK_IMPORT_PAGE_SIZE))
  const offset = positiveInt(input.offset, 0, 10_000_000)
  const suppliedRunId = clean(input.runId)
  const geodata = suppliedRunId
    ? (await loadRunGeodataVersion(suppliedRunId) ?? await createGeodataVersion({ serviceUrl, layerId, offset }))
    : await createGeodataVersion({ serviceUrl, layerId, offset })
  const runId = suppliedRunId ?? await insertImportRun({
    service_url: serviceUrl,
    layer_id: layerId,
    page_size: limit,
    created_by: input.actorUserId ?? 'system',
    next_offset: offset,
    geodata_version: geodata.versionKey,
  })
  const queryUrl = new URL(`${serviceUrl}/${layerId}/query`)
  queryUrl.searchParams.set('where', '1=1')
  queryUrl.searchParams.set('outFields', '*')
  queryUrl.searchParams.set('returnGeometry', 'true')
  queryUrl.searchParams.set('f', 'geojson')
  queryUrl.searchParams.set('resultOffset', String(offset))
  queryUrl.searchParams.set('resultRecordCount', String(limit))
  queryUrl.searchParams.set('orderByFields', 'OBJECTID ASC')
  queryUrl.searchParams.set('outSR', '4326')

  try {
    const response = await fetch(queryUrl.toString(), {
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(25_000),
    })
    if (!response.ok) throw new Error(`SVK ArcGIS svarade ${response.status}`)
    const payload = await response.json() as {
      features?: Array<Record<string, unknown>>
      exceededTransferLimit?: boolean
      error?: { code?: number; message?: string; details?: string[] }
    }
    if (payload.error) {
      throw new Error(`SVK ArcGIS-fel ${payload.error.code ?? 'okänt'}: ${payload.error.message ?? payload.error.details?.join('; ') ?? 'okänt fel'}`)
    }
    const features = Array.isArray(payload.features) ? payload.features : []
    let upserted = 0
    const errors: string[] = []

    for (const [index, feature] of features.entries()) {
      const properties = feature.properties && typeof feature.properties === 'object' ? feature.properties as Record<string, unknown> : {}
      const geometry = feature.geometry && typeof feature.geometry === 'object' ? feature.geometry as Record<string, unknown> : null
      const id = featureId(feature, offset + index)
      validateSvkFeatureProperties(properties, id)
      const { error } = await supabaseService.rpc('gridex_stage_energy_geodata_feature', {
        p_geodata_version_id: geodata.id,
        p_feature_id: id,
        p_properties: properties,
        p_geometry_geojson: geometry,
        p_source_url: queryUrl.toString(),
      })
      if (error) errors.push(`${id}: ${error.message}`)
      else upserted += 1
    }

    if (errors.length > 0) {
      throw new Error(`SVK-geometriimporten stoppades eftersom ${errors.length} polygonrader inte kunde sparas: ${errors.slice(0, 3).join('; ')}`)
    }

    const hasMore = Boolean(payload.exceededTransferLimit) || features.length === limit
    const nextOffset = offset + features.length
    await updateSvkImportRun(runId, {
      status: hasMore ? 'running' : 'completed',
      records_seen: offset + features.length,
      records_upserted: offset + upserted,
      records_failed: 0,
      completed_at: hasMore ? null : new Date().toISOString(),
      metadata: { service_url: serviceUrl, layer_id: layerId, page_size: limit, next_offset: nextOffset, has_more: hasMore, geodata_version: geodata.versionKey },
      error_log: [],
    })
    const now = new Date().toISOString()
    const { error: geodataError } = await supabaseService
      .from('energy_geodata_versions')
      .update({
        cursor_offset: nextOffset,
        feature_count: offset + features.length,
        coverage_status: hasMore ? 'partial' : 'complete',
        metadata: { run_id: runId, service_url: serviceUrl, layer_id: layerId, page_size: limit, records_failed: 0 },
        updated_at: now,
      })
      .eq('id', geodata.id)
      .eq('status', 'importing')
    if (geodataError) throw geodataError
    if (!hasMore) {
      const { error: promoteError } = await supabaseService.rpc('gridex_promote_energy_geodata_version', {
        p_geodata_version_id: geodata.id,
      })
      if (promoteError) throw promoteError

      const { error: reconciliationError } = await supabaseService.rpc('gridex_reconcile_grid_owner_mappings_v1', {
        p_apply: true,
      })
      if (reconciliationError) throw reconciliationError
    }
    return { ok: true, runId, seen: features.length, upserted, errors: [], nextOffset: hasMore ? nextOffset : null, hasMore, geodataVersion: geodata.versionKey }
  } catch (error) {
    const now = new Date().toISOString()
    const failure = serializeSvkImportError(error)
    await updateSvkImportRun(runId, {
      status: 'failed',
      completed_at: now,
      error_log: [failure],
    })
    await supabaseService
      .from('energy_geodata_versions')
      .update({ status: 'failed', coverage_status: 'failed', completed_at: now, updated_at: now })
      .eq('id', geodata.id)
    throw error
  }
}
