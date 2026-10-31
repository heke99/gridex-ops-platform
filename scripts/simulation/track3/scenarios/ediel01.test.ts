// EDIEL01 (spår 3): Ediel-protokoll och utgående kvittenser. Kampanj 20261029-3f1a8ab1.
// Ingen webbläsare/Playwright. En fil med beroende steg i ordning: kör alltid hela filen.
//   EDIEL01.01  N (=28) syntetiska UTILTS E66 70007 -> 16700 via IMAP-TLS -> intake -> N CONTRL (positiv) i outbox -> HTTP-drain -> N MIME hos DSO
//   EDIEL01.02  N positiva APERAK-utkast utan outbox -> native enqueue (autoAckOrchestrator, prepared.kind==='existing') -> exakt en outboxrad var
//   EDIEL01.03  drain -> N APERAK sent, transportförsök 'accepted', Message-ID/sha256 i DB == mottagen MIME
//   EDIEL01.04  TLS: positivt över egen CA (TLS-version) + negativt mot okänd CA (SMTP + IMAP) + klartext/STARTTLS-nedgradering
//   EDIEL01.05  RFC Message-ID, UNB-interchange-ref och BGM/affärsref är tre olika värden i sina kolumner, inga kollisioner
//   EDIEL01.06  äldre rader (producerade av koden före körningen) är oförändrade efter hela kedjan
// Produktavvikelser asserteras som FAIL (maskeras inte); övrigt loggas som observation i report.json.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { triggerInbound, triggerOutbox } from '../lib/app'
import { appendToInbox, counterpartyState, purgeInbox, readReceivedEml, receivedMail, setSmtpMode, tlsHandshake, type ReceivedMail } from '../lib/counterparty'
import { lit, resetMailboxSchedule } from '../lib/db'
import { buildSources, injectAll, logLine, mailRows, runIntake, reprocessSources, sourceRows, Timer, actorId, type Source, type IntakeResult } from '../lib/e01-chain'
import { OWN_EDIEL_ID, seedE01Tenant, seedHistoryGround, seedRoutableChain, setAckRouteApplicationReference, sqlIn } from '../lib/e01-fixture'
import { startPlainSmtpListener, startUntrustedTlsListener } from '../lib/e01-tls'
import { Evidence } from '../lib/evidence'
import { runInboundEngineAsAutomationActor } from '../lib/inprocess'
import { adminClient, DSO_EMAIL, newRunContext, COUNTERPARTY_EDIEL_ID } from '../lib/seed.mjs'

const N = Number(process.env.T3_E01_N ?? 28)
const mode = (process.env.T3_MODE as 'test' | 'production') ?? 'test'
const mailbox = process.env.T3_MAILBOX_ADDRESS ?? 'ediel@t3.sim.invalid'
const run = newRunContext('ediel01')
const ev = new Evidence()
const timer = new Timer()
const q = <T>(sql: string) => sqlIn<T>(sql)
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex')
const inList = (ids: string[]) => (ids.length ? ids.map(lit).join(',') : "'00000000-0000-0000-0000-000000000000'")
const T0 = Date.now()

let ackRoutePrevious: { profileId: string; previous: string | null } | null = null
let seeded: ReturnType<typeof seedRoutableChain>
let sources: Source[] = []
let legacySource: Source | null = null
let srcIds: string[] = []                 // ediel_messages.id för de N inkommande E66
let contrl: OutRow[] = []
let aperak: OutRow[] = []
let dsoBase = 0
let legacyBaseline: Record<string, string> | null = null
let intake: IntakeResult | null = null

type OutRow = {
  id: string; message_family: string; status: string; ack_outcome: string | null; related_message_id: string; interchange_reference: string
  external_reference: string | null; raw_payload: string; outbox_id: string | null; outbox_status: string | null; send_attempt_count: number | null
}
const outRows = (family: 'CONTRL' | 'APERAK', ids: string[]) => q<OutRow[]>(
  `SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.related_message_id),'[]') FROM (SELECT m.id,m.message_family,m.status,m.ack_outcome,m.related_message_id,m.interchange_reference,m.external_reference,m.raw_payload,
     o.id AS outbox_id,o.status AS outbox_status,o.send_attempt_count FROM public.ediel_messages m LEFT JOIN public.ediel_outbox o ON o.ediel_message_id=m.id
     WHERE m.direction='outbound' AND m.message_family=${lit(family)} AND m.related_message_id IN (${inList(ids)})) x`)

type Attempt = { message_id: string; classification: string | null; rfc: string; mimeSha: string; payloadHash: string; providerMessageId: string | null; smtpCode: number | null; rawBase64: string }
const attemptsFor = (ids: string[]) => q<Attempt[]>(
  `SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM (SELECT a.message_id,a.classification,a.binding->>'rfcMessageId' AS rfc,a.binding->>'mimeSha256' AS "mimeSha",a.binding->>'payloadHash' AS "payloadHash",
     a.provider_result->>'messageId' AS "providerMessageId",(a.provider_result->>'smtpCode')::int AS "smtpCode",a.binding->>'rawBase64' AS "rawBase64"
     FROM gridex_ediel_transport.attempts a WHERE a.message_id IN (${inList(ids)})) x`)

function parseMime(raw: Buffer) {
  const text = raw.toString('latin1')
  const cut = text.indexOf('\r\n\r\n')
  const head = text.slice(0, cut).replace(/\r\n[ \t]+/g, ' ')
  const headers: Record<string, string> = {}
  for (const l of head.split('\r\n')) { const i = l.indexOf(':'); if (i > 0) headers[l.slice(0, i).toLowerCase()] = l.slice(i + 1).trim() }
  const body = text.slice(cut + 4)
  const payload = /base64/i.test(headers['content-transfer-encoding'] ?? '') ? Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('latin1') : body
  return { headers, payload }
}
const segs = (edi: string) => edi.replace(/^UNA.{6}/, '').split("'").map((s) => s.trim()).filter(Boolean)

async function drainUntilDone(ids: string[], maxCalls = 6) {
  const calls: Array<{ status: number; ms: number; body: unknown }> = []
  for (let i = 0; i < maxCalls; i++) {
    const r = await timer.p('outbox_drain_http', () => triggerOutbox(mode, 100))
    calls.push({ status: r.status, ms: r.ms, body: r.body ?? r.text.slice(0, 500) })
    const open = q<number>(`SELECT count(*) FROM public.ediel_outbox WHERE ediel_message_id IN (${inList(ids)}) AND status IN ('prepared','queued','sending')`)
    if (Number(open) === 0) break
  }
  return calls
}

beforeAll(async () => {
  ev.observe('run', { ...run, mode, N, startedAt: new Date(T0).toISOString() })
  await setSmtpMode('accept')
  ev.observe('e01_tenant', { ...seedE01Tenant(), ownEdielId: OWN_EDIEL_ID, note: 'egen tenant 16701 i stället för basbolaget 16700 (ack-läsningarna skalar med antalet CONTRL i bolaget; basbolaget hade ~37 -> 8 s statement_timeout)' })
  ackRoutePrevious = setAckRouteApplicationReference('23-DDQ-E66-T')
  ev.observe('ack_route_profile_application_reference', { set: '23-DDQ-E66-T', previous: ackRoutePrevious.previous, note: 'Basfixturens ediel_ack-profil har NULL; select_configured_reply_route_v2 kräver UNB-applikationsreferensen (fixtur, inte produktfynd)' })
  const all = buildSources(run.prefix, [0, ...Array.from({ length: N }, (_, i) => i + 1)], mailbox)
  legacySource = all[0]; sources = all.slice(1)
  seeded = seedRoutableChain(all.map((s) => s.spec.meteringPoint))
  ev.observe('seeded', { companyId: seeded.companyId, meteringPoints: seeded.points.length, issuer: `${COUNTERPARTY_EDIEL_ID} (gridex_utilts_issuer)` })
}, 300_000)

afterEach(async () => { await setSmtpMode('accept').catch(() => undefined) })
afterAll(async () => {
  await setSmtpMode('accept').catch(() => undefined)
  if (ackRoutePrevious) setAckRouteApplicationReference(ackRoutePrevious.previous)
  ev.observe('timings', timer.summary())
  ev.observe('wall_clock_ms', Date.now() - T0)
  ev.finalize()
}, 120_000)

// ---------------------------------------------------------------------------------------------------------------------
describe('EDIEL01.06 förberedelse: äldre rader skapas av kodens egen väg före huvudkörningen', () => {
  it('EDIEL01.06 pre: äldre failed CONTRL-outboxrad + arkiverad legacy-MIME (permfail 554) + äldre outbound_requests; sha256/radhash tas', async () => {
    const dir = 'legacy'
    await purgeInbox()
    await injectAll([legacySource!], timer, ev, dir)
    const r = await runIntake(run.prefix, 1, timer, mode, { maxPolls: 3, legacy: true })
    ev.save(`${dir}/intake.json`, r)
    const lsrc = sourceRows(run.prefix, true)
    expect(lsrc.length, 'legacy-källan har ett ediel_message').toBe(1)
    const lc = outRows('CONTRL', [lsrc[0].id])
    expect(lc.length, 'legacy-CONTRL skapad').toBe(1)
    await setSmtpMode('permfail-5xx', { code: 554 })
    let d: Awaited<ReturnType<typeof triggerOutbox>>
    try { d = await timer.p('legacy_drain_permfail', () => triggerOutbox(mode, 100)) } finally { await setSmtpMode('accept').catch(() => undefined) }
    ev.save(`${dir}/drain-response.json`, d.body ?? d.text)
    const after = outRows('CONTRL', [lsrc[0].id])[0]
    ev.observe('legacy_outbox_after_permfail', { status: after.outbox_status, attempts: after.send_attempt_count })
    expect(['failed', 'delivery_uncertain', 'blocked']).toContain(after.outbox_status)
    // Äldre köpost i det äldre lagret: två outbound_requests (en queued/0 försök, en sent), skapade med äldre tidsstämplar.
    q(`INSERT INTO public.outbound_requests(id,company_id,request_type,status,channel_type,attempts_count,queued_at,sent_at,created_at,updated_at,external_reference,payload)
       VALUES(gen_random_uuid(),${lit(seeded.companyId)},'grid_owner_information','queued','unresolved',0,now()-interval '40 days',NULL,now()-interval '40 days',now()-interval '40 days',${lit(`${run.prefix}-LEGACY-Q`)},'{"legacy":true}'),
             (gen_random_uuid(),${lit(seeded.companyId)},'grid_owner_information','sent','email',1,now()-interval '41 days',now()-interval '41 days',now()-interval '41 days',now()-interval '41 days',${lit(`${run.prefix}-LEGACY-S`)},'{"legacy":true}')`)
    await purgeInbox() // legacy-mailet ska inte hämtas av huvudkörningens polls
    legacyBaseline = await legacyHashes(lsrc[0].id)
    ev.save('legacy/baseline-hashes.json', legacyBaseline)
    ev.observe('legacy_baseline', { keys: Object.keys(legacyBaseline).length })
    expect(Object.keys(legacyBaseline).length).toBeGreaterThanOrEqual(6)
    dsoBase = (await receivedMail()).length
  }, 600_000)
})

async function legacyHashes(legacySourceId: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const ack = q<Array<{ id: string }>>(`SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM (SELECT id FROM public.ediel_messages WHERE related_message_id=${lit(legacySourceId)}) x`)
  const ackIds = ack.map((a) => a.id)
  const hashRows = (label: string, sql: string) => {
    const rows = q<Array<{ k: string; j: unknown }>>(`SELECT coalesce(jsonb_agg(jsonb_build_object('k',k,'j',j) ORDER BY k),'[]') FROM (${sql}) y(k,j)`)
    for (const r of rows) out[`${label}:${r.k}`] = sha(JSON.stringify(r.j))
  }
  hashRows('ediel_messages.source', `SELECT id::text, to_jsonb(m) FROM public.ediel_messages m WHERE id=${lit(legacySourceId)}`)
  hashRows('ediel_messages.ack', `SELECT id::text, to_jsonb(m) FROM public.ediel_messages m WHERE id IN (${inList(ackIds)})`)
  hashRows('ediel_outbox', `SELECT id::text, to_jsonb(o) FROM public.ediel_outbox o WHERE ediel_message_id IN (${inList(ackIds)})`)
  hashRows('transport.attempts', `SELECT id::text, to_jsonb(a) FROM gridex_ediel_transport.attempts a WHERE message_id IN (${inList(ackIds)})`)
  hashRows('ediel_message_payloads', `SELECT id::text, to_jsonb(p) FROM public.ediel_message_payloads p WHERE ediel_message_id IN (${inList(ackIds)})`)
  hashRows('outbound_requests', `SELECT id::text, to_jsonb(r) FROM public.outbound_requests r WHERE external_reference LIKE ${lit(`${run.prefix}-LEGACY-%`)}`)
  // Arkiverad legacy-MIME i lagret ediel-files (bytes).
  const payloads = q<Array<{ path: string }>>(`SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM (SELECT metadata->>'archive_path' AS path FROM public.ediel_message_payloads WHERE payload_kind='raw_mime' AND ediel_message_id IN (${inList(ackIds)})) x`)
  for (const p of payloads) {
    const { data, error } = await adminClient().storage.from('ediel-files').download(p.path)
    if (error || !data) { out[`storage:${p.path}`] = `ERR:${error?.message}`; continue }
    out[`storage:${p.path}`] = sha(Buffer.from(await data.arrayBuffer()))
  }
  return out
}

// ---------------------------------------------------------------------------------------------------------------------
describe('EDIEL01.01 intake av N E66 -> N CONTRL -> drain -> N MIME hos DSO', () => {
  it('EDIEL01.01 N syntetiska E66 läggs i IMAP via TLS och ligger kvar i mappen', async () => {
    await injectAll(sources, timer, ev, 'inbound')
    const { inboxStatus } = await import('../lib/counterparty')
    const st = await inboxStatus()
    ev.observe('imap_after_inject', st)
    expect(st.messages).toBe(N)
    expect(new Set(sources.map((s) => s.spec.interchangeRef)).size, 'unika UNB-refs').toBe(N)
    expect(new Set(sources.map((s) => s.spec.documentRef)).size, 'unika BGM-refs').toBe(N)
    expect(new Set(sources.map((s) => s.spec.meteringPoint)).size, 'unika mätpunkter').toBe(N)
  }, 600_000)

  it('EDIEL01.01 HTTP inbound-cron (utan aktör) loggas först: utfall, tid, vad som lagras', async () => {
    resetMailboxSchedule(mode)
    const before = mailRows(run.prefix).length
    const r = await timer.p('imap_poll_http_cron', () => triggerInbound(mode))
    const after = mailRows(run.prefix)
    const jobs = q<Array<{ status: string; step: string | null; error_message: string | null }>>(`SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM (SELECT j.status,j.step,j.error_message FROM public.inbound_processing_jobs j JOIN public.inbound_email_messages i ON i.id=j.inbound_email_message_id WHERE i.subject LIKE ${lit(`E66 ${run.prefix} %`)} AND i.subject <> ${lit(`E66 ${run.prefix} 000`)}) x`)
    const ediel = sourceRows(run.prefix).length
    ev.save('inbound/http-cron-outcome.json', { status: r.status, ms: r.ms, body: r.body ?? r.text.slice(0, 2000), mailsBefore: before, mailsAfter: after.length, jobs, edielMessages: ediel })
    ev.observe('http_inbound_cron', { status: r.status, ms: r.ms, storedMails: after.length - before, jobs, edielMessages: ediel,
      note: 'cron-routen skickar ingen actorUserId -> ediel_real_reception_actor_and_parse_required (README obs. 2); en poll hämtar ~ett meddelande (obs. 1)' })
    // Oraklet för HTTP-vägen: den ska göra hela intaket (N ediel_messages). Observerat avvikande utfall asserteras som FAIL.
    expect(ediel, 'HTTP inbound-cron skapar ediel_messages utan aktör').toBeGreaterThan(0)
  }, 600_000)

  it('EDIEL01.01 intake med aktör: poll(IMAP) lagrar N mail; första bearbetningsförsöket skapar ediel_messages', async () => {
    // Dokumenterat ersättningssteg: samma motor i testprocessen med automationsaktören (app/admin/inbound-mail/actions.ts:75-91).
    intake = await runIntake(run.prefix, N, timer, mode)
    ev.save('inbound/intake-result.json', intake)
    ev.observe('intake', intake)
    expect(mailRows(run.prefix).length, 'N mail lagrade via IMAP-poll').toBe(N)
    // Kandidatfynd: för delad brevlåda är inbound_email_messages.company_id NULL när createInboundEdielMessage körs;
    // trigger gridex_ediel_message_inbound_email_tenant_guard ger 23514 och raden uteblir (company_id sätts först efteråt).
    expect(intake.queueFirstPass.edielMessagesAfter, 'första bearbetningsförsöket (kön) skapar N ediel_messages').toBe(N)
  }, 900_000)

  it('EDIEL01.01 N ediel_messages (inbound E66) finns efter "Processa om" + autobearbetning, med rätt referenser', async () => {
    const rows = sourceRows(run.prefix)
    srcIds = rows.map((r) => r.id)
    ev.save('inbound/source-rows.json', rows)
    expect(rows.length).toBe(N)
    const byRef = new Map(rows.map((r) => [r.interchange_reference, r]))
    for (const s of sources) {
      const r = byRef.get(s.spec.interchangeRef)
      expect(r, `ediel_message för ${s.spec.interchangeRef}`).toBeTruthy()
      expect(r!.external_reference).toBe(s.spec.documentRef)
      s.sourceId = r!.id; s.mailId = r!.inbound_email_message_id
    }
    expect(intake!.engineAuto.error).toBeUndefined()
    expect(intake!.engineAuto.autoProcessErrors ?? []).toEqual([])
  })

  it('EDIEL01.01 exakt N CONTRL i outbox med related_message_id = källa, positiv resultatkod; UCI refererar källans UNB-ref; avsändare/mottagare omvända', async () => {
    contrl = outRows('CONTRL', srcIds)
    ev.save('outbound/contrl-rows-before-drain.json', contrl.map((c) => ({ ...c, raw_payload: undefined })))
    expect(contrl.length, 'exakt N CONTRL').toBe(N)
    expect(new Set(contrl.map((c) => c.related_message_id)).size).toBe(N)
    const mismatches: string[] = []
    for (const s of sources) {
      const c = contrl.find((x) => x.related_message_id === s.sourceId)!
      ev.save(`outbound/contrl-${String(s.seq).padStart(3, '0')}.edi`, c.raw_payload)
      const sg = segs(c.raw_payload)
      const unb = sg.find((x) => x.startsWith('UNB+'))!.split('+')
      const uci = sg.find((x) => x.startsWith('UCI+'))!.split('+')
      const unh = sg.find((x) => x.startsWith('UNH+'))!
      if (!unh.includes('CONTRL:')) mismatches.push(`${s.seq}: UNH ${unh}`)
      if (c.ack_outcome !== 'positive') mismatches.push(`${s.seq}: ack_outcome ${c.ack_outcome}`)
      if (c.outbox_id === null) mismatches.push(`${s.seq}: ingen outboxrad`)
      if (unb[2] !== `${OWN_EDIEL_ID}:ZZ` || unb[3] !== `${COUNTERPARTY_EDIEL_ID}:ZZ`) mismatches.push(`${s.seq}: UNB avs/mott ${unb[2]} ${unb[3]}`)
      if (uci[1] !== s.spec.interchangeRef) mismatches.push(`${s.seq}: UCI ref ${uci[1]} != ${s.spec.interchangeRef}`)
      // UCI: avsändare/mottagare = originalets (omvänt mot CONTRL:ens UNB), 0083 = 1 (accepterat, enligt lib/ediel/ack/inboundAckOutcome.ts:60; brevet antog 4/7)
      if (uci[2] !== `${COUNTERPARTY_EDIEL_ID}:ZZ` || uci[3] !== `${OWN_EDIEL_ID}:ZZ`) mismatches.push(`${s.seq}: UCI parter ${uci[2]} ${uci[3]}`)
      if (uci[4] !== '1') mismatches.push(`${s.seq}: UCI 0083 ${uci[4]}`)
      if (unb[5] === s.spec.interchangeRef) mismatches.push(`${s.seq}: CONTRL återanvänder källans interchange-ref`)
    }
    const hasUcm = contrl.some((c) => segs(c.raw_payload).some((x) => x.startsWith('UCM+')))
    ev.observe('contrl_shape', { uciActionCodeObserved: '1 (accepted)', briefExpected: '4 eller 7', ucmSegmentsPresent: hasUcm, sample: segs(contrl[0].raw_payload) })
    expect(mismatches, mismatches.slice(0, 5).join(' | ')).toEqual([])
    expect(contrl.every((c) => ['queued', 'prepared'].includes(String(c.outbox_status))), `outbox-status före drain: ${[...new Set(contrl.map((c) => c.outbox_status))]}`).toBe(true)
  })

  it('EDIEL01.01 outbox-drain via app-HTTP -> N CONTRL skickade och N MIME mottagna hos DSO-motparten', async () => {
    const ids = contrl.map((c) => c.id)
    const foreign = q<number>(`SELECT count(*) FROM public.ediel_outbox WHERE status IN ('prepared','queued') AND ediel_message_id NOT IN (${inList(ids)})`)
    ev.observe('foreign_open_outbox_before_drain', Number(foreign))
    const calls = await drainUntilDone(ids)
    ev.save('outbound/contrl-drain-responses.json', calls)
    const now = contrl.map((c) => c.id)
    const rows = outRows('CONTRL', srcIds)
    ev.observe('contrl_outbox_after_drain', Object.fromEntries([...new Set(rows.map((r) => r.outbox_status))].map((s) => [s, rows.filter((r) => r.outbox_status === s).length])))
    const attempts = attemptsFor(now)
    const dso = (await receivedMail()).slice(dsoBase)
    const mine: Array<{ n: number; rec: ReceivedMail; attempt: Attempt }> = []
    for (const a of attempts) {
      const rec = dso.find((m) => readReceivedEml(m.n).raw.toString('latin1').includes(`Message-ID: ${a.rfc}`))
      if (rec) mine.push({ n: rec.n, rec, attempt: a })
    }
    for (const m of mine) { const e = readReceivedEml(m.n); ev.save(`outbound/dso-contrl-${m.n}.eml`, e.raw) }
    ev.observe('dso_contrl', { received: mine.length, tls: [...new Set(mine.map((m) => m.rec.tlsVersion))], dispositions: [...new Set(mine.map((m) => m.rec.disposition))] })
    expect(rows.every((r) => r.outbox_status === 'sent'), `outbox-status efter drain: ${JSON.stringify(rows.map((r) => r.outbox_status).slice(0, 5))}`).toBe(true)
    expect(attempts.length, 'ett transportförsök per CONTRL').toBe(N)
    expect(mine.length, 'N CONTRL-MIME mottagna hos DSO').toBe(N)
  }, 900_000)
})

// ---------------------------------------------------------------------------------------------------------------------
describe('EDIEL01.02 positiva APERAK-utkast utan outbox -> native enqueue', () => {
  let groundAndReprocess: Awaited<ReturnType<typeof reprocessSources>> = []
  let beforeCounts: Record<string, number>
  const counts = () => ({
    outboundMessagesForSources: Number(q<number>(`SELECT count(*) FROM public.ediel_messages WHERE direction='outbound' AND related_message_id IN (${inList(srcIds)})`)),
    aperakMessages: Number(q<number>(`SELECT count(*) FROM public.ediel_messages WHERE direction='outbound' AND message_family='APERAK' AND related_message_id IN (${inList(srcIds)})`)),
    contrlMessages: Number(q<number>(`SELECT count(*) FROM public.ediel_messages WHERE direction='outbound' AND message_family='CONTRL' AND related_message_id IN (${inList(srcIds)})`)),
    outboxForSources: Number(q<number>(`SELECT count(*) FROM public.ediel_outbox WHERE source_message_id IN (${inList(srcIds)})`)),
    allEdielMessages: Number(q<number>(`SELECT count(*) FROM public.ediel_messages`)),
  })

  it('EDIEL01.02 kodens egen väg för E66 ger N positiva APERAK-utkast; observerad outbox-status loggas', async () => {
    // Granskat historiktäckningsunderlag (syntetiskt, anpassat från native-testernas helper) för de admitterade källorna; därefter
    // samma inbound-bearbetning som motorns autoprocess -> UTILTS accepteras -> positiv APERAK.
    ev.observe('history_ground_seeded', seedHistoryGround(srcIds, actorId()))
    groundAndReprocess = await reprocessSources(srcIds, timer)
    ev.save('outbound/aperak-reprocess.json', groundAndReprocess)
    aperak = outRows('APERAK', srcIds)
    ev.save('outbound/aperak-rows-before-enqueue.json', aperak.map((a) => ({ ...a, raw_payload: undefined })))
    ev.observe('aperak_after_code_path', { count: aperak.length, outcomes: [...new Set(aperak.map((a) => a.ack_outcome))], outboxIds: aperak.filter((a) => a.outbox_id).length, errors: groundAndReprocess.filter((g) => g.error).map((g) => g.error).slice(0, 3) })
    expect(groundAndReprocess.filter((g) => g.error).map((g) => g.error)).toEqual([])
    expect(aperak.length, 'N APERAK-utkast skapade av kodens egen väg').toBe(N)
    expect(aperak.every((a) => a.ack_outcome === 'positive'), 'alla positiva').toBe(true)
    expect(contrl.length).toBe(N)
    expect(outRows('CONTRL', srcIds).length, 'inga extra CONTRL av omkörningen').toBe(N)
    // Oraklet för "befintliga utan outbox": kodens väg lämnar APERAK utan outboxrad (logga om den själv köar dem).
    const withOutbox = aperak.filter((a) => a.outbox_id !== null).length
    ev.observe('aperak_outbox_by_code_itself', { withOutbox, withoutOutbox: N - withOutbox })
    expect(withOutbox, 'kodens egen väg köar inga APERAK (utkast utan outbox)').toBe(0)
    for (const s of sources) {
      const a = aperak.find((x) => x.related_message_id === s.sourceId)!
      ev.save(`outbound/aperak-${String(s.seq).padStart(3, '0')}.edi`, a.raw_payload)
    }
  }, 900_000)

  it('EDIEL01.02 native enqueue via autoAckOrchestrator (prepared.kind==="existing") -> exakt en outboxrad per utkast, existing_response_retained, inga nya svarskopior', async () => {
    const { runAutoAckOrchestratorForInboundMessage } = await import('@/lib/ediel/orchestrator/autoAckOrchestrator')
    const { supabaseService } = await import('@/lib/supabase/service')
    beforeCounts = counts()
    const results: Array<{ seq: number; status: string; lifecycleStatus: string | null; ackMessageId: string | null; expectedAck: string; reason: string; ms: number }> = []
    for (const s of sources) {
      const { data: src, error } = await supabaseService.from('ediel_messages').select('*').eq('id', s.sourceId!).single()
      expect(error).toBeNull()
      const expectedAck = aperak.find((a) => a.related_message_id === s.sourceId)!.id
      const t0 = Date.now()
      const r = await timer.p('native_enqueue_orchestrator', () => runAutoAckOrchestratorForInboundMessage({
        actorUserId: actorId(), sourceMessage: src as never, inboundEmailMessageId: s.mailId!,
        decision: { kind: 'ack', ackFamily: 'APERAK', outcome: 'positive', messageText: null, applicationErrors: [], reason: 'EDIEL01.02 native enqueue av befintligt APERAK-utkast', ruleKeys: [], classification: null },
      }))
      results.push({ seq: s.seq, status: r.status, lifecycleStatus: r.lifecycleStatus, ackMessageId: r.ackMessageId, expectedAck, reason: r.reason, ms: Date.now() - t0 })
    }
    ev.save('outbound/native-enqueue-results.json', results)
    const afterCounts = counts()
    ev.observe('native_enqueue', { before: beforeCounts, after: afterCounts, lifecycle: [...new Set(results.map((r) => r.lifecycleStatus))], status: [...new Set(results.map((r) => r.status))] })
    expect(results.filter((r) => r.lifecycleStatus !== 'existing_response_retained').map((r) => `${r.seq}:${r.lifecycleStatus}/${r.status}`)).toEqual([])
    expect(results.every((r) => r.ackMessageId === r.expectedAck), 'det befintliga utkastet återanvänds').toBe(true)
    const aperakNow = outRows('APERAK', srcIds)
    expect(aperakNow.length).toBe(N)
    expect(aperakNow.every((a) => a.outbox_id !== null), 'en outboxrad per utkast').toBe(true)
    const perDraft = q<Array<{ ediel_message_id: string; c: number }>>(`SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM (SELECT ediel_message_id,count(*)::int AS c FROM public.ediel_outbox WHERE ediel_message_id IN (${inList(aperakNow.map((a) => a.id))}) GROUP BY 1) x`)
    expect(perDraft.length).toBe(N)
    expect(perDraft.every((p) => p.c === 1), 'exakt en outboxrad per utkast').toBe(true)
    expect(afterCounts.aperakMessages, 'inga nya APERAK-kopior').toBe(beforeCounts.aperakMessages)
    expect(afterCounts.contrlMessages).toBe(beforeCounts.contrlMessages)
    expect(afterCounts.outboundMessagesForSources).toBe(beforeCounts.outboundMessagesForSources)
    expect(afterCounts.allEdielMessages, 'ediel_messages totalt oförändrat').toBe(beforeCounts.allEdielMessages)
    expect(afterCounts.outboxForSources - beforeCounts.outboxForSources, 'exakt N nya outboxrader').toBe(N)
    ev.observe('aperak_outbox_status_after_enqueue', [...new Set(aperakNow.map((a) => a.outbox_status))])
    aperak = aperakNow
    // Idempotens: ett andra anrop skapar varken nya svar eller nya outboxrader.
    const again = counts()
    const second = await runAutoAckOrchestratorForInboundMessage({
      actorUserId: actorId(), sourceMessage: (await supabaseService.from('ediel_messages').select('*').eq('id', sources[0].sourceId!).single()).data as never,
      inboundEmailMessageId: sources[0].mailId!,
      decision: { kind: 'ack', ackFamily: 'APERAK', outcome: 'positive', messageText: null, applicationErrors: [], reason: 'EDIEL01.02 repeat', ruleKeys: [], classification: null },
    })
    const afterSecond = counts()
    ev.observe('native_enqueue_repeat', { lifecycle: second.lifecycleStatus, before: again, after: afterSecond })
    expect(afterSecond).toEqual(again)
  }, 900_000)
})

// ---------------------------------------------------------------------------------------------------------------------
describe('EDIEL01.03 drain -> N APERAK sent, accepted, N MIME hos DSO, Message-ID/sha256 matchar', () => {
  it('EDIEL01.03 outbox-drain via app-HTTP skickar N APERAK; transportförsök accepted; N MIME mottagna', async () => {
    const ids = aperak.map((a) => a.id)
    const dsoBefore = (await receivedMail()).length
    const calls = await drainUntilDone(ids)
    ev.save('outbound/aperak-drain-responses.json', calls)
    const rows = outRows('APERAK', srcIds)
    ev.save('outbound/aperak-rows-after-drain.json', rows.map((r) => ({ ...r, raw_payload: undefined })))
    ev.observe('aperak_outbox_after_drain', Object.fromEntries([...new Set(rows.map((r) => r.outbox_status))].map((s) => [s, rows.filter((r) => r.outbox_status === s).length])))
    const attempts = attemptsFor(ids)
    ev.observe('aperak_attempt_classes', Object.fromEntries([...new Set(attempts.map((a) => a.classification))].map((c) => [String(c), attempts.filter((a) => a.classification === c).length])))
    expect(rows.every((r) => r.outbox_status === 'sent'), `APERAK outbox ${JSON.stringify([...new Set(rows.map((r) => r.outbox_status))])}`).toBe(true)
    expect(attempts.length).toBe(N)
    expect(attempts.every((a) => a.classification === 'accepted' && a.smtpCode === 250)).toBe(true)
    const dso = await receivedMail()
    const fresh = dso.slice(dsoBefore)
    let matched = 0
    const problems: string[] = []
    const providerIdDiffers: string[] = []
    const files = new Map<number, { raw: Buffer; rec: ReceivedMail }>()
    for (const rec of dso.slice(dsoBase)) files.set(rec.n, { raw: readReceivedEml(rec.n).raw, rec })
    for (const a of attempts) {
      const hit = [...files.values()].find((f) => f.raw.toString('latin1').includes(`Message-ID: ${a.rfc}`) && /APERAK/.test(f.raw.toString('latin1').slice(0, 400)))
      if (!hit) { problems.push(`${a.message_id}: ingen MIME hos DSO med ${a.rfc}`); continue }
      matched++
      ev.save(`outbound/dso-aperak-${hit.rec.n}.eml`, hit.raw)
      const parsed = parseMime(hit.raw)
      if (hit.rec.sha256 !== a.mimeSha || sha(hit.raw) !== a.mimeSha) problems.push(`${a.message_id}: MIME-sha256 DB ${a.mimeSha} != mottagen ${hit.rec.sha256}`)
      if (parsed.headers['message-id'] !== a.rfc) problems.push(`${a.message_id}: Message-ID DB ${a.rfc} != ${parsed.headers['message-id']}`)
      if (sha(Buffer.from(parsed.payload, 'latin1')) !== a.payloadHash) problems.push(`${a.message_id}: payload-sha256 DB ${a.payloadHash} != mottagen ${sha(Buffer.from(parsed.payload, 'latin1'))}`)
      if (a.providerMessageId && a.providerMessageId !== a.rfc) providerIdDiffers.push(a.message_id)
      const row = rows.find((r) => r.id === a.message_id)!
      if (parsed.payload !== row.raw_payload) problems.push(`${a.message_id}: skickad payload != lagrad raw_payload`)
    }
    ev.observe('aperak_dso', { fresh: fresh.length, matched, tls: [...new Set(fresh.map((m) => m.tlsVersion))], providerMessageIdDiffersFromHeader: providerIdDiffers.length,
      note: 'provider_result.messageId (nodemailer) != Message-ID-huvudet på tråden; DB:s binding.rfcMessageId matchar huvudet' })
    expect(matched, 'N APERAK-MIME hos DSO').toBe(N)
    expect(problems, problems.slice(0, 5).join(' | ')).toEqual([])
  }, 900_000)

  it('EDIEL01.03 N CONTRL-MIME: Message-ID och sha256 i DB matchar den mottagna MIME:n', async () => {
    const attempts = attemptsFor(contrl.map((c) => c.id))
    const dso = await receivedMail()
    const problems: string[] = []
    for (const a of attempts) {
      const rec = dso.slice(dsoBase).find((m) => readReceivedEml(m.n).raw.toString('latin1').includes(`Message-ID: ${a.rfc}`))
      if (!rec) { problems.push(`${a.message_id}: saknas hos DSO`); continue }
      const raw = readReceivedEml(rec.n).raw
      const parsed = parseMime(raw)
      if (sha(raw) !== a.mimeSha || rec.sha256 !== a.mimeSha) problems.push(`${a.message_id}: mime sha`)
      if (sha(Buffer.from(parsed.payload, 'latin1')) !== a.payloadHash) problems.push(`${a.message_id}: payload sha`)
      if (a.classification !== 'accepted') problems.push(`${a.message_id}: klass ${a.classification}`)
    }
    expect(attempts.length).toBe(N)
    expect(problems, problems.slice(0, 5).join(' | ')).toEqual([])
  })

  it('EDIEL01.03 APERAK-innehåll: positiv (BGM 312, ERC 100), DOC/RFF refererar källans BGM och transaktions-id, parter omvända', async () => {
    const mism: string[] = []
    for (const s of sources) {
      const a = aperak.find((x) => x.related_message_id === s.sourceId)!
      const sg = segs(a.raw_payload)
      const unb = sg.find((x) => x.startsWith('UNB+'))!.split('+')
      if (!sg.some((x) => x.startsWith('BGM+312+'))) mism.push(`${s.seq}: BGM`)
      if (!sg.some((x) => x.startsWith('ERC+100'))) mism.push(`${s.seq}: ERC`)
      if (!sg.some((x) => x === `DOC+E66:SVK:260+${s.spec.documentRef}`)) mism.push(`${s.seq}: DOC`)
      if (!sg.some((x) => x === `RFF+ACW:${s.spec.transactionRef}`)) mism.push(`${s.seq}: RFF ACW`)
      if (unb[2] !== `${OWN_EDIEL_ID}:ZZ` || unb[3] !== `${COUNTERPARTY_EDIEL_ID}:ZZ`) mism.push(`${s.seq}: UNB parter`)
      if (!sg.includes(`NAD+MS+${OWN_EDIEL_ID}:SVK:260`) || !sg.includes(`NAD+MR+${COUNTERPARTY_EDIEL_ID}:SVK:260`)) mism.push(`${s.seq}: NAD`)
    }
    expect(mism, mism.slice(0, 5).join(' | ')).toEqual([])
  })
})

// ---------------------------------------------------------------------------------------------------------------------
describe('EDIEL01.04 TLS över egen CA; certfel mot okänd CA; ingen klartext', () => {
  it('EDIEL01.04 positivt: all trafik SMTP/IMAP gick över TLS >= 1.2 med egen CA (versioner loggas)', async () => {
    const dso = (await receivedMail()).slice(dsoBase).filter((m) => m.disposition === 'accepted' && m.authUser)
    const versions = [...new Set(dso.map((m) => m.tlsVersion))]
    const imap = await tlsHandshake(Number(process.env.T3_IMAP_TLS_PORT))
    const smtp = await tlsHandshake(Number(process.env.T3_SMTP_PORT))
    ev.observe('tls_positive', { smtpServerSideVersions: versions, acceptedMimes: dso.length, imapHandshake: imap, smtpHandshake: smtp })
    expect(dso.length).toBeGreaterThanOrEqual(2 * N)
    expect(versions.every((v) => /^TLSv1\.[23]$/.test(v)), `TLS-versioner ${versions}`).toBe(true)
    expect(imap.authorized && smtp.authorized).toBe(true)
  })

  it('EDIEL01.04 negativt SMTP: okänd CA och klartext/STARTTLS-lös motpart -> sändningen faller och ingen mejlkommando går i klartext', async () => {
    const { sendEdielEmail } = await import('@/lib/email/sendEdielEmail')
    const target = contrl[0]
    const rawMime = (tag: string) => Buffer.from([`From: ${mailbox}`, `To: ${DSO_EMAIL}`, `Subject: E01 negative TLS ${tag}`, `Message-ID: <e01-neg-${tag}-${run.prefix.toLowerCase()}@t3.sim.invalid>`, 'MIME-Version: 1.0', 'Content-Type: text/plain', '', 'must never reach a server', ''].join('\r\n'))
    const withEnv = async <T>(vars: Record<string, string>, fn: () => Promise<T>) => {
      const old = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]))
      Object.assign(process.env, vars)
      try { return await fn() } finally { for (const [k, v] of Object.entries(old)) { if (v === undefined) delete process.env[k]; else process.env[k] = v } }
    }
    const attempt = (tag: string, vars: Record<string, string>) => withEnv(vars, async () => {
      try {
        await sendEdielEmail({ raw: rawMime(tag), to: DSO_EMAIL, envelopeFrom: mailbox }, { archiveContext: { companyId: seeded.companyId, messageId: target.id }, beforeProviderCall: async () => undefined })
        return { sent: true as const, error: null as string | null, code: null as string | null }
      } catch (e) { const err = e as { message?: string; code?: string }; return { sent: false as const, error: String(err.message), code: err.code ?? null } }
    })
    const unk = await startUntrustedTlsListener()
    const plain = await startPlainSmtpListener()
    try {
      const r1 = await attempt('unknown-ca', { EDIEL_SMTP_PORT: String(unk.port), EDIEL_SMTP_SECURE: 'true' })
      const r2 = await attempt('plain-implicit', { EDIEL_SMTP_PORT: String(plain.port), EDIEL_SMTP_SECURE: 'true' })
      const r3 = await attempt('plain-starttls', { EDIEL_SMTP_PORT: String(plain.port), EDIEL_SMTP_SECURE: 'false' })
      const mailCmds = (l: string[]) => l.filter((c) => /^(MAIL FROM|RCPT TO|DATA|AUTH)/i.test(c))
      ev.save('tls/negative-results.json', { unknownCa: { result: r1, listener: unk.log }, plainImplicit: { result: r2, listener: plain.log }, plainStarttls: { result: r3 } })
      ev.observe('tls_negative_smtp', { unknownCa: { ...r1, handshakes: unk.log.secureHandshakes, tlsClientErrors: unk.log.tlsClientErrors, appBytes: unk.log.appBytes },
        plainImplicitOrStarttls: { implicit: r2, starttls: r3, mailCommandsSeen: mailCmds(plain.log.smtpCommands), commands: plain.log.smtpCommands.slice(0, 8) } })
      expect(r1.sent).toBe(false)
      expect(String(r1.error) + String(r1.code), 'certfel mot okänd CA').toMatch(/self.signed|unable to verify|certificate|CERT_|UNABLE_TO|issuer/i)
      expect(unk.log.appBytes, 'inga applikationsbytes till servern med okänd CA').toBe(0)
      expect(unk.log.secureHandshakes, 'klienten slutförde aldrig handskakningen').toBe(0)
      expect(r2.sent).toBe(false)
      expect(r3.sent, 'ingen nedgradering till klartext när STARTTLS saknas').toBe(false)
      expect(mailCmds(plain.log.smtpCommands), 'inga MAIL/RCPT/DATA/AUTH i klartext').toEqual([])
    } finally { await unk.close(); await plain.close() }
  }, 300_000)

  it('EDIEL01.04 negativt IMAP: poll mot server med okänd CA nekas utan att inloggningsuppgifter skickas; imap_secure=false-banan loggas', async () => {
    const mbRow = q<{ id: string; imap_port: number; metadata: Record<string, unknown> }>(`SELECT to_jsonb(x) FROM (SELECT id,imap_port,metadata FROM public.ediel_mailboxes WHERE company_id IS NULL AND environment=${lit(mode)} AND COALESCE(metadata->>'scope','')='platform_shared' LIMIT 1) x`)
    const unk = await startUntrustedTlsListener('* OK untrusted IMAP')
    const setBox = (port: number, secure: boolean) => q(`UPDATE public.ediel_mailboxes SET imap_port=${port}, metadata = metadata || ${lit(JSON.stringify({ imap_secure: secure }))}::jsonb, last_polled_at=NULL, locked_at=NULL, locked_by=NULL WHERE id=${lit(mbRow.id)}`)
    const restore = () => q(`UPDATE public.ediel_mailboxes SET imap_port=${mbRow.imap_port}, metadata=${lit(JSON.stringify(mbRow.metadata))}::jsonb, last_polled_at=NULL, locked_at=NULL, locked_by=NULL, last_error=NULL WHERE id=${lit(mbRow.id)}`)
    try {
      setBox(unk.port, true)
      const bad = await timer.p('imap_poll_unknown_ca', () => runInboundEngineAsAutomationActor(mode, { processLimit: 0 }))
      const badInfo = bad.ok ? { fetched: bad.result.fetchedMessages, errors: bad.result.debug.errorsByMailbox } : { error: bad.error }
      ev.observe('tls_negative_imap', { ...badInfo, listener: unk.log })
      ev.save('tls/negative-imap.json', { result: badInfo, listener: unk.log })
      expect(bad.ok).toBe(true)
      expect(JSON.stringify(badInfo.errors ?? badInfo.error), 'certfel vid poll mot okänd CA').toMatch(/self.signed|unable to verify|certificate|CERT_|UNABLE_TO|issuer/i)
      expect(unk.log.appBytes, 'ingen LOGIN/credentials till servern med okänd CA').toBe(0)
      // Kandidatfynd (loggas, körs inte i produktionsbanan): imap_secure=false + klartextport tillåts av poller (part-2:358 metadataBool(mailbox,"imap_secure", port===993)).
      await purgeInbox()
      await appendToInbox(Buffer.from([`From: probe@t3.sim.invalid`, `To: ${mailbox}`, `Subject: E01 plaintext-imap probe ${run.prefix}`, `Message-ID: <e01-plain-${run.prefix.toLowerCase()}@t3.sim.invalid>`, 'Content-Type: text/plain', '', 'probe', ''].join('\r\n')))
      setBox(Number(process.env.T3_IMAP_PLAIN_PORT ?? 3143), false)
      const plain = await timer.p('imap_poll_plaintext', () => runInboundEngineAsAutomationActor(mode, { processLimit: 0 }))
      const plainInfo = plain.ok ? { fetched: plain.result.fetchedMessages, stored: plain.result.storedEmails, errors: plain.result.debug.errorsByMailbox } : { error: plain.error }
      ev.observe('imap_secure_false_allowed', { port: process.env.T3_IMAP_PLAIN_PORT ?? 3143, ...plainInfo, candidateFinding: 'edielMailboxPoller.part-2.ts:358 imap_secure=false och port != 993 ger klartext-IMAP (ImapFlow STARTTLS endast opportunistiskt)' })
      ev.save('tls/imap-plaintext-observation.json', plainInfo)
    } finally { restore(); await unk.close() }
  }, 300_000)
})

// ---------------------------------------------------------------------------------------------------------------------
describe('EDIEL01.05 tre olika referenser: RFC Message-ID, UNB-interchange-ref, BGM/affärsref', () => {
  it('EDIEL01.05 per meddelande tre olika värden i sina kolumner; inga kollisioner över inkommande och utgående', async () => {
    const mails = mailRows(run.prefix)
    const inboundSrc = sourceRows(run.prefix)
    const atts = attemptsFor([...contrl, ...aperak].map((x) => x.id))
    const out = outRows('CONTRL', srcIds).concat(outRows('APERAK', srcIds))
    const rfc = new Set<string>(), unb = new Set<string>(), bgm = new Set<string>()
    const problems: string[] = []
    const add = (set: Set<string>, v: string | null, label: string) => { if (!v) { problems.push(`${label}: tomt`); return } if (set.has(v)) problems.push(`${label}: dubblett ${v}`); set.add(v) }
    for (const s of sources) {
      const mail = mails.find((m) => m.subject === `E66 ${run.prefix} ${String(s.seq).padStart(3, '0')}`)!
      const src = inboundSrc.find((m) => m.interchange_reference === s.spec.interchangeRef)!
      const triple = [mail.internet_message_id, src.interchange_reference, src.external_reference ?? '']
      if (new Set(triple).size !== 3) problems.push(`in ${s.seq}: ej tre olika ${triple}`)
      if (mail.internet_message_id !== s.messageId) problems.push(`in ${s.seq}: internet_message_id ${mail.internet_message_id} != ${s.messageId}`)
      if (src.interchange_reference !== s.spec.interchangeRef || src.external_reference !== s.spec.documentRef) problems.push(`in ${s.seq}: kolumner != trådens UNB/BGM`)
      add(rfc, mail.internet_message_id, 'in rfc'); add(unb, src.interchange_reference, 'in unb'); add(bgm, src.external_reference, 'in bgm')
    }
    for (const o of out) {
      const a = atts.find((x) => x.message_id === o.id)
      const wire = segs(o.raw_payload)
      const wireUnb = wire.find((x) => x.startsWith('UNB+'))!.split('+')[5]
      const wireBgm = wire.find((x) => x.startsWith('BGM+'))?.split('+')[2] ?? null
      if (wireUnb !== o.interchange_reference) problems.push(`ut ${o.id}: UNB-kolumn != wire`)
      if (o.message_family === 'APERAK' && wireBgm !== o.external_reference) problems.push(`ut ${o.id}: BGM-kolumn ${o.external_reference} != wire ${wireBgm}`)
      add(rfc, a?.rfc ?? null, `ut rfc ${o.message_family}`)
      add(unb, o.interchange_reference, `ut unb ${o.message_family}`)
      if (o.message_family === 'APERAK') {
        add(bgm, o.external_reference, 'ut bgm')
        if (new Set([a?.rfc, o.interchange_reference, o.external_reference]).size !== 3) problems.push(`ut ${o.id}: ej tre olika`)
      } else if (new Set([a?.rfc, o.interchange_reference]).size !== 2) problems.push(`ut ${o.id}: rfc == unb`)
    }
    for (const v of rfc) if (unb.has(v) || bgm.has(v)) problems.push(`korsning rfc/unb/bgm: ${v}`)
    for (const v of unb) if (bgm.has(v)) problems.push(`korsning unb/bgm: ${v}`)
    ev.save('references/reference-columns.json', { inbound: sources.map((s) => ({ seq: s.seq, rfc: s.messageId, unb: s.spec.interchangeRef, bgm: s.spec.documentRef })),
      outbound: out.map((o) => ({ id: o.id, family: o.message_family, rfc: atts.find((x) => x.message_id === o.id)?.rfc, unb: o.interchange_reference, bgm: o.external_reference })) })
    ev.observe('reference_counts', { rfc: rfc.size, unb: unb.size, bgm: bgm.size, messages: sources.length + out.length })
    expect(rfc.size).toBe(3 * N)
    expect(unb.size).toBe(3 * N)
    expect(bgm.size).toBe(2 * N)
    expect(problems, problems.slice(0, 6).join(' | ')).toEqual([])
  })
})

// ---------------------------------------------------------------------------------------------------------------------
describe('EDIEL01.06 äldre rader oförändrade', () => {
  it('EDIEL01.06 post: äldre failed CONTRL-outbox, legacy-MIME (payload + storage), attempts, utkast och outbound_requests har oförändrad radhash/sha256', async () => {
    const lsrc = sourceRows(run.prefix, true)[0]
    const now = await legacyHashes(lsrc.id)
    ev.save('legacy/final-hashes.json', now)
    const diffs = Object.keys({ ...legacyBaseline!, ...now }).filter((k) => legacyBaseline![k] !== now[k]).map((k) => ({ key: k, before: legacyBaseline![k] ?? null, after: now[k] ?? null }))
    ev.observe('legacy_unchanged', { compared: Object.keys(legacyBaseline!).length, changed: diffs })
    ev.observe('legacy_outbound_requests_now', q(`SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM (SELECT id,status,attempts_count,failure_reason,updated_at FROM public.outbound_requests WHERE external_reference LIKE ${lit(`${run.prefix}-LEGACY-%`)}) x`))
    // Observation av tillståndet i slutet (sparas, men oraklet är oförändrad hash).
    ev.observe('final_counterparty', await counterpartyState())
    expect(diffs, JSON.stringify(diffs.slice(0, 3))).toEqual([])
  })

  it('EDIEL01.06 post: tidsmätning (IMAP-poll, intake, drain/SMTP, harness) sparad', async () => {
    const t = timer.summary()
    ev.save('timings.json', { ...t, wallClockMs: Date.now() - T0 })
    logLine(ev.dir, JSON.stringify(t))
    expect(Object.keys(t.product).length).toBeGreaterThan(3)
  })
})
void readFileSync
