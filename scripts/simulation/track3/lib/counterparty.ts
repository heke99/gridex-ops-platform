// Klient mot den lokala mailmotpartens kontrollport + IMAP-inläggning och TLS-kontroll.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { connect as tlsConnect } from 'node:tls'
import { ImapFlow } from 'imapflow'

export type SmtpMode = 'accept' | 'tempfail-4xx' | 'permfail-5xx' | 'drop-after-data' | 'hang'
export type ReceivedMail = {
  n: number; receivedAt: string; envelopeFrom: string; envelopeTo: string[]; bytes: number; sha256: string
  authUser: string; tlsVersion: string; mode: SmtpMode; disposition: string; smtpReply: string | null
}
const env = (name: string) => { const v = process.env[name]; if (!v) throw new Error(`env ${name} saknas`); return v }
const simHome = () => process.env.T3_SIM_HOME ?? env('SIM_HOME')
const control = () => `http://127.0.0.1:${env('T3_CONTROL_PORT')}`

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${control()}${path}`, init)
  if (!r.ok) throw new Error(`motpart ${path}: HTTP ${r.status} ${await r.text()}`)
  return (await r.json()) as T
}

export const setSmtpMode = (mode: SmtpMode, o: { code?: number | string; stage?: 'rcpt' | 'data' | 'greeting'; hangMs?: number } = {}) => {
  const q = new URLSearchParams({ mode })
  if (o.code !== undefined) q.set('code', String(o.code))
  if (o.stage) q.set('stage', o.stage)
  if (o.hangMs) q.set('hangMs', String(o.hangMs))
  return getJson<{ mode: SmtpMode }>(`/mode?${q}`, { method: 'POST' })
}
export const counterpartyState = () => getJson<{ control: { mode: SmtpMode }; stats: Record<string, unknown>; stored: number }>('/state')
export const receivedMail = () => getJson<ReceivedMail[]>('/messages')
export const inboxDir = () => join(simHome(), 'mail', 'inbox-dso')
/** Läs mottagen MIME byte-exakt och verifiera mot sparad sha256. */
export function readReceivedEml(n: number): { raw: Buffer; sha256: string; sha256Matches: boolean } {
  const raw = readFileSync(join(inboxDir(), `${n}.eml`))
  const recorded = readFileSync(join(inboxDir(), `${n}.eml.sha256`), 'utf8').split(/\s+/)[0]
  const actual = createHash('sha256').update(raw).digest('hex')
  return { raw, sha256: actual, sha256Matches: actual === recorded }
}
export async function waitForReceived(minCount: number, timeoutMs = 20_000): Promise<ReceivedMail[]> {
  const end = Date.now() + timeoutMs
  for (;;) {
    const all = await receivedMail()
    if (all.length >= minCount || Date.now() > end) return all
    await new Promise((r) => setTimeout(r, 250))
  }
}

/** TLS-handskakning mot en lokal motpartsport med egen CA (verifierar kedja + SAN). */
export function tlsHandshake(port: number, host = '127.0.0.1'): Promise<{ authorized: boolean; protocol: string | null; authorizationError: string | null; subject: string }> {
  const ca = readFileSync(join(simHome(), 'ca', 'ca.pem'))
  return new Promise((resolve, reject) => {
    const s = tlsConnect({ host, port, ca, minVersion: 'TLSv1.2', servername: host }, () => {
      const cert = s.getPeerCertificate()
      resolve({ authorized: s.authorized, protocol: s.getProtocol(), authorizationError: s.authorizationError ? String(s.authorizationError) : null, subject: String(cert?.subject?.CN ?? '') })
      s.end()
    })
    s.setTimeout(10_000, () => { s.destroy(); reject(new Error('tls timeout')) })
    s.on('error', reject)
  })
}

// ---- IMAP (via TLS-terminatorn, egen CA via NODE_EXTRA_CA_CERTS) ----
export const imapClient = () => new ImapFlow({
  host: '127.0.0.1', port: Number(env('T3_IMAP_TLS_PORT')), secure: true,
  auth: { user: env('T3_IMAP_USER'), pass: env('T3_IMAP_PASS') }, logger: false,
})
export async function appendToInbox(mime: Buffer, folder = 'INBOX', flags: string[] = []): Promise<{ uid: number | null; path: string }> {
  const c = imapClient()
  await c.connect()
  try {
    const res = await c.append(folder, mime, flags)
    return { uid: res ? Number(res.uid ?? 0) || null : null, path: folder }
  } finally { await c.logout().catch(() => undefined) }
}
export async function inboxStatus(folder = 'INBOX'): Promise<{ messages: number; unseen: number }> {
  const c = imapClient()
  await c.connect()
  try {
    const s = await c.status(folder, { messages: true, unseen: true })
    if (!s) return { messages: 0, unseen: 0 }
    return { messages: s.messages ?? 0, unseen: s.unseen ?? 0 }
  } finally { await c.logout().catch(() => undefined) }
}
/** Töm inkorgen (används av scenarier som vill ha ren start). */
export async function purgeInbox(folder = 'INBOX'): Promise<number> {
  const c = imapClient()
  await c.connect()
  try {
    const lock = await c.getMailboxLock(folder)
    try {
      const n = (c.mailbox && typeof c.mailbox === 'object' ? c.mailbox.exists : 0) ?? 0
      if (n > 0) await c.messageDelete('1:*')
      return n
    } finally { lock.release() }
  } finally { await c.logout().catch(() => undefined) }
}

/** Markera alla (eller givna) meddelanden som \\Seen. Harness-hjälp: appen gör det själv men fastnar (se README, kandidatfynd). */
export async function markInboxSeen(uids?: number[], folder = 'INBOX'): Promise<number> {
  const c = imapClient()
  await c.connect()
  try {
    const lock = await c.getMailboxLock(folder)
    try {
      const unseen = (await c.search({ seen: false }, { uid: true })) || []
      const targets = uids ? unseen.filter((u) => uids.includes(u)) : unseen
      if (targets.length) await c.messageFlagsAdd(targets, ['\\Seen'], { uid: true })
      return targets.length
    } finally { lock.release() }
  } finally { await c.logout().catch(() => undefined) }
}

/** Markera bara meddelanden med givna Message-ID som \\Seen (t.ex. de som appen redan lagrat). */
export async function markSeenByMessageIds(messageIds: string[], folder = 'INBOX'): Promise<number> {
  const c = imapClient()
  await c.connect()
  try {
    const lock = await c.getMailboxLock(folder)
    try {
      let n = 0
      for (const id of messageIds) {
        const uids = (await c.search({ header: { 'message-id': id.replace(/^<|>$/g, '') }, seen: false }, { uid: true })) || []
        if (uids.length) { await c.messageFlagsAdd(uids, ['\\Seen'], { uid: true }); n += uids.length }
      }
      return n
    } finally { lock.release() }
  } finally { await c.logout().catch(() => undefined) }
}
