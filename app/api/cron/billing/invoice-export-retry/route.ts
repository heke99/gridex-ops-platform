import { randomUUID, timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { processDueInvoiceExportRetries } from '@/lib/integrations/billing/invoiceExportCore'

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

async function run(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 })
  }

  try {
    const limitRaw = Number(clean(request.nextUrl.searchParams.get('limit')) ?? '50')
    const result = await processDueInvoiceExportRetries({
      companyId: clean(request.nextUrl.searchParams.get('company_id')),
      limit: Number.isFinite(limitRaw) ? limitRaw : 50,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    const traceId = randomUUID()
    console.error('[invoice-export-retry-cron] failed', { traceId, error })
    return NextResponse.json(
      { ok: false, error: 'Fakturaexport-återförsök kunde inte köras just nu.', code: 'invoice_export_retry_cron_failed', trace_id: traceId },
      { status: 500 },
    )
  }
}

export async function GET(request: NextRequest) { return run(request) }
export async function POST(request: NextRequest) { return run(request) }
