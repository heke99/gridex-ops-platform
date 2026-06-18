import { supabaseService } from '@/lib/supabase/service'

export const DEFAULT_SVK_GRID_AREA_SERVICE_URL = 'https://services2.arcgis.com/L8WLzcxhwLqd80Jx/arcgis/rest/services/N%C3%A4tomr%C3%A5den_240524_2_WFL1/FeatureServer'
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
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function safeSvkServiceUrl(value: unknown): string {
  const candidate = clean(value) ?? DEFAULT_SVK_GRID_AREA_SERVICE_URL
  const parsed = new URL(candidate)
  if (parsed.protocol !== 'https:' || parsed.origin !== ALLOWED_ORIGIN || !parsed.pathname.startsWith(ALLOWED_PATH_PREFIX)) {
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

async function insertImportRun(metadata: Record<string, unknown>) {
  const { data, error } = await supabaseService
    .from('platform_data_import_runs')
    .insert({ source: 'svk_arcgis', import_type: 'grid_area_geometries', status: 'running', metadata })
    .select('id')
    .maybeSingle()
  if (error) throw error
  return typeof data?.id === 'string' ? data.id : null
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
  const layerId = positiveInt(input.layerId, 4, 50)
  const limit = Math.max(1, positiveInt(input.limit, SVK_IMPORT_PAGE_SIZE, SVK_IMPORT_PAGE_SIZE))
  const offset = positiveInt(input.offset, 0, 10_000_000)
  const runId = clean(input.runId) ?? await insertImportRun({
    serviceUrl,
    layerId,
    page_size: limit,
    createdBy: input.actorUserId ?? 'system',
    next_offset: offset,
  })
  const queryUrl = new URL(`${serviceUrl}/${layerId}/query`)
  queryUrl.searchParams.set('where', '1=1')
  queryUrl.searchParams.set('outFields', '*')
  queryUrl.searchParams.set('returnGeometry', 'true')
  queryUrl.searchParams.set('f', 'geojson')
  queryUrl.searchParams.set('resultOffset', String(offset))
  queryUrl.searchParams.set('resultRecordCount', String(limit))

  try {
    const response = await fetch(queryUrl.toString(), {
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(25_000),
    })
    if (!response.ok) throw new Error(`SVK ArcGIS svarade ${response.status}`)
    const payload = await response.json() as { features?: Array<Record<string, unknown>>; exceededTransferLimit?: boolean }
    const features = Array.isArray(payload.features) ? payload.features : []
    let upserted = 0
    const errors: string[] = []

    for (const [index, feature] of features.entries()) {
      const properties = feature.properties && typeof feature.properties === 'object' ? feature.properties as Record<string, unknown> : {}
      const geometry = feature.geometry && typeof feature.geometry === 'object' ? feature.geometry as Record<string, unknown> : null
      const id = featureId(feature, offset + index)
      const { error } = await supabaseService.rpc('gridex_import_grid_area_geojson_feature', {
        p_feature_id: id,
        p_properties: properties,
        p_geometry_geojson: geometry,
        p_source_url: queryUrl.toString(),
      })
      if (error) errors.push(`${id}: ${error.message}`)
      else upserted += 1
    }

    const hasMore = Boolean(payload.exceededTransferLimit) || features.length === limit
    const nextOffset = offset + features.length
    await updateSvkImportRun(runId, {
      status: hasMore ? 'running' : (errors.length > 0 ? 'completed_with_warnings' : 'completed'),
      records_seen: offset + features.length,
      records_upserted: offset + upserted,
      records_failed: errors.length,
      completed_at: hasMore ? null : new Date().toISOString(),
      metadata: { service_url: serviceUrl, layer_id: layerId, page_size: limit, next_offset: nextOffset, has_more: hasMore },
      error_log: errors.slice(0, 100),
    })
    return { ok: errors.length === 0, runId, seen: features.length, upserted, errors, nextOffset: hasMore ? nextOffset : null, hasMore }
  } catch (error) {
    await updateSvkImportRun(runId, {
      status: 'failed',
      completed_at: new Date().toISOString(),
      error_log: [error instanceof Error ? error.message : 'svk_geometry_import_failed'],
    })
    throw error
  }
}
