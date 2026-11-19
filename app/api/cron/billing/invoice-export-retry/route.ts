import { randomUUID, timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { processDueApprovedInvoiceRetries } from '@/lib/billing/invoiceApprovedDispatch'
import { processPendingInvoiceProviderEvents, retryReviewableInvoiceProviderEvents } from '@/lib/billing/providerEventProcessor'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function clean(value: string | null | undefined) {
  const text = String(value ?? '').trim()
  return text || null
}

function authorized(request: NextRequest) {
  const expected = [process.env.BILLING_AUTOMATION_CRON_SECRET, process.env.CRON_SECRET]
    .map(clean)
    .filter((value): value is string => Boolean(value))
  if (expected.length === 0) return false
  const authorization = request.headers.get('authorization') ?? ''
  const token = authorization.toLowerCase().startsWith('bearer ')
    ? clean(authorization.slice('bearer '.length))
    : clean(request.headers.get('x-cron-secret'))
  return Boolean(token && expected.some((secret) => {
    const left = Buffer.from(token)
    const right = Buffer.from(secret)
    return left.length === right.length && timingSafeEqual(left, right)
  }))
}

function providerSummary<Result extends { results: readonly { outcome: string }[] }>(result: Result | null) {
  if (result === null) return null
  return {
    ...result,
    results: result.results.map((entry) => entry.outcome === 'skipped'
      ? { ...entry, reason: 'provider_event_processing_failed' }
      : entry),
  }
}

async function run(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 })

  const limitRaw = Number(clean(request.nextUrl.searchParams.get('limit')) ?? '50')
  const companyId = clean(request.nextUrl.searchParams.get('company_id'))
  const failedSteps: { step: string; trace_id: string }[] = []

  async function runStep<Result>(step: string, execute: () => Promise<Result>): Promise<Result | null> {
    try {
      return await execute()
    } catch (error) {
      const traceId = randomUUID()
      console.error('[invoice-export-retry-cron] step failed', { step, traceId, error })
      failedSteps.push({ step, trace_id: traceId })
      return null
    }
  }

  const retries = await runStep('retries', () => processDueApprovedInvoiceRetries({
    companyId,
    limit: Number.isFinite(limitRaw) ? limitRaw : 50,
  }))
  const providerEvents = await runStep('providerEvents', () => processPendingInvoiceProviderEvents({ companyId, limit: 200 }))
  const reviewRetries = await runStep('reviewRetries', () => retryReviewableInvoiceProviderEvents({ companyId, limit: 50 }))

  const failedEntries = (retries?.failed ?? 0) + (providerEvents?.failed ?? 0) + (reviewRetries?.failed ?? 0)
  const completedEntries = (retries?.sent ?? 0) + (providerEvents?.processed ?? 0) +
    (providerEvents?.needsReview ?? 0) + (reviewRetries?.processed ?? 0) + (reviewRetries?.stillNeedsReview ?? 0)
  const complete = failedEntries === 0 && failedSteps.length === 0
  const blocked = !complete && completedEntries === 0
  const summary = {
    ok: complete,
    outcome: complete ? 'completed' : blocked ? 'blocked' : 'partial',
    failed_entries: failedEntries,
    failed_steps: failedSteps,
    retries,
    providerEvents: providerSummary(providerEvents),
    reviewRetries: providerSummary(reviewRetries),
    approval_enforced: true,
  }

  if (!blocked) return NextResponse.json(summary)

  return NextResponse.json({
    ...summary,
    error: 'Fakturaexport-återförsök kunde inte köras just nu.',
    code: 'invoice_export_retry_cron_failed',
    ...(failedSteps[0] ? { trace_id: failedSteps[0].trace_id } : {}),
  }, { status: 500 })
}

export async function GET(request: NextRequest) { return run(request) }
export async function POST(request: NextRequest) { return run(request) }
