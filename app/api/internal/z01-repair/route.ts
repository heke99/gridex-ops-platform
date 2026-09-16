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
import { internalApiError } from '@/lib/http/apiError'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { finalizeStuckZ01GridOwnerDataRequest, dryRunZ01Finalizer } from '@/lib/customer-operations/z01Finalizer'
import type { EdielEnvironment } from '@/lib/ediel/types'

import { readAdminJson } from '@/lib/http/adminJsonRequest'
import { z01RepairSchema } from '@/lib/admin/platformJsonSchemas'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null
}

export async function POST(request: NextRequest) {
  try {
    const guard = await requirePlatformAdminAccess().catch(() => null)
    if (!guard) {
      return NextResponse.json({ ok: false, error: 'Åtkomst nekad. Kräver plattformsadministratörsbehörighet.' }, { status: 403 })
    }

    const parsed = await readAdminJson(request, z01RepairSchema)
    if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error, code: parsed.code, field: parsed.field }, { status: parsed.status })
    const body = parsed.data

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
    const dryRun = body.dry_run ?? body.dryRun ?? true

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
    return internalApiError({
      context: 'z01-repair',
      error,
      code: 'z01_repair_failed',
      message: 'Z01-reparationen kunde inte slutföras. Se serverloggen med trace_id.',
    })
  }
}
