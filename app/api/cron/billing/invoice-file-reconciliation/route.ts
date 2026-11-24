import { randomUUID } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { authorizeScheduledRequest } from '@/lib/automation/scheduledAuth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const headers = { 'Cache-Control': 'no-store' }

async function run(request: NextRequest) {
  if (!authorizeScheduledRequest({
    request,
    dedicatedSecretEnv: 'BILLING_AUTOMATION_CRON_SECRET',
    allowVercelCron: true,
  })) {
    return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401, headers })
  }

  try {
    const { runInvoiceFileReconciliation } = await import('@/lib/billing/invoiceFileReconciliation')
    const { status, period, legacy } = await runInvoiceFileReconciliation()
    const ok = status === 'completed'
    return NextResponse.json({
      ok,
      outcome: status,
      ...(!ok ? { code: 'invoice_file_reconciliation_incomplete' } : {}),
      period: {
        scanned: period.scanned,
        locked: period.locked,
        alreadyLocked: period.alreadyLocked,
        incomplete: period.incomplete,
        superseded: period.superseded,
        retryPending: period.retryPending,
        failed: period.failed,
        listFailed: period.listFailed,
        deferred: period.deferred,
      },
      legacy: {
        scanned: legacy.scanned,
        applied: legacy.applied,
        held: legacy.held,
        retryPending: legacy.retryPending,
        failed: legacy.failed,
        listFailed: legacy.listFailed,
        deferred: legacy.deferred,
      },
    }, { status: ok ? 200 : 503, headers })
  } catch {
    const traceId = randomUUID()
    console.error('[invoice-file-reconciliation-cron] worker failed', { traceId })
    return NextResponse.json({
      ok: false,
      outcome: 'failed',
      code: 'invoice_file_reconciliation_unavailable',
      trace_id: traceId,
    }, { status: 503, headers })
  }
}

export async function GET(request: NextRequest) { return run(request) }
export async function POST(request: NextRequest) { return run(request) }
