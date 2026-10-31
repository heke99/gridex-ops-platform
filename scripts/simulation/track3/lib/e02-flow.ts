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
import { COUNTERPARTY_EDIEL_ID, lit, sql, sqlJson } from './seed.mjs'

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex')
export type Phase = 'poll' | 'intake' | 'reprocess' | 'drain' | 'harness'
export type DsoMail = { n: number; sha256: string; subject: string; edifact: string | null; uci: string[]; contrlStatus: string | null; segments: string[] }

export class E02Flow {
  readonly durations: Record<Phase, number[]> = { poll: [], intake: [], reprocess: [], drain: [], harness: [] }
  readonly polls: unknown[] = []
  constructor(readonly ev: Evidence, readonly mailboxId: string, readonly environment: 'test' | 'production' = 'test') {}

  time<T>(phase: Phase, fn: () => T): T { const t = Date.now(); try { return fn() } finally { this.durations[phase].push(Date.now() - t) } }
  async timeAsync<T>(phase: Phase, fn: () => Promise<T>): Promise<T> { const t = Date.now(); try { return await fn() } finally { this.durations[phase].push(Date.now() - t) } }

  /** Bygg + spara + lägg MIME i IMAP via TLS. */
  async inject(name: string, raw: string, o: { messageId?: string; subject: string; placement?: 'attachment' | 'inline'; from?: string }): Promise<{ mime: Buffer; messageId: string; sha256: string }> {
    const built = buildEdifactMime({ from: o.from ?? `${COUNTERPARTY_EDIEL_ID}@dso.t3.sim.invalid`, to: process.env.T3_MAILBOX_ADDRESS ?? 'ediel@t3.sim.invalid', subject: o.subject, raw, placement: o.placement ?? 'inline', messageId: o.messageId })
    this.ev.save(`${name}.edi`, raw); this.ev.save(`${name}.eml`, built.mime)
    await this.putRaw(built.mime)
    return { mime: built.mime, messageId: built.messageId, sha256: sha(built.mime) }
  }
  async putRaw(mime: Buffer) { await this.timeAsync('intake', () => appendToInbox(mime)) }

  /** En poll: motorn som automationsaktör mot företagsbrevlådan. Returnerar resultatet + ids. */
  async poll(label: string) {
    const t0 = Date.now()
    const out = await runInboundEngineAsAutomationActor(this.environment, { sharedOnly: false, mailboxId: this.mailboxId })
    const ms = Date.now() - t0; this.durations.poll.push(ms)
    const summary = out.ok ? { ms, fetched: out.result.fetchedMessages, stored: out.result.storedEmails, deduped: out.result.dedupedEmails, processedJobs: out.result.processedJobs, failedJobs: out.result.failedJobs,
      storedIds: out.result.inboundEmailMessageIds, edielMessageIds: out.result.edielMessageIds, dedupedIds: out.result.results.flatMap((r) => r.dedupedInboundEmailMessageIds),
      errorsByMailbox: out.result.debug.errorsByMailbox, autoProcessErrors: out.result.debug.autoProcessErrors, autoProcessed: out.result.debug.autoProcessedEdielMessages }
      : { ms, error: out.error }
    this.polls.push({ label, ...summary }); this.ev.save(`poll-${label}.json`, { label, ...summary })
    return { out, summary: summary as Record<string, any> }
  }

  /** Syntetisk granskad historikgrund + ombearbetning (se e02-seed.grantHistoryGround). */
  async groundAndReprocess(ids: string[]) {
    const res: Record<string, unknown> = {}
    for (const id of ids) {
      const granted = this.time('harness', () => grantHistoryGround(id))
      // PostgREST (authenticator) har statement_timeout=8s; under last överskrider enskilda ACK-RPC:er den. Anropen är atomära och
      // idempotenta (samma väg som nästa poll), så harnessen försöker om upp till 5 ggr och loggar antalet.
      let r = await this.timeAsync('reprocess', () => reprocessInbound(id)); let attempts = 1
      while (!r.ok && /57014|statement timeout/.test(r.error) && attempts < 5) { r = await this.timeAsync('reprocess', () => reprocessInbound(id)); attempts++ }
      res[id] = { granted, attempts, reprocess: r }
    }
    return res
  }

  /** Outbox-drain + läs nya DSO-mejl. */
  async drain(label: string) {
    const before = (await receivedMail()).length
    const t0 = Date.now()
    const r = await triggerOutbox(this.environment)
    this.durations.drain.push(Date.now() - t0)
    await new Promise((res) => setTimeout(res, 1200))
    const mails = (await receivedMail()).slice(before)
    const parsed = mails.map((m) => this.parseDso(m.n))
    this.ev.save(`drain-${label}.json`, { status: r.status, body: r.body ?? r.text, dso: parsed.map((d) => ({ n: d.n, sha256: d.sha256, subject: d.subject, uci: d.uci })) })
    for (const d of parsed) this.ev.save(`dso/${label}-${d.n}.eml`, readReceivedEml(d.n).raw)
    return { http: r, mails: parsed }
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
  const ids: string[] = stored.length ? (sqlJson(`SELECT coalesce(jsonb_agg(id ORDER BY created_at),'[]') FROM public.ediel_messages WHERE inbound_email_message_id IN (${stored.map((x) => lit(x)).join(',')})`) as string[]) : []
  const reproc = await flow.groundAndReprocess(ids)
  void opts
  return { inj, poll, ids, reproc }
}
