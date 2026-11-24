import { randomUUID } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { authorizeScheduledRequest } from '@/lib/automation/scheduledAuth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 45

const headers = { 'Cache-Control': 'no-store' }

async function run(request: NextRequest) {
  if (!authorizeScheduledRequest({ request, dedicatedSecretEnv: 'BILLING_AUTOMATION_CRON_SECRET', allowVercelCron: true })) {
    return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401, headers })
  }
  try {
    const { runInvoiceDispatchPeriodReconciliation } = await import('@/lib/billing/invoiceDispatchPeriodReconciliation')
    const result = await runInvoiceDispatchPeriodReconciliation()
    const ok = result.failed === 0 && result.deferred === 0
    return NextResponse.json({
      ok, scanned: result.scanned, locked: result.locked, alreadyLocked: result.alreadyLocked,
      superseded: result.superseded, waiting: result.waiting, deferred: result.deferred, failed: result.failed,
    }, { status: ok ? 200 : 503, headers })
  } catch {
    const traceId = randomUUID()
    console.error('[invoice-dispatch-period-cron] reconciliation failed', { traceId })
    return NextResponse.json({ ok: false, error: 'invoice_dispatch_period_unavailable', trace_id: traceId }, { status: 503, headers })
  }
}

export async function GET(request: NextRequest) { return run(request) }
export async function POST(request: NextRequest) { return run(request) }
