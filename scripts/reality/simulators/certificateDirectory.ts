// Expisoft's Ediel certificate directory, simulated: an LDAP server (anonymous
// search, BER over TCP, the same protocol as sodir01.expisoft.se:389) that
// serves each registered market actor's S/MIME receiver certificate. The app
// reaches it through its own configuration (EDIEL_EXPISOFT_LDAP_HOST/_PORT).
// Certificates are issued by a local test CA for ediel-<EdielId>@example.invalid,
// so nothing here can be used against a real actor.
//
//   ldap    REALITY_LDAP_PORT (default 3389): bind, search (equality, substrings,
//           present, and, or, not), unbind
//   control REALITY_LDAP_CONTROL_PORT (default 3902):
//           POST /__sim/actor {edielId, name, email, validDays?}  issue + publish a certificate
//           POST /__sim/fault {mode: ok|hang|drop|empty, count?}  directory outage modes
//           GET  /__sim/state                                      actors and search log
//           GET  /__sim/trust/<EdielId>                            CA anchor, CRL, leaf fingerprint
//
// Run: npx tsx scripts/reality/simulators/certificateDirectory.ts
import { createServer as createTcpServer, type Socket } from 'node:net'
import { createServer as createHttpServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

type Tlv = { tag: number; value: Buffer; end: number }
type Entry = { dn: string; attributes: Record<string, Buffer[]> }
type Fault = { mode: 'ok' | 'hang' | 'drop' | 'empty'; remaining: number | null }

const ldapPort = Number(process.env.REALITY_LDAP_PORT ?? 3389)
const controlPort = Number(process.env.REALITY_LDAP_CONTROL_PORT ?? 3902)
const entries: Entry[] = []
const searches: Array<{ at: string; base: string; filter: string; matched: number }> = []
let fault: Fault = { mode: 'ok', remaining: null }

// ---- BER (only what LDAPv3 search needs) ------------------------------------
function readTlv(buffer: Buffer, offset: number): Tlv | null {
  if (offset + 2 > buffer.length) return null
  const tag = buffer[offset]
  let length = buffer[offset + 1]
  let position = offset + 2
  if (length & 0x80) {
    const bytes = length & 0x7f
    if (position + bytes > buffer.length) return null
    length = 0
    for (let i = 0; i < bytes; i++) length = length * 256 + buffer[position++]
  }
  if (position + length > buffer.length) return null
  return { tag, value: buffer.subarray(position, position + length), end: position + length }
}
function children(value: Buffer): Tlv[] {
  const list: Tlv[] = []
  for (let offset = 0; offset < value.length;) {
    const tlv = readTlv(value, offset)
    if (!tlv) throw Error('ber_truncated')
    list.push(tlv); offset = tlv.end
  }
  return list
}
function encode(tag: number, content: Buffer): Buffer {
  const n = content.length
  const length = n < 0x80 ? Buffer.from([n]) : (() => { const bytes: number[] = []; for (let v = n; v > 0; v = Math.floor(v / 256)) bytes.unshift(v & 0xff); return Buffer.from([0x80 | bytes.length, ...bytes]) })()
  return Buffer.concat([Buffer.from([tag]), length, content])
}
const octets = (value: string | Buffer, tag = 0x04) => encode(tag, Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8'))
const sequence = (tag: number, items: Buffer[]) => encode(tag, Buffer.concat(items))
function integer(value: number, tag = 0x02) {
  const bytes: number[] = []
  let v = value
  do { bytes.unshift(v & 0xff); v = Math.floor(v / 256) } while (v > 0)
  if (bytes[0] & 0x80) bytes.unshift(0)
  return encode(tag, Buffer.from(bytes))
}
const readInteger = (value: Buffer) => value.reduce((n, byte) => n * 256 + byte, 0)
const ldapResult = (tag: number, messageId: number) => sequence(0x30, [integer(messageId), sequence(tag, [integer(0, 0x0a), octets(''), octets('')])])

// ---- Filters -----------------------------------------------------------------
type Filter = (entry: Entry) => boolean
const values = (entry: Entry, attribute: string) => Object.entries(entry.attributes)
  .filter(([name]) => name.toLowerCase().split(';')[0] === attribute.toLowerCase().split(';')[0]).flatMap(([, list]) => list.map(v => v.toString('utf8').toLowerCase()))
function parseFilter(tlv: Tlv): { match: Filter; text: string } {
  switch (tlv.tag) {
    case 0xa0: case 0xa1: { // and, or
      const parts = children(tlv.value).map(parseFilter)
      const and = tlv.tag === 0xa0
      return { match: e => and ? parts.every(p => p.match(e)) : parts.some(p => p.match(e)), text: `(${and ? '&' : '|'}${parts.map(p => p.text).join('')})` }
    }
    case 0xa2: { const inner = parseFilter(children(tlv.value)[0]); return { match: e => !inner.match(e), text: `(!${inner.text})` } }
    case 0xa3: { // equalityMatch
      const [attribute, value] = children(tlv.value).map(t => t.value.toString('utf8'))
      return { match: e => values(e, attribute).includes(value.toLowerCase()), text: `(${attribute}=${value})` }
    }
    case 0xa4: { // substrings
      const [type, parts] = children(tlv.value)
      const attribute = type.value.toString('utf8')
      const pieces = children(parts.value).map(p => ({ kind: p.tag & 0x0f, text: p.value.toString('utf8').toLowerCase() }))
      return { match: e => values(e, attribute).some(v => {
        let position = 0
        for (const piece of pieces) {
          if (piece.kind === 0) { if (!v.startsWith(piece.text)) return false; position = piece.text.length }
          else if (piece.kind === 1) { const at = v.indexOf(piece.text, position); if (at < 0) return false; position = at + piece.text.length }
          else if (!v.endsWith(piece.text) || v.length - piece.text.length < position) return false
        }
        return true
      }), text: `(${attribute}=${pieces.map(p => p.kind === 0 ? `${p.text}*` : p.kind === 1 ? `*${p.text}*` : `*${p.text}`).join('').replace(/\*\*/g, '*')})` }
    }
    case 0x87: { const attribute = tlv.value.toString('utf8'); return { match: e => values(e, attribute).length > 0, text: `(${attribute}=*)` } }
    default: return { match: () => false, text: `(unsupported:0x${tlv.tag.toString(16)})` }
  }
}

// ---- LDAP session --------------------------------------------------------------
function handle(socket: Socket, message: Buffer) {
  const [id, op] = children(message)
  const messageId = readInteger(id.value)
  if (op.tag === 0x42) { socket.end(); return } // unbind
  if (op.tag === 0x60) { socket.write(ldapResult(0x61, messageId)); return } // bind: anonymous or simple, always success
  if (op.tag !== 0x63) { socket.write(ldapResult(0x65, messageId)); return }
  const [base, , , , , , filterTlv, attributeList] = children(op.value)
  const filter = parseFilter(filterTlv)
  const requested = children(attributeList.value).map(t => t.value.toString('utf8').toLowerCase().split(';')[0])
  const matched = fault.mode === 'empty' ? [] : entries.filter(filter.match)
  searches.push({ at: new Date().toISOString(), base: base.value.toString('utf8'), filter: filter.text, matched: matched.length })
  for (const entry of matched) {
    const attributes = Object.entries(entry.attributes)
      .filter(([name]) => requested.length === 0 || requested.includes(name.toLowerCase().split(';')[0]))
      .map(([name, list]) => sequence(0x30, [octets(name), sequence(0x31, list.map(v => octets(v)))]))
    socket.write(sequence(0x30, [integer(messageId), sequence(0x64, [octets(entry.dn), sequence(0x30, attributes)])]))
  }
  socket.write(ldapResult(0x65, messageId))
}

createTcpServer(socket => {
  let pending = Buffer.alloc(0)
  socket.on('error', () => undefined)
  socket.on('data', chunk => {
    if (fault.mode === 'drop') { socket.destroy(); return consumeFault() }
    if (fault.mode === 'hang') return consumeFault() // never answers: only the client's own timeout ends the lookup
    pending = Buffer.concat([pending, chunk])
    for (let tlv = readTlv(pending, 0); tlv; tlv = readTlv(pending, 0)) {
      try { handle(socket, tlv.value) } catch { socket.destroy(); return }
      pending = pending.subarray(tlv.end)
    }
    if (fault.mode === 'empty') consumeFault()
  })
}).listen(ldapPort, '127.0.0.1')
function consumeFault() { if (fault.remaining !== null && --fault.remaining <= 0) fault = { mode: 'ok', remaining: null } }

// ---- Test CA and certificates ---------------------------------------------------
const dir = mkdtempSync(join(tmpdir(), 'reality-ldap-ca-'))
const openssl = (...args: string[]) => execFileSync('openssl', args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] })
openssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem', '-days', '3650', '-subj', '/C=SE/O=Gridex Reality Test CA/CN=Reality Ediel Test CA')
// The CA's certificate revocation list (none revoked), as an Ediel CA publishes it.
writeFileSync(join(dir, 'index.txt'), '')
writeFileSync(join(dir, 'crlnumber'), '01\n')
writeFileSync(join(dir, 'ca.cnf'), `[ca]\ndefault_ca=reality\n[reality]\ndatabase=${join(dir, 'index.txt')}\ncrlnumber=${join(dir, 'crlnumber')}\ndefault_md=sha256\ndefault_crl_days=30\n`)
const crl = () => { openssl('ca', '-gencrl', '-config', 'ca.cnf', '-keyfile', 'ca.key', '-cert', 'ca.pem', '-out', 'crl.pem'); return readFileSync(join(dir, 'crl.pem'), 'utf8') }
const fingerprints = new Map<string, string>()
function issue(input: { edielId: string; name: string; email: string; validDays?: number; reissue?: boolean }) {
  const base = `actor-${input.edielId}`
  // An actor keeps its certificate until it is explicitly reissued, as in the real directory.
  const current = entries.find(e => values(e, 'uid').includes(input.edielId) && values(e, 'mail').includes(input.email.toLowerCase()))
  if (current && !input.reissue) return { dn: current.dn, pem: readFileSync(join(dir, `${base}.pem`), 'utf8') }
  writeFileSync(join(dir, `${base}.ext`), `subjectAltName=email:${input.email}\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=emailProtection\n`)
  openssl('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${base}.key`, '-out', `${base}.csr`, '-subj', `/C=SE/O=${input.name.replace(/[/=]/g, ' ')}/CN=${input.edielId}/emailAddress=${input.email}`)
  openssl('x509', '-req', '-in', `${base}.csr`, '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', `${base}.pem`, '-days', String(input.validDays ?? 365), '-extfile', `${base}.ext`)
  const der = openssl('x509', '-in', `${base}.pem`, '-outform', 'DER')
  fingerprints.set(input.edielId, createHash('sha256').update(der).digest('hex'))
  const at = entries.findIndex(e => values(e, 'uid').includes(input.edielId))
  const entry: Entry = { dn: `mail=${input.email},o=${input.edielId},c=se`, attributes: {
    mail: [Buffer.from(input.email)], cn: [Buffer.from(`${input.name} ${input.edielId}`)], uid: [Buffer.from(input.edielId)], o: [Buffer.from(input.edielId)],
    'userCertificate;binary': [der] } }
  if (at >= 0) entries[at] = entry; else entries.push(entry)
  return { dn: entry.dn, pem: readFileSync(join(dir, `${base}.pem`), 'utf8') }
}

createHttpServer(async (req, res) => {
  const send = (status: number, payload: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(payload)) }
  let body = ''
  for await (const chunk of req) body += chunk
  try {
    if (req.url === '/__sim/state') return send(200, { fault, actors: entries.map(e => e.dn), searches: searches.slice(-200) })
    if (req.url === '/__sim/actor' && req.method === 'POST') return send(200, issue(JSON.parse(body)))
    // Public trust originals for an actor: CA anchor, current CRL and the registered leaf fingerprint.
    if (req.url?.startsWith('/__sim/trust/')) {
      const edielId = req.url.slice('/__sim/trust/'.length)
      if (!fingerprints.has(edielId)) return send(404, { message: 'actor not registered' })
      return send(200, { anchors: [readFileSync(join(dir, 'ca.pem'), 'utf8')], intermediates: [], crls: [crl()], recipientFingerprints: [fingerprints.get(edielId)] })
    }
    if (req.url === '/__sim/fault' && req.method === 'POST') { const input = JSON.parse(body); fault = { mode: input.mode, remaining: input.count ?? null }; return send(200, { fault }) }
    return send(404, { message: 'not simulated' })
  } catch (error) { return send(500, { message: error instanceof Error ? error.message : String(error) }) }
}).listen(controlPort, '127.0.0.1', () => console.log(`[certificate-directory] ldap://127.0.0.1:${ldapPort} control http://127.0.0.1:${controlPort}`))
