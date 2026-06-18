import { NextResponse } from 'next/server'
import { internalApiError } from '@/lib/http/apiError'
import { requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { upsertPlatformGridAreaMasterRows } from '@/lib/energy/resolver'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type ImportRow = {
  gridOwnerName?: string | null
  gridAreaName?: string | null
  gridAreaCode?: string | null
  priceArea?: string | null
  metadata?: Record<string, unknown>
}

function normaliseRows(body: Record<string, unknown>): ImportRow[] {
  const rows = Array.isArray(body.rows) ? body.rows : Array.isArray(body.data) ? body.data : []
  return rows
    .filter((row): row is Record<string, unknown> => Boolean(row && typeof row === 'object' && !Array.isArray(row)))
    .map((row) => ({
      gridOwnerName: typeof row.grid_owner_name === 'string' ? row.grid_owner_name : typeof row.gridOwnerName === 'string' ? row.gridOwnerName : typeof row.elnatsforetag === 'string' ? row.elnatsforetag : null,
      gridAreaName: typeof row.grid_area_name === 'string' ? row.grid_area_name : typeof row.gridAreaName === 'string' ? row.gridAreaName : typeof row.natomrade_name === 'string' ? row.natomrade_name : null,
      gridAreaCode: typeof row.grid_area_code === 'string' ? row.grid_area_code : typeof row.gridAreaCode === 'string' ? row.gridAreaCode : typeof row.natomradeskod === 'string' ? row.natomradeskod : null,
      priceArea: typeof row.price_area === 'string' ? row.price_area : typeof row.priceArea === 'string' ? row.priceArea : typeof row.elomrade === 'string' ? row.elomrade : null,
      metadata: row,
    }))
}

export async function POST(request: Request) {
  try {
    await requirePlatformAdminActionAccess()
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const rows = normaliseRows(body)
    if (rows.length === 0) return NextResponse.json({ ok: false, error: 'Inga nätområdesrader skickades.' }, { status: 422 })
    const result = await upsertPlatformGridAreaMasterRows(rows)
    return NextResponse.json({ ok: true, seen: rows.length, result })
  } catch (error) {
    return internalApiError({ context: 'grid-area-import', error, code: 'grid_area_import_failed', message: 'Masterimporten kunde inte slutföras.' })
  }
}
