/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
// VENDORED COPY. Origin: claude/gifted-hamilton-vss1hj @ 2711f86287fd77da12e48aa5fd26a695f4a51426:scripts/reality/simulators/gridOwner.ts
// Only the edits listed in chain/vendor-sync.py PATCHES (and @/ import rewrites) differ from the origin.
// Grid-owner (nätägare) simulator: an autonomous counterparty that talks to the
// platform only the way a real DSO does — e-mail with EDIFACT attachments over
// SMTPS/IMAPS. It reads its own inbox, answers what it receives according to a
// behaviour profile, and sends its own metering files. No database access.
//
//   our PRODAT Z03 (switch request)  -> CONTRL, APERAK (positive or negative), Z04 after a delay
//   our CONTRL / APERAK              -> recorded (acknowledgement of its own files)
//   control  GET  /__sim/state                  what it received and sent
//            POST /__sim/profile {…}            change behaviour at runtime
//            POST /__sim/send-e66 {meterId,day} send one day of quarter-hour values now: the grid owner's
//                                               Ediel day 00:00–24:00 +0100 (ENV-08), always 96 values (24 hourly)
//            POST /__sim/send-e66-batch {receiver, files:[{meterId,day,values?,…}]}
//                                               several days and meters, one file (mail) each
//
// Run: npx tsx scripts/reality/simulators/gridOwner.ts  (env: REALITY_GRID_OWNER_* below)
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import nodemailer from 'nodemailer'
import { ImapFlow } from 'imapflow'
import { tokenizeEdifact, segmentComposite } from '@/lib/ediel/core/edifactTokenizer'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { buildAperakDraft, buildContrlDraft } from '@/lib/ediel/ack'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { dailyE66, dayProfile } from '../../helpers/live-chain-wire'
import { buildZ04ForSwitchRequest } from './gridOwnerWire'
import { z02For } from '../../helpers/reality/inboundProdatWire'
import { unwrapSmimeForActor } from './smimeUnwrap'
import { platformMailboxFor } from './platformMailbox'
import { businessAnswerDelayMs, DEFAULT_GRID_OWNER_PROFILE, type GridOwnerProfile } from './gridOwnerProfile'
import { edifactAttachment, edifactInterchangesInMail } from './edifactMailParts'

export type { GridOwnerProfile } from './gridOwnerProfile'

const env = (name: string, fallback: string) => process.env[name] ?? fallback
const config = {
  edielId: env('REALITY_GRID_OWNER_EDIEL_ID', '80001'),
  email: env('REALITY_GRID_OWNER_EMAIL', 'e2e-natagare@example.invalid'),
  mailHost: env('REALITY_MAIL_HOST', 'localhost'),
  smtpsPort: Number(env('REALITY_SMTPS_PORT', '55425')),
  imapsPort: Number(env('REALITY_IMAPS_PORT', '55426')),
  pollMs: Number(env('REALITY_GRID_OWNER_POLL_MS', '15000')),
  controlPort: Number(env('REALITY_GRID_OWNER_PORT', '3902')),
  gridArea: env('REALITY_GRID_OWNER_GRID_AREA', 'ALS'),
}
let profile: GridOwnerProfile = { ...DEFAULT_GRID_OWNER_PROFILE }

type Received = { at: string; subject: string; family: string; code: string; interchange: string; handled: string }
type Sent = { at: string; kind: string; reference: string; inReplyTo?: string }
const received: Received[] = []
const sent: Sent[] = []
const pending = new Set<NodeJS.Timeout>()
const failures: Array<{ at: string; error: string }> = []
// Deterministic share decisions: the n-th request is rejected when n*share crosses an integer.
let switchRequests = 0
const decide = (share: number, n: number) => Math.floor(n * share) !== Math.floor((n - 1) * share)

const transport = nodemailer.createTransport({ host: config.mailHost, port: config.smtpsPort, secure: true, requireTLS: true,
  auth: { user: config.email, pass: 'grid-owner-local' }, tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' } })

async function deliver(kind: string, edifact: string, reference: string, inReplyTo?: string) {
  const copies = decide(profile.duplicateShare, sent.length + 1) ? 2 : 1
  for (let copy = 0; copy < copies; copy += 1) {
    await transport.sendMail({ from: config.email, to: platformMailboxFor(edifact), subject: `${kind} ${reference}`, text: 'Ediel',
      attachments: [edifactAttachment(`${kind}_${reference}.edi`, edifact)] })
    sent.push({ at: new Date().toISOString(), kind: copy ? `${kind} (duplicate)` : kind, reference, inReplyTo })
  }
}
function later(ms: number, task: () => Promise<void>) {
  // One bad file must never stop the counterparty: every failure is recorded and the loop goes on.
  const timer = setTimeout(() => { pending.delete(timer); Promise.resolve().then(task).catch(error => { failures.push({ at: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) }); console.error('[grid-owner] send failed', error) }) }, ms)
  pending.add(timer)
}

/** The platform's file as the grid owner received it (its own perspective: inbound). */
function asReceived(raw: string, family: string): EdielMessageRow {
  return { id: randomUUID(), raw_payload: raw, company_id: null, environment: EdifactEnvelopeCodec.decode(raw).environment, message_standard: 'edifact', message_family: family, direction: 'inbound' } as unknown as EdielMessageRow
}

function handle(raw: string, subject: string) {
  const tokens = tokenizeEdifact(raw)
  const unh = tokens.segments.find(s => s.tag === 'UNH')
  const unb = tokens.segments.find(s => s.tag === 'UNB')
  const family = unh ? segmentComposite(unh, 2, tokens.una)[0] ?? '?' : '?'
  const bgm = tokens.segments.find(s => s.tag === 'BGM')
  const code = bgm ? segmentComposite(bgm, 1, tokens.una)[0] ?? '' : ''
  const interchange = unb ? segmentComposite(unb, 5, tokens.una)[0] ?? '' : ''
  const entry: Received = { at: new Date().toISOString(), subject, family, code, interchange, handled: 'recorded' }
  received.push(entry)
  if (!profile.respond || family === 'CONTRL' || family === 'APERAK') return
  const source = asReceived(raw, family)
  later(profile.contrlDelayMs, () => deliver('CONTRL', buildContrlDraft({ sourceMessage: source, outcome: 'positive' }).rawPayload!, interchange, interchange))
  if (family === 'PRODAT' && code === 'Z01') {
    // A website customer's facility is verified through our Z01; the grid owner answers with what its register
    // holds (Z02, T31's builder), as the real one does (FINDINGS A-B3).
    entry.handled = 'answered (APERAK + Z02)'
    later(profile.aperakDelayMs, () => deliver('APERAK', buildAperakDraft({ sourceMessage: source, outcome: 'positive' }).rawPayload!, interchange, interchange))
    later(businessAnswerDelayMs(profile, 'Z01')!, async () => {
      const z02 = z02For(raw, config.edielId, { gridArea: config.gridArea })
      await deliver('PRODAT-Z02', z02.raw, z02.document, interchange)
    })
    return
  }
  if (family === 'PRODAT' && code === 'Z03') {
    switchRequests += 1
    const reject = decide(profile.rejectShare, switchRequests)
    entry.handled = reject ? 'rejected (negative APERAK)' : 'confirmed (APERAK + Z04)'
    later(profile.aperakDelayMs, () => deliver('APERAK', buildAperakDraft({ sourceMessage: source, outcome: reject ? 'negative' : 'positive' }).rawPayload!, interchange, interchange))
    if (!reject) later(businessAnswerDelayMs(profile, 'Z03')!, async () => {
      const z04 = buildZ04ForSwitchRequest({ request: raw, gridOwnerEdielId: config.edielId })
      await deliver('PRODAT-Z04', z04.raw, z04.reference, interchange)
    })
  }
}

async function poll() {
  const client = new ImapFlow({ host: config.mailHost, port: config.imapsPort, secure: true, auth: { user: config.email, pass: 'grid-owner-local' }, logger: false })
  await client.connect()
  const lock = await client.getMailboxLock('INBOX')
  try {
    const unseen = await client.search({ seen: false }, { uid: true })
    for (const uid of unseen || []) {
      const message = await client.fetchOne(String(uid), { source: true, envelope: true }, { uid: true })
      if (!message) continue
      // Production mail is S/MIME enveloped to this grid owner's certificate; read it as the real one does.
      let text: string
      try { text = message.source ? unwrapSmimeForActor(message.source, config.edielId) : '' }
      catch (error) { failures.push({ at: new Date().toISOString(), error: `unreadable mail: ${error instanceof Error ? error.message : String(error)}` }); text = '' }
      // Attachments are base64 or 7bit EDIFACT; decode every part that holds a UNB.
      for (const file of edifactInterchangesInMail(text)) {
        try { handle(file, message.envelope?.subject ?? '') }
        catch (error) { failures.push({ at: new Date().toISOString(), error: `unreadable file: ${error instanceof Error ? error.message : String(error)}` }) }
      }
      await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true })
    }
  } finally { lock.release(); await client.logout() }
}

/**
 * One Ediel day of metering values for one meter (live-chain-wire dailyE66: 00:00–24:00 +0100 from 23:00Z the day
 * before, always 96 quarter-hours or 24 hours, also on the DST days). Without `values` the standard household
 * profile of `dayIndex` is sent. `registeredAfterHours` re-sends the day as a correction (later registration time); its default
 * reference then ends in C so it never collides with the original's.
 */
type E66File = { meterId: string; day: string; receiver: string; values?: number[]; dayIndex?: number; reference?: string
  registeredAfterHours?: number; resolutionMinutes?: 15 | 60; environment?: 'production' | 'test' }

async function sendE66(file: E66File) {
  const reference = file.reference ?? `${file.day.replaceAll('-', '').slice(2)}${file.meterId.slice(-6)}${file.registeredAfterHours ? 'C' : ''}`
  const values = file.values ?? dayProfile(file.dayIndex ?? 0)
  await deliver('UTILTS-E66', dailyE66({ issuer: config.edielId, receiver: file.receiver, meterId: file.meterId, day: file.day, values, reference,
    resolutionMinutes: file.resolutionMinutes, registeredAfterHours: file.registeredAfterHours, environment: file.environment,
    // Never in the future; a correction stays later than an original capped in the same batch (FINDINGS H-B5b).
    notAfter: Date.now() - (file.registeredAfterHours ? 60_000 : 120_000) }), reference)
  return { meterId: file.meterId, day: file.day, reference, kwh: Math.round(values.reduce((a, b) => a + b, 0) * 1000) / 1000 }
}

function body(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => { let s = ''; req.on('data', c => { s += c }); req.on('end', () => resolve(s)); req.on('error', reject) })
}
function reply(res: ServerResponse, status: number, payload: unknown) { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(payload)) }

createServer(async (req, res) => {
  try {
    const path = new URL(req.url ?? '/', 'http://local').pathname
    if (path === '/__sim/state') return reply(res, 200, { config, profile, received, sent, failures, pendingSends: pending.size })
    if (path === '/__sim/profile' && req.method === 'POST') { profile = { ...profile, ...JSON.parse(await body(req)) }; return reply(res, 200, profile) }
    if (path === '/__sim/send-e66' && req.method === 'POST') {
      const { reference } = await sendE66(JSON.parse(await body(req)) as E66File)
      return reply(res, 200, { reference })
    }
    if (path === '/__sim/send-e66-batch' && req.method === 'POST') {
      const input = JSON.parse(await body(req)) as { receiver: string; files: Array<Omit<E66File, 'receiver'> & { receiver?: string }> }
      // In order, one mail per file, like a grid owner's daily metering run.
      const sentFiles: Array<Awaited<ReturnType<typeof sendE66>>> = []
      for (const file of input.files) sentFiles.push(await sendE66({ ...file, receiver: file.receiver ?? input.receiver }))
      return reply(res, 200, { sent: sentFiles })
    }
    return reply(res, 404, { message: 'not found' })
  } catch (error) { reply(res, 500, { message: error instanceof Error ? error.message : String(error) }) }
}).listen(config.controlPort, '127.0.0.1', () => console.log(`[grid-owner ${config.edielId}] control on http://127.0.0.1:${config.controlPort}, mailbox ${config.email}`))

const loop = async () => {
  try { await poll() } catch (error) { console.error('[grid-owner] poll failed', error instanceof Error ? error.message : error) }
  setTimeout(loop, config.pollMs)
}
void loop()
