/**
 * Internal API: Z01 Grid Owner Data Request Finalizer
 *
 * Protected endpoint for platform administrators to repair stuck PRODAT Z01
 * grid_owner_data_requests that have no linked outbound_request or ediel_message.
 *
 * This endpoint requires platform admin authentication.
 * It does NOT send SMTP directly — it delegates to the normal guarded send path.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { finalizeStuckZ01GridOwnerDataRequest, dryRunZ01Finalizer } from '@/lib/customer-operations/z01Finalizer'
import type { EdielEnvironment } from '@/lib/ediel/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null
}

function asBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v
  if (v === 'true' || v === '1') return true
  return false
}

export async function POST(request: NextRequest) {
  try {
    const guard = await requirePlatformAdminAccess().catch(() => null)
    if (!guard) {
      return NextResponse.json({ ok: false, error: 'Åtkomst nekad. Kräver plattformsadministratörsbehörighet.' }, { status: 403 })
    }

    let body: Record<string, unknown>
    try {
      body = (await request.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ ok: false, error: 'Ogiltig JSON.' }, { status: 400 })
    }

    const companyId = asString(body.company_id)
    if (!companyId) {
      return NextResponse.json({ ok: false, error: 'company_id krävs.' }, { status: 400 })
    }

    const gridOwnerDataRequestId = asString(body.grid_owner_data_request_id)
    const customerInfoRequestId = asString(body.customer_info_request_id)

    if (!gridOwnerDataRequestId && !customerInfoRequestId) {
      return NextResponse.json({ ok: false, error: 'Ange grid_owner_data_request_id eller customer_info_request_id.' }, { status: 400 })
    }

    const environment = asString(body.environment) as EdielEnvironment | null
    const dryRun = asBool(body.dry_run ?? body.dryRun ?? true)

    const actorUserId = guard.userId ?? 'platform-admin'

    if (dryRun) {
      const result = await dryRunZ01Finalizer({
        companyId,
        actorUserId,
        gridOwnerDataRequestId,
        customerInfoRequestId,
        environment,
        dryRun: true,
      })
      return NextResponse.json({ ok: true, dryRun: true, result })
    }

    const result = await finalizeStuckZ01GridOwnerDataRequest({
      companyId,
      actorUserId,
      gridOwnerDataRequestId,
      customerInfoRequestId,
      environment,
      dryRun: false,
    })

    return NextResponse.json({ ok: true, dryRun: false, result })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? 'Okänt fel.')
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
