/** Local STARTTLS SMTP boundary; only fictional mail, only owned Mailpit relay. */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
const require = createRequire(import.meta.url)
const { SMTPServer } = require('/workspace/elklart-runtime/smtp-deps/node_modules/smtp-server')
const nodemailer = require('nodemailer')
const ROOT = '/workspace/elklart-runtime'
const fictional = address => typeof address === 'string' && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@elklart\.example\.invalid$/i.test(address)
function error(message, responseCode = 451) { return Object.assign(new Error(message), { responseCode }) }
function same(left, right) { const a = Buffer.from(left), b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b) }
export function assertLocalDockerEnvironment(environment = process.env) {
  if (environment.DOCKER_HOST !== undefined || environment.DOCKER_CONTEXT !== undefined) throw error('Docker host/context overrides refused')
}
function localDocker(args) {
  assertLocalDockerEnvironment()
  return execFileSync('docker', ['--host', 'unix:///var/run/docker.sock', ...args], { encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024 })
}
function durable(file, value) {
  const temporary = file + '.' + randomUUID() + '.tmp'
  const fd = fs.openSync(temporary, 'wx', 0o600)
  try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  fs.renameSync(temporary, file)
  const directory = fs.openSync(path.dirname(file), 'r')
  try { fs.fsyncSync(directory) } finally { fs.closeSync(directory) }
}
export function ownedMailpitRelay() {
  assertLocalDockerEnvironment()
  const [container] = JSON.parse(localDocker(['inspect', 'supabase_inbucket_elklart-ops-demo']))
  const network = container.NetworkSettings.Networks['elklart-ops-demo']
  if (container.Name !== '/supabase_inbucket_elklart-ops-demo' || !container.State.Running || container.Config.Labels['com.supabase.cli.project'] !== 'elklart-ops-demo' || container.Config.Labels['com.docker.compose.project'] !== 'elklart-ops-demo' || container.Config.Labels['org.opencontainers.image.title'] !== 'Mailpit' || !network?.NetworkID || !/^172\.18\.0\.[0-9]+$/.test(network.IPAddress)) throw error('Owned demo Mailpit could not be verified')
  const [actualNetwork] = JSON.parse(localDocker(['network', 'inspect', network.NetworkID]))
  if (actualNetwork.Name !== 'elklart-ops-demo' || !actualNetwork.Containers?.[container.Id]) throw error('Demo Mailpit network membership mismatch')
  if ((container.Config.Env ?? []).some(value => /^(MP_SMTP_RELAY_ALL|MP_SMTP_FORWARD_CONFIG)=/.test(value) && !/=(?:false|0)?$/i.test(value))) throw error('Mailpit forwarding configuration refused')
  return { host: network.IPAddress, port: 1025 }
}
export function createSmtpProvider({ user, password, directory, key, cert, relayResolver = ownedMailpitRelay }) {
  if (!fictional(user) || typeof password !== 'string' || password.length < 32) throw error('Private fictional SMTP credentials required')
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  for (let current = path.resolve(directory); current !== path.dirname(current); current = path.dirname(current)) if (fs.lstatSync(current).isSymbolicLink()) throw error('Symlinks refused')
  const stat = fs.statSync(directory)
  if (stat.uid !== process.getuid() || (stat.mode & 0o7077)) throw error('Private state directory required')
  const lock = path.join(directory, '.writer-lock')
  fs.mkdirSync(lock, { mode: 0o700 })
  let queue = Promise.resolve()
  const server = new SMTPServer({ name: 'elklart-local-smtp', secure: false, key, cert, minVersion: 'TLSv1.2', authOptional: false, allowInsecureAuth: false, authMethods: ['PLAIN', 'LOGIN'], size: 8 * 1024 * 1024, disabledCommands: ['VRFY', 'EXPN'],
    onAuth(auth, session, done) {
      if (!session.secure || !same(String(auth.username), user) || !same(String(auth.password), password)) return done(error('Authentication failed', 535))
      done(null, { user })
    },
    onMailFrom(address, session, done) { done(session.secure && fictional(address.address) ? null : error('Fictional sender and TLS required', 553)) },
    onRcptTo(address, session, done) { done(fictional(address.address) && session.envelope.rcptTo.length < 10 ? null : error('Fictional demo recipients only', 553)) },
    onData(stream, session, done) {
      const chunks = []; let size = 0
      stream.on('data', chunk => { size += chunk.length; if (size <= 8 * 1024 * 1024) chunks.push(chunk) })
      stream.on('error', () => done(error('SMTP input interrupted')))
      stream.on('end', () => {
        const raw = Buffer.concat(chunks)
        const envelope = { from: session.envelope.mailFrom.address, to: session.envelope.rcptTo.map(item => item.address) }
        const deliver = async () => {
          if (stream.sizeExceeded || size > 8 * 1024 * 1024) throw error('Message too large', 552)
          const id = createHash('sha256').update(JSON.stringify(envelope)).update(raw).digest('hex')
          const file = path.join(directory, id + '.json')
          if (fs.existsSync(file)) {
            if (fs.lstatSync(file).isSymbolicLink()) throw error('Unsafe receipt')
            const receipt = JSON.parse(fs.readFileSync(file, 'utf8'))
            if (receipt.status !== 'sent') throw error('Delivery ambiguous; reconcile private receipt before retry')
            return id
          }
          // Verify the target afresh for every send; never relay via arbitrary DNS.
          const target = relayResolver()
          const receipt = { id, status: 'pending', envelope, rawSha256: createHash('sha256').update(raw).digest('hex'), rawBase64: raw.toString('base64'), acceptedAt: new Date().toISOString(), relay: target }
          durable(file, receipt)
          const transport = nodemailer.createTransport({ ...target, secure: false, ignoreTLS: true, connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 10000 })
          try {
            const result = await transport.sendMail({ envelope, raw })
            if (result.rejected?.length || result.accepted?.length !== envelope.to.length) throw error('Mailpit did not accept all recipients')
            durable(file, { ...receipt, status: 'sent', response: result.response, accepted: result.accepted, sentAt: new Date().toISOString() })
          } finally { transport.close() }
          return id
        }
        const operation = queue.then(deliver)
        queue = operation.catch(() => {})
        operation.then(id => done(null, 'Elklart local receipt ' + id), () => done(error('Local sink failed or ambiguous; reconcile private receipt')))
      })
    },
  })
  server.on('close', () => { try { fs.rmdirSync(lock) } catch {} })
  return server
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  // Reject ambient remote Docker selection before credentials, subprocesses,
  // process control, inspection or any network activity.
  assertLocalDockerEnvironment()
  const directory = ROOT + '/provider-smtp'
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const script = path.resolve(process.argv[1])
  const pidFile = directory + '/supervisor.json'
  const processIdentity = pid => {
    const command = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0')
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8')
    if (command[1] !== script || command[2] !== '--serve') throw error('Process ownership mismatch')
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]
  }
  const ownedProcess = () => {
    const record = JSON.parse(fs.readFileSync(pidFile, 'utf8'))
    if (!Number.isSafeInteger(record.pid) || record.pid <= 1 || record.identity !== processIdentity(record.pid)) throw error('Supervisor identity mismatch')
    return record.pid
  }
  if (['--start', '--stop', '--status'].includes(process.argv[2])) {
    const command = process.argv[2]
    if (command === '--status' || command === '--stop') {
      const pid = ownedProcess()
      if (command === '--stop') {
        process.kill(pid, 'SIGTERM')
        for (let attempt = 0; attempt < 200 && fs.existsSync(pidFile); attempt++) await new Promise(resolve => setTimeout(resolve, 25))
        if (fs.existsSync(pidFile)) throw error('Owned SMTP sink did not finish stopping; no forced kill performed')
        process.stdout.write('Owned Elklart SMTP sink stopped\n')
      }
      else process.stdout.write(`Owned Elklart SMTP sink running (pid ${pid})\n`)
    } else {
      if (fs.existsSync(pidFile)) {
        try { ownedProcess(); throw error('Owned SMTP sink already running') } catch (failure) { if (failure.code !== 'ENOENT') throw failure }
        fs.unlinkSync(pidFile)
      }
      const log = fs.openSync(directory + '/supervisor.log', 'a', 0o600)
      const child = spawn(process.execPath, [script, '--serve'], { detached: true, stdio: ['ignore', log, log] })
      fs.closeSync(log)
      child.unref()
      let identity
      for (let attempt = 0; attempt < 20; attempt++) {
        try { identity = processIdentity(child.pid); break } catch {}
        await new Promise(resolve => setTimeout(resolve, 25))
      }
      if (!identity) throw error('SMTP supervisor did not start')
      durable(pidFile, { pid: child.pid, identity })
      await new Promise(resolve => setTimeout(resolve, 500))
      ownedProcess()
      process.stdout.write(`Detached Elklart SMTP sink started (pid ${child.pid})\n`)
    }
    process.exit(0)
  }
  const credentialsFile = directory + '/credentials.json'
  if (!fs.existsSync(credentialsFile)) durable(credentialsFile, { user: 'ediel@elklart.example.invalid', password: randomBytes(32).toString('base64url') })
  const credentialStat = fs.lstatSync(credentialsFile)
  if (!credentialStat.isFile() || credentialStat.isSymbolicLink() || credentialStat.uid !== process.getuid() || (credentialStat.mode & 0o7077)) throw error('Private credential file required')
  const { user, password } = JSON.parse(fs.readFileSync(credentialsFile, 'utf8'))
  ownedMailpitRelay()
  const server = createSmtpProvider({ user, password, directory, key: fs.readFileSync(ROOT + '/tls/server-key.pem'), cert: fs.readFileSync(ROOT + '/tls/server.pem') })
  server.listen(38482, '127.0.0.1', () => process.stdout.write('Elklart STARTTLS sink listening on 127.0.0.1:38482; private credentials in provider-smtp/credentials.json\n'))
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => {
    try { if (ownedProcess() === process.pid) fs.unlinkSync(pidFile) } catch {}
    process.exit(0)
  }))
}
