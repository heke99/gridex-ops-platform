// EDIEL01: driver för kedjan IMAP -> intake -> (tenant-omkörning) -> ediel_messages + CONTRL i outbox, samt APERAK-steget.
// Allt går via produktens egna ingångar i testprocessen (samma motor som app/admin/inbound-mail/actions.ts använder),
// förutom HTTP-cron som anropas separat och loggas. Varaktigheter mäts per anrop (product vs harness).
import { performance } from 'node:perf_hooks'
import { appendToInbox, purgeInbox } from './counterparty'
import { resetMailboxSchedule } from './db'
import { buildRoutableE66, type E66Spec } from './e01-fixture'
import { sqlIn } from './e01-fixture'
import { runInboundEngineAsAutomationActor } from './inprocess'
import { buildEdifactMime } from './mime'
import { lit } from './seed.mjs'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Evidence } from './evidence'

export type Source = { seq: number; spec: E66Spec; subject: string; messageId: string; eml: Buffer; mailId?: string; sourceId?: string }

export class Timer {
  readonly product: Record<string, number[]> = {}
  readonly harness: Record<string, number[]> = {}
  async p<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const t0 = performance.now()
    try { return await fn() } finally { (this.product[label] ??= []).push(Math.round(performance.now() - t0)) }
  }
  async h<T>(label: string, fn: () => Promise<T> | T): Promise<T> {
    const t0 = performance.now()
    try { return await fn() } finally { (this.harness[label] ??= []).push(Math.round(performance.now() - t0)) }
  }
  summary() {
    const sum = (m: Record<string, number[]>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { calls: v.length, totalMs: v.reduce((a, b) => a + b, 0), maxMs: Math.max(...v), allMs: v.length <= 40 ? v : undefined }]))
    return { product: sum(this.product), harness: sum(this.harness) }
  }
}

export const actorId = () => process.env.EDIEL_AUTOMATION_ACTOR_USER_ID!
export const subjectOf = (prefix: string, seq: number) => `E66 ${prefix} ${String(seq).padStart(3, '0')}`

export function buildSources(prefix: string, seqs: number[], mailbox: string): Source[] {
  return seqs.map((seq) => {
    const spec = buildRoutableE66({ prefix, seq })
    const subject = subjectOf(prefix, seq)
    const built = buildEdifactMime({ from: '70007@dso.t3.sim.invalid', to: mailbox, subject, raw: spec.raw, placement: 'inline', messageId: `<${prefix.toLowerCase()}-${String(seq).padStart(3, '0')}@dso.t3.sim.invalid>` })
    return { seq, spec, subject, messageId: built.messageId, eml: built.mime }
  })
}

export async function injectAll(sources: Source[], t: Timer, ev: Evidence, dir: string) {
  for (const s of sources) {
    await t.p('imap_append', () => appendToInbox(s.eml))
    ev.save(`${dir}/e66-${String(s.seq).padStart(3, '0')}.edi`, s.spec.raw)
    ev.save(`${dir}/e66-${String(s.seq).padStart(3, '0')}.eml`, s.eml)
  }
}

const q = <T>(sql: string) => sqlIn<T>(sql)

const legacyClause = (col: string, prefix: string, legacy: boolean) => `${col} ${legacy ? '=' : '<>'} ${lit(subjectOf(prefix, 0))}`
export function mailRows(prefix: string, legacy = false) {
  return q<Array<{ id: string; subject: string; internet_message_id: string; company_id: string | null; processing_status: string; match_status: string | null }>>(
    `SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.subject),'[]') FROM (SELECT id,subject,internet_message_id,company_id,processing_status,match_status FROM public.inbound_email_messages WHERE subject LIKE ${lit(`E66 ${prefix} %`)} AND ${legacyClause('subject', prefix, legacy)}) x`)
}
export function sourceRows(prefix: string, legacy = false) {
  return q<Array<{ id: string; inbound_email_message_id: string; interchange_reference: string; external_reference: string; status: string; processing_status: string | null }>>(
    `SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.interchange_reference),'[]') FROM (SELECT m.id,m.inbound_email_message_id,m.interchange_reference,m.external_reference,m.status,m.processing_status
      FROM public.ediel_messages m JOIN public.inbound_email_messages i ON i.id=m.inbound_email_message_id WHERE m.direction='inbound' AND i.subject LIKE ${lit(`E66 ${prefix} %`)} AND ${legacyClause('i.subject', prefix, legacy)}) x`)
}

export type IntakeResult = {
  polls: Array<{ poll: number; ms: number; fetched?: number; stored?: number; deduped?: number; processedJobs?: number; failedJobs?: number; error?: string; errorsByMailbox?: unknown }>
  queueFirstPass: { ms: number; processed: number; failed: number; edielMessagesAfter: number }
  reprocess: Array<{ mailId: string; ms: number; status: string }>
  engineAuto: { ms: number; fetched?: number; edielMessageIds?: number; autoProcessErrors?: string[]; error?: string }
}

/** poll (transport) -> queue-bearbetning (första försöket) -> "Processa om" per mail -> motor som autobearbetar ediel_messages. */
export async function runIntake(prefix: string, expected: number, t: Timer, mode: 'test' | 'production', opts: { maxPolls?: number; legacy?: boolean } = {}): Promise<IntakeResult> {
  const polls: IntakeResult['polls'] = []
  for (let poll = 1; poll <= (opts.maxPolls ?? 8); poll++) {
    resetMailboxSchedule(mode)
    const t0 = performance.now()
    const out = await t.p('imap_poll_store', () => runInboundEngineAsAutomationActor(mode, { processLimit: 0 }))
    const ms = Math.round(performance.now() - t0)
    polls.push(out.ok
      ? { poll, ms, fetched: out.result.fetchedMessages, stored: out.result.storedEmails, deduped: out.result.dedupedEmails, processedJobs: out.result.processedJobs, failedJobs: out.result.failedJobs, errorsByMailbox: out.result.debug.errorsByMailbox }
      : { poll, ms, error: out.error })
    if (mailRows(prefix, opts.legacy).length >= expected) break
  }
  const { processQueuedInboundProcessingJobs } = await import('@/lib/inbound-mail/edielMailboxPoller')
  const t1 = performance.now()
  const queue = await t.p('intake_queue_first_pass', () => processQueuedInboundProcessingJobs({ workerId: 'e01-queue', limit: 200, actorUserId: actorId() }))
  const queueFirstPass = { ms: Math.round(performance.now() - t1), processed: queue.processed, failed: queue.failed, edielMessagesAfter: sourceRows(prefix, opts.legacy).length }

  // Produktens "Processa om" (app/admin/inbound-mail/actions.ts reprocessInboundEmailAction rad 272-285) för de mail som saknar ediel_message.
  const { processInboundEmailMessage } = await import('@/lib/inbound-mail/edielInboundProcessor')
  const { syncActiveInboundProcessingJobForMessage } = await import('@/lib/inbound-mail/edielMailboxPoller')
  const have = new Set(sourceRows(prefix, opts.legacy).map((r) => r.inbound_email_message_id))
  const reprocess: IntakeResult['reprocess'] = []
  for (const mail of mailRows(prefix, opts.legacy)) {
    if (have.has(mail.id)) continue
    const t2 = performance.now()
    const outcome = await t.p('intake_reprocess', () => processInboundEmailMessage({ inboundEmailMessageId: mail.id, actorUserId: actorId() }))
    await syncActiveInboundProcessingJobForMessage({ inboundEmailMessageId: mail.id, outcomeStatus: outcome.status })
    reprocess.push({ mailId: mail.id, ms: Math.round(performance.now() - t2), status: outcome.status })
  }

  // Produktens standard EDIEL_INBOUND_MESSAGE_CONCURRENCY=4 gav vid N=28 statement timeouts/"Okänt fel" (globala tabelllås i ack-skapandet);
  // körningen 20261030T124519Z-357e3f dokumenterar det. Här körs motorn seriellt (=1) och upprepas upp till 3 gånger tills alla CONTRL finns.
  process.env.EDIEL_INBOUND_MESSAGE_CONCURRENCY = '1'
  const t3 = performance.now()
  let auto = await t.p('intake_auto_process_engine', async () => { resetMailboxSchedule(mode); return runInboundEngineAsAutomationActor(mode, { processLimit: 200 }) })
  for (let again = 0; again < 2; again++) {
    const ids = sourceRows(prefix, opts.legacy).map((r) => r.id)
    const have = Number(q<number>(`SELECT count(*) FROM public.ediel_messages WHERE direction='outbound' AND message_family='CONTRL' AND related_message_id IN (${ids.length ? ids.map(lit).join(',') : "'00000000-0000-0000-0000-000000000000'"})`))
    if (have >= expected) break
    auto = await t.p('intake_auto_process_engine_retry', async () => { resetMailboxSchedule(mode); return runInboundEngineAsAutomationActor(mode, { processLimit: 200 }) })
  }
  const engineAuto = auto.ok
    ? { ms: Math.round(performance.now() - t3), fetched: auto.result.fetchedMessages, edielMessageIds: auto.result.edielMessageIds.length, autoProcessErrors: auto.result.debug.autoProcessErrors }
    : { ms: Math.round(performance.now() - t3), error: auto.error }
  return { polls, queueFirstPass, reprocess, engineAuto }
}

/** Seedar granskat historiktäckningsunderlag och kör inbound-bearbetningen på nytt (samma anrop som motorns autoprocess) -> positiv APERAK-utkast. */
export async function reprocessSources(ids: string[], t: Timer, concurrency = 1): Promise<Array<{ id: string; error: string | null; ms: number }>> {
  const { processInboundEdielMessage } = await import('@/lib/ediel/flows/inboundProcessing')
  const out: Array<{ id: string; error: string | null; ms: number }> = []
  let next = 0
  const worker = async () => {
    for (;;) {
      const i = next++
      if (i >= ids.length) return
      const t0 = performance.now()
      let error: string | null = null
      try { await t.p('process_inbound_edi_message', () => processInboundEdielMessage({ actorUserId: actorId(), edielMessageId: ids[i] })) } catch (e) { error = e instanceof Error ? e.message : String(e) }
      out.push({ id: ids[i], error, ms: Math.round(performance.now() - t0) })
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  return out
}

export function logLine(dir: string, text: string) { try { appendFileSync(join(dir, 'e01-progress.log'), `${new Date().toISOString()} ${text}\n`) } catch { /* ignore */ } }
export { purgeInbox }
