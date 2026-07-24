import { randomUUID, timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { runSvkGeometryImport } from '@/lib/energy/svkGeometryImport'
import { supabaseService } from '@/lib/supabase/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function sameSecret(candidate: string | null, expected: string) {
  if (!candidate) return false
  const left = Buffer.from(candidate)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

function authorized(request: NextRequest) {
  const expected = [process.env.GRID_AREA_IMPORT_CRON_SECRET, process.env.CRON_SECRET]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
  const header = request.headers.get('authorization') ?? ''
  const token = header.toLowerCase().startsWith('bearer ')
    ? header.slice('bearer '.length).trim()
    : request.headers.get('x-cron-secret')?.trim() ?? null
  return expected.some((secret) => sameSecret(token, secret))
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 })
  try {
    const { data, error } = await supabaseService
      .from('platform_data_import_runs')
      .select('id,metadata')
      .eq('source', 'svk_arcgis')
      .eq('import_type', 'grid_area_geometries')
      .eq('status', 'running')
      .order('started_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    if (data?.id) {
      const metadata = data.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata)
        ? data.metadata as Record<string, unknown>
        : {}
      const result = await runSvkGeometryImport({
        runId: String(data.id),
        serviceUrl: metadata.service_url,
        layerId: metadata.layer_id,
        limit: metadata.page_size,
        offset: metadata.next_offset,
        actorUserId: process.env.GRIDEX_AUTOMATION_USER_ID ?? null,
      })
      return NextResponse.json({ ok: true, resumed: true, started: false, result })
    }

    const maxAgeDaysRaw = Number(process.env.ENERGY_GEODATA_MAX_AGE_DAYS ?? '30')
    const maxAgeDays = Number.isFinite(maxAgeDaysRaw) ? Math.min(Math.max(maxAgeDaysRaw, 1), 365) : 30
    const latest = await supabaseService
      .from('energy_geodata_versions')
      .select('version_key,verified_at,completed_at')
      .eq('provider', 'svk_arcgis')
      .eq('status', 'verified')
      .order('verified_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (latest.error) throw latest.error
    const verifiedAt = latest.data?.verified_at ?? latest.data?.completed_at ?? null
    const stale = !verifiedAt || Date.now() - Date.parse(String(verifiedAt)) > maxAgeDays * 24 * 60 * 60 * 1000
    if (!stale) {
      return NextResponse.json({ ok: true, resumed: false, started: false, reason: 'verified_geodata_is_fresh', geodata_version: latest.data?.version_key ?? null })
    }

    const result = await runSvkGeometryImport({
      actorUserId: process.env.GRIDEX_AUTOMATION_USER_ID ?? null,
    })
    return NextResponse.json({ ok: true, resumed: false, started: true, reason: 'geodata_missing_or_stale', result })
  } catch (error) {
    const traceId = randomUUID()
    console.error('[svk-geometry-import-cron] failed', { traceId, error })
    return NextResponse.json({ ok: false, error: 'Importen kunde inte återupptas.', code: 'svk_import_resume_failed', trace_id: traceId }, { status: 500 })
  }
}
