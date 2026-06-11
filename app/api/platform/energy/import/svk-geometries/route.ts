import { NextResponse } from 'next/server'
import { requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DEFAULT_SERVICE_URL = 'https://services2.arcgis.com/L8WLzcxhwLqd80Jx/arcgis/rest/services/N%C3%A4tomr%C3%A5den_240524_2_WFL1/FeatureServer'

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function featureId(feature: Record<string, unknown>, index: number): string {
  const properties = feature.properties && typeof feature.properties === 'object' ? feature.properties as Record<string, unknown> : {}
  return String(feature.id ?? properties.OBJECTID ?? properties.objectid ?? properties.FID ?? `feature-${index}`)
}

async function insertImportRun(metadata: Record<string, unknown>) {
  const { data } = await supabaseService
    .from('platform_data_import_runs')
    .insert({ source: 'svk_arcgis', import_type: 'grid_area_geometries', status: 'running', metadata })
    .select('id')
    .maybeSingle()
  return typeof data?.id === 'string' ? data.id : null
}

export async function POST(request: Request) {
  try {
    const admin = await requirePlatformAdminActionAccess()
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const serviceUrl = clean(body.service_url) ?? clean(body.serviceUrl) ?? DEFAULT_SERVICE_URL
    const layerId = Number(body.layer_id ?? body.layerId ?? 4)
    const limit = Math.min(Math.max(Number(body.limit ?? 2000), 1), 2000)
    const queryUrl = new URL(`${serviceUrl.replace(/\/$/, '')}/${layerId}/query`)
    queryUrl.searchParams.set('where', '1=1')
    queryUrl.searchParams.set('outFields', '*')
    queryUrl.searchParams.set('returnGeometry', 'true')
    queryUrl.searchParams.set('f', 'geojson')
    queryUrl.searchParams.set('resultRecordCount', String(limit))

    const runId = await insertImportRun({ serviceUrl, layerId, limit, createdBy: admin.userId })
    const response = await fetch(queryUrl.toString(), { cache: 'no-store' })
    if (!response.ok) throw new Error(`SVK ArcGIS svarade ${response.status}`)
    const payload = await response.json() as { features?: Array<Record<string, unknown>> }
    const features = Array.isArray(payload.features) ? payload.features : []
    let upserted = 0
    const errors: string[] = []

    for (const [index, feature] of features.entries()) {
      const properties = feature.properties && typeof feature.properties === 'object' ? feature.properties as Record<string, unknown> : {}
      const geometry = feature.geometry && typeof feature.geometry === 'object' ? feature.geometry as Record<string, unknown> : null
      const { error } = await supabaseService.rpc('gridex_import_grid_area_geojson_feature', {
        p_feature_id: featureId(feature, index),
        p_properties: properties,
        p_geometry_geojson: geometry,
        p_source_url: queryUrl.toString(),
      })
      if (error) errors.push(`${featureId(feature, index)}: ${error.message}`)
      else upserted += 1
    }

    if (runId) {
      await supabaseService
        .from('platform_data_import_runs')
        .update({
          status: errors.length > 0 ? 'completed_with_warnings' : 'completed',
          records_seen: features.length,
          records_upserted: upserted,
          records_failed: errors.length,
          completed_at: new Date().toISOString(),
          error_log: errors,
        })
        .eq('id', runId)
    }

    return NextResponse.json({ ok: errors.length === 0, runId, seen: features.length, upserted, errors })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'SVK-geometriimporten misslyckades.'
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
