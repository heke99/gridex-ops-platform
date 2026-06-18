import { randomUUID, timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { processCustomerOperationJobs } from '@/lib/customer-operations/automation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function clean(value: string | null | undefined) {
  const text = String(value ?? '').trim()
  return text || null
}

function authorized(request: NextRequest) {
  const expected = [process.env.CUSTOMER_OPERATION_CRON_SECRET, process.env.CRON_SECRET]
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

function limit(value: string | null) {
  const parsed = Number(value ?? 20)
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.floor(parsed), 1), 100) : 20
}

async function run(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 })
  try {
    const result = await processCustomerOperationJobs({
      workerId: `customer-operations-cron:${new Date().toISOString()}`,
      limit: limit(request.nextUrl.searchParams.get('limit')),
    })
    return NextResponse.json({ ok: true, result })
  } catch (error) {
    const traceId = randomUUID()
    console.error('[customer-operations-cron] failed', { traceId, error })
    return NextResponse.json(
      { ok: false, error: 'Kundautomation kunde inte köras just nu.', code: 'customer_operation_processing_failed', trace_id: traceId },
      { status: 500 },
    )
  }
}

export async function GET(request: NextRequest) { return run(request) }
export async function POST(request: NextRequest) { return run(request) }
