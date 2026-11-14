/** Isolated Resend HTTP boundary. Never sends outside the local Mailpit. */
import fs from 'node:fs'
import path from 'node:path'
import https from 'node:https'
import { randomUUID, createHash, timingSafeEqual } from 'node:crypto'
import { pathToFileURL } from 'node:url'

const DOMAIN = 'elklart.example.invalid'
const DOMAIN_ID = 'elklart-simulated-domain'
const ROOT = '/workspace/elklart-runtime'
const hash = value => createHash('sha256').update(value).digest('hex')
function assert(value, message) { if (!value) throw new Error(message) }
function privatePath(target, directory = false) {
  for (let current = target; current !== path.dirname(current); current = path.dirname(current)) {
    if (fs.existsSync(current) || (() => { try { fs.lstatSync(current); return true } catch { return false } })()) {
      assert(!fs.lstatSync(current).isSymbolicLink(), 'Symlinks refused')
    }
  }
  const stat = fs.statSync(target)
  assert(stat.uid === process.getuid() && (stat.mode & 0o7077) === 0, 'Private ownership/mode required')
  assert(directory ? stat.isDirectory() : stat.isFile(), 'Unexpected file type')
}
function persist(file, value) {
  const temp = `${file}.${randomUUID()}.tmp`
  const descriptor = fs.openSync(temp, 'wx', 0o600)
  try { fs.writeFileSync(descriptor, JSON.stringify(value)); fs.fsyncSync(descriptor) } finally { fs.closeSync(descriptor) }
  fs.renameSync(temp, file)
  const directory = fs.openSync(path.dirname(file), 'r')
  try { fs.fsyncSync(directory) } finally { fs.closeSync(directory) }
}
function mailbox(value) {
  assert(typeof value === 'string' && !/[\r\n]/.test(value), 'Invalid mailbox')
  const match = value.match(/^(?:[^<>]*<)?([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@elklart\.example\.invalid)>?$/)
  assert(match, 'Only fictional demo mailboxes allowed')
  return { Email: match[1] }
}
function mailboxes(value) { return (Array.isArray(value) ? value : [value]).map(mailbox) }
function payload(body) {
  assert(body && typeof body.subject === 'string' && (typeof body.html === 'string' || typeof body.text === 'string'), 'Missing message')
  assert(!body.scheduled_at && !body.template, 'Scheduling/templates are unsupported')
  const Attachments = (body.attachments || []).map(attachment => {
    assert(!attachment.path && typeof attachment.filename === 'string' && !/[\r\n/\\]/.test(attachment.filename), 'Unsafe attachment')
    assert(typeof attachment.content === 'string' && /^[A-Za-z0-9+/]*={0,2}$/.test(attachment.content), 'Base64 attachment required')
    return { Filename: attachment.filename, Content: attachment.content, ContentType: attachment.content_type }
  })
  assert(!body.headers || Object.keys(body.headers).every(key => /^x-[a-z0-9-]+$/i.test(key) && typeof body.headers[key] === 'string' && !/[\r\n]/.test(body.headers[key])), 'Unsafe custom headers')
  const To = mailboxes(body.to)
  assert(To.length > 0, 'Recipient required')
  return { From: mailbox(body.from), To, Subject: body.subject, HTML: body.html, Text: body.text,
    ...(body.cc ? { Cc: mailboxes(body.cc) } : {}),
    ...(body.bcc ? { Bcc: mailboxes(body.bcc).map(item => item.Email) } : {}),
    ...(body.reply_to ? { ReplyTo: mailboxes(body.reply_to) } : {}),
    Attachments, Headers: body.headers, Tags: ['elklart-simulated-resend'] }
}
function domain(verified) {
  const status = verified ? 'verified' : 'pending'
  return { id: DOMAIN_ID, name: DOMAIN, status, region: 'eu-west-1', created_at: '2026-11-10T00:00:00Z',
    simulation: 'LOCAL SIMULATION: no public DNS has been queried or certified', records: [
      { record: 'DKIM', type: 'TXT', name: `demo._domainkey.${DOMAIN}`, value: 'v=DKIM1; k=rsa; p=SIMULATED_NOT_A_PUBLIC_KEY', status },
      { record: 'SPF', type: 'TXT', name: `send.${DOMAIN}`, value: 'v=spf1 include:amazonses.com ~all', status },
      { record: 'MX', type: 'MX', name: `send.${DOMAIN}`, value: `mail.${DOMAIN}`, priority: 10, status },
      { record: 'DMARC', type: 'TXT', name: `_dmarc.${DOMAIN}`, value: 'v=DMARC1; p=reject;', status },
    ] }
}
export function createProvider({ stateDir, apiKey, mailpitURL = 'http://127.0.0.1:54324/api/v1/send', persistState = persist }) {
  assert(typeof apiKey === 'string' && apiKey.length >= 32 && /^[A-Za-z0-9_-]+$/.test(apiKey), 'Private random API key required')
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 }); privatePath(stateDir, true)
  const lock = path.join(stateDir, '.writer-lock')
  fs.mkdirSync(lock, { mode: 0o700 }) // Never steal a stale lock: operator must reconcile it.
  const file = path.join(stateDir, 'state.json')
  let state = { domain: false, verified: false, sends: {} }
  if (fs.existsSync(file)) { privatePath(file); state = JSON.parse(fs.readFileSync(file, 'utf8')) }
  let queue = Promise.resolve()
  const update = next => { persistState(file, next); state = next }
  const processRequest = async (request, response) => {
    const reply = (status, data) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(data)) }
    const failure = (status, message) => reply(status, { statusCode: status, name: 'validation_error', message })
    const supplied = Buffer.from(request.headers.authorization || '')
    const expected = Buffer.from(`Bearer ${apiKey}`)
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return failure(401, 'Unauthorized')
    try {
      let raw = ''
      for await (const chunk of request) { raw += chunk; assert(Buffer.byteLength(raw) <= 1024 * 1024, 'Request too large') }
      const body = raw ? JSON.parse(raw) : {}
      const route = request.url.split('?')[0]
      if (route === '/domains' && request.method === 'GET') return reply(200, { object: 'list', has_more: false, data: state.domain ? [domain(state.verified)] : [] })
      if (route === '/domains' && request.method === 'POST') {
        if (body.name !== DOMAIN) return failure(422, 'Only the fictional demo domain is supported')
        update({ ...state, domain: true }); return reply(200, domain(state.verified))
      }
      if (route === `/domains/${DOMAIN_ID}` && request.method === 'GET' && state.domain) return reply(200, domain(state.verified))
      if (route === `/domains/${DOMAIN_ID}/verify` && request.method === 'POST' && state.domain) {
        update({ ...state, verified: true }); return reply(200, { object: 'domain', id: DOMAIN_ID })
      }
      if (route !== '/emails' || request.method !== 'POST') return failure(404, 'Unknown demo endpoint')
      if (!state.verified) return failure(403, 'Simulated domain verification required')
      let message
      try { message = payload(body) } catch { return failure(422, 'Invalid message or non-fictional mailbox') }
      const key = request.headers['idempotency-key']
      if (typeof key !== 'string' || key.length < 1 || key.length > 256) return failure(422, 'Idempotency-Key required')
      const index = hash(key), fingerprint = hash(JSON.stringify(body)), existing = state.sends[index]
      if (existing) {
        if (existing.fingerprint !== fingerprint) return failure(409, 'Idempotency payload conflict')
        if (existing.status !== 'sent') return failure(409, 'Delivery ambiguous; reconcile Mailpit before any retry')
        return reply(200, { id: existing.id })
      }
      const id = randomUUID()
      update({ ...state, sends: { ...state.sends, [index]: { fingerprint, id, status: 'pending' } } })
      // Persist intent BEFORE physical delivery; any ambiguous failure remains pending forever.
      const delivered = await fetch(mailpitURL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(message), signal: AbortSignal.timeout(10000), redirect: 'error' })
      assert(delivered.ok, 'Local delivery failed')
      const receipt = await delivered.json()
      assert(typeof receipt.ID === 'string' && receipt.ID.length > 0, 'Missing local receipt')
      update({ ...state, sends: { ...state.sends, [index]: { fingerprint, id, status: 'sent', mailpitId: receipt.ID } } })
      return reply(200, { id })
    } catch { return failure(503, 'Local boundary failed; pending deliveries require reconciliation') }
  }
  return { handler(request, response) { queue = queue.then(() => processRequest(request, response)).catch(() => { response.destroy() }) },
    close() { fs.rmdirSync(lock) } }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    privatePath(ROOT, true)
    const keyFile = `${ROOT}/provider-mail/api-key`
    privatePath(keyFile)
    const key = fs.readFileSync(keyFile, 'utf8').trim()
    for (const name of ['server-key.pem', 'server.pem']) privatePath(`${ROOT}/tls/${name}`)
    const provider = createProvider({ stateDir: `${ROOT}/provider-mail`, apiKey: key })
    const server = https.createServer({ key: fs.readFileSync(`${ROOT}/tls/server-key.pem`), cert: fs.readFileSync(`${ROOT}/tls/server.pem`) }, provider.handler)
    server.listen(38481, '127.0.0.1', () => console.log('Elklart local simulated Resend boundary listening on 127.0.0.1:38481'))
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { provider.close(); process.exit(0) }))
  } catch { console.error('Local email boundary refused startup; inspect private configuration and writer lock'); process.exitCode = 1 }
}
