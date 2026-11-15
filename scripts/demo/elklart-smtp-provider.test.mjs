import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { createSmtpProvider, assertLocalDockerEnvironment, ownedMailpitRelay } from './elklart-smtp-provider.mjs'
const require = createRequire(import.meta.url)
const { SMTPServer } = require('/workspace/elklart-runtime/smtp-deps/node_modules/smtp-server')
const nodemailer = require('nodemailer')
const tlsRoot = '/workspace/elklart-runtime/tls'
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const close = server => new Promise(resolve => server.close(resolve))

test('Docker overrides fail before subprocess launch or remote contact', () => {
  for (const override of [{ DOCKER_HOST: 'tcp://192.0.2.1:2375' }, { DOCKER_CONTEXT: 'remote' }, { DOCKER_HOST: '' }, { DOCKER_CONTEXT: '' }]) {
    assert.throws(() => assertLocalDockerEnvironment(override), /overrides refused/)
    const env = { ...process.env }
    delete env.DOCKER_HOST; delete env.DOCKER_CONTEXT
    Object.assign(env, override)
    // No Docker binary is available through PATH. A remote inspection attempt
    // would fail ENOENT, rather than the required environment guard.
    env.PATH = '/nonexistent-elklart-docker-path'
    const result = spawnSync(process.execPath, [new URL('./elklart-smtp-provider.mjs', import.meta.url).pathname, '--start'], { env, encoding: 'utf8', timeout: 5000 })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Docker host\/context overrides refused/)
    assert.doesNotMatch(result.stderr, /spawnSync docker|ENOENT/)
  }
  const previous = process.env.DOCKER_HOST
  process.env.DOCKER_HOST = 'tcp://192.0.2.1:2375'
  try { assert.throws(() => ownedMailpitRelay(), /overrides refused/) } finally { if (previous === undefined) delete process.env.DOCKER_HOST; else process.env.DOCKER_HOST = previous }
})

test('real STARTTLS SMTP authentication, fictional envelopes, exact MIME, replay and durable receipts', async () => {
  const captured = []
  const receiver = new SMTPServer({ authOptional: true, disabledCommands: ['AUTH', 'STARTTLS'], onData(stream, session, done) {
    const chunks = []; stream.on('data', item => chunks.push(item)); stream.on('end', () => { captured.push(Buffer.concat(chunks)); done() })
  } })
  await listen(receiver)
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'elklart-smtp-'))
  const user = 'ediel@elklart.example.invalid', password = 'p'.repeat(48)
  let unavailable = false
  const sink = createSmtpProvider({ user, password, directory, key: fs.readFileSync(tlsRoot + '/server-key.pem'), cert: fs.readFileSync(tlsRoot + '/server.pem'), relayResolver() { if (unavailable) throw new Error('Unavailable relay'); return { host: '127.0.0.1', port: receiver.server.address().port } } })
  await listen(sink)
  const options = { host: '127.0.0.1', port: sink.server.address().port, secure: false, requireTLS: true, auth: { user, pass: password }, tls: { rejectUnauthorized: true, ca: fs.readFileSync(tlsRoot + '/ca.pem'), minVersion: 'TLSv1.2' } }
  const raw = Buffer.from('From: ediel@elklart.example.invalid\r\nTo: grid-owner@elklart.example.invalid\r\nMessage-ID: <test@elklart.example.invalid>\r\nSubject: Local EDIEL fixture\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=demo\r\n\r\n--demo\r\nContent-Type: text/plain\r\n\r\n.local test\r\n--demo\r\nContent-Type: application/EDIFACT\r\nContent-Disposition: attachment; filename="fixture.edi"\r\n\r\nUNB+TEST\r\n--demo--\r\n')
  const envelope = { from: user, to: ['grid-owner@elklart.example.invalid'] }
  const send = (settings = {}, env = envelope, message = raw) => nodemailer.createTransport({ ...options, ...settings }).sendMail({ envelope: env, raw: message })
  try {
    await assert.rejects(send({ auth: { user, pass: 'wrong-password' } }), /535/)
    await assert.rejects(send({ ignoreTLS: true, requireTLS: false }), /TLS|538|530|Authentication/i)
    await assert.rejects(send({}, { ...envelope, to: ['external@example.com'] }), /553/)
    await assert.rejects(send({}, { ...envelope, from: 'external@example.com' }), /553/)
    const result = await send()
    assert.equal(result.accepted.length, 1)
    assert.deepEqual(captured, [raw])
    await send()
    assert.equal(captured.length, 1)
    const files = fs.readdirSync(directory).filter(file => file.endsWith('.json'))
    assert.equal(files.length, 1)
    const saved = JSON.parse(fs.readFileSync(path.join(directory, files[0]), 'utf8'))
    assert.equal(saved.status, 'sent')
    assert.deepEqual(Buffer.from(saved.rawBase64, 'base64'), raw)
    assert.equal(fs.statSync(path.join(directory, files[0])).mode & 0o777, 0o600)
    unavailable = true
    await assert.rejects(send({}, envelope, Buffer.from(raw.toString().replace('Local EDIEL fixture', 'Local failure'))), /451/)
    assert.equal(captured.length, 1)
  } finally { await close(sink); await close(receiver); fs.rmSync(directory, { recursive: true, force: true }) }
})
