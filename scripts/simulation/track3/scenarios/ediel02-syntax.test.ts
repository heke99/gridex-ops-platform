/* eslint-disable @typescript-eslint/no-explicit-any */
// EDIEL02.06: syntaxfel -> faktisk negativ CONTRL skapad och skickad till DSO-motparten. Ingen webbläsare.
//  a) felaktigt segment (okänt segment, fel UNT-segmentantal, saknat BGM)  b) ogiltigt teckenset / UNOC-brott (UNOC med tecken utanför ISO 8859-1, UNOA med gemener/icke-A)
//  c) trasig MIME / ingen EDIFACT: koden förväntas ge manual_review utan CONTRL; designen kräver ett faktiskt felkvitto, så det
//     asserteras som eget steg (06c-*-receipt) och faller om inget kvitto skickas (kandidatfynd, inte bortassertat).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { purgeInbox, readReceivedEml, receivedMail } from '../lib/counterparty'
import { buildE02Utilts } from '../lib/e02-edifact'
import { type DsoMail, sha } from '../lib/e02-flow'
import { lit, sql } from '../lib/e02-flow'
import { e02MeteringPoint, seedE02Routable, type E02Fixture } from '../lib/e02-seed'
import { e02Counts } from '../lib/e02-state'
import { E02_OWN_ID } from '../lib/e02-tenant'
import { setupE02 } from '../lib/e02-setup'
import { buildEdifactMime } from '../lib/mime'

let S: Awaited<ReturnType<typeof setupE02>>
beforeAll(async () => { S = await setupE02('syntax') }, 120_000)
afterAll(async () => { await S?.teardown() })

const j = (q: string) => JSON.parse(sql(q))
type Fate = { emails: any[]; messages: any[]; dso: DsoMail[]; counts: ReturnType<typeof e02Counts>; poll: Record<string, any>; mimeSha256: string; interchangeRef: string | null; tasks: any[] }
const results = new Map<string, Fate>()

/** Lägg ett meddelande (givna bytes) i IMAP, kör poll + drain och samla utfallet för e-posten. */
async function run(tag: string, fx: E02Fixture, mime: Buffer, interchangeRef: string | null, subject: string): Promise<Fate> {
  const { flow, run: r, ev } = S
  await purgeInbox()
  ev.save(`${tag}/input.eml`, mime)
  const dso0 = (await receivedMail()).length
  await flow.putRaw(mime)
  const poll = await flow.poll(tag)
  const ids = poll.summary.edielMessageIds as string[]
  const reproc = ids.length ? await flow.groundAndReprocess(ids) : {}
  const drain = await flow.drain(tag)
  const dso = await flow.dsoSince(dso0)
  const emails = j(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'company',company_id,'status',processing_status,'match',match_status,'err',error_message,'family',message_family,'code',message_code,'raw_sha',raw_message_sha256) ORDER BY created_at),'[]') FROM public.inbound_email_messages WHERE subject=${lit(subject)}`)
  const messages = j(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id,'family',m.message_family,'dir',m.direction,'status',m.status,'ack',m.ack_outcome,'syntax',m.syntax_check_status,'fail',m.failure_reason,'rel',m.related_message_id) ORDER BY m.created_at),'[]')
    FROM public.ediel_messages m WHERE m.inbound_email_message_id IN (SELECT id FROM public.inbound_email_messages WHERE subject=${lit(subject)})
       OR m.related_message_id IN (SELECT id FROM public.ediel_messages WHERE inbound_email_message_id IN (SELECT id FROM public.inbound_email_messages WHERE subject=${lit(subject)}))`)
  const tasks = j(`SELECT coalesce(jsonb_agg(jsonb_build_object('type',task_type,'title',title) ORDER BY created_at),'[]') FROM public.customer_operation_tasks WHERE company_id=${lit(fx.companyId)} AND metadata::text LIKE ${lit('%' + (emails[0]?.id ?? 'no-email') + '%')}`)
  const counts = e02Counts(fx, r.prefix)
  const fate: Fate = { emails, messages, dso, counts, poll: poll.summary, mimeSha256: sha(mime), interchangeRef, tasks }
  ev.save(`${tag}/fate.json`, { ...fate, dso: dso.map((d) => ({ n: d.n, sha256: d.sha256, subject: d.subject, status: d.contrlStatus, uci: d.uci })), reproc, drain: drain.http.body })
  ev.observe(tag, { emails: emails.map((e: any) => ({ status: e.status, match: e.match, err: e.err })), messages: messages.map((m: any) => `${m.dir}:${m.family}:${m.status}:${m.ack ?? ''}:${m.syntax ?? ''}`), dso: dso.map((d) => ({ subject: d.subject, status: d.contrlStatus, uci: d.uci })), tasks, counts, autoProcessErrors: poll.summary.autoProcessErrors, polled: { fetched: poll.summary.fetched, stored: poll.summary.stored } })
  results.set(tag, fate)
  return fate
}
const noBusinessEffect = (c: Fate['counts']) => expect(c).toMatchObject({ series: 0, meteringValues: 0, normalized: 0, billingUnderlays: 0, invoices: 0, aperak: 0 })
/** Verifiera den faktiskt mottagna negativa CONTRL:en (MIME, mottagare, UCI-status, referens). */
function expectNegativeContrl(f: Fate) {
  const contrl = f.dso.filter((d) => d.segments.some((s) => s.startsWith('UNH+') && s.includes('CONTRL')))
  expect(contrl).toHaveLength(1)
  const m = contrl[0]
  const eml = readReceivedEml(m.n)
  expect(eml.sha256Matches).toBe(true)
  const text = eml.raw.toString('utf8')
  expect(text).toMatch(/^To: dso@t3\.sim\.invalid$/m)
  expect(text).toMatch(/^From: ediel@t3\.sim\.invalid$/m)
  expect(m.subject).toMatch(/^CONTRL /)
  const uci = m.segments.find((s) => s.startsWith('UCI+'))!
  expect(uci).toBeTruthy()
  expect(uci).toContain(`+${f.interchangeRef}+`) // refererar den felaktiga överföringen
  expect(uci).toMatch(new RegExp(`\\+70007:ZZ\\+${E02_OWN_ID}:ZZ\\+|\\+${E02_OWN_ID}:ZZ\\+70007:ZZ\\+`)) // ursprunglig avsändare/mottagare i UCI (kopplat till 70007<->16700)
  expect(m.contrlStatus).not.toBe('1') // 1 = accepterad; negativt kvitto bär annan kod
  expect(m.contrlStatus).toBe('4')
  const ownContrl = f.messages.filter((x) => x.dir === 'outbound' && x.family === 'CONTRL')
  expect(ownContrl).toHaveLength(1); expect(ownContrl[0].ack).toBe('negative')
  return { status: m.contrlStatus, uci: m.segments.filter((s) => /^UC[IMSD]/.test(s)) }
}

describe('EDIEL02.06ab syntaxfel ger faktisk negativ CONTRL till DSO', () => {
  const cases: Array<{ id: string; title: string; seq: number; mutateRaw: (raw: string) => string; e66?: Partial<Parameters<typeof buildE02Utilts>[0]> }> = [
    { id: '06a1', title: 'okänt segment (ZZZ) i meddelandet', seq: 61, mutateRaw: (r) => r, e66: { mutate: (s) => { const i = s.findIndex((x) => x.startsWith('MKS+')); s.splice(i + 1, 0, 'ZZZ+1+2'); return s } } },
    { id: '06a2', title: 'fel segmentantal i UNT', seq: 62, mutateRaw: (r) => r.replace(/UNT\+\d+\+1/, 'UNT+99+1') },
    { id: '06a3', title: 'obligatoriskt segment (BGM) saknas', seq: 63, mutateRaw: (r) => r, e66: { mutate: (s) => s.filter((x) => !x.startsWith('BGM+')) } },
    { id: '06b1', title: 'UNOC-brott: tecken utanför ISO 8859-1 (euro) i fritext', seq: 64, mutateRaw: (r) => r, e66: { mutate: (s) => { const i = s.findIndex((x) => x.startsWith('MKS+')); s.splice(i + 1, 0, 'FTX+AAO+++Pris i €'); return s } } },
    { id: '06b2', title: 'UNOA-brott: gemener och icke-A-tecken under teckensetet UNOA', seq: 65, mutateRaw: (r) => r.replace('UNOC:3', 'UNOA:3'), e66: { mutate: (s) => { const i = s.findIndex((x) => x.startsWith('MKS+')); s.splice(i + 1, 0, 'FTX+AAO+++små bokstäver åäö'); return s } } },
  ]
  for (const c of cases) {
    it(`EDIEL02.${c.id} ${c.title}: negativ CONTRL skapas och skickas till DSO`, async () => {
      const { run: r } = S
      const fx = seedE02Routable(e02MeteringPoint(r.prefix, c.seq), `${r.prefix}-${c.id}`)
      const e = buildE02Utilts({ prefix: r.prefix, seq: c.seq, meteringPoint: fx.meteringPoint, ...(c.e66 ?? {}) })
      const raw = c.mutateRaw(e.raw)
      const subject = `E66 ${r.prefix} ${c.id}`
      const built = buildEdifactMime({ from: '70007@dso.t3.sim.invalid', to: 'ediel@t3.sim.invalid', subject, raw, placement: 'inline' })
      S.ev.save(`${c.id}/input.edi`, raw)
      const f = await run(c.id, fx, built.mime, e.interchangeRef, subject)
      noBusinessEffect(f.counts) // inga mätvärden/underlag från ett syntaxfel
      const detail = expectNegativeContrl(f)
      S.ev.observe(`EDIEL02.${c.id}.contrl`, detail)
    }, 300_000)
  }
})

describe('EDIEL02.06c trasig MIME / ingen EDIFACT', () => {
  const mimes: Array<{ id: string; title: string; build: (subject: string, e: ReturnType<typeof buildE02Utilts>) => Buffer }> = [
    { id: '06c1', title: 'ren text utan EDIFACT', build: (s) => Buffer.from(['From: 70007@dso.t3.sim.invalid', 'To: ediel@t3.sim.invalid', `Subject: ${s}`, `Message-ID: <${s.replaceAll(' ', '-')}@t3.sim.invalid>`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', '', 'Hej, det här är inget EDIFACT-meddelande.', ''].join('\r\n')) },
    { id: '06c2', title: 'trasig multipart (fel boundary, avklippt bilaga, ogiltig base64)', build: (s, e) => Buffer.from(['From: 70007@dso.t3.sim.invalid', 'To: ediel@t3.sim.invalid', `Subject: ${s}`, `Message-ID: <${s.replaceAll(' ', '-')}@t3.sim.invalid>`, 'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="BROKEN-BOUNDARY"', '', '--WRONG-BOUNDARY', 'Content-Type: application/edifact', 'Content-Transfer-Encoding: base64', '', '@@@@not-base64@@@@', Buffer.from(e.raw.slice(0, 60)).toString('base64').slice(0, 37), '--BROKEN-BOUNDARY', ''].join('\r\n')) },
    { id: '06c3', title: 'avklippt EDIFACT (UNB utan UNH/UNZ)', build: (s, e) => buildEdifactMime({ from: '70007@dso.t3.sim.invalid', to: 'ediel@t3.sim.invalid', subject: s, raw: e.raw.slice(0, e.raw.indexOf("'\n") + 1), placement: 'inline' }).mime },
  ]
  for (const c of mimes) {
    it(`EDIEL02.${c.id} ${c.title}: ingen affärseffekt och synlig manuell granskning`, async () => {
      const { run: r } = S
      const fx = seedE02Routable(e02MeteringPoint(r.prefix, 70 + Number(c.id.slice(-1))), `${r.prefix}-${c.id}`)
      const e = buildE02Utilts({ prefix: r.prefix, seq: 70 + Number(c.id.slice(-1)), meteringPoint: fx.meteringPoint })
      const subject = `E66 ${r.prefix} ${c.id}`
      const f = await run(c.id, fx, c.build(subject, e), e.interchangeRef, subject)
      noBusinessEffect(f.counts)
      expect(f.poll.stored).toBe(1)
      // Ingen tyst förlust: mejlet är lagrat och ligger i manuell granskning/fel (inte processed).
      expect(f.emails).toHaveLength(1)
      expect(['manual_review', 'failed', 'error']).toContain(f.emails[0].status)
    }, 300_000)
    it(`EDIEL02.${c.id}-receipt ${c.title}: designen "faktiskt felkvitto" => negativt kvitto skickas till DSO (kandidatfynd om det saknas)`, async () => {
      const f = results.get(c.id)
      expect(f, 'föregående steg körde inte').toBeTruthy()
      expect(f!.dso.filter((d) => d.segments.some((s) => s.startsWith('UNH+') && s.includes('CONTRL')))).toHaveLength(1)
      expectNegativeContrl(f!)
    }, 60_000)
  }
})
