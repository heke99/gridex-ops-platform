#!/usr/bin/env node
// TR-08 operator probe (owner decision 2026-10-04): send one synthetic message
// through the Ediel SMTP lane to an OPERATOR-OWNED test mailbox, read it back
// over IMAP, verify the Received-header hop chain and persist the hash-bound
// evidence via public.ediel_record_relay_trace_v1. Never send to a counterparty.
//
//   node --experimental-strip-types scripts/ediel-tr-08-relay-trace-probe.mjs            # dry run: validates env, sends nothing
//   node --experimental-strip-types scripts/ediel-tr-08-relay-trace-probe.mjs --execute  # sends + reads back + persists
//
// Env (no secrets in the repo): EDIEL_SMTP_HOST/PORT/SECURE/USER/PASS/FROM (same as
// the Ediel lane), EDIEL_RELAY_PROBE_MAILBOX, EDIEL_RELAY_PROBE_OWN_MAILBOX_CONFIRMED=true,
// EDIEL_RELAY_PROBE_OWN_HOSTS (comma list of our submission hosts, e.g. smtp.strato.de),
// EDIEL_RELAY_PROBE_COMPANY_ID, EDIEL_RELAY_PROBE_ENVIRONMENT (test|production),
// EDIEL_RELAY_PROBE_ACTOR_USER_ID (active member with communication.write),
// EDIEL_RELAY_PROBE_IMAP_HOST/PORT(993)/USER/PASSWORD/MAILBOX(INBOX),
// EDIEL_RELAY_PROBE_TIMEOUT_SECONDS (300), NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
import { randomUUID } from 'node:crypto'
import { relayProbeConfigFromEnv, runRelayTraceProbe, recordRelayTrace, RELAY_PROBE_HEADER } from '../lib/ediel/transport/relayTrace.ts'

const config = relayProbeConfigFromEnv(process.env)
const smtp = {
  host: process.env.EDIEL_SMTP_HOST?.trim() || 'smtp.strato.de',
  port: Number(process.env.EDIEL_SMTP_PORT ?? 465),
  secure: String(process.env.EDIEL_SMTP_SECURE ?? 'true').toLowerCase() !== 'false',
  user: process.env.EDIEL_SMTP_USER?.trim() || process.env.EDIEL_SMTP_FROM?.trim(),
  pass: process.env.EDIEL_SMTP_PASS || process.env.EDIEL_SMTP_PASSWORD,
  from: process.env.EDIEL_SMTP_FROM?.trim(),
}
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
if (!smtp.from || !smtp.pass) throw new Error('relay_probe_env_missing: EDIEL_SMTP_FROM, EDIEL_SMTP_PASS')
if (!supabaseUrl || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('relay_probe_env_missing: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')

if (!process.argv.includes('--execute')) {
  console.log(JSON.stringify({ dryRun: true, smtpHost: smtp.host, smtpPort: smtp.port, to: config.mailbox, imapHost: config.imap.host,
    ownHosts: config.ownHosts, companyId: config.companyId, environment: config.environment }, null, 2))
  console.log('Dry run: nothing sent. Re-run with --execute to send to the own test mailbox.')
  process.exit(0)
}

const [{ default: nodemailer }, { ImapFlow }, { createClient }] = await Promise.all([import('nodemailer'), import('imapflow'), import('@supabase/supabase-js')])
const transporter = nodemailer.createTransport({ host: smtp.host, port: smtp.port, secure: smtp.secure, requireTLS: true,
  auth: { user: smtp.user, pass: smtp.pass }, tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' } })
const supabase = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

async function fetchHeaders(probeId) {
  const client = new ImapFlow({ host: config.imap.host, port: config.imap.port, secure: true,
    auth: { user: config.imap.user, pass: config.imap.password }, logger: false, tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' } })
  await client.connect()
  try {
    const lock = await client.getMailboxLock(config.imap.mailbox)
    try {
      const uids = await client.search({ header: { [RELAY_PROBE_HEADER]: probeId } }, { uid: true })
      if (!uids || !uids.length) return null
      const message = await client.fetchOne(String(uids[uids.length - 1]), { headers: true }, { uid: true })
      return message?.headers ? message.headers.toString('utf8') : null
    } finally { lock.release() }
  } finally { await client.logout() }
}

const result = await runRelayTraceProbe(config, {
  probeId: () => 'probe-' + randomUUID(),
  send: async (message) => { await transporter.sendMail({ from: smtp.from, ...message }) },
  fetchHeaders,
  persist: (rawHeaders, verdict) => recordRelayTrace(supabase, { companyId: config.companyId, environment: config.environment,
    actorUserId: config.actorUserId, rawHeaders, verdict }),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
})
console.log(JSON.stringify({ evidenceId: result.evidenceId, reason: result.reason, verified: result.verdict?.verified ?? false,
  reasons: result.verdict?.reasons, relayHopCount: result.verdict?.relayHopCount, rawHeadersSha256: result.verdict?.rawHeadersSha256 }, null, 2))
process.exit(result.verdict?.verified ? 0 : 1)
