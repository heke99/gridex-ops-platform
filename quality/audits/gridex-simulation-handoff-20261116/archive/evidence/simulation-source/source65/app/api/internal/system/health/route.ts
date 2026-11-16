import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getOpsHealth } from '@/lib/ops/health'
import { internalApiError } from '@/lib/http/apiError'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function clean(value: string | null | undefined) {
  const normalized = String(value ?? '').trim()
  return normalized || null
}

function expectedSecrets() {
  return [process.env.OPS_HEALTH_CRON_SECRET, process.env.CRON_SECRET]
    .map(clean)
    .filter((value): value is string => Boolean(value))
}

function token(request: NextRequest) {
  const authorization = request.headers.get('authorization') ?? ''
  return authorization.toLowerCase().startsWith('bearer ')
    ? clean(authorization.slice('bearer '.length))
    : clean(request.headers.get('x-ops-health-secret')) ?? clean(request.headers.get('x-cron-secret'))
}

function equal(left: string | null, right: string) {
  if (!left) return false
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

function authorized(request: NextRequest) {
  const candidate = token(request)
  return expectedSecrets().some((secret) => equal(candidate, secret))
}

async function run(request: NextRequest) {
  if (expectedSecrets().length === 0) {
    return NextResponse.json({ ok: false, error: 'Driftkontroll saknar cron-hemlighet.', code: 'ops_health_secret_missing' }, { status: 503 })
  }
  if (!authorized(request)) return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 })

  try {
    const health = await getOpsHealth()
    const blocking = health.rows.filter((row) => row.status === 'blocking')
    const warnings = health.rows.filter((row) => row.status === 'warning')
    return NextResponse.json({
      ok: blocking.length === 0,
      status: blocking.length > 0 ? 'blocking' : warnings.length > 0 ? 'warning' : 'ok',
      schema_ready: health.schemaReady,
      blocking_count: blocking.length,
      warning_count: warnings.length,
      checks: health.rows,
    }, { status: blocking.length > 0 ? 503 : 200 })
  } catch (error) {
    return internalApiError({ context: 'ops-health', error, code: 'ops_health_failed', message: 'Driftkontrollen kunde inte köras.' })
  }
}

export async function GET(request: NextRequest) { return run(request) }
export async function POST(request: NextRequest) { return run(request) }
