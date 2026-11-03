// SMOKE: infrastrukturprov för spår 3 (Playwright används inte; ingen webbläsare).
// Asserterar bara att harnessen fungerar: stack, app, TLS mot egen CA, IMAP-inläggning, SMTP-mottagning.
// Produktutfallet (inkommande rad, CONTRL i outbox, status, DSO-mejl) LOGGAS som observation i report.json
// men asserteras INTE: det är underlag för scenarier, inte ett förväntat PASS.
import { readFileSync } from 'node:fs'
import nodemailer from 'nodemailer'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { appUrl, triggerInbound, triggerOutbox } from '../lib/app'
import {
  appendToInbox, counterpartyState, inboxStatus, markSeenByMessageIds, purgeInbox, readReceivedEml, receivedMail, setSmtpMode, tlsHandshake, waitForReceived,
} from '../lib/counterparty'
import { countRows, lit, newRows, resetMailboxSchedule, snapshotIds, sql, sqlJson } from '../lib/db'
import { buildUtiltsE66 } from '../lib/edifact'
import { runInboundEngineAsAutomationActor } from '../lib/inprocess'
import { Evidence } from '../lib/evidence'
import { buildEdifactMime } from '../lib/mime'
import { adminClient, newRunContext, OWN_EDIEL_ID, COUNTERPARTY_EDIEL_ID, DSO_EMAIL } from '../lib/seed.mjs'

const mode = (process.env.T3_MODE as 'test' | 'production') ?? 'test'
const run = newRunContext('smoke')
const evidence = new Evidence()
const mailbox = process.env.T3_MAILBOX_ADDRESS ?? 'ediel@t3.sim.invalid'
let before: ReturnType<typeof snapshotIds>
let injected: Array<{ key: string; subject: string; interchangeRef: string; documentRef: string; messageId: string }> = []

const transport = () => nodemailer.createTransport({
  host: '127.0.0.1', port: Number(process.env.T3_SMTP_PORT), secure: true, requireTLS: true,
  auth: { user: process.env.EDIEL_SMTP_USER!, pass: process.env.EDIEL_SMTP_PASS! },
  tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' }, connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 4000,
})
const probeMail = (tag: string) => ({
  envelope: { from: mailbox, to: [DSO_EMAIL] },
  raw: Buffer.from(['From: ' + mailbox, 'To: ' + DSO_EMAIL, `Subject: T3 probe ${tag}`, `Message-ID: <${run.prefix}-${tag}@t3.sim.invalid>`,
    'X-T3-Probe: 1', 'Content-Type: text/plain', '', '.leading dot line', '..two dots', 'end', ''].join('\r\n')),
})

beforeAll(async () => { await setSmtpMode('accept'); evidence.observe('run', { ...run, mode, appUrl: appUrl() }); before = snapshotIds() })
afterEach(async () => { await setSmtpMode('accept').catch(() => undefined) })
afterAll(async () => { await setSmtpMode('accept').catch(() => undefined); evidence.finalize() })

describe('Track3 smoke: infrastruktur', () => {
  it('SMOKE.01 stacken svarar och fixturen är seedad (tenant, aktör, parter 16700/70007, brevlåda)', async () => {
    const admin = adminClient()
    const { data: user, error } = await admin.auth.admin.getUserById(process.env.EDIEL_AUTOMATION_ACTOR_USER_ID!)
    expect(error).toBeNull()
    expect(user.user?.email).toBe('t3sim-automation@t3.sim.invalid')
    const rows = JSON.parse(sql(`SELECT jsonb_build_object(
      'company',(SELECT count(*) FROM public.companies WHERE ediel_id='${OWN_EDIEL_ID}'),
      'membership',(SELECT count(*) FROM public.company_memberships WHERE user_id=${JSON.stringify(process.env.EDIEL_AUTOMATION_ACTOR_USER_ID).replaceAll('"', "'")} AND is_active),
      'routes',(SELECT count(*) FROM public.ediel_route_profiles WHERE receiver_ediel_id='${COUNTERPARTY_EDIEL_ID}' AND sender_ediel_id='${OWN_EDIEL_ID}' AND is_enabled),
      'sharedMailbox',(SELECT count(*) FROM public.ediel_mailboxes WHERE environment='${mode}' AND imap_host='127.0.0.1' AND secret_reference='env:EDIEL_IMAP_PASS'))`))
    evidence.observe('fixture', rows)
    expect(rows).toMatchObject({ company: 1, membership: 1, sharedMailbox: 1 })
    expect(rows.routes).toBeGreaterThanOrEqual(1)
  })

  it('SMOKE.02 appen svarar och skyddar cron-ingångarna (401 utan hemlighet)', async () => {
    const root = await fetch(`${appUrl()}/`, { redirect: 'manual' })
    expect(root.status).toBeLessThan(600)
    for (const path of ['/api/internal/inbound-mail/cron?environment=test', '/api/ediel/outbox/process?environment=test']) {
      const r = await fetch(`${appUrl()}${path}`, { method: 'POST', headers: { authorization: 'Bearer wrong' } })
      expect(r.status).toBe(401)
    }
    // Appprocessen litar på egen CA via NODE_EXTRA_CA_CERTS och har inte stängt av certifikatverifiering.
    const pid = readFileSync(`${process.env.T3_SIM_HOME}/pids/app.pid`, 'utf8').trim()
    const appEnv = readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0')
    const names = appEnv.map((e) => e.split('=')[0])
    evidence.observe('app_process_env_names', { pid, hasExtraCa: names.includes('NODE_EXTRA_CA_CERTS'), hasRejectUnauthorizedOverride: names.includes('NODE_TLS_REJECT_UNAUTHORIZED') })
    expect(names).toContain('NODE_EXTRA_CA_CERTS')
    expect(names).not.toContain('NODE_TLS_REJECT_UNAUTHORIZED')
  })

  it('SMOKE.03 TLS-handskakning mot egen CA (SMTP och IMAP), TLS >= 1.2, kedjan verifieras', async () => {
    for (const [name, port] of [['smtp', process.env.T3_SMTP_PORT], ['imap', process.env.T3_IMAP_TLS_PORT]] as const) {
      const h = await tlsHandshake(Number(port))
      evidence.observe(`tls_${name}`, h)
      expect(h.authorized, h.authorizationError ?? '').toBe(true)
      expect(h.protocol).toMatch(/^TLSv1\.[23]$/)
    }
    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined()
  })

  it('SMOKE.04 SMTP-motparten sparar MIME byte-exakt med sha256 och stöder alla fem lägen', async () => {
    const t = transport()
    const m = probeMail('accept')
    const n0 = (await receivedMail()).length
    const info = await t.sendMail(m)
    expect(info.accepted).toEqual([DSO_EMAIL])
    const all = await waitForReceived(n0 + 1)
    const last = all[all.length - 1]
    const eml = readReceivedEml(last.n)
    expect(eml.sha256Matches).toBe(true)
    expect(eml.raw.equals(m.raw)).toBe(true) // inkl. dot-stuffade rader
    expect(last).toMatchObject({ envelopeFrom: mailbox, envelopeTo: [DSO_EMAIL], disposition: 'accepted' })

    await setSmtpMode('tempfail-4xx', { code: 451 })
    await expect(t.sendMail(probeMail('tempfail'))).rejects.toMatchObject({ responseCode: 451 })
    await setSmtpMode('permfail-5xx', { code: 554 })
    await expect(t.sendMail(probeMail('permfail'))).rejects.toMatchObject({ responseCode: 554 })
    await setSmtpMode('drop-after-data')
    await expect(t.sendMail(probeMail('drop'))).rejects.toBeTruthy()
    await setSmtpMode('hang', { hangMs: 15000 })
    await expect(t.sendMail(probeMail('hang'))).rejects.toMatchObject({ code: expect.stringMatching(/ETIMEDOUT|ECONNECTION|ESOCKET/) })
    await setSmtpMode('accept')
    const mails = await receivedMail()
    evidence.observe('probe_dispositions', mails.slice(n0).map((x) => ({ n: x.n, mode: x.mode, disposition: x.disposition, reply: x.smtpReply })))
    expect(mails.slice(n0).map((x) => x.disposition)).toEqual([
      'accepted', 'tempfail-not-accepted', 'permfail-not-accepted', 'received-no-reply-connection-dropped', 'received-no-reply-hang',
    ])
  })

  it('SMOKE.05 syntetiska UTILTS E66 (70007 -> 16700) kan läggas i IMAP via TLS (bilaga resp. inline)', async () => {
    const purged = await purgeInbox()
    const b = await inboxStatus()
    const variants = [
      { key: 'attachment', placement: 'attachment' as const, seq: 1 },
      { key: 'inline', placement: 'inline' as const, seq: 2 },
    ]
    injected = []
    for (const v of variants) {
      const e66 = buildUtiltsE66({ prefix: run.prefix, seq: v.seq })
      const built = buildEdifactMime({ from: `${COUNTERPARTY_EDIEL_ID}@dso.t3.sim.invalid`, to: mailbox, subject: `UTILTS E66 ${v.key} ${run.prefix}`, raw: e66.raw, placement: v.placement })
      await appendToInbox(built.mime)
      evidence.save(`inbound/e66-${v.key}.edi`, e66.raw)
      evidence.save(`inbound/e66-${v.key}.eml`, built.mime)
      injected.push({ key: v.key, subject: `UTILTS E66 ${v.key} ${run.prefix}`, interchangeRef: e66.interchangeRef, documentRef: e66.documentRef, messageId: built.messageId })
    }
    const a = await inboxStatus()
    evidence.observe('imap_inject', { purged, before: b, after: a, injected })
    expect(a.messages).toBe(b.messages + 2)
  })

  it('SMOKE.06 inbound-cron (HTTP) når IMAP via egen CA och hämtar meddelandena', async () => {
    // Observation (se README, kandidatfynd): appens poller kör messageFlagsAdd inuti for-await client.fetch (ImapFlow
    // bakåttryck) och fastnar efter första meddelandet -> en poll hämtar bara ett. Harnessen markerar därför det redan
    // lagrade meddelandet som \\Seen mellan pollar så att nästa meddelande kan nå appen. Det loggas som observation.
    const polls: unknown[] = []
    for (let i = 0; i < 4; i++) {
      resetMailboxSchedule(mode)
      const pre = snapshotIds()
      const r = await triggerInbound(mode)
      const diff = newRows(pre)
      const stored = (r.body as { result?: { storedEmails?: number; fetchedMessages?: number } } | null)?.result
      const storedIds = (sqlJson(`SELECT coalesce(jsonb_agg(internet_message_id),'[]') FROM public.inbound_email_messages WHERE subject IN (${injected.map((m) => lit(m.subject)).join(',')})`) as string[]) ?? []
      const marked = await markSeenByMessageIds(storedIds)
      polls.push({ poll: i + 1, status: r.status, ms: r.ms, fetched: stored?.fetchedMessages, stored: stored?.storedEmails,
        harnessMarkedSeen: marked, newRows: Object.fromEntries(Object.entries(diff).map(([t, rows]) => [t, rows.length])), body: r.body ?? r.text })
      evidence.save(`inbound/cron-response-${i + 1}.json`, polls[i])
      if (i === 0) {
        // Infrastruktur: HTTP-ingången svarade med JSON och brevlådan nåddes (ingen anslutnings-/inloggnings-/certifikatsfel).
        expect(r.body).toBeTruthy()
        const body = r.body as { code?: string; result?: { fetchedMessages: number; mailboxesChecked: number; debug?: { errorsByMailbox?: Array<{ errors: string[] }> } } }
        expect(String(body.code ?? '')).not.toMatch(/imap_connection_failed|imap_login_failed|imap_credentials_missing|mailbox_config_missing/)
        expect(body.result?.mailboxesChecked).toBeGreaterThanOrEqual(1)
        expect(JSON.stringify(body.result?.debug?.errorsByMailbox ?? [])).not.toMatch(/ECONN|certificate|self.signed|AUTHENTICATIONFAILED|Invalid credentials/i)
        expect(body.result?.fetchedMessages).toBeGreaterThanOrEqual(1)
      }
      const have = Number(sql(`SELECT count(*) FROM public.inbound_email_messages WHERE subject IN (${injected.map((m) => lit(m.subject)).join(',')})`))
      if (have >= injected.length) break
    }
    evidence.observe('inbound_polls', polls.map((p) => ({ ...(p as object), body: undefined })))
    evidence.observe('inbound_per_message', injected.map((m) => ({
      key: m.key,
      inbound: sqlJson(`SELECT to_jsonb(x) FROM (SELECT id, processing_status, match_status, error_message, message_family, message_code, sender_ediel_id, receiver_ediel_id FROM public.inbound_email_messages WHERE subject=${lit(m.subject)} ORDER BY created_at DESC LIMIT 1) x`),
      jobs: sqlJson(`SELECT coalesce(jsonb_agg(to_jsonb(j)),'[]') FROM (SELECT j.status, j.step, j.attempts_count, j.error_message FROM public.inbound_processing_jobs j JOIN public.inbound_email_messages e ON e.id=j.inbound_email_message_id WHERE e.subject=${lit(m.subject)}) j`),
    })))
    const stored = Number(sql(`SELECT count(*) FROM public.inbound_email_messages WHERE subject IN (${injected.map((m) => lit(m.subject)).join(',')})`))
    expect(stored).toBe(injected.length)
  })

  it('SMOKE.07 samma motor i testprocessen med automationsaktören (observerat utfall loggas)', async () => {
    resetMailboxSchedule(mode)
    const pre = snapshotIds()
    const t0 = Date.now()
    const out = await runInboundEngineAsAutomationActor(mode)
    const diff = newRows(pre)
    evidence.save('inbound/inprocess-actor-outcome.json', { ms: Date.now() - t0, out })
    evidence.save('inbound/inprocess-db-new-rows.json', diff)
    evidence.observe('inbound_inprocess_actor', {
      ms: Date.now() - t0, ok: out.ok,
      ...(out.ok ? { fetched: out.result.fetchedMessages, stored: out.result.storedEmails, deduped: out.result.dedupedEmails, processedJobs: out.result.processedJobs,
        failedJobs: out.result.failedJobs, edielMessageIds: out.result.edielMessageIds, errorsByMailbox: out.result.debug.errorsByMailbox, autoProcessErrors: out.result.debug.autoProcessErrors }
        : { error: out.error }),
      newRows: Object.fromEntries(Object.entries(diff).map(([t, rows]) => [t, rows.length])),
    })
    evidence.observe('inbound_per_message_after_actor', injected.map((m) => ({
      key: m.key,
      inbound: sqlJson(`SELECT to_jsonb(x) FROM (SELECT id, processing_status, match_status, error_message FROM public.inbound_email_messages WHERE subject=${lit(m.subject)} ORDER BY created_at DESC LIMIT 1) x`),
      jobs: sqlJson(`SELECT coalesce(jsonb_agg(to_jsonb(j)),'[]') FROM (SELECT j.status, j.step, j.attempts_count, j.error_message FROM public.inbound_processing_jobs j JOIN public.inbound_email_messages e ON e.id=j.inbound_email_message_id WHERE e.subject=${lit(m.subject)}) j`),
    })))
    // Infrastruktur: anropet kom tillbaka (resultat eller fel är båda observationer).
    expect(typeof out.ok).toBe('boolean')
  })

  it('SMOKE.08 outbox-drain (HTTP) svarar; observerat utfall loggas', async () => {
    const preMail = (await receivedMail()).length
    const pre = snapshotIds()
    const r = await triggerOutbox(mode)
    await new Promise((res) => setTimeout(res, 1500))
    const post = await receivedMail()
    evidence.save('outbound/outbox-response.json', { status: r.status, ms: r.ms, body: r.body ?? r.text })
    evidence.observe('outbox_cron', { status: r.status, ms: r.ms, body: r.body ?? r.text })
    const diff = newRows(pre)
    evidence.save('outbound/db-new-rows.json', diff)
    evidence.observe('outbox_db_new_rows', Object.fromEntries(Object.entries(diff).map(([t, rows]) => [t, rows.length])))
    const dso = post.slice(preMail)
    evidence.observe('dso_received_after_drain', dso.map((m) => ({ n: m.n, to: m.envelopeTo, from: m.envelopeFrom, sha256: m.sha256, disposition: m.disposition })))
    for (const m of dso) evidence.save(`outbound/dso-${m.n}.eml`, readReceivedEml(m.n).raw)
    expect(typeof r.status).toBe('number')
    expect(r.body ?? r.text).toBeTruthy()
  })

  it('SMOKE.09 observationsrapport (inkommande rad, CONTRL i outbox, status, DSO)', async () => {
    const after = snapshotIds()
    const all = newRows(before)
    const inboundEmail = all['public.inbound_email_messages']
    const messages = all['public.ediel_messages']
    const outbox = all['public.ediel_outbox']
    const summary = {
      rowCountsBefore: countRows(before), rowCountsAfter: countRows(after),
      inboundEmailRows: inboundEmail.map((r) => ({ id: r.id, status: r.processing_status ?? r.status, subject: r.subject })),
      edielMessages: messages.map((r) => ({ id: r.id, direction: r.direction, family: r.message_family, code: r.message_code, status: r.status, ack: r.ack_status })),
      outbox: outbox.map((r) => ({ id: r.id, status: r.status, family: r.message_family, attempts: r.attempt_count ?? r.attempts, last_error: r.last_error })),
      counterparty: await counterpartyState(),
    }
    evidence.observe('summary', summary)
    evidence.save('summary.json', summary)
    console.log('SMOKE OBSERVATIONS', JSON.stringify({ summary, observations: evidence.observations }, null, 2))
    expect(summary.counterparty.stored).toBeGreaterThanOrEqual(5)
  })
})
