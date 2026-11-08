// Inkommande kedja för CUSTODY01: IMAP-inläggning -> poll -> kö-bearbetning -> "Processa om" -> motor med aktör.
// Härkomst (kopierad, generaliserad från T6/T3-specifika prefix till subjectLike): 01d97c27:scripts/simulation/track3/lib/e01-chain.ts
//   runIntake(), mailRows(), sourceRows(). Skillnader: urval på godtyckligt ämnesmönster; ingen Timer; HTTP-cron körs av anroparen.
import { performance } from 'node:perf_hooks'
import { resetMailboxSchedule } from '../db'
import { lit } from '../seed.mjs'
import { actorId, mode, sqlIn } from './base'
import { runInboundEngineAsAutomationActor } from './inprocess'

export type MailRow = { id: string; subject: string; internet_message_id: string | null; company_id: string | null; processing_status: string; match_status: string | null }
export type SourceRow = { id: string; inbound_email_message_id: string; interchange_reference: string; external_reference: string | null; status: string; company_id: string; raw_payload: string; immutable_payload_hash: string | null }

export const mailRows = (subjectLike: string): MailRow[] => sqlIn<MailRow[]>(
  `SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.subject),'[]') FROM (SELECT id,subject,internet_message_id,company_id,processing_status,match_status FROM public.inbound_email_messages WHERE subject LIKE ${lit(subjectLike)}) x`)

export const sourceRows = (subjectLike: string): SourceRow[] => sqlIn<SourceRow[]>(
  `SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.interchange_reference),'[]') FROM (SELECT m.id,m.inbound_email_message_id,m.interchange_reference,m.external_reference,m.status,m.company_id,m.raw_payload,m.immutable_payload_hash
    FROM public.ediel_messages m JOIN public.inbound_email_messages i ON i.id=m.inbound_email_message_id WHERE m.direction='inbound' AND i.subject LIKE ${lit(subjectLike)}) x`)

export type IntakeResult = {
  polls: Array<{ poll: number; ms: number; fetched?: number; stored?: number; deduped?: number; processedJobs?: number; failedJobs?: number; error?: string; errorsByMailbox?: unknown }>
  queueFirstPass: { ms: number; processed: number; failed: number; edielMessagesAfter: number }
  reprocess: Array<{ mailId: string; ms: number; status: string }>
  engineAuto: { ms: number; fetched?: number; edielMessageIds?: number; autoProcessErrors?: string[]; error?: string }
}

/** Ersättningsvägen med aktör (HTTP-cron saknar aktör, se README i spår 3, obs. 2). Alla steg loggas av anroparen. */
export async function runIntakeWithActor(subjectLike: string, expected: number, opts: { maxPolls?: number } = {}): Promise<IntakeResult> {
  const polls: IntakeResult['polls'] = []
  for (let poll = 1; poll <= (opts.maxPolls ?? 8); poll++) {
    resetMailboxSchedule(mode())
    const t0 = performance.now()
    const out = await runInboundEngineAsAutomationActor(mode(), { processLimit: 0 })
    const ms = Math.round(performance.now() - t0)
    polls.push(out.ok
      ? { poll, ms, fetched: out.result.fetchedMessages, stored: out.result.storedEmails, deduped: out.result.dedupedEmails, processedJobs: out.result.processedJobs, failedJobs: out.result.failedJobs, errorsByMailbox: out.result.debug.errorsByMailbox }
      : { poll, ms, error: out.error })
    if (mailRows(subjectLike).length >= expected) break
  }
  const { processQueuedInboundProcessingJobs } = await import('@/lib/inbound-mail/edielMailboxPoller')
  const t1 = performance.now()
  const queue = await processQueuedInboundProcessingJobs({ workerId: 'custody-queue', limit: 200, actorUserId: actorId() })
  const queueFirstPass = { ms: Math.round(performance.now() - t1), processed: queue.processed, failed: queue.failed, edielMessagesAfter: sourceRows(subjectLike).length }

  // Produktens "Processa om" (app/admin/inbound-mail/actions.ts reprocessInboundEmailAction) för mail utan ediel_message.
  const { processInboundEmailMessage } = await import('@/lib/inbound-mail/edielInboundProcessor')
  const { syncActiveInboundProcessingJobForMessage } = await import('@/lib/inbound-mail/edielMailboxPoller')
  const have = new Set(sourceRows(subjectLike).map((r) => r.inbound_email_message_id))
  const reprocess: IntakeResult['reprocess'] = []
  for (const mail of mailRows(subjectLike)) {
    if (have.has(mail.id)) continue
    const t2 = performance.now()
    const outcome = await processInboundEmailMessage({ inboundEmailMessageId: mail.id, actorUserId: actorId() })
    await syncActiveInboundProcessingJobForMessage({ inboundEmailMessageId: mail.id, outcomeStatus: outcome.status })
    reprocess.push({ mailId: mail.id, ms: Math.round(performance.now() - t2), status: outcome.status })
  }

  // Motorn seriellt (EDIEL_INBOUND_MESSAGE_CONCURRENCY=1; T3 observerade timeouts vid 4) och upprepas upp till 3 gånger.
  process.env.EDIEL_INBOUND_MESSAGE_CONCURRENCY = '1'
  const t3 = performance.now()
  let auto = await (async () => { resetMailboxSchedule(mode()); return runInboundEngineAsAutomationActor(mode(), { processLimit: 200 }) })()
  for (let again = 0; again < 2; again++) {
    if (sourceRows(subjectLike).length >= expected) break
    auto = await (async () => { resetMailboxSchedule(mode()); return runInboundEngineAsAutomationActor(mode(), { processLimit: 200 }) })()
  }
  const engineAuto = auto.ok
    ? { ms: Math.round(performance.now() - t3), fetched: auto.result.fetchedMessages, edielMessageIds: auto.result.edielMessageIds.length, autoProcessErrors: auto.result.debug.autoProcessErrors }
    : { ms: Math.round(performance.now() - t3), error: auto.error }
  return { polls, queueFirstPass, reprocess, engineAuto }
}
