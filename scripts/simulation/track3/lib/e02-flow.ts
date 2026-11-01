/* eslint-disable @typescript-eslint/no-explicit-any */
// EDIEL02: flödeshjälp. IMAP-inläggning -> poll (motorn med automationsaktören, företagsbrevlåda) -> granskad historikgrund (syntetisk) ->
// ombearbetning -> outbox-drain -> läsning av mottagna DSO-mejl. Varaktigheter loggas per fas.
import { createHash } from 'node:crypto'
import { appendToInbox, purgeInbox, readReceivedEml, receivedMail } from './counterparty'
import { triggerOutbox } from './app'
import { Evidence } from './evidence'
import { runInboundEngineAsAutomationActor } from './inprocess'
import { buildEdifactMime } from './mime'
import { grantHistoryGround, reprocessInbound } from './e02-seed'
import { E02OutboxAdmission } from './e02-outbox'
import { COUNTERPARTY_EDIEL_ID, lit, sql, sqlJson } from './seed.mjs'

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex')
const qualifiedBusinessRefusals = new Set([
  'utilts_consumption_correction_not_newer',
  'utilts_consumption_correction_ancestry_invalid',
  'utilts_consumption_correction_binding_invalid',
  'utilts_consumption_late_history',
  'utilts_consumption_stale_version',
])
function isQualifiedBusinessRefusal(error: string): boolean {
  // reprocessInbound preserves PostgREST's exact SQLSTATE suffix. Any cause,
  // unknown state or additional text remains an unqualified processing failure.
  const suffix = ' [P0U01]'
  return qualifiedBusinessRefusals.has(error.endsWith(suffix) ? error.slice(0, -suffix.length) : error)
}
export type Phase = 'poll' | 'intake' | 'reprocess' | 'drain' | 'harness'
export type DsoMail = { n: number; sha256: string; subject: string; edifact: string | null; uci: string[]; contrlStatus: string | null; segments: string[] }

export class E02Flow {
  readonly durations: Record<Phase, number[]> = { poll: [], intake: [], reprocess: [], drain: [], harness: [] }
  readonly polls: unknown[] = []
  private readonly admission: E02OutboxAdmission
  private readonly pendingGround = new Set<string>()
  private readonly assignedOutboxes = new Set<string>()
  private unknownDrainOutcome = false
  private unknownProcessingOutcome = false
  constructor(readonly ev: Evidence, readonly mailboxId: string, readonly environment: 'test' | 'production' = 'test', companyId: string) {
    this.admission = new E02OutboxAdmission({ companyId, environment, mailboxId })
  }

  time<T>(phase: Phase, fn: () => T): T { const t = Date.now(); try { return fn() } finally { this.durations[phase].push(Date.now() - t) } }
  async timeAsync<T>(phase: Phase, fn: () => Promise<T>): Promise<T> { const t = Date.now(); try { return await fn() } finally { this.durations[phase].push(Date.now() - t) } }

  /** Bygg + spara + lägg MIME i IMAP via TLS. */
  async inject(name: string, raw: string, o: { messageId?: string; subject: string; placement?: 'attachment' | 'inline'; from?: string }): Promise<{ mime: Buffer; messageId: string; sha256: string }> {
    const built = buildEdifactMime({ from: o.from ?? `${COUNTERPARTY_EDIEL_ID}@dso.t3.sim.invalid`, to: process.env.T3_MAILBOX_ADDRESS ?? 'ediel@t3.sim.invalid', subject: o.subject, raw, placement: o.placement ?? 'inline', messageId: o.messageId })
    this.ev.save(`${name}.edi`, raw); this.ev.save(`${name}.eml`, built.mime)
    await this.putRaw(built.mime)
    return { mime: built.mime, messageId: built.messageId, sha256: sha(built.mime) }
  }
  async putRaw(mime: Buffer) {
    await this.timeAsync('intake', () => appendToInbox(mime))
    this.admission.rememberMime(mime)
  }

  /** En poll: motorn som automationsaktör mot företagsbrevlådan. Returnerar resultatet + ids. */
  async poll(label: string) {
    if (this.unknownProcessingOutcome || this.unknownDrainOutcome) {
      throw new Error('T3_HARNESS_PRECONDITION: observe persistent effects before another poll')
    }
    const t0 = Date.now()
    this.unknownProcessingOutcome = true
    const out = await runInboundEngineAsAutomationActor(this.environment, { sharedOnly: false, mailboxId: this.mailboxId })
    const ms = Date.now() - t0; this.durations.poll.push(ms)
    const summary = out.ok ? { ms, fetched: out.result.fetchedMessages, stored: out.result.storedEmails, deduped: out.result.dedupedEmails, processedJobs: out.result.processedJobs, failedJobs: out.result.failedJobs,
      storedIds: out.result.inboundEmailMessageIds, edielMessageIds: out.result.edielMessageIds, dedupedIds: out.result.results.flatMap((r) => r.dedupedInboundEmailMessageIds),
      errorsByMailbox: out.result.debug.errorsByMailbox, autoProcessErrors: out.result.debug.autoProcessErrors, autoProcessed: out.result.debug.autoProcessedEdielMessages }
      : { ms, error: out.error }
    this.polls.push({ label, ...summary }); this.ev.save(`poll-${label}.json`, { label, ...summary })
    if (!out.ok || out.result.debug.errorsByMailbox.some((mailbox) => mailbox.errors.length > 0)
      || out.result.debug.autoProcessErrors.length > 0) {
      throw new Error('T3_HARNESS_PRECONDITION: successful physical mailbox reception required')
    }
    const previous = new Set(this.admission.sources.map((source) => source.sourceMessageId))
    const observed = this.admission.observePoll(out.result.inboundEmailMessageIds, out.result.edielMessageIds)
    for (const id of observed) if (!previous.has(id)) this.pendingGround.add(id)
    // The raw engine result remains in the saved poll evidence. Only qualified
    // business sources may be handed to processing; technical originals cannot.
    ;(summary as Record<string, unknown>).edielMessageIds = [...observed]
    this.ev.save(`reception-receipts-${label}.json`, { business: this.admission.sources, technical: this.admission.technicalSources })
    this.unknownProcessingOutcome = false
    return { out, summary: summary as Record<string, any> }
  }

  sourceIdsForEmails(emailIds: readonly string[]): string[] {
    return this.admission.sources.filter((source) => emailIds.includes(source.inboundEmailMessageId)).map((source) => source.sourceMessageId)
  }

  /** Syntetisk granskad historikgrund + ombearbetning (se e02-seed.grantHistoryGround). */
  async groundAndReprocess(ids: string[]) {
    if (this.unknownProcessingOutcome || this.unknownDrainOutcome) {
      throw new Error('T3_HARNESS_PRECONDITION: observe persistent effects before processing again')
    }
    this.admission.assertSources(ids)
    const res: Record<string, unknown> = {}
    for (const id of ids) {
      this.unknownProcessingOutcome = true
      const granted = this.time('harness', () => grantHistoryGround(id))
      // Processing spans several persistent calls. A timed-out call does not
      // establish that the whole operation rolled back; preserve it for recovery.
      const r = await this.timeAsync('reprocess', () => reprocessInbound(id))
      const attempts = 1
      res[id] = { granted, attempts, reprocess: r }
      if (!r.ok && !isQualifiedBusinessRefusal(r.error)) {
        this.ev.save('reprocess-unknown-outcome.json', {
          sourceMessageId: id, granted, attempts, reprocess: r,
          recovery: 'observe_persistent_effects_before_retry',
        })
        throw new Error('T3_HARNESS_PRECONDITION: processing outcome unknown; observe persistent effects before retry')
      }
      if (this.pendingGround.has(id)) {
        const receipts = this.admission.captureOutboxes([id])
        for (const receipt of receipts) this.assignedOutboxes.add(receipt.id)
        this.pendingGround.delete(id)
        this.ev.save('outbox-receipts.json', this.admission.outboxes)
      }
      this.unknownProcessingOutcome = false
    }
    return res
  }

  /** Outbox-drain + läs nya DSO-mejl. */
  async drain(label: string) {
    if (this.unknownDrainOutcome || this.unknownProcessingOutcome || this.pendingGround.size > 0) {
      throw new Error('T3_HARNESS_PRECONDITION: unresolved processing or drain outcome; observe persistent effects before retry')
    }
    const assignment = [...this.assignedOutboxes]
    const admitted = this.admission.admit(assignment)
    if (!admitted.workerNeeded) {
      this.assignedOutboxes.clear()
      const http = { status: 0, ok: true, ms: 0, body: { workerInvoked: false }, text: 'No worker invoked' }
      this.ev.save(`drain-${label}.json`, { workerInvoked: false, assignment: admitted.assigned, dso: [] })
      return { http, mails: [] as DsoMail[], workerInvoked: false }
    }
    const before = (await receivedMail()).length
    const t0 = Date.now()
    this.unknownDrainOutcome = true
    const r = await triggerOutbox(this.environment)
    this.durations.drain.push(Date.now() - t0)
    this.ev.save(`drain-http-${label}.json`, { assignment: admitted.assigned, response: r })
    if (!r.ok || !r.body || (r.body as { ok?: boolean }).ok !== true) {
      throw new Error('T3_HARNESS_PRECONDITION: drain outcome unqualified; observe persistent effects before retry')
    }
    this.unknownDrainOutcome = false
    this.assignedOutboxes.clear()
    await new Promise((res) => setTimeout(res, 1200))
    const mails = (await receivedMail()).slice(before)
    const parsed = mails.map((m) => this.parseDso(m.n))
    this.ev.save(`drain-${label}.json`, { status: r.status, body: r.body ?? r.text, dso: parsed.map((d) => ({ n: d.n, sha256: d.sha256, subject: d.subject, uci: d.uci })) })
    for (const d of parsed) this.ev.save(`dso/${label}-${d.n}.eml`, readReceivedEml(d.n).raw)
    return { http: r, mails: parsed, workerInvoked: true }
  }

  /** Alla DSO-mejl från ett löpnummer. */
  async dsoSince(n0: number): Promise<DsoMail[]> { return (await receivedMail()).slice(n0).map((m) => this.parseDso(m.n)) }

  parseDso(n: number): DsoMail {
    const { raw, sha256 } = readReceivedEml(n)
    const text = raw.toString('utf8')
    const subject = /^Subject: (.*)$/m.exec(text)?.[1] ?? ''
    let edifact: string | null = null
    const b64 = /Content-Transfer-Encoding: base64\r?\n(?:.*\r?\n)*?\r?\n([A-Za-z0-9+/=\r\n]+)/.exec(text)?.[1]
    if (b64) edifact = Buffer.from(b64.replace(/\s+/g, ''), 'base64').toString('utf8')
    else { const i = text.indexOf('UNB+'); if (i >= 0) edifact = text.slice(i) }
    const segments = edifact ? edifact.replace(/^UNA.{6}/, '').split(/'\r?\n?/).filter(Boolean) : []
    const uci = segments.filter((s) => s.startsWith('UCI+') || s.startsWith('UCM+') || s.startsWith('UCS+') || s.startsWith('UCD+'))
    const contrlStatus = segments.find((s) => s.startsWith('UCI+'))?.split('+')[4] ?? null
    return { n, sha256, subject, edifact, uci, contrlStatus, segments }
  }

  finalizeDurations(extra: Record<string, unknown> = {}) {
    const stat = (xs: number[]) => ({ n: xs.length, totalMs: xs.reduce((a, b) => a + b, 0), maxMs: Math.max(0, ...xs), samples: xs })
    const d = Object.fromEntries(Object.entries(this.durations).map(([k, v]) => [k, stat(v)]))
    this.ev.save('durations.json', { ...d, ...extra })
    this.ev.observe('durations', d)
  }
}
export { sha, purgeInbox, sql, sqlJson, lit }

/** Leverera ett UTILTS-meddelande hela vägen: inject -> poll -> (grund + ombearbetning av nya källor) och returnera ids. */
export async function deliverE02(flow: E02Flow, name: string, raw: string, subject: string, opts: { reprocessErrors?: Record<string, unknown> } = {}) {
  const inj = await flow.inject(name, raw, { subject })
  const poll = await flow.poll(name.replace(/\W+/g, '-'))
  // Bara källor för mejl som lagrades i just denna poll (tidigare mejl i inkorgen hämtas om och dedupas).
  const stored = (poll.summary.storedIds as string[]) ?? []
  const ids = flow.sourceIdsForEmails(stored)
  const reproc = await flow.groundAndReprocess(ids)
  void opts
  return { inj, poll, ids, reproc }
}
