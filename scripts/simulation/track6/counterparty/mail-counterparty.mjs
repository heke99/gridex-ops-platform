// Spår 6 (Ediel): lokal syntetisk mailmotpart.
//
//  * SMTP med implicit TLS (egen CA) som tar emot "DSO"-post och sparar varje MIME byte-exakt
//    (efter dot-unstuffing) i  <SIM_HOME>/mail/inbox-dso/<n>.eml  + <n>.eml.sha256 + <n>.json.
//  * Läge styrs per körning via kontrollfil <SIM_HOME>/mail/control.json eller lokal HTTP-kontroll
//    (127.0.0.1:CONTROL_PORT):  accept | tempfail-4xx | permfail-5xx | drop-after-data | hang
//  * IMAP med TLS (egen CA): TLS-terminering framför GreenMail (docker, plaintext på 127.0.0.1).
//
// Härkomst: SMTP-tillståndsmaskinen är en egen omskrivning efter mönstret i
// 1c0c088cb4ed66d0dd8b3e34c9606019342a1a56:scripts/ediel-ops04-controlled-send-native.test.ts
// (startLoopbackSmtp, rad 926-1051); ingen kod är kopierad rakt av.
//
// Inga externa värdar. Lyssnar bara på 127.0.0.1. Hemligheter läses från filer i SIM_HOME.
import { createServer as createTlsServer } from 'node:tls'
import { createServer as createHttpServer } from 'node:http'
import { connect as netConnect } from 'node:net'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'

const need = (name) => {
  const v = process.env[name]
  if (!v) { console.error(`missing env ${name}`); process.exit(2) }
  return v
}
const SIM_HOME = need('SIM_HOME')
const SMTP_PORT = Number(need('T6_SMTP_PORT'))
const IMAP_TLS_PORT = Number(need('T6_IMAP_TLS_PORT'))
const IMAP_PLAIN_PORT = Number(need('T6_IMAP_PLAIN_PORT'))
const CONTROL_PORT = Number(need('T6_CONTROL_PORT'))
const SMTP_USER = need('T6_SMTP_USER')
const SMTP_PASS = readFileSync(join(SIM_HOME, 'secrets', 'smtp-pass'), 'utf8').trim()
const MAIL_DIR = join(SIM_HOME, 'mail')
const INBOX = join(MAIL_DIR, 'inbox-dso')
const CONTROL_FILE = join(MAIL_DIR, 'control.json')
const tlsOptions = () => ({
  key: readFileSync(join(SIM_HOME, 'ca', 'server.key')),
  cert: readFileSync(join(SIM_HOME, 'ca', 'server.pem')),
  minVersion: 'TLSv1.2',
})
mkdirSync(INBOX, { recursive: true })

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const nowIso = () => new Date().toISOString()

// ---- läge --------------------------------------------------------------
const DEFAULT_CONTROL = { mode: 'accept', code: null, stage: null, hangMs: 120000 }
function readControl() {
  try {
    const parsed = JSON.parse(readFileSync(CONTROL_FILE, 'utf8'))
    return { ...DEFAULT_CONTROL, ...parsed }
  } catch { return { ...DEFAULT_CONTROL } }
}
const MODES = new Set(['accept', 'tempfail-4xx', 'permfail-5xx', 'drop-after-data', 'hang'])

// ---- lagring -----------------------------------------------------------
let counter = readdirSync(INBOX).filter((f) => /^\d+\.eml$/.test(f)).length
const stats = { connections: 0, authenticated: 0, stored: 0, refused: 0, modes: {} }
function storeMessage({ from, to, raw, authUser, tlsVersion, mode, disposition, reply }) {
  counter += 1
  const n = counter
  const digest = sha256(raw)
  writeFileSync(join(INBOX, `${n}.eml`), raw)
  writeFileSync(join(INBOX, `${n}.eml.sha256`), `${digest}  ${n}.eml\n`)
  writeFileSync(join(INBOX, `${n}.json`), JSON.stringify({
    n, receivedAt: nowIso(), envelopeFrom: from, envelopeTo: to, bytes: raw.length, sha256: digest,
    authUser, tlsVersion, mode, disposition, smtpReply: reply,
  }, null, 2))
  appendFileSync(join(MAIL_DIR, 'inbox-dso.index.jsonl'),
    JSON.stringify({ n, receivedAt: nowIso(), sha256: digest, bytes: raw.length, mode, disposition }) + '\n')
  stats.stored += 1
  return n
}

// ---- SMTP --------------------------------------------------------------
const sockets = new Set()
const smtp = createTlsServer(tlsOptions(), (socket) => {
  if (socket.remoteAddress !== '127.0.0.1' && socket.remoteAddress !== '::ffff:127.0.0.1') { socket.destroy(); return }
  sockets.add(socket)
  stats.connections += 1
  socket.setTimeout(300000, () => socket.destroy())
  socket.on('error', () => {})
  socket.on('close', () => sockets.delete(socket))
  const control0 = readControl()
  let buffer = Buffer.alloc(0)
  let authenticated = false
  let from = null
  let recipients = []
  let dataChunks = null
  let challenge = null
  let loginUser = ''
  const reply = (text) => { if (!socket.destroyed) socket.write(text + '\r\n') }
  const resetEnvelope = () => { from = null; recipients = []; dataChunks = null }
  const verify = (user, pass) => {
    if (user === SMTP_USER && pass === SMTP_PASS) {
      if (!authenticated) stats.authenticated += 1
      authenticated = true
      reply('235 2.7.0 authentication successful')
    } else { authenticated = false; reply('535 5.7.8 authentication failed') }
  }
  const plain = (encoded) => {
    const values = Buffer.from(encoded, 'base64').toString('utf8').split('\0')
    if (values.length !== 3) { reply('535 5.7.8 authentication failed'); return }
    verify(values[1], values[2])
  }
  const finishData = (raw) => {
    const control = readControl()
    const mode = MODES.has(control.mode) ? control.mode : 'accept'
    stats.modes[mode] = (stats.modes[mode] ?? 0) + 1
    const base = { from, to: [...recipients], raw, authUser: SMTP_USER, tlsVersion: socket.getProtocol() ?? '', mode }
    resetEnvelope()
    if (mode === 'accept') {
      const n = storeMessage({ ...base, disposition: 'accepted', reply: '250' })
      reply(`250 2.0.0 t6-sim accepted ${n}`)
    } else if (mode === 'tempfail-4xx') {
      const code = control.code && /^4\d\d$/.test(String(control.code)) ? String(control.code) : '451'
      stats.refused += 1
      storeMessage({ ...base, disposition: 'tempfail-not-accepted', reply: code })
      reply(`${code} 4.3.0 t6-sim temporary failure, try again later`)
    } else if (mode === 'permfail-5xx') {
      const code = control.code && /^5\d\d$/.test(String(control.code)) ? String(control.code) : '554'
      stats.refused += 1
      storeMessage({ ...base, disposition: 'permfail-not-accepted', reply: code })
      reply(`${code} 5.7.1 t6-sim permanent failure`)
    } else if (mode === 'drop-after-data') {
      // Meddelandet har tagits emot byte-exakt men klienten får aldrig något svar.
      storeMessage({ ...base, disposition: 'received-no-reply-connection-dropped', reply: null })
      socket.destroy()
    } else if (mode === 'hang') {
      storeMessage({ ...base, disposition: 'received-no-reply-hang', reply: null })
      const ms = Number(control.hangMs) > 0 ? Number(control.hangMs) : 120000
      socket.setTimeout(0)
      setTimeout(() => socket.destroy(), ms).unref()
    }
  }
  if (control0.mode === 'hang' && control0.stage === 'greeting') { socket.setTimeout(0); return }
  reply('220 t6-sim.invalid ESMTP SYNTHETIC TRACK3 DSO COUNTERPARTY')
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk])
    if (buffer.length > 32 * 1024 * 1024) { socket.destroy(); return }
    for (;;) {
      if (dataChunks) {
        // DATA-läge: <CRLF>.<CRLF> avslutar (eller ".<CRLF>" direkt om meddelandet är tomt).
        let end = -1
        let skip = 0
        if (buffer.length >= 3 && buffer.subarray(0, 3).equals(Buffer.from('.\r\n'))) { end = 0; skip = 3 }
        else {
          const idx = buffer.indexOf('\r\n.\r\n')
          if (idx >= 0) { end = idx + 2; skip = idx + 5 } // behåll sista radens CRLF
        }
        if (end < 0) return // vänta på mer data (buffer behålls)
        const raw = unstuff(buffer.subarray(0, end))
        buffer = buffer.subarray(skip)
        dataChunks = null
        finishData(raw)
        continue
      }
      const eol = buffer.indexOf('\r\n')
      if (eol < 0) return
      const line = buffer.subarray(0, eol).toString('latin1')
      buffer = buffer.subarray(eol + 2)
      if (challenge) {
        const stage = challenge; challenge = null
        if (stage === 'plain') plain(line)
        else if (stage === 'username') { loginUser = Buffer.from(line, 'base64').toString('utf8'); challenge = 'password'; reply('334 UGFzc3dvcmQ6') }
        else verify(loginUser, Buffer.from(line, 'base64').toString('utf8'))
        continue
      }
      const command = line.split(' ', 1)[0].toUpperCase()
      if (command === 'EHLO' || command === 'HELO') {
        reply('250-t6-sim.invalid\r\n250-AUTH PLAIN LOGIN\r\n250-8BITMIME\r\n250-SMTPUTF8\r\n250 SIZE 33554432')
      } else if (command === 'AUTH') {
        const [, mechanism, value] = line.split(/\s+/)
        if (mechanism?.toUpperCase() === 'PLAIN') { if (value) plain(value); else { challenge = 'plain'; reply('334 ') } }
        else if (mechanism?.toUpperCase() === 'LOGIN') {
          if (value) { loginUser = Buffer.from(value, 'base64').toString('utf8'); challenge = 'password'; reply('334 UGFzc3dvcmQ6') }
          else { challenge = 'username'; reply('334 VXNlcm5hbWU6') }
        } else reply('504 5.5.4 mechanism unsupported')
      } else if (command === 'MAIL') {
        const m = /^MAIL FROM:\s*<([^>]*)>/i.exec(line)
        if (!authenticated) reply('530 5.7.0 authentication required')
        else if (!m) reply('501 5.5.4 syntax')
        else { from = m[1]; recipients = []; reply('250 2.1.0 ok') }
      } else if (command === 'RCPT') {
        const m = /^RCPT TO:\s*<([^>]*)>/i.exec(line)
        if (!authenticated || from === null) reply('503 5.5.1 bad sequence')
        else if (!m) reply('501 5.5.4 syntax')
        else {
          const control = readControl()
          if (control.mode === 'tempfail-4xx' && control.stage === 'rcpt') { stats.refused += 1; reply(`${/^4\d\d$/.test(String(control.code)) ? control.code : '451'} 4.3.0 t6-sim temporary failure at RCPT`) }
          else if (control.mode === 'permfail-5xx' && control.stage === 'rcpt') { stats.refused += 1; reply(`${/^5\d\d$/.test(String(control.code)) ? control.code : '550'} 5.1.1 t6-sim no such recipient`) }
          else { recipients.push(m[1]); reply('250 2.1.5 ok') }
        }
      } else if (command === 'DATA') {
        if (!authenticated || from === null || recipients.length === 0) reply('503 5.5.1 bad sequence')
        else { dataChunks = []; reply('354 end with <CRLF>.<CRLF>') }
      } else if (command === 'RSET') { resetEnvelope(); reply('250 2.0.0 ok') }
      else if (command === 'NOOP') reply('250 2.0.0 ok')
      else if (command === 'QUIT') { reply('221 2.0.0 bye'); socket.end() }
      else if (command === 'STARTTLS') reply('454 4.7.0 already on TLS')
      else reply('502 5.5.2 command not recognized')
    }
  })
})

function unstuff(buf) {
  // Ersätt "\r\n.." med "\r\n." och inledande ".." med ".".
  const out = []
  let start = 0
  if (buf.length >= 2 && buf[0] === 0x2e && buf[1] === 0x2e) { start = 1 }
  let pos = start
  const marker = Buffer.from('\r\n..')
  for (;;) {
    const idx = buf.indexOf(marker, pos)
    if (idx < 0) { out.push(buf.subarray(start)); break }
    out.push(buf.subarray(start, idx + 3)) // inkl. CRLF och första punkten
    start = idx + 4
    pos = start
  }
  return Buffer.concat(out)
}

// ---- IMAP TLS-terminator -> GreenMail ----------------------------------
const imapStats = { connections: 0, upstreamErrors: 0 }
const imap = createTlsServer(tlsOptions(), (client) => {
  imapStats.connections += 1
  const upstream = netConnect({ host: '127.0.0.1', port: IMAP_PLAIN_PORT })
  sockets.add(client)
  client.on('error', () => upstream.destroy())
  upstream.on('error', () => { imapStats.upstreamErrors += 1; client.destroy() })
  client.on('close', () => { sockets.delete(client); upstream.destroy() })
  upstream.on('close', () => client.destroy())
  client.pipe(upstream)
  upstream.pipe(client)
})

// ---- HTTP-kontroll -----------------------------------------------------
function listMessages() {
  return readdirSync(INBOX).filter((f) => /^\d+\.json$/.test(f))
    .map((f) => JSON.parse(readFileSync(join(INBOX, f), 'utf8'))).sort((a, b) => a.n - b.n)
}
const control = createHttpServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
  if (url.pathname === '/health') return send(200, { ok: true, smtpPort: SMTP_PORT, imapTlsPort: IMAP_TLS_PORT, startedAt })
  if (url.pathname === '/state') return send(200, { control: readControl(), stats, imapStats, stored: counter })
  if (url.pathname === '/messages') return send(200, listMessages())
  if (url.pathname === '/mode') {
    const mode = url.searchParams.get('mode')
    if (req.method === 'GET' && !mode) return send(200, readControl())
    if (!mode || !MODES.has(mode)) return send(400, { error: 'mode must be one of ' + [...MODES].join(',') })
    const next = { mode, code: url.searchParams.get('code'), stage: url.searchParams.get('stage'), hangMs: Number(url.searchParams.get('hangMs') ?? 120000) }
    writeFileSync(CONTROL_FILE, JSON.stringify(next))
    return send(200, next)
  }
  if (url.pathname === '/drop-connections' && req.method === 'POST') { for (const s of sockets) s.destroy(); return send(200, { ok: true }) }
  return send(404, { error: 'not found' })
})

const startedAt = nowIso()
if (!existsSync(CONTROL_FILE)) writeFileSync(CONTROL_FILE, JSON.stringify(DEFAULT_CONTROL))
await new Promise((r) => smtp.listen(SMTP_PORT, '127.0.0.1', r))
await new Promise((r) => imap.listen(IMAP_TLS_PORT, '127.0.0.1', r))
await new Promise((r) => control.listen(CONTROL_PORT, '127.0.0.1', r))
console.log(JSON.stringify({ event: 'listening', at: startedAt, smtpPort: SMTP_PORT, imapTlsPort: IMAP_TLS_PORT, controlPort: CONTROL_PORT }))
const stop = () => { for (const s of sockets) s.destroy(); smtp.close(); imap.close(); control.close(); setTimeout(() => process.exit(0), 200).unref() }
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
