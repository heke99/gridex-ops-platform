import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { processEdielOutbox } from '@/lib/ediel/outbox/processEdielOutbox'
import { supabaseService } from '@/lib/supabase/service'
import { configuredEdielAutomationActorId } from '@/lib/ediel/automationActor'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function expectedSecrets(): string[] {
  return [process.env.EDIEL_PLATFORM_MAINTENANCE_SECRET, process.env.EDIEL_CRON_SECRET]
    .map((value) => clean(value))
    .filter((value): value is string => Boolean(value))
}

function requestToken(request: NextRequest): string | null {
  const authorization = request.headers.get('authorization') ?? ''
  if (authorization.toLowerCase().startsWith('bearer ')) return clean(authorization.slice('bearer '.length))
  return clean(request.headers.get('x-ediel-platform-maintenance-secret')) ?? clean(request.headers.get('x-ediel-cron-secret'))
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

function parseLimit(value: unknown): number {
  const parsed = Number(value ?? 25)
  if (!Number.isFinite(parsed) || parsed <= 0) return 25
  return Math.min(Math.floor(parsed), 100)
}

async function companyExists(companyId: string): Promise<boolean> {
  const { data, error } = await supabaseService
    .from('companies')
    .select('id')
    .eq('id', companyId)
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return Boolean(data)
}

export async function POST(request: NextRequest) {
  if (expectedSecrets().length === 0) {
    return NextResponse.json({ ok: false, error: 'EDIEL_PLATFORM_MAINTENANCE_SECRET is not configured.' }, { status: 503 })
  }
  if (!isAuthorized(request)) return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 })

  const body = await request.json().catch(() => ({} as Record<string, unknown>))
  const companyId = clean(body.companyId) ?? clean(body.company_id)
  const reason = clean(body.reason)
  const environment = clean(body.environment)
  let actorUserId: string
  try {
    actorUserId = configuredEdielAutomationActorId()
  } catch (error) {
    console.error('[ediel-outbox-company] automation actor configuration failed', error)
    return NextResponse.json({ ok: false, error: 'Ediel-automation saknar giltig systemaktör.', code: 'ediel_automation_actor_missing' }, { status: 503 })
  }

  if (!companyId) return NextResponse.json({ ok: false, error: 'company_id krävs.' }, { status: 400 })
  if (!reason) return NextResponse.json({ ok: false, error: 'reason krävs för company-scoped outbox processing.' }, { status: 400 })
  if (!(await companyExists(companyId))) return NextResponse.json({ ok: false, error: 'company_id hittades inte.' }, { status: 404 })

  const result = await processEdielOutbox({
    actorUserId,
    companyId,
    environment,
    limit: parseLimit(body.limit),
  })

  await supabaseService.from('audit_logs').insert({
    company_id: companyId,
    actor_user_id: actorUserId,
    entity_type: 'ediel_outbox',
    entity_id: companyId,
    action: 'ediel_outbox_company_scoped_process',
    metadata: { reason, environment, result },
  }).then(({ error }) => {
    if (error) console.warn('[ediel-outbox-company] Audit log skipped', error)
  })

  return NextResponse.json({ ok: true, source: 'ediel_outbox_company_maintenance', companyId, environment, result })
}
