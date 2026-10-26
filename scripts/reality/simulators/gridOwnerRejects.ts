// Rejecting grid owner (nätägare) for reality scenario I: the same autonomous e-mail counterparty as
// gridOwner.ts (SMTPS/IMAPS only, no database), but it answers each received request according to a per-facility
// plan: positive or negative CONTRL, business rejection per object (BGM 34, ERC 40/42 with the reason code),
// whole-message rejection (BGM 27), silence, Z04 before the APERAK, and duplicate APERAK delivery.
//
// Why a separate process: gridOwner.ts's own reject path (rejectShare) calls buildAperakDraft({outcome:
// 'negative'}) without an object outcome; for a Z03 that throws APERAK_PRODAT_OBJECT_OUTCOME_SCOPE_MISMATCH
// (lib/ediel/aperakEngine.ts:398), the failure is swallowed into `failures` and NO APERAK is ever sent
// (harness defect GOR-S1). Patch proposed in the scenario I report; gridOwner.ts itself is not edited here.
//
//   control  GET  /__sim/state                       received, sent, failures, plans
//            POST /__sim/plan {facility|'*': plan}   answer plan per GSRN ('*' = default)
//
// Run: npx tsx scripts/reality/simulators/gridOwnerRejects.ts  (env as gridOwner.ts, REALITY_GRID_OWNER_*)
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import nodemailer from 'nodemailer'
import { ImapFlow } from 'imapflow'
import { answersFor, readReceivedRequest, SILENT, type GridOwnerAnswerPlan } from '../../helpers/reality/rejectsWire'
import { buildZ04ForSwitchRequest } from './gridOwnerWire'
import { unwrapSmimeForActor } from './smimeUnwrap'
import { platformMailboxFor } from './platformMailbox'
import { edifactInterchangesInMail } from './edifactMailParts'

const env = (name: string, fallback: string) => process.env[name] ?? fallback
const config = {
  edielId: env('REALITY_GRID_OWNER_EDIEL_ID', '80001'),
  email: env('REALITY_GRID_OWNER_EMAIL', 'e2e-natagare@example.invalid'),
  mailHost: env('REALITY_MAIL_HOST', 'localhost'),
  smtpsPort: Number(env('REALITY_SMTPS_PORT', '3465')),
  imapsPort: Number(env('REALITY_IMAPS_PORT', '3993')),
  pollMs: Number(env('REALITY_GRID_OWNER_POLL_MS', '15000')),
  controlPort: Number(env('REALITY_GRID_OWNER_PORT', '3912')),
  /** Pause between the answers to one request (CONTRL, APERAK, Z04 arrive as separate mails, in order). */
  stepMs: Number(env('REALITY_GRID_OWNER_STEP_MS', '20000')),
}
const plans = new Map<string, GridOwnerAnswerPlan>([['*', { contrl: 'positive', aperak: { kind: 'positive' }, z04: 'after_aperak', duplicateAperak: false }]])
type Received = { at: string; subject: string; family: string; code: string; interchange: string; facility: string; lineItemReference: string; plan: string }
type Sent = { at: string; kind: string; facility: string; inReplyTo: string; reference: string }
const received: Received[] = []
const sent: Sent[] = []
const failures: Array<{ at: string; error: string }> = []
let pending = 0

const transport = nodemailer.createTransport({ host: config.mailHost, port: config.smtpsPort, secure: true, requireTLS: true,
  auth: { user: config.email, pass: 'grid-owner-local' }, tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' } })

async function deliver(kind: string, edifact: string, facility: string, inReplyTo: string) {
  const reference = /UNB\+[^']*?\+[^+']*\+[^+']*\+[^+']*\+([^+']+)/.exec(edifact)?.[1] ?? '?'
  await transport.sendMail({ from: config.email, to: platformMailboxFor(edifact), subject: `${kind} ${reference}`, text: 'Ediel',
    attachments: [{ filename: `${kind.replace(/\W+/g, '_')}_${reference}.edi`, content: edifact, contentType: 'application/edifact' }] })
  sent.push({ at: new Date().toISOString(), kind, facility, inReplyTo, reference })
}

function handle(raw: string, subject: string) {
  const facts = readReceivedRequest(raw)
  const plan = plans.get(facts.facility) ?? plans.get('*') ?? SILENT
  received.push({ at: new Date().toISOString(), subject, family: facts.family, code: facts.code, interchange: facts.interchange, facility: facts.facility,
    lineItemReference: facts.lineItemReference, plan: JSON.stringify(plan) })
  // Our own CONTRL/APERAK on the grid owner's files are only recorded (no ACK on ACK).
  if (facts.family !== 'PRODAT' || !['Z03', 'Z01'].includes(facts.code)) return
  const steps = answersFor(raw, plan)
  pending += 1
  void (async () => {
    try {
      for (const step of steps) {
        await new Promise(resolve => setTimeout(resolve, config.stepMs))
        const edifact = step.edifact ?? buildZ04ForSwitchRequest({ request: raw, gridOwnerEdielId: config.edielId }).raw
        await deliver(step.kind, edifact, facts.facility, facts.interchange)
      }
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
      const message = await client.fetchOne(String(uid), { source: true, envelope: true }, { uid: true })
      if (!message) continue
      // Production mail is S/MIME enveloped to this grid owner's certificate; read it as the real one does.
      let text: string
      try { text = message.source ? unwrapSmimeForActor(message.source, config.edielId) : '' }
      catch (error) { failures.push({ at: new Date().toISOString(), error: `unreadable mail: ${error instanceof Error ? error.message : String(error)}` }); text = '' }
      for (const file of edifactInterchangesInMail(text)) {
        try { handle(file, message.envelope?.subject ?? '') }
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
      for (const [facility, plan] of Object.entries(JSON.parse(await body(req)) as Record<string, GridOwnerAnswerPlan>)) plans.set(facility, plan)
      return reply(res, 200, Object.fromEntries(plans))
    }
    return reply(res, 404, { message: 'not found' })
  } catch (error) { reply(res, 500, { message: error instanceof Error ? error.message : String(error) }) }
}).listen(config.controlPort, '127.0.0.1', () => console.log(`[rejecting grid-owner ${config.edielId}] control on http://127.0.0.1:${config.controlPort}, mailbox ${config.email}`))

const loop = async () => {
  try { await poll() } catch (error) { console.error('[rejecting grid-owner] poll failed', error instanceof Error ? error.message : error) }
  setTimeout(loop, config.pollMs)
}
void loop()
