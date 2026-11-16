import { randomUUID, timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { processCompanyProvisioningJobs } from '@/lib/tenant/provisioningWorker'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function clean(value: string | null | undefined) {
  const normalized = String(value ?? '').trim()
  return normalized || null
}

function authorized(request: NextRequest) {
  const expected = [process.env.TENANT_PROVISIONING_CRON_SECRET, process.env.CRON_SECRET]
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
    const requested = Number(request.nextUrl.searchParams.get('limit') ?? 20)
    const result = await processCompanyProvisioningJobs({
      workerId: `tenant-provisioning:${randomUUID()}`,
      limit: Number.isFinite(requested) ? requested : 20,
    })
    return NextResponse.json({ ok: true, result })
  } catch (error) {
    const traceId = randomUUID()
    console.error('[tenant-provisioning-cron] failed', { traceId, error })
    return NextResponse.json({
      ok: false,
      code: 'tenant_provisioning_failed',
      error: 'Tenantprovisioneringen kunde inte köras.',
      trace_id: traceId,
    }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  return run(request)
}

export async function POST(request: NextRequest) {
  return run(request)
}
