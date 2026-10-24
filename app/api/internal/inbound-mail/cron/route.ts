// app/api/internal/inbound-mail/cron/route.ts
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { resolveConfiguredEdielAutomationActorId } from '@/lib/ediel/automationActor'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Reality G-1: one run polls up to 25 mails, processes them and then resumes
// held UTILTS (one resume stores a whole file, 2-3 minutes). Without a declared
// limit a run was measured at 315 s; the engine now stops starting work that
// cannot finish ROUTE_DEADLINE_RESERVE_MS before this limit.
export const maxDuration = 300
// Kept for what follows the held resume (customer-operation jobs, run log) and the response.
const ROUTE_DEADLINE_RESERVE_MS = 30_000

function isAuthorized(request: NextRequest): boolean {
  const configuredSecret = process.env.EDIEL_INBOUND_CRON_SECRET ?? process.env.CRON_SECRET
  if (!configuredSecret) return false

  const authorization = request.headers.get('authorization') ?? ''
  const bearer = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : null
  const headerSecret = request.headers.get('x-cron-secret')

  return [bearer, headerSecret].some((candidate) => {
    if (!candidate) return false
    const left = Buffer.from(candidate)
    const right = Buffer.from(configuredSecret)
    return left.length === right.length && timingSafeEqual(left, right)
  })
}

function parseEnvironment(value: string | null): 'test' | 'production' {
  if (value === 'test' || value === 'production') return value
  throw new Error('environment måste vara test eller production.')
}

function safeInboundErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '')
  if (/mailbox.*missing|mailbox.*not.*found|no active mailbox/i.test(message)) return 'mailbox_config_missing'
  if (/credential|password|username|secret|imap.*env/i.test(message)) return 'imap_credentials_missing'
  if (/authentication|login|AUTHENTICATIONFAILED|Invalid credentials/i.test(message)) return 'imap_login_failed'
  if (/ECONN|ETIMEDOUT|ENOTFOUND|imap.*connect|socket/i.test(message)) return 'imap_connection_failed'
  if (/smime|cms|decrypt|certificate|pfx/i.test(message)) return 'smime_decrypt_failed'
  if (/parse|edifact|payload/i.test(message)) return 'inbound_payload_parse_failed'
  return 'inbound_mail_processing_failed'
}

export async function POST(request: NextRequest) {
  const deadlineAt = Date.now() + maxDuration * 1000 - ROUTE_DEADLINE_RESERVE_MS
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  if (request.nextUrl.searchParams.get('company_id') || request.nextUrl.searchParams.get('companyId')) {
    return NextResponse.json({ ok: false, error: 'company_id overrides är inte tillåtna för shared mailbox-cron.' }, { status: 400 })
  }

  let environment: 'test' | 'production'
  try {
    environment = parseEnvironment(request.nextUrl.searchParams.get('environment'))
  } catch {
    return NextResponse.json({ ok: false, error: 'environment måste vara test eller production.', code: 'invalid_environment' }, { status: 400 })
  }

  const mailboxId = request.nextUrl.searchParams.get('mailbox_id') ?? request.nextUrl.searchParams.get('mailboxId')
  const debugForceAllowed = request.headers.get('x-gridex-internal-debug') === 'true'
  const force = debugForceAllowed && ['1', 'true', 'yes'].includes((request.nextUrl.searchParams.get('force') ?? '').toLowerCase())

  // Reception is recorded by a real current actor; the scheduled run uses the
  // same configured Ediel automation actor as the outbox cron.
  let actorUserId: string
  try {
    actorUserId = await resolveConfiguredEdielAutomationActorId()
  } catch (error) {
    console.error('[inbound-mail-cron] automation actor configuration failed', error)
    return NextResponse.json({ ok: false, error: 'Ediel-automation saknar giltig systemaktör.', code: 'ediel_automation_actor_missing' }, { status: 503 })
  }

  try {
    const { runInboundEdielMailEngine } = await import('@/lib/inbound-mail/edielMailboxPoller')
    const result = await runInboundEdielMailEngine({
      actorUserId,
      environment,
      mailboxId,
      force,
      sharedOnly: !mailboxId,
      allowMissingMailboxConfig: true,
      // F103: the scheduled lane resumes its own stranded 'received' inbound messages.
      resumeStrandedInboundMessages: true,
      deadlineAt,
    })
    return NextResponse.json({ ok: true, result })
  } catch (error) {
    const traceId = randomUUID()
    const code = safeInboundErrorCode(error)
    console.error('[inbound-mail-cron] Run failed', { traceId, environment, mailboxId, code, error })
    return NextResponse.json(
      { ok: false, error: 'Inbound mail engine failed.', code, trace_id: traceId, environment, mailbox_id: mailboxId ?? null },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  return POST(request)
}
