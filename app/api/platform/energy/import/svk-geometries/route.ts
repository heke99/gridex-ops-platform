import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DEFAULT_SERVICE_URL = 'https://services2.arcgis.com/L8WLzcxhwLqd80Jx/arcgis/rest/services/N%C3%A4tomr%C3%A5den_240524_2_WFL1/FeatureServer'
const ALLOWED_ORIGIN = 'https://services2.arcgis.com'
const ALLOWED_PATH_PREFIX = '/L8WLzcxhwLqd80Jx/arcgis/rest/services/'
const MAX_PAGE_SIZE = 250

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function safeServiceUrl(value: unknown): string {
  const candidate = clean(value) ?? DEFAULT_SERVICE_URL
  const parsed = new URL(candidate)
  if (parsed.origin !== ALLOWED_ORIGIN || !parsed.pathname.startsWith(ALLOWED_PATH_PREFIX)) {
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

async function updateImportRun(runId: string | null, patch: Record<string, unknown>) {
  if (!runId) return
  const { error } = await supabaseService
    .from('platform_data_import_runs')
    .update(patch)
    .eq('id', runId)
  if (error) console.warn('[svk-geometry-import] could not update import run', error.message)
}

export async function POST(request: Request) {
  let runId: string | null = null
  try {
    const admin = await requirePlatformAdminActionAccess()
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const serviceUrl = safeServiceUrl(body.service_url ?? body.serviceUrl)
    const layerId = positiveInt(body.layer_id ?? body.layerId, 4, 50)
    const limit = Math.max(1, positiveInt(body.limit, MAX_PAGE_SIZE, MAX_PAGE_SIZE))
    const offset = positiveInt(body.offset ?? body.result_offset, 0, 10_000_000)
    const existingRunId = clean(body.run_id ?? body.runId)
    const queryUrl = new URL(`${serviceUrl}/${layerId}/query`)
    queryUrl.searchParams.set('where', '1=1')
    queryUrl.searchParams.set('outFields', '*')
    queryUrl.searchParams.set('returnGeometry', 'true')
    queryUrl.searchParams.set('f', 'geojson')
    queryUrl.searchParams.set('resultOffset', String(offset))
    queryUrl.searchParams.set('resultRecordCount', String(limit))

    runId = existingRunId ?? await insertImportRun({ serviceUrl, layerId, page_size: limit, createdBy: admin.userId, next_offset: offset })
    const response = await fetch(queryUrl.toString(), { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(25_000) })
    if (!response.ok) throw new Error(`SVK ArcGIS svarade ${response.status}`)
    const payload = await response.json() as { features?: Array<Record<string, unknown>>; exceededTransferLimit?: boolean }
    const features = Array.isArray(payload.features) ? payload.features : []
    let upserted = 0
    const errors: string[] = []

    for (const [index, feature] of features.entries()) {
      const properties = feature.properties && typeof feature.properties === 'object' ? feature.properties as Record<string, unknown> : {}
      const geometry = feature.geometry && typeof feature.geometry === 'object' ? feature.geometry as Record<string, unknown> : null
      const { error } = await supabaseService.rpc('gridex_import_grid_area_geojson_feature', {
        p_feature_id: featureId(feature, offset + index),
        p_properties: properties,
        p_geometry_geojson: geometry,
        p_source_url: queryUrl.toString(),
      })
      if (error) errors.push(`${featureId(feature, offset + index)}: ${error.message}`)
      else upserted += 1
    }

    const hasMore = Boolean(payload.exceededTransferLimit) || features.length === limit
    const nextOffset = offset + features.length
    await updateImportRun(runId, {
      status: hasMore ? 'running' : (errors.length > 0 ? 'completed_with_warnings' : 'completed'),
      records_seen: offset + features.length,
      records_upserted: offset + upserted,
      records_failed: errors.length,
      completed_at: hasMore ? null : new Date().toISOString(),
      metadata: { service_url: serviceUrl, layer_id: layerId, page_size: limit, next_offset: nextOffset, has_more: hasMore },
      error_log: errors.slice(0, 100),
    })

    return NextResponse.json({ ok: errors.length === 0, runId, seen: features.length, upserted, errors, nextOffset: hasMore ? nextOffset : null, hasMore })
  } catch (error) {
    const traceId = randomUUID()
    console.error('[svk-geometry-import] failed', { traceId, error })
    await updateImportRun(runId, { status: 'failed', completed_at: new Date().toISOString(), error_log: [`trace_id=${traceId}`] })
    return NextResponse.json({ ok: false, error: 'SVK-geometriimporten misslyckades.', code: 'svk_geometry_import_failed', trace_id: traceId }, { status: 500 })
  }
}
