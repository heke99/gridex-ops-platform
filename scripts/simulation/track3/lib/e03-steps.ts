import { dispatchE03Physical } from './e03-reception'
// EDIEL03-hjälpare för scenarier: tidtagning per kategori, drain via appens HTTP-ingång, bevisinsamling.
import { createHash } from 'node:crypto'
import { triggerOutbox } from './app'
import { readReceivedEml, receivedMail, type ReceivedMail } from './counterparty'
import type { Evidence } from './evidence'
import { attemptsFor, eventsFor, mode, outboxRow, type E03Source } from './e03-fixture'
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
type OwnedOutbox = { id: string; companyId: string; ackMessageId: string; sourceMessageId: string; environment: string }
type ActiveOutbox = OwnedOutbox & { status: string; ackCompanyId: string; ackSourceMessageId: string; sourceCompanyId: string; sourceEnvironment: string; direction: string; family: string }
const ownedOutboxes = new Map<string, Readonly<OwnedOutbox>>()
function precondition(message: string): never { throw new Error(`T3_HARNESS_PRECONDITION: ${message}`) }
function rememberSource(source: E03Source) {
  // SLA-only fixtures deliberately create no ACK/outbox and never authorize a worker.
  if (source.outboxId === null && source.ackMessageId === null) return
  const binding: OwnedOutbox = { id: source.outboxId ?? '', companyId: source.companyId, ackMessageId: source.ackMessageId ?? '', sourceMessageId: source.sourceMessageId, environment: mode() }
  if (Object.values(binding).some(value => typeof value !== 'string' || !value)) precondition('successful seed has no complete outbox binding')
  const prior = ownedOutboxes.get(binding.id)
  if (prior && JSON.stringify(prior) !== JSON.stringify(binding)) precondition('owned outbox binding changed')
  ownedOutboxes.set(binding.id, Object.freeze(binding))
}
/** Global cron also sweeps sending rows. Ownership comes only from successful
 * explicit fixtures, never discovery or a shared company. The coordinator must
 * supply an exclusive, quiescent phase; this read does not acquire a lease. */
function admitActiveSet(ids: readonly string[]) {
  if (new Set(ids).size !== ids.length || ids.some(id => !ownedOutboxes.has(id))) precondition('explicit owned outbox IDs required')
  const rows: unknown = sqlJson(`SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',o.id,'companyId',o.company_id,'ackMessageId',o.ediel_message_id,'sourceMessageId',o.source_message_id,'environment',o.environment,'status',o.status,
    'ackCompanyId',a.company_id,'ackSourceMessageId',a.related_message_id,'direction',a.direction,'family',a.message_family,
    'sourceCompanyId',s.company_id,'sourceEnvironment',s.environment) ORDER BY o.id),'[]')
    FROM public.ediel_outbox o LEFT JOIN public.ediel_messages a ON a.id=o.ediel_message_id LEFT JOIN public.ediel_messages s ON s.id=o.source_message_id
    WHERE o.environment=${lit(mode())} AND (o.status IN ('prepared','queued','sending')${ids.length ? ` OR o.id IN (${ids.map(lit).join(',')})` : ''})`)
  if (!Array.isArray(rows)) precondition('active outbox inventory unavailable')
  const seen = new Set<string>()
  for (const unknownRow of rows) {
    if (!unknownRow || typeof unknownRow !== 'object' || Array.isArray(unknownRow)) precondition('active outbox inventory malformed')
    const row = unknownRow as ActiveOutbox, expected = ownedOutboxes.get(row.id)
    if (!ids.includes(row.id) || !expected || seen.has(row.id)) precondition('unassigned active outbox row')
    seen.add(row.id)
    if (Object.entries(expected).some(([key, value]) => row[key as keyof OwnedOutbox] !== value)
      || row.ackCompanyId !== expected.companyId || row.sourceCompanyId !== expected.companyId
      || row.sourceEnvironment !== expected.environment || row.ackSourceMessageId !== expected.sourceMessageId
      || row.direction !== 'outbound' || row.family !== 'CONTRL'
      || !['draft','prepared','queued','sending','sent','failed','delivery_uncertain','blocked','cancelled'].includes(row.status)) precondition('active outbox source binding differs')
  }
  if (ids.some(id => !seen.has(id))) precondition('owned outbox row is missing')
}
export async function drain(ownOutboxId: string, timing: Timing, label: string, ownedIds: readonly string[] = [ownOutboxId]): Promise<DrainOutcome> {
  if (!ownedIds.includes(ownOutboxId)) precondition('drain target is not assigned to this phase')
  admitActiveSet(ownedIds)
  const r = await triggerOutbox(mode(), 25)
  timing.add('drain', label, r.ms)
  const body = r.body as { result?: Record<string, unknown> } | null
  return { status: r.status, ms: r.ms, result: body?.result ?? null, raw: r.body ?? r.text, foreignClaimableBefore: 0 }
}

/** Complete physical capture, not a filter by the original transport ID. */
export async function physicalCaptureSince(fromN: number) {
  if (!Number.isSafeInteger(fromN) || fromN < 0) precondition('capture baseline is invalid')
  const all = await receivedMail(), seen = new Set<number>()
  if (!Array.isArray(all)) precondition('capture inventory unavailable')
  for (const mail of all) {
    if (!mail || !Number.isSafeInteger(mail.n) || mail.n < 1 || seen.has(mail.n)) precondition('capture index is ambiguous')
    seen.add(mail.n)
  }
  return all.filter(mail => mail.n > fromN).map(mail => {
    const read = readReceivedEml(mail.n), sha256 = createHash('sha256').update(read.raw).digest('hex')
    if (!read.raw.length || !read.sha256Matches || read.sha256 !== sha256 || mail.sha256 !== sha256) precondition('capture bytes are unavailable or differ')
    const headers = read.raw.toString('latin1').split('\r\n\r\n', 1)[0].replace(/\r\n[ \t]+/g, ' ')
    const ids = [...headers.matchAll(/^message-id:\s*(.+)$/gim)].map(match => match[1].trim())
    if (ids.length !== 1) precondition('capture RFC identity is ambiguous')
    return { n: mail.n, sha256, bytes: read.raw.length, rfcMessageId: ids[0], envelopeFrom: mail.envelopeFrom, envelopeTo: mail.envelopeTo }
  })
}

/** Mottagna mejl hos motparten vars MIME innehåller givet RFC-Message-ID. */
export async function mimeCopiesFor(rfcMessageId: string | null, fromN = 0): Promise<Array<ReceivedMail & { sha256Verified: boolean; file: string }>> {
  if (!rfcMessageId) return []
  const out: Array<ReceivedMail & { sha256Verified: boolean; file: string }> = []
  for (const m of await receivedMail()) {
    if (m.n <= fromN) continue
    const e = readReceivedEml(m.n)
    const headers = e.raw.toString('latin1').split('\r\n\r\n', 1)[0].replace(/\r\n[ \t]+/g, ' ')
    const ids = [...headers.matchAll(/^message-id:\s*(.+)$/gim)].map(match => match[1].trim())
    if (ids.length === 1 && ids[0] === rfcMessageId) out.push({ ...m, sha256Verified: e.sha256Matches, file: `${m.n}.eml` })
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

/** A fresh phase must be empty. Unknown leftovers are preserved, never flushed. */
export async function flushQueuedInAcceptMode(timing: Timing) {
  await timing.time('harness', 'require-empty-before-fixture', () => admitActiveSet([]))
  return { workerInvoked: false, claimed: 0, sent: 0, blocked: 0, failed: 0, deliveryUncertain: 0 }
}

/** Kept caller name; an unknown partial seed is preserved and never retried or flushed. */
export async function seedWithRetry(timing: Timing, label: string, make: (attempt: number) => Promise<import('./e03-fixture').E03Source>, log: Array<Record<string, unknown>>) {
  try {
    const source = await timing.time('harness', label, () => make(0))
    rememberSource(source)
    return source
  } catch (e) {
    log.push({ label, attempt: 0, error: String((e as Error)?.message ?? e).slice(0, 300), recovery: 'preserve_unknown_partial_seed_no_retry' })
    throw e
  }
}

/** Physical .03 pilot only; retained legacy drain above remains unqualified for
 * this path and cannot manufacture the independent physical receipt brand. */
export async function drainPhysical(ownOutboxId: string, timing: Timing, label: string, ownedIds: readonly string[] = [ownOutboxId], opts: { uncertainNoResendProbe?: boolean } = {}): Promise<DrainOutcome> {
  if (ownedIds.length !== 1 || ownedIds[0] !== ownOutboxId) precondition('physical .03 pilot requires one exact owned target')
  const r = await dispatchE03Physical(ownOutboxId, () => triggerOutbox(mode(), 25), opts.uncertainNoResendProbe ?? false)
  timing.add('drain', label, r.ms)
  const body = r.body as { result: Record<string, unknown> }
  return { status: r.status, ms: r.ms, result: body.result, raw: r.body, foreignClaimableBefore: 0 }
}
