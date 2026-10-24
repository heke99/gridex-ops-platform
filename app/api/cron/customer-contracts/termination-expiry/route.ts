import { randomUUID, timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createTerminationNoticeExpiryTasks } from '@/lib/customer-contracts/terminationNoticeExpiry'

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

// FINDINGS H3d B3/B6 (owner decisions 2026-10-23 and 2026-10-24): a termination without a move whose notice period
// ends within TERMINATION_Z08_TASK_LEAD_DAYS days while the supply is still ours (no new supplier's Z05) gets one
// operator task to send an end of supply (Z08) to the grid owner in good time; an open task is closed automatically
// once a Z05 ended the supply first. Nothing is sent automatically; the database command is idempotent and
// tenant-scoped per contract.
async function run(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 })
  try {
    const result = await createTerminationNoticeExpiryTasks()
    return NextResponse.json({ ok: true, result })
  } catch (error) {
    const traceId = randomUUID()
    console.error('[termination-expiry-cron] failed', { traceId, error })
    return NextResponse.json(
      { ok: false, error: 'Kontrollen av utgångna uppsägningar kunde inte köras just nu.', code: 'termination_expiry_cron_failed', trace_id: traceId },
      { status: 500 },
    )
  }
}

export async function GET(request: NextRequest) { return run(request) }
export async function POST(request: NextRequest) { return run(request) }
