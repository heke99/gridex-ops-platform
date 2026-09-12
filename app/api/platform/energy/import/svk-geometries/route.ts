import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { retrySvkGridOwnerReconciliation, runSvkGeometryImport } from '@/lib/energy/svkGeometryImport'

import { readAdminJson } from '@/lib/http/adminJsonRequest'
import { platformSvkImportSchema } from '@/lib/admin/platformJsonSchemas'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const admin = await requirePlatformAdminActionAccess()
    const parsed = await readAdminJson(request, platformSvkImportSchema, { allowEmpty: true })
    if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error, code: parsed.code, field: parsed.field }, { status: parsed.status })
    const body = parsed.data

    if (body.action === 'retry_reconciliation') {
      const runId = typeof (body.run_id ?? body.runId) === 'string' ? String(body.run_id ?? body.runId) : ''
      const result = await retrySvkGridOwnerReconciliation(runId)
      return NextResponse.json(result, { status: result.ok ? 200 : 409 })
    }

    const result = await runSvkGeometryImport({
      serviceUrl: body.service_url ?? body.serviceUrl,
      layerId: body.layer_id ?? body.layerId,
      limit: body.limit,
      offset: body.offset ?? body.result_offset,
      runId: typeof (body.run_id ?? body.runId) === 'string' ? String(body.run_id ?? body.runId) : null,
      actorUserId: admin.userId,
    })
    return NextResponse.json(result, { status: result.ok ? 200 : 502 })
  } catch (error) {
    const traceId = randomUUID()
    console.error('[svk-geometry-import] failed', { traceId, error })
    return NextResponse.json({ ok: false, error: 'SVK-geometriimporten misslyckades.', code: 'svk_geometry_import_failed', trace_id: traceId }, { status: 500 })
  }
}
