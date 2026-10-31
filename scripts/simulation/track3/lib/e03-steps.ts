// EDIEL03-hjälpare för scenarier: tidtagning per kategori, drain via appens HTTP-ingång, bevisinsamling.
import { createHash } from 'node:crypto'
import { triggerOutbox } from './app'
import { readReceivedEml, receivedMail, type ReceivedMail } from './counterparty'
import type { Evidence } from './evidence'
import { attemptsFor, eventsFor, mode, outboxRow, otherClaimable } from './e03-fixture'
import { lit, sql, sqlJson } from './seed.mjs'

export class Timing {
  readonly totals: Record<string, number> = {}
  readonly log: Array<{ category: string; label: string; ms: number }> = []
  add(category: 'smtp_transport' | 'drain' | 'wait' | 'harness', label: string, ms: number) {
    this.totals[category] = (this.totals[category] ?? 0) + ms
    this.log.push({ category, label, ms })
  }
  async time<T>(category: Parameters<Timing['add']>[0], label: string, fn: () => Promise<T> | T): Promise<T> {
    const t0 = Date.now()
    try { return await fn() } finally { this.add(category, label, Date.now() - t0) }
  }
  async sleep(label: string, ms: number) { await new Promise((r) => setTimeout(r, ms)); this.add('wait', label, ms) }
}

export type DrainOutcome = { status: number; ms: number; result: Record<string, unknown> | null; raw: unknown; foreignClaimableBefore: number }
export async function drain(ownOutboxId: string, timing: Timing, label: string): Promise<DrainOutcome> {
  const foreignClaimableBefore = otherClaimable(ownOutboxId)
  const r = await triggerOutbox(mode(), 25)
  timing.add('drain', label, r.ms)
  const body = r.body as { result?: Record<string, unknown> } | null
  return { status: r.status, ms: r.ms, result: body?.result ?? null, raw: r.body ?? r.text, foreignClaimableBefore }
}

/** Mottagna mejl hos motparten vars MIME innehåller givet RFC-Message-ID. */
export async function mimeCopiesFor(rfcMessageId: string | null, fromN = 0): Promise<Array<ReceivedMail & { sha256Verified: boolean; file: string }>> {
  if (!rfcMessageId) return []
  const needle = rfcMessageId.replace(/^<|>$/g, '')
  const out: Array<ReceivedMail & { sha256Verified: boolean; file: string }> = []
  for (const m of await receivedMail()) {
    if (m.n <= fromN) continue
    const e = readReceivedEml(m.n)
    if (e.raw.toString('latin1').includes(needle)) out.push({ ...m, sha256Verified: e.sha256Matches, file: `${m.n}.eml` })
  }
  return out
}
export const maxReceivedN = async () => Math.max(0, ...(await receivedMail()).map((m) => m.n))

export function rfcIdOf(attempts: Array<Record<string, unknown>>): string | null {
  for (const a of attempts) {
    const b = a.binding as { rfcMessageId?: string } | undefined
    if (b?.rfcMessageId) return b.rfcMessageId
  }
  return null
}

/** Spara outbox-/attemptrader, events och mottagna MIME med sha256 i evidenskatalogen. */
export async function capture(ev: Evidence, label: string, o: { outboxId: string; ackMessageId: string; sourceMessageId?: string; fromN?: number }) {
  const outbox = outboxRow(o.outboxId)
  const attempts = attemptsFor(o.ackMessageId)
  const events = await eventsFor(o.ackMessageId)
  const copies = await mimeCopiesFor(rfcIdOf(attempts), o.fromN ?? 0)
  ev.save(`${label}/outbox.json`, outbox)
  ev.save(`${label}/attempts.json`, attempts)
  ev.save(`${label}/ack-message-events.json`, events)
  for (const c of copies) ev.save(`${label}/received-${c.file}`, readReceivedEml(c.n).raw)
  ev.save(`${label}/received-index.json`, copies.map((c) => ({ ...c, eml_sha256: createHash('sha256').update(readReceivedEml(c.n).raw).digest('hex') })))
  return { outbox, attempts, events, copies }
}

/** Operatörssynlighet: oklara transportärenden/uppgifter för ACK-meddelandet (läser faktiska rader, observation). */
export function operatorVisibility(ackMessageId: string, sourceMessageId: string) {
  const tables = sqlJson(`SELECT coalesce(jsonb_agg(t.table_schema||'.'||t.table_name ORDER BY 1),'[]') FROM information_schema.tables t
    WHERE t.table_schema IN ('public','gridex_ediel_transport') AND (t.table_name ILIKE '%unknown%transport%' OR t.table_name ILIKE '%transport%case%' OR t.table_name ILIKE '%reconcil%' OR t.table_name ILIKE '%ediel%task%' OR t.table_name ILIKE '%dead%letter%' OR t.table_name ILIKE '%ediel_work%')`) as string[]
  const rows: Record<string, unknown> = {}
  for (const full of tables) {
    const cols = (sqlJson(`SELECT coalesce(jsonb_agg(column_name),'[]') FROM information_schema.columns WHERE table_schema||'.'||table_name=${lit(full)}`) as string[]) ?? []
    const keyCols = cols.filter((c) => /message_id|ediel_message_id|source_message_id|related_message_id|subject_id/.test(c))
    if (!keyCols.length) { rows[full] = { note: 'ingen meddelandekoppling', columns: cols.length }; continue }
    const where = keyCols.map((c) => `${c}::text IN (${lit(ackMessageId)},${lit(sourceMessageId)})`).join(' OR ')
    try { rows[full] = sqlJson(`SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM ${full} x WHERE ${where}`) } catch (e) { rows[full] = { error: String((e as Error).message).slice(0, 200) } }
  }
  const deadLetters = sqlJson(`SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM public.ediel_dead_letter_items x WHERE x.ediel_message_id=${lit(ackMessageId)}`)
  const hasTasks = sql(`SELECT to_regclass('public.tasks') IS NOT NULL`) === 't'
  const tasks = hasTasks ? sqlJson(`SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM public.tasks x WHERE x::text LIKE ${lit('%' + ackMessageId + '%')}`) : 'public.tasks finns inte i schemat'
  return { tablesProbed: tables, rows, deadLetters, tasks }
}
export { sql, sqlJson, lit }

/** Töm köade rester från andra körningar i accept-läge innan egen fixture skapas (resultatet loggas av anroparen). */
export async function flushQueuedInAcceptMode(timing: Timing) {
  const { setSmtpMode } = await import('./counterparty')
  await setSmtpMode('accept')
  const r = await timing.time('drain', 'flush-before', async () => triggerOutbox(mode(), 100))
  const res = (r.body as { result?: { claimed?: number; sent?: number; blocked?: number; failed?: number; deliveryUncertain?: number } } | null)?.result
  return { status: r.status, claimed: res?.claimed, sent: res?.sent, blocked: res?.blocked, failed: res?.failed, deliveryUncertain: res?.deliveryUncertain }
}

/** Harness-hårdning: fixturen tar flera sekunder och tar tabelllås (select_configured_reply_route_v2: LOCK TABLE ... SHARE MODE);
 * ett 'statement timeout' från delad stack ger omförsök (med accept-flush av ev. halvfärdig kö) i stället för falskt scenariofel. */
export async function seedWithRetry(timing: Timing, label: string, make: (attempt: number) => Promise<import('./e03-fixture').E03Source>, log: Array<Record<string, unknown>>) {
  for (let attempt = 0; ; attempt++) {
    try { return await timing.time('harness', label, () => make(attempt)) }
    catch (e) {
      const msg = String((e as Error)?.message ?? e)
      log.push({ label, attempt, error: msg.slice(0, 300) })
      if (attempt >= 2 || !/statement timeout|canceling statement|deadlock/i.test(msg)) throw e
      await flushQueuedInAcceptMode(timing)
    }
  }
}

