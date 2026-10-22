// Grid owner (nätägare) for reality scenario J1: what the grid owner SENDS us about our switches. The same
// autonomous e-mail counterparty as gridOwner.ts (SMTPS/IMAPS only, no database), but each received Z03 is answered
// by a per-facility plan: positive CONTRL + APERAK (before or after the business answer), then a sequence of PRODAT
// business files: Z04 with the requested start, a later or an earlier start, without the counter code (field 259),
// Z04C (grid-owner cancellation), the identical Z04 bytes again, a re-sent Z04 as a new document, or a Z04 for a
// switch the supplier never requested (another facility and case reference).
//
// It also reads what the platform owes it in return: our CONTRL (per interchange) and APERAK (per document, RFF+ACW)
// on every file it sent, so the scenario can check the supplier's own obligations as a receiver.
//
//   control  GET  /__sim/state                       received, sent (with our answers), failures, plans
//            POST /__sim/plan {facility|'*': plan}   answer plan per GSRN ('*' = default)
//
// Run: npx tsx scripts/reality/simulators/gridOwnerInboundProdat.ts  (env as gridOwner.ts, REALITY_GRID_OWNER_*)
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import nodemailer from 'nodemailer'
import { ImapFlow } from 'imapflow'
import { gs1 } from '../../helpers/live-chain-wire'
import { contrlFor, positiveAperakFor, readReceivedRequest } from '../../helpers/reality/rejectsWire'
import { prodatFacts, readOurAnswer, shiftDate, z04cFor, z04For, z04ForUnknownSwitch, type InboundProdatPlan, type InboundProdatStep } from '../../helpers/reality/inboundProdatWire'
import { unwrapSmimeForActor } from './smimeUnwrap'

const env = (name: string, fallback: string) => process.env[name] ?? fallback
const config = {
  edielId: env('REALITY_GRID_OWNER_EDIEL_ID', '80001'),
  email: env('REALITY_GRID_OWNER_EMAIL', 'e2e-natagare@example.invalid'),
  platformMailbox: env('GRIDEX_SHARED_EDIEL_TEST_EMAIL', 'gridex-ediel-test@example.invalid'),
  mailHost: env('REALITY_MAIL_HOST', 'localhost'),
  smtpsPort: Number(env('REALITY_SMTPS_PORT', '3465')),
  imapsPort: Number(env('REALITY_IMAPS_PORT', '3993')),
  pollMs: Number(env('REALITY_GRID_OWNER_POLL_MS', '15000')),
  controlPort: Number(env('REALITY_GRID_OWNER_PORT', '3913')),
  /** Pause between the files answering one request (each arrives as its own mail, in order). */
  stepMs: Number(env('REALITY_GRID_OWNER_STEP_MS', '20000')),
}
const plans = new Map<string, InboundProdatPlan>([['*', { acksFirst: true, steps: ['z04'] }]])
type Received = { at: string; family: string; code: string; interchange: string; facility: string; plan: string }
type Sent = { at: string; kind: InboundProdatStep | 'CONTRL' | 'APERAK'; facility: string; object: string; interchange: string; document: string; start: string; li: string
  /** What the platform answered to this file (its CONTRL by interchange, its APERAK by document). */
  answers: Array<{ family: string; outcome: string; codes: string[] }> }
const received: Received[] = []
const sent: Sent[] = []
const failures: Array<{ at: string; error: string }> = []
let pending = 0

const transport = nodemailer.createTransport({ host: config.mailHost, port: config.smtpsPort, secure: true, requireTLS: true,
  auth: { user: config.email, pass: 'grid-owner-local' }, tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' } })

const interchangeOf = (edifact: string) => /UNB\+[^']*?\+[^+']*\+[^+']*\+[^+']*\+([^+']+)/.exec(edifact)?.[1] ?? '?'

async function deliver(kind: Sent['kind'], edifact: string, facility: string) {
  const interchange = interchangeOf(edifact), facts = prodatFacts(edifact)
  await transport.sendMail({ from: config.email, to: config.platformMailbox, subject: `${kind} ${interchange}`, text: 'Ediel',
    attachments: [{ filename: `${kind.replace(/\W+/g, '_')}_${interchange}.edi`, content: edifact, contentType: 'application/edifact' }] })
  sent.push({ at: new Date().toISOString(), kind, facility, object: facts.facility, interchange, document: facts.document, start: facts.start, li: facts.li, answers: [] })
}

/** The business file of one plan step for our received Z03 (`raw`). Built only from the received file. */
function businessFile(step: InboundProdatStep, raw: string, previous: string | null): string {
  const requested = readReceivedRequest(raw).startDate
  const requestedDay = `${requested.slice(0, 4)}-${requested.slice(4, 6)}-${requested.slice(6, 8)}`
  switch (step) {
    case 'z04': return z04For(raw, config.edielId).raw
    case 'z04-later': return z04For(raw, config.edielId, { startDate: shiftDate(requestedDay, 7) }).raw
    case 'z04-earlier': return z04For(raw, config.edielId, { startDate: shiftDate(requestedDay, -3) }).raw
    case 'z04-no-counter': return z04For(raw, config.edielId, { readings: false }).raw
    case 'z04c': return z04cFor(raw, config.edielId).raw
    // The identical bytes of the previous business file, delivered again (transport retry on the DSO side).
    case 'z04-again': if (!previous) throw Error('z04_again_without_previous_file'); return previous
    // A new document (new UNB/BGM) with the same facts: the DSO re-sends because our APERAK did not arrive.
    case 'z04-resend': return z04For(raw, config.edielId).raw
    case 'z04-unknown-switch': return z04ForUnknownSwitch(raw, config.edielId, {
      facility: gs1(`735999${String(Math.floor(Math.random() * 1e11)).padStart(11, '0')}`),
      caseReference: `LI${randomUUID().replaceAll('-', '').toUpperCase()}` }).raw
  }
}

function handle(raw: string) {
  const facts = readReceivedRequest(raw)
  // Our answers (CONTRL/APERAK) to the grid owner's own files.
  if (facts.family === 'CONTRL' || facts.family === 'APERAK') {
    const answer = readOurAnswer(raw)
    received.push({ at: new Date().toISOString(), family: facts.family, code: answer.outcome, interchange: facts.interchange, facility: '', plan: '' })
    for (const file of sent) {
      if ((answer.family === 'CONTRL' && answer.reference === file.interchange) || (answer.family === 'APERAK' && answer.reference === file.document))
        file.answers.push({ family: answer.family, outcome: answer.outcome, codes: answer.codes })
    }
    return
  }
  const plan = plans.get(facts.facility) ?? plans.get('*')!
  received.push({ at: new Date().toISOString(), family: facts.family, code: facts.code, interchange: facts.interchange, facility: facts.facility, plan: JSON.stringify(plan) })
  if (facts.family !== 'PRODAT' || facts.code !== 'Z03') return
  pending += 1
  void (async () => {
    const pause = () => new Promise(resolve => setTimeout(resolve, config.stepMs))
    try {
      const acks = async () => {
        await pause(); await deliver('CONTRL', contrlFor(raw, 'positive'), facts.facility)
        await pause(); await deliver('APERAK', positiveAperakFor(raw), facts.facility)
      }
      if (plan.acksFirst) await acks()
      let previous: string | null = null
      for (const step of plan.steps) {
        await pause()
        const file = businessFile(step, raw, previous)
        await deliver(step, file, facts.facility)
        previous = file
      }
      if (!plan.acksFirst) await acks()
    } catch (error) {
      failures.push({ at: new Date().toISOString(), error: `${facts.code} ${facts.facility}: ${error instanceof Error ? error.message : String(error)}` })
    } finally { pending -= 1 }
  })()
}

async function poll() {
  const client = new ImapFlow({ host: config.mailHost, port: config.imapsPort, secure: true, auth: { user: config.email, pass: 'grid-owner-local' }, logger: false })
  await client.connect()
  const lock = await client.getMailboxLock('INBOX')
  try {
    for (const uid of (await client.search({ seen: false }, { uid: true })) || []) {
      const message = await client.fetchOne(String(uid), { source: true }, { uid: true })
      if (!message) continue
      // Production mail is S/MIME enveloped to this grid owner's certificate; read it as the real one does.
      let text: string
      try { text = message.source ? unwrapSmimeForActor(message.source, config.edielId) : '' }
      catch (error) { failures.push({ at: new Date().toISOString(), error: `unreadable mail: ${error instanceof Error ? error.message : String(error)}` }); text = '' }
      for (const part of text.split(/\r?\n--[^\r\n]+\r?\n/)) {
        const [head, ...rest] = part.split(/\r?\n\r?\n/)
        let content = rest.join('\n\n')
        if (/content-transfer-encoding:\s*base64/i.test(head)) content = Buffer.from(content.replace(/\s+/g, ''), 'base64').toString('utf8')
        if (!/UN[AB][+:]/.test(content)) continue
        try { handle(content.slice(content.search(/UN[AB]/)).trim()) }
        catch (error) { failures.push({ at: new Date().toISOString(), error: `unreadable file: ${error instanceof Error ? error.message : String(error)}` }) }
      }
      await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true })
    }
  } finally { lock.release(); await client.logout() }
}

function body(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => { let s = ''; req.on('data', c => { s += c }); req.on('end', () => resolve(s)); req.on('error', reject) })
}
function reply(res: ServerResponse, status: number, payload: unknown) { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(payload)) }

createServer(async (req, res) => {
  try {
    const path = new URL(req.url ?? '/', 'http://local').pathname
    if (path === '/__sim/state') return reply(res, 200, { config, plans: Object.fromEntries(plans), received, sent, failures, pendingSends: pending })
    if (path === '/__sim/plan' && req.method === 'POST') {
      for (const [facility, plan] of Object.entries(JSON.parse(await body(req)) as Record<string, InboundProdatPlan>)) plans.set(facility, plan)
      return reply(res, 200, Object.fromEntries(plans))
    }
    return reply(res, 404, { message: 'not found' })
  } catch (error) { reply(res, 500, { message: error instanceof Error ? error.message : String(error) }) }
}).listen(config.controlPort, '127.0.0.1', () => console.log(`[J1 grid-owner ${config.edielId}] control on http://127.0.0.1:${config.controlPort}, mailbox ${config.email}`))

const loop = async () => {
  try { await poll() } catch (error) { console.error('[J1 grid-owner] poll failed', error instanceof Error ? error.message : error) }
  setTimeout(loop, config.pollMs)
}
void loop()
