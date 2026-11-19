// Physical E03 candidate. No tenant/history authority is manufactured here.
import { readFileSync, realpathSync, lstatSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { parseInboundEmailContent } from '@/lib/inbound-mail/edielEmailParser'
import { triggerInbound, type HttpResult } from './app'
import { appendToInbox, setSmtpMode } from './counterparty'
import { qualifiedEngine } from './e01-chain'
import { E02OutboxAdmission } from './e02-outbox'
import { Evidence } from './evidence'
import { buildEdifactMime } from './mime'
import { sqlJson, lit } from './seed.mjs'
import type { E03Source } from './e03-fixture'
import type { InboundEngineRunResult } from '@/lib/inbound-mail/edielMailboxPoller.part-1'

const owners = new WeakMap<E03Source, E02OutboxAdmission>()
const byOutbox = new Map<string, { source: E03Source; admission: E02OutboxAdmission; evidence: Evidence; directory: string }>()
let held = false
const attempts = new Set<string>()
const dispatches = new Set<string>(), probes = new Set<string>()
function stop(message: string): never { throw new Error(`T3_HARNESS_PRECONDITION: ${message}`) }
function known() { if (held) stop('E03 effects require observation before another operation') }
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex')
function requireQuiescentIngress() {
  const counts = sqlJson(`/* t3-e03:global-ingress */ SELECT jsonb_build_object(
    'inbound',(SELECT count(*) FROM public.inbound_processing_jobs WHERE status IN ('queued','retry','received','processing')),
    'customer',(SELECT count(*) FROM public.customer_operation_jobs WHERE status IN ('queued','running')),
    'outbound',(SELECT count(*) FROM public.outbound_requests WHERE company_id IS NOT NULL AND status IN ('sent','prepared','queued','syntax_accepted','application_accepted','acknowledged')))`)
  if (!counts || typeof counts !== 'object' || Array.isArray(counts)
    || ['inbound', 'customer', 'outbound'].some(key => (counts as Record<string, unknown>)[key] !== 0)) stop('global intake workers have unassigned work')
}
function prepareAssignedSchedule(mailboxId: string, environment: string) {
  // This is the private fixture's exact shared endpoint, not discovered work.
  // An existing lock is never expired, cleared or stolen by the harness.
  const row = sqlJson(`/* t3-e03:assigned-schedule */ UPDATE public.ediel_mailboxes SET last_polled_at=NULL
    WHERE id=${lit(mailboxId)} AND environment=${lit(environment)} AND company_id IS NULL AND is_active=true
      AND metadata->>'scope'='platform_shared' AND locked_at IS NULL AND locked_by IS NULL
    RETURNING jsonb_build_object('id',id,'environment',environment)`)
  if (!row || typeof row !== 'object' || Array.isArray(row)
    || (row as Record<string, unknown>).id !== mailboxId || (row as Record<string, unknown>).environment !== environment) stop('assigned mailbox changed or locked')
}

export function assignedE03Mailbox(environment: 'test' | 'production'): string {
  const home = process.env.SIM_HOME
  if (!home || realpathSync(home) !== home) stop('canonical private fixture home required')
  const file = join(home, 'fixture.json'), stat = lstatSync(file)
  if (!stat.isFile() || stat.uid !== process.getuid!() || (stat.mode & 0o777) !== 0o600 || realpathSync(file) !== file) stop('private fixture changed')
  const fixture = JSON.parse(readFileSync(file, 'utf8'))
  const mailboxId = fixture.mailboxes?.[environment]
  if (typeof mailboxId !== 'string' || !mailboxId) stop('assigned fixture mailbox required')
  return mailboxId
}

export async function receiveE03Physical(input: { prefix: string; seq: number; raw: string; companyId: string; environment: 'test' | 'production' }): Promise<E03Source> {
  known()
  if (!input.prefix || !Number.isSafeInteger(input.seq) || input.seq < 1 || !input.raw || !input.companyId) stop('exact E03 input required')
  const key = JSON.stringify([input.environment, input.prefix, input.seq])
  if (attempts.has(key)) stop('physical input already attempted')
  const mailboxId = assignedE03Mailbox(input.environment)
  const admission = new E02OutboxAdmission({ companyId: input.companyId, environment: input.environment, mailboxId })
  // Empty full active set before mutating IMAP; an exclusive producer phase is
  // an independent prerequisite. This observation does not acquire a lease.
  admission.admit([])
  requireQuiescentIngress()
  const built = buildEdifactMime({ from: '70007@dso.t3.sim.invalid', to: process.env.T3_MAILBOX_ADDRESS ?? 'ediel@t3.sim.invalid',
    subject: `E66 ${input.prefix} ${input.seq}`, raw: input.raw, placement: 'inline', messageId: `<${input.prefix}-${input.seq}@t3.sim.invalid>` })
  const parsed = parseInboundEmailContent({ rawEmail: built.mime.toString('utf8') })
  if (!parsed || parsed.messageFamily !== 'UTILTS' || !parsed.rawPayload) stop('independent physical payload unavailable')
  if (!process.env.T3_EVIDENCE_DIR) stop('assigned scenario evidence directory required')
  const evidence = new Evidence(), directory = `physical/${hash(key)}`
  evidence.save(`${directory}/input.eml`, built.mime)
  evidence.save(`${directory}/input.json`, { mailboxId, mimeSha256: hash(built.mime), sourcePayloadSha256: hash(parsed.rawPayload) })
  attempts.add(key); held = true
  prepareAssignedSchedule(mailboxId, input.environment)
  await appendToInbox(built.mime)
  admission.rememberMime(built.mime)
  // Exactly one ordinary HTTP attempt for this one-message input. No actor
  // fallback, diagnostic reprocessing or repeat after an ambiguous response.
  evidence.save(`${directory}/http-intent.json`, { environment: input.environment, mailboxId, attempt: 1 })
  requireQuiescentIngress()
  let response: HttpResult
  try { response = await triggerInbound(input.environment, mailboxId) }
  catch (error) { evidence.save(`${directory}/http-unknown.json`, { outcome: 'unknown', retry: false }); throw error }
  evidence.save(`${directory}/http-result.json`, response)
  const body = response.body as { ok?: boolean; result?: InboundEngineRunResult } | null
  if (!response.ok || response.status !== 200 || body?.ok !== true || !body.result) stop('ordinary HTTP intake unknown or failed')
  const result = qualifiedEngine({ ok: true, result: body.result })
  if (result.debug.customerOperationJobs?.claimed !== 0 || !result.overdueTasks
    || ['ackOverdue', 'z04Overdue', 'z14Overdue'].some(key => (result.overdueTasks as unknown as Record<string, unknown>)[key] !== 0)) stop('ordinary intake performed unassigned global jobs')
  const emails = result.inboundEmailMessageIds, sources = result.edielMessageIds
  if (!Array.isArray(emails) || emails.length !== 1 || !Array.isArray(sources) || sources.length !== 1) stop('complete one-message physical intake required')
  admission.observePoll(emails, sources)
  // Existing admission deliberately refuses technical-only NULL-tenant rows
  // as worker authority. Keep that HOLD rather than pretending attribution.
  if (admission.sources.length !== 1 || admission.sources[0].sourceMessageId !== sources[0]
    || admission.sources[0].inboundEmailMessageId !== emails[0] || admission.sources[0].mimeSha256 !== hash(built.mime)
    || admission.sources[0].sourcePayloadSha256 !== hash(parsed.rawPayload)) stop('exact independently decoded source required')
  const outputs = admission.captureOutboxes(sources)
  if (outputs.length !== 1 || outputs[0].ackFamily !== 'CONTRL') stop('one causal initial CONTRL outbox required')
  admission.admit([outputs[0].id])
  const fresh = sqlJson(`/* t3-e03:fresh-transport */ SELECT jsonb_build_object('status',o.status,'attempts',(SELECT count(*) FROM gridex_ediel_transport.attempts a WHERE a.message_id=o.ediel_message_id)) FROM public.ediel_outbox o WHERE o.id=${lit(outputs[0].id)}`) as { status?: string; attempts?: number } | null
  if (!fresh || !['queued', 'prepared'].includes(fresh.status ?? '') || fresh.attempts !== 0) stop('new physical reply must be fresh unattempted queued work')
  const received = sqlJson(`/* t3-e03:physical-received */ SELECT jsonb_build_object('receivedAt',received_at) FROM public.inbound_email_messages WHERE id=${lit(emails[0])}`) as { receivedAt?: unknown } | null
  if (!received || typeof received.receivedAt !== 'string' || !Number.isFinite(Date.parse(received.receivedAt))) stop('actual receipt time required')
  const timers = sqlJson(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.timer_type),'[]') FROM public.ediel_sla_timers t WHERE t.ediel_message_id=${lit(sources[0])}`)
  if (!Array.isArray(timers)) stop('timer observation unavailable')
  const source: E03Source = Object.freeze({ prefix: input.prefix, seq: input.seq, companyId: input.companyId,
    sourceMessageId: sources[0], inboundEmailMessageId: emails[0], receivedAt: received.receivedAt,
    raw: parsed.rawPayload, outboxId: outputs[0].id, ackMessageId: outputs[0].ackMessageId, timers })
  evidence.save(`${directory}/receipts.json`, { source: admission.sources[0], outbox: outputs[0], fresh, receivedAt: received.receivedAt, timers })
  owners.set(source, admission); byOutbox.set(outputs[0].id, { source, admission, evidence, directory }); held = false
  return source
}

export function requireE03Physical(source: E03Source): void {
  known()
  const admission = owners.get(source)
  if (!admission || !source.outboxId) stop('physical reception receipt required; source shape grants no authority')
  admission.assertSources([source.sourceMessageId]); admission.admit([source.outboxId])
}
export function admitE03PhysicalOutbox(id: string): void {
  known()
  const owner = byOutbox.get(id)
  if (!owner) stop('actual physical receipt required for worker')
  requireE03Physical(owner.source)
}
export function holdE03Physical(): void { held = true }
/** The second call is an explicit no-resend oracle after a known uncertain
 * classification, never retry authority after an unknown HTTP outcome. */
export async function dispatchE03Physical(id: string, action: () => Promise<HttpResult>, uncertainNoResendProbe = false): Promise<HttpResult> {
  admitE03PhysicalOutbox(id)
  const owner = byOutbox.get(id)!
  const status = () => sqlJson(`/* t3-e03:dispatch-state */ SELECT to_jsonb(status) FROM public.ediel_outbox WHERE id=${lit(id)}`)
  const before = status()
  if (uncertainNoResendProbe) {
    if (!dispatches.has(id) || probes.has(id) || before !== 'delivery_uncertain') stop('explicit known-uncertain no-resend probe required')
    probes.add(id)
  } else {
    if (dispatches.has(id) || !['queued', 'prepared'].includes(String(before))) stop('fresh dispatch already attempted or sending')
    dispatches.add(id)
  }
  held = true
  const phase = uncertainNoResendProbe ? 'no-resend-probe' : 'fresh-dispatch'
  owner.evidence.save(`${owner.directory}/${phase}-intent.json`, { outboxId: id, before })
  let response: HttpResult
  try { response = await action() }
  catch (error) { owner.evidence.save(`${owner.directory}/${phase}-unknown.json`, { outcome: 'unknown', retry: false }); throw error }
  owner.evidence.save(`${owner.directory}/${phase}-http.json`, response)
  const body = response.body as { ok?: boolean; result?: { processed?: unknown; results?: unknown } } | null
  if (!response.ok || response.status !== 200 || body?.ok !== true || !body.result
    || !Number.isSafeInteger(body.result.processed) || Number(body.result.processed) < 0 || !Array.isArray(body.result.results)) stop('worker HTTP outcome unknown')
  owner.admission.assertSources([owner.source.sourceMessageId]); owner.admission.admit([id])
  const after = status()
  if (!['sent', 'failed', 'blocked', 'delivery_uncertain'].includes(String(after))) stop('transport effect incomplete or sending')
  if (uncertainNoResendProbe && (body.result.processed !== 0 || body.result.results.length !== 0 || after !== 'delivery_uncertain')) stop('no-resend probe changed transport effect')
  if (!uncertainNoResendProbe) {
    const results = body.result.results as Array<{ id?: unknown; status?: unknown }>
    if (body.result.processed !== 1 || results.length !== 1 || !results[0] || results[0].id !== id || results[0].status !== after) stop('worker processed an unassigned or mismatching transport result')
  }
  held = false
  return response
}
export async function setE03PhysicalSmtp(source: E03Source | null, mode: 'accept' | 'drop-after-data' | 'hang', options?: { hangMs: number }): Promise<void> {
  known()
  try {
    if (!source && mode !== 'accept') stop('negative SMTP control requires actual physical source')
    if (source) {
      requireE03Physical(source)
      const state = sqlJson(`/* t3-e03:dispatch-state */ SELECT to_jsonb(status) FROM public.ediel_outbox WHERE id=${lit(source.outboxId!)}`)
      // Before any dispatch, the fresh receipt can set either the initial
      // accepting mode or its declared negative control. After a dispatch,
      // only restoration from a qualified terminal outcome is authorized.
      const allowed = dispatches.has(source.outboxId!)
        ? mode === 'accept' ? ['sent', 'failed', 'blocked', 'delivery_uncertain'] : []
        : ['queued', 'prepared']
      if (typeof state !== 'string' || !allowed.includes(state)) stop('unknown, sending or inappropriate transport state cannot authorize SMTP control')
    }
    const active = sqlJson(`/* t3-e03:shared-smtp */ SELECT coalesce(jsonb_agg(id),'[]') FROM public.ediel_outbox WHERE status IN ('prepared','queued','sending')`)
    if (!Array.isArray(active) || active.some(id => id !== source?.outboxId)) stop('shared SMTP has unassigned active work')
    held = true
    await setSmtpMode(mode, options)
    held = false
  } catch (error) {
    // A later successful read never heals a missing/failed original observation.
    held = true
    throw error
  }
}
