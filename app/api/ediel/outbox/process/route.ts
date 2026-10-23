import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { drainEdielOutbox } from '@/lib/ediel/outbox/drainEdielOutbox'
import { resolveConfiguredEdielAutomationActorId } from '@/lib/ediel/automationActor'
import { recordCompanyCertifiedScopes } from '@/lib/ediel/companyCertifiedScopes'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// The run drains the queue in batches for up to EDIEL_OUTBOX_DRAIN_BUDGET_MS (FINDINGS P8).
export const maxDuration = 120

type EdielEnvironment = 'test' | 'production'

function clean(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function expectedSecrets(): string[] {
  return [process.env.EDIEL_CRON_SECRET, process.env.CRON_SECRET]
    .map((value) => clean(value))
    .filter((value): value is string => Boolean(value))
}

function requestToken(request: NextRequest): string | null {
  const authorization = request.headers.get('authorization') ?? ''
  if (authorization.toLowerCase().startsWith('bearer ')) {
    return clean(authorization.slice('bearer '.length))
  }

  return clean(request.headers.get('x-ediel-cron-secret')) ?? clean(request.headers.get('x-cron-secret'))
}

function isAuthorized(request: NextRequest): boolean {
  const token = requestToken(request)
  if (!token) return false
  return expectedSecrets().some((secret) => {
    const left = Buffer.from(token)
    const right = Buffer.from(secret)
    return left.length === right.length && timingSafeEqual(left, right)
  })
}

function parseEnvironment(value: string | null): EdielEnvironment | null {
  if (value === 'test' || value === 'production') return value
  return null
}

function parseLimit(value: unknown): number {
  const parsed = Number(value ?? 25)
  if (!Number.isFinite(parsed) || parsed <= 0) return 25
  return Math.min(Math.floor(parsed), 100)
}

async function readPostBody(request: NextRequest): Promise<Record<string, unknown>> {
  return request.json().catch(() => ({} as Record<string, unknown>))
}

async function runOutboxProcessor(request: NextRequest, body: Record<string, unknown> = {}) {
  if (expectedSecrets().length === 0) {
    return NextResponse.json(
      { ok: false, error: 'EDIEL_CRON_SECRET or CRON_SECRET is not configured.' },
      { status: 503 }
    )
  }

  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 })
  }

  const searchParams = request.nextUrl.searchParams
  let actorUserId: string
  try {
    actorUserId = await resolveConfiguredEdielAutomationActorId()
  } catch (error) {
    console.error('[ediel-outbox-cron] automation actor configuration failed', error)
    return NextResponse.json({ ok: false, error: 'Ediel-automation saknar giltig systemaktör.', code: 'ediel_automation_actor_missing' }, { status: 503 })
  }
  const ignoredCompanyId = clean(String(body.companyId ?? body.company_id ?? '')) ?? clean(searchParams.get('companyId')) ?? clean(searchParams.get('company_id'))
  const environment =
    parseEnvironment(String(body.environment ?? '')) ?? parseEnvironment(searchParams.get('environment'))
  const limit = parseLimit(body.limit ?? searchParams.get('limit'))

  // Owner decision 2026-10-23 (F89/F90/F91): before production sends, the platform records the
  // per-scope proof from the tenant's own company certification for every pending scope whose
  // proof is missing or stale (new release, route or rule edition). The gate is unchanged and
  // still refuses without a current proof; a failure here never stops the outbox (CONTRL/APERAK).
  let scopeEvidence: unknown = null
  if (environment !== 'test') {
    scopeEvidence = await recordCompanyCertifiedScopes().catch((error: unknown) => {
      console.error('[ediel-outbox-cron] company-certified scope evidence failed', error instanceof Error ? error.message : 'Unknown error')
      return { status: 'failed', reason: 'ediel_company_certified_scopes_failed' }
    })
  }

  try {
    // Batches of `limit` until the queue is drained or the time budget is spent, not one batch per run (FINDINGS P8).
    const result = await drainEdielOutbox({
      actorUserId,
      environment,
      limit,
    })

    return NextResponse.json({
      ok: true,
      source: 'ediel_outbox_cron',
      environment,
      companyId: null,
      ignoredCompanyOverride: ignoredCompanyId ? 'blocked_on_generic_cron' : null,
      scopeEvidence,
      result,
    })
  } catch (error) {
    console.error('[ediel-outbox-cron] Run failed', error instanceof Error ? error.message : 'Unknown error')
    return NextResponse.json(
      {
        ok: false,
        error: 'Ediel outbox processing failed.', code: 'ediel_outbox_processing_failed',
      },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  return runOutboxProcessor(request)
}

export async function POST(request: NextRequest) {
  return runOutboxProcessor(request, await readPostBody(request))
}
