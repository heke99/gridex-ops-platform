// Physical EDIEL03.04 pair. SQL below changes only the declared lease-clock fixture.
import { createHash } from 'node:crypto'
import { parseInboundEmailContent } from '@/lib/inbound-mail/edielEmailParser'
import type { InboundEngineRunResult } from '@/lib/inbound-mail/edielMailboxPoller.part-1'
import { triggerInbound, type HttpResult } from './app'
import { appendToInbox, receivedMail, setSmtpMode } from './counterparty'
import { qualifiedEngine } from './e01-chain'
import { E02OutboxAdmission } from './e02-outbox'
import { assignedE03Mailbox } from './e03-reception'
import type { E03Source } from './e03-fixture'
import { Evidence } from './evidence'
import { buildEdifactMime } from './mime'
import { sqlJson, lit } from './seed.mjs'

export type PhysicalInput = Readonly<{ prefix: string; seq: number; raw: string; companyId: string; environment: 'test' | 'production' }>
type Row = Record<string, unknown>
type Claim = Readonly<{ worker: string; attempt: string }>
let held = false, attempted = false, poisoned = false
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex')
function stop(message: string): never { held = true; poisoned = true; throw new Error(`T3_HARNESS_PRECONDITION: ${message}`) }
function known() { if (held) stop('E03 lease recovery held; no further effects authorized') }
function unpoisoned() { if (poisoned) stop('concurrent or failed phase remains held') }
function row(value: unknown): Row { if (!value || typeof value !== 'object' || Array.isArray(value)) stop('complete observation required'); return value as Row }
function quiet() {
  const counts = row(sqlJson(`/* t3-e03-lease:global-ingress */ SELECT jsonb_build_object(
    'inbound',(SELECT count(*) FROM public.inbound_processing_jobs WHERE status IN ('queued','retry','received','processing')),
    'customer',(SELECT count(*) FROM public.customer_operation_jobs WHERE status IN ('queued','running')),
    'outbound',(SELECT count(*) FROM public.outbound_requests WHERE company_id IS NOT NULL AND status IN ('sent','prepared','queued','syntax_accepted','application_accepted','acknowledged')))`))
  if (['inbound', 'customer', 'outbound'].some(key => counts[key] !== 0)) stop('unassigned global ingress work')
}
function activeOnly(ids: readonly string[]) {
  const active = sqlJson(`/* t3-e03-lease:shared-smtp */ SELECT coalesce(jsonb_agg(id),'[]') FROM public.ediel_outbox WHERE status IN ('prepared','queued','sending')`)
  if (!Array.isArray(active) || new Set(active).size !== active.length || active.some(id => !ids.includes(id))) stop('unassigned global active outbox')
}

export async function receiveE03LeaseRecoveryPair(provided: readonly [PhysicalInput, PhysicalInput]) {
  known()
  if (attempted) stop('pair already attempted; no retry or new sequence')
  // Latch before observations too: a failed admission cannot be healed by another pair.
  attempted = true; held = true
  if (!Array.isArray(provided) || provided.length !== 2 || provided.some(x => !x || typeof x !== 'object')) stop('exact physical pair required')
  const inputs = provided.map(x => Object.freeze({ prefix: x.prefix, seq: x.seq, raw: x.raw, companyId: x.companyId, environment: x.environment })) as [PhysicalInput, PhysicalInput]
  const [a, b] = inputs
  if (inputs.some(x => !x || typeof x.prefix !== 'string' || !x.prefix.trim() || x.prefix !== x.prefix.trim() || typeof x.companyId !== 'string' || !x.companyId.trim() || x.companyId !== x.companyId.trim() || typeof x.raw !== 'string' || !x.raw || !Number.isSafeInteger(x.seq) || x.seq < 1 || !['test', 'production'].includes(x.environment))
    || a.prefix !== b.prefix || a.companyId !== b.companyId || a.environment !== b.environment || a.seq === b.seq || a.raw === b.raw) stop('distinct physical inputs in one scope required')
  const mailboxId = assignedE03Mailbox(a.environment)
  const admission = new E02OutboxAdmission({ companyId: a.companyId, environment: a.environment, mailboxId })
  admission.admit([]); activeOnly([]); quiet()
  if (!process.env.T3_EVIDENCE_DIR) stop('assigned private evidence directory required')
  const evidence = new Evidence(), directory = `physical-lease/${hash(JSON.stringify([a.environment, a.prefix, a.seq, b.seq]))}`
  const built = inputs.map(input => {
    const mime = buildEdifactMime({ from: '70007@dso.t3.sim.invalid', to: process.env.T3_MAILBOX_ADDRESS ?? 'ediel@t3.sim.invalid',
      subject: `E66 ${input.prefix} ${input.seq}`, raw: input.raw, placement: 'inline', messageId: `<${input.prefix}-${input.seq}@t3.sim.invalid>` }).mime
    const parsed = parseInboundEmailContent({ rawEmail: mime.toString('utf8') })
    if (!parsed || parsed.messageFamily !== 'UTILTS' || !parsed.rawPayload) stop('independent UTILTS payload required')
    return { mime, raw: parsed.rawPayload, mimeHash: hash(mime), payloadHash: hash(parsed.rawPayload) }
  })
  if (built[0].mimeHash === built[1].mimeHash || built[0].payloadHash === built[1].payloadHash) stop('independently distinct physical payloads required')
  const baseline = await receivedMail()
  unpoisoned()
  if (!Array.isArray(baseline) || baseline.some(x => !Number.isSafeInteger(x.n)) || new Set(baseline.map(x => x.n)).size !== baseline.length) stop('complete SMTP inventory required')
  const smtpSnapshot = JSON.stringify(baseline)
  async function noSmtp() {
    unpoisoned()
    const observation = await receivedMail()
    unpoisoned()
    if (JSON.stringify(observation) !== smtpSnapshot) stop('unexpected SMTP effect')
  }
  function beforeIntakeEffect() { unpoisoned(); admission.admit([]); activeOnly([]); quiet() }
  beforeIntakeEffect()
  await setSmtpMode('accept')
  unpoisoned()
  beforeIntakeEffect()
  const schedule = row(sqlJson(`/* t3-e03-lease:assigned-schedule */ UPDATE public.ediel_mailboxes SET last_polled_at=NULL WHERE id=${lit(mailboxId)} AND environment=${lit(a.environment)} AND company_id IS NULL AND is_active=true AND metadata->>'scope'='platform_shared' AND locked_at IS NULL AND locked_by IS NULL RETURNING jsonb_build_object('id',id,'environment',environment)`))
  if (schedule.id !== mailboxId || schedule.environment !== a.environment) stop('assigned mailbox changed or locked')
  for (const [index, item] of built.entries()) {
    evidence.save(`${directory}/input-${index}.eml`, item.mime)
    evidence.save(`${directory}/append-${index}-intent.json`, { mailboxId, mimeSha256: item.mimeHash, sourcePayloadSha256: item.payloadHash })
    let appended: Awaited<ReturnType<typeof appendToInbox>>
    beforeIntakeEffect()
    try { appended = await appendToInbox(item.mime) }
    catch (error) { evidence.save(`${directory}/append-${index}-unknown.json`, { outcome: 'unknown', retry: false }); throw error }
    evidence.save(`${directory}/append-${index}-result.json`, appended)
    unpoisoned()
    if (!appended || !Number.isSafeInteger(appended.uid) || Number(appended.uid) < 1 || appended.path !== 'INBOX') stop('successful exact APPEND required')
    admission.rememberMime(item.mime)
  }
  quiet()
  evidence.save(`${directory}/http-intent.json`, { mailboxId, environment: a.environment, attempt: 1 })
  let response: HttpResult
  beforeIntakeEffect()
  try { response = await triggerInbound(a.environment, mailboxId) }
  catch (error) { evidence.save(`${directory}/http-unknown.json`, { outcome: 'unknown', retry: false }); throw error }
  evidence.save(`${directory}/http-result.json`, response)
  unpoisoned()
  const body = response.body as { ok?: boolean; result?: InboundEngineRunResult } | null
  if (!response.ok || response.status !== 200 || body?.ok !== true || !body.result) stop('ordinary intake failed or unknown')
  const result = qualifiedEngine({ ok: true, result: body.result })
  if (result.debug.customerOperationJobs?.claimed !== 0 || !result.overdueTasks || ['ackOverdue', 'z04Overdue', 'z14Overdue'].some(key => (result.overdueTasks as unknown as Row)[key] !== 0)) stop('unassigned global engine effects')
  const emails = result.inboundEmailMessageIds, sourceIds = result.edielMessageIds
  if (!Array.isArray(emails) || emails.length !== 2 || new Set(emails).size !== 2 || !Array.isArray(sourceIds) || sourceIds.length !== 2 || new Set(sourceIds).size !== 2) stop('complete two-message intake required')
  admission.observePoll(emails, sourceIds)
  if (admission.sources.length !== 2 || admission.technicalSources.length !== 0) stop('two business receipts required')
  const outputs = admission.captureOutboxes(sourceIds)
  if (outputs.length !== 2 || outputs.some(x => x.ackFamily !== 'CONTRL') || new Set(outputs.map(x => x.id)).size !== 2 || new Set(outputs.map(x => x.ackMessageId)).size !== 2) stop('two distinct causal CONTRL receipts required')
  const sources = inputs.map((input, index) => {
    const receipt = admission.sources.find(x => x.mimeSha256 === built[index].mimeHash && x.sourcePayloadSha256 === built[index].payloadHash)
    const output = outputs.find(x => x.sourceMessageId === receipt?.sourceMessageId)
    if (!receipt || !output) stop('MIME-bound causal source mapping required')
    const received = row(sqlJson(`/* t3-e03-lease:physical-received */ SELECT jsonb_build_object('receivedAt',received_at) FROM public.inbound_email_messages WHERE id=${lit(receipt.inboundEmailMessageId)}`))
    if (typeof received.receivedAt !== 'string' || !Number.isFinite(Date.parse(received.receivedAt))) stop('actual receipt time required')
    const timers = sqlJson(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.timer_type),'[]') FROM public.ediel_sla_timers t WHERE t.ediel_message_id=${lit(receipt.sourceMessageId)}`)
    if (!Array.isArray(timers)) stop('actual timers required')
    return Object.freeze({ prefix: input.prefix, seq: input.seq, companyId: input.companyId, sourceMessageId: receipt.sourceMessageId,
      inboundEmailMessageId: receipt.inboundEmailMessageId, receivedAt: received.receivedAt, raw: built[index].raw,
      outboxId: output.id, ackMessageId: output.ackMessageId, timers }) as E03Source
  }) as [E03Source, E03Source]
  const ids = sources.map(x => x.outboxId!), claims: Array<Claim | undefined> = [], leaseTimes: Array<string | undefined> = [], expired = new Set<number>(), done = new Set<string>()
  let swept = false
  function state(index: 0 | 1) { return row(sqlJson(`/* t3-e03-lease:state */ SELECT to_jsonb(o) FROM public.ediel_outbox o WHERE o.id=${lit(ids[index])}`)) }
  function states() {
    admission.assertSources(sources.map(x => x.sourceMessageId)); admission.admit(ids); activeOnly(ids); quiet()
    return sources.map((source, index) => {
      const value = state(index as 0 | 1)
      const attempts = sqlJson(`/* t3-e03-lease:attempts */ SELECT count(*) FROM gridex_ediel_transport.attempts WHERE message_id=${lit(source.ackMessageId!)}`)
      if (value.id !== ids[index] || attempts !== 0) stop('owned independent state and zero transport attempts required')
      const claim = claims[index]
      if (claim && value.current_send_attempt_id !== claim.attempt) stop('send attempt changed')
      if (claim) {
        if (swept) uncertain(value)
        else { sending(value, index); if (value.locked_at !== leaseTimes[index]) stop('owned lease clock changed outside declared fixture') }
      } else if (!['queued', 'prepared'].includes(String(value.status)) || value.locked_by !== null || value.locked_at !== null || value.current_send_attempt_id !== null) stop('unclaimed owned output changed')
      return value
    })
  }
  function sending(value: Row, index: number) {
    const claim = claims[index]
    if (!claim || value.status !== 'sending' || value.locked_by !== claim.worker || typeof value.locked_at !== 'string' || !Number.isFinite(Date.parse(value.locked_at))) stop('exact sending lease required')
  }
  function uncertain(value: Row) {
    if (value.status !== 'delivery_uncertain' || value.locked_by !== null || value.locked_at !== null || value.last_error !== 'stale_sending_lock_requires_transport_reconciliation') stop('exact uncertain reconciliation state required')
  }
  await noSmtp()
  const initial = states()
  if (initial.some(x => !['queued', 'prepared'].includes(String(x.status)) || x.locked_by !== null || x.locked_at !== null || x.current_send_attempt_id !== null)) stop('fresh unclaimed outputs required')
  evidence.save(`${directory}/receipts.json`, { sources: admission.sources, outputs, initial })
  if (poisoned) stop('concurrent or failed phase remains held')
  held = false
  async function operation<T>(key: string, action: () => Promise<T>): Promise<T> {
    known(); held = true
    if (done.has(key)) stop('operation already attempted')
    done.add(key)
    evidence.save(`${directory}/${key}-intent.json`, { outboxIds: ids })
    try {
      states(); await noSmtp(); states(); unpoisoned()
      const value = await action()
      unpoisoned(); states(); await noSmtp(); states(); unpoisoned()
      evidence.save(`${directory}/${key}-result.json`, value ?? null)
      if (poisoned) stop('concurrent or failed phase remains held')
      held = false
      return value
    } catch (error) { poisoned = true; evidence.save(`${directory}/${key}-unknown.json`, { outcome: 'held', retry: false }); throw error }
  }
  return Object.freeze({
    sources: Object.freeze(sources) as readonly [E03Source, E03Source],
    hold() { held = true; poisoned = true },
    claim(index: 0 | 1, workerId: string, action: () => Promise<unknown>) {
      return operation(`claim-${index}`, async () => {
        if ((index !== 0 && index !== 1) || typeof workerId !== 'string' || !workerId.trim() || workerId !== workerId.trim() || claims.some(x => x?.worker === workerId) || done.has('drain-live')) stop('distinct actual claim worker required')
        const before = state(index)
        if (!['queued', 'prepared'].includes(String(before.status))) stop('fresh claim required')
        const value = row(await action())
        unpoisoned()
        const after = state(index)
        if (value.id !== ids[index] || value.status !== 'sending' || value.locked_by !== workerId || typeof value.current_send_attempt_id !== 'string' || !value.current_send_attempt_id
          || claims.some(x => x?.attempt === value.current_send_attempt_id) || after.id !== value.id || after.status !== value.status || after.locked_by !== workerId || after.current_send_attempt_id !== value.current_send_attempt_id) stop('claim result differs from independent owned row')
        claims[index] = Object.freeze({ worker: workerId, attempt: value.current_send_attempt_id })
        sending(after, index)
        leaseTimes[index] = String(after.locked_at)
        return value
      })
    },
    expireLease(index: 0 | 1) {
      return operation(`expire-${index}`, async () => {
        if ((index !== 0 && index !== 1) || !done.has('drain-live') || (index === 0 && !done.has('probe-1-expired-worker'))) stop('declared lease-clock stage out of order')
        sending(state(index), index)
        const claim = claims[index]!
        const changed = row(sqlJson(`/* t3-e03-lease:expire-lease */ UPDATE public.ediel_outbox SET locked_at=now()-interval '11 minutes' WHERE id=${lit(ids[index])} AND status='sending' AND locked_by=${lit(claim.worker)} AND current_send_attempt_id=${lit(claim.attempt)} RETURNING to_jsonb(ediel_outbox)`))
        const after = state(index)
        sending(after, index)
        if (changed.id !== ids[index] || changed.locked_by !== claim.worker || changed.current_send_attempt_id !== claim.attempt || changed.locked_at !== after.locked_at || Date.parse(String(after.locked_at)) > Date.now() - 10 * 60_000) stop('exact owned expired clock fixture required')
        leaseTimes[index] = String(after.locked_at)
        expired.add(index)
        return changed
      })
    },
    drain(kind: 'live' | 'stale' | 'final', action: () => Promise<HttpResult>) {
      return operation(`drain-${kind}`, async () => {
        if (!['live', 'stale', 'final'].includes(kind)) stop('exact drain stage required')
        const before = states()
        if (kind === 'live') { if (claims.filter(Boolean).length !== 2 || expired.size !== 0) stop('two live claims required'); before.forEach(sending) }
        else if (kind === 'stale') { if (expired.size !== 2 || !done.has('probe-1-expired-worker')) stop('two declared expired leases required'); before.forEach(sending) }
        else { if (!done.has('probe-0-resumed-worker') || !done.has('probe-0-transport-fence') || !done.has('drain-stale')) stop('known fenced workers required'); before.forEach(uncertain) }
        const response = await action()
        unpoisoned()
        evidence.save(`${directory}/drain-${kind}-http.json`, response)
        const body = response.body as { ok?: boolean; result?: { claimed?: unknown; processed?: unknown; results?: unknown } } | null
        if (!response.ok || response.status !== 200 || body?.ok !== true || !body.result || body.result.claimed !== 0 || body.result.processed !== 0 || !Array.isArray(body.result.results) || body.result.results.length !== 0) stop('drain must have known zero work')
        if (kind === 'stale') swept = true
        const after = states()
        if (kind === 'live') { after.forEach(sending); if (after.some((x, i) => x.locked_at !== before[i].locked_at)) stop('live lease changed') }
        else after.forEach(uncertain)
        return response
      })
    },
    probe(index: 0 | 1, kind: 'expired-worker' | 'resumed-worker' | 'transport-fence', action: () => Promise<unknown>) {
      return operation(`probe-${index}-${kind}`, async () => {
        if ((index !== 0 && index !== 1) || !['expired-worker', 'resumed-worker', 'transport-fence'].includes(kind)) stop('exact probe stage required')
        const before = states()
        if (kind === 'expired-worker') { if (index !== 1 || !expired.has(1) || expired.has(0)) stop('unswept B expired-worker stage required'); before.forEach(sending) }
        else { if (index !== 0 || !done.has('drain-stale')) stop('swept A fence stage required'); before.forEach(uncertain) }
        let value: unknown
        if (kind === 'transport-fence') {
          let fenced = false
          try { value = await action(); unpoisoned() } catch (error) { const failure = error && typeof error === 'object' ? error as { message?: unknown; code?: unknown } : null; if (!failure || failure.message !== 'ediel_transport_worker_fence_lost' || (!(error instanceof Error) && failure.code !== 'P0001')) throw error; fenced = true; value = { threw: failure.message } }
          if (!fenced) stop('actual transport fence exception required')
        } else {
          value = await action()
          unpoisoned()
          const blocked = row(value), expected = kind === 'expired-worker' ? 'ediel_outbox_worker_lease_expired' : 'outbox_item_not_claimed_by_worker'
          if (blocked.status !== 'blocked' || blocked.error !== expected) stop('exact known worker refusal required')
        }
        unpoisoned()
        const after = states()
        if (after.some((x, i) => ['status', 'locked_by', 'locked_at', 'current_send_attempt_id', 'last_error'].some(key => x[key] !== before[i][key]))) stop('blocked probe changed lease state')
        return value
      })
    },
    restoreSmtp() {
      return operation('restore-smtp', async () => {
        if (!done.has('drain-final')) stop('known final no-resend stage required')
        states().forEach(uncertain)
        unpoisoned()
        await setSmtpMode('accept')
        unpoisoned()
      })
    },
  })
}
