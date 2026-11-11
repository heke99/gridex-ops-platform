/** Private, reproducible local OPS development launcher; no shell/env-file evaluation. */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
const script = fileURLToPath(import.meta.url)
const repository = path.resolve(path.dirname(script), '../..')
const root = '/workspace/elklart-runtime'
const runtime = `${root}/ops`
const tls = `${root}/tls`
const pidPath = `${runtime}/app.pid`
function assert(ok, message) { if (!ok) throw Error(message) }
function privatePath(file, directory = false) {
  for (let current = file; current !== path.dirname(current); current = path.dirname(current)) assert(!fs.lstatSync(current).isSymbolicLink(), 'Symlink path refused')
  const info = fs.lstatSync(file)
  assert(info.uid === process.getuid() && !(info.mode & 0o7077) && (directory ? info.isDirectory() : info.isFile()), 'Private owned runtime file required')
}
export function parsePrivateEnvironment(text) {
  const env = Object.create(null)
  for (const line of text.split('\n').filter(Boolean)) {
    const split = line.indexOf('='); const key = line.slice(0, split)
    assert(split > 0 && /^[A-Z][A-Z0-9_]*$/.test(key) && !(key in env), 'Invalid/duplicate environment key')
    const value = JSON.parse(line.slice(split + 1))
    assert(typeof value === 'string' && !value.includes('\0'), 'Environment values must be strings')
    env[key] = value
  }
  return env
}
export function validateEnvironment(env) {
  assert(env.NODE_ENV === 'development' && env.ELKLART_DEMO_ENABLED === 'true', 'Demo environment required')
  assert(env.NEXT_PUBLIC_SUPABASE_URL === 'http://localhost:54321' && env.SUPABASE_URL === 'http://localhost:54321', 'Dedicated local OPS Supabase required')
  assert(env.NEXT_PUBLIC_APP_URL === 'https://localhost:3000' && env.APP_URL === 'https://localhost:3000' && env.ELKLART_DEMO_PORTAL_ORIGIN === 'https://localhost:3001', 'Local HTTPS origins required')
  assert(env.NODE_EXTRA_CA_CERTS === `${tls}/ca.pem` && env.NODE_TLS_REJECT_UNAUTHORIZED !== '0' && !env.VERCEL_ENV, 'Local CA verification required')
  assert(!env.CAPWAY_APTIC_TEST_BASE_URL || env.CAPWAY_APTIC_TEST_BASE_URL === 'http://127.0.0.1:38480', 'Only local invoice provider boundary allowed')
  assert(!env.RESEND_BASE_URL || env.RESEND_BASE_URL === 'https://localhost:38481', 'Only local email boundary allowed')
  assert(env.EDIEL_EMAIL_PROVIDER === 'strato' && env.EDIEL_SMTP_HOST === '127.0.0.1' && env.EDIEL_SMTP_PORT === '38482' && env.EDIEL_SMTP_SECURE === 'false', 'Only local STARTTLS SMTP boundary allowed')
  const fictional = value => typeof value === 'string' && /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@elklart\.example\.invalid$/.test(value)
  assert(fictional(env.EDIEL_SMTP_USER) && fictional(env.EDIEL_SMTP_FROM) && (!env.EDIEL_SMTP_REPLY_TO || fictional(env.EDIEL_SMTP_REPLY_TO)), 'Only fictional SMTP identities allowed')
  assert(typeof env.EDIEL_SMTP_PASS === 'string' && env.EDIEL_SMTP_PASS.length >= 32, 'Private local SMTP credentials required')
  assert(!env.NODE_OPTIONS || /^--max-old-space-size=\d+$/.test(env.NODE_OPTIONS), 'Unsafe Node options')
}
function environment() {
  privatePath(root, true); privatePath(runtime, true); privatePath(`${runtime}/app.env`)
  for (const name of ['ca.pem', 'server.pem', 'server-key.pem']) privatePath(`${tls}/${name}`)
  const configured = parsePrivateEnvironment(fs.readFileSync(`${runtime}/app.env`, 'utf8')); validateEnvironment(configured)
  // Do not inherit provider/project credentials or Node injection flags from the shell.
  return { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'C.UTF-8', ...configured, NEXT_TELEMETRY_DISABLED: '1' }
}
function identity(pid) {
  const raw = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); const fields = raw.slice(raw.lastIndexOf(')') + 2).split(' ')
  return { group: Number(fields[2]), session: Number(fields[3]), started: fields[19], state: fields[0] }
}
export function isOwnedCommand(command, executable) {
  const args = command.split('\0').filter(Boolean)
  return args.length === 3 && args[0] === executable && args[1] === script && args[2] === 'serve'
}
async function start() {
  const env = environment()
  const descriptor = fs.openSync(pidPath, 'wx', 0o600)
  let log, child
  try {
    log = fs.openSync(`${runtime}/app.log`, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW, 0o600)
    assert(fs.fstatSync(log).isFile() && fs.fstatSync(log).uid === process.getuid(), 'Private owned log required'); fs.fchmodSync(log, 0o600)
    child = spawn(process.execPath, [script, 'serve'], { cwd: repository, env, detached: true, stdio: ['ignore', log, log] })
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
    const record = { pid: child.pid, executable: process.execPath, ...identity(child.pid) }
    assert(record.group === record.pid && record.session === record.pid, 'Dedicated process group required')
    fs.writeFileSync(descriptor, JSON.stringify(record)); fs.fsyncSync(descriptor); child.unref()
  } catch (error) { if (child?.pid) child.kill('SIGTERM'); fs.unlinkSync(pidPath); throw error }
  finally { fs.closeSync(descriptor); if (log !== undefined) fs.closeSync(log) }
  console.log('Dedicated OPS process started; private PID/log saved. Verify HTTPS readiness separately.')
}
function liveGroupMembers(group) {
  const members = []
  for (const name of fs.readdirSync('/proc').filter(name => /^\d+$/.test(name))) {
    try {
      const info = identity(Number(name))
      if (info.group === group && info.state !== 'Z' && info.state !== 'X') {
        assert(fs.statSync(`/proc/${name}`).uid === process.getuid(), 'Foreign process in recorded group')
        members.push(Number(name))
      }
    } catch (error) { if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error }
  }
  return members
}
async function stop() {
  privatePath(root, true); privatePath(runtime, true); privatePath(pidPath)
  const record = JSON.parse(fs.readFileSync(pidPath, 'utf8'))
  assert(Number.isSafeInteger(record.pid) && record.pid > 1, 'Invalid PID')
  let current, command
  try {
    current = identity(record.pid)
    command = fs.readFileSync(`/proc/${record.pid}/cmdline`, 'utf8')
  } catch (error) { if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error }
  if (current) {
    assert(current.started === record.started && current.group === record.pid && current.session === record.pid, 'PID/group ownership mismatch')
    if (current.state !== 'Z' && current.state !== 'X') {
      assert(isOwnedCommand(command, record.executable), 'Live PID command ownership mismatch')
      process.kill(-record.pid, 'SIGTERM')
    }
  }
  // Exited/adopted zombies cannot serve traffic and need no signal. Never signal a
  // group solely because a stale PID file or an empty zombie cmdline exists.
  for (let attempt = 0; attempt < 100; attempt++) {
    if (liveGroupMembers(record.pid).length === 0) {
      fs.unlinkSync(pidPath); console.log('Dedicated OPS process stopped.'); return
    }
    if (attempt === 99) throw Error('Recorded group has live members; PID retained for inspection')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}

async function serve() {
  const env = environment()
  const child = spawn(process.execPath, [`${repository}/node_modules/next/dist/bin/next`, 'dev', '--hostname', '127.0.0.1', '--port', '3000', '--experimental-https', '--experimental-https-key', `${tls}/server-key.pem`, '--experimental-https-cert', `${tls}/server.pem`, '--experimental-https-ca', `${tls}/ca.pem`], { cwd: repository, env, stdio: 'inherit' })
  // Group SIGTERM reaches Next too; keep supervisor alive until its child exits.
  process.on('SIGTERM', () => {}); process.on('SIGINT', () => {})
  child.once('error', () => { process.exitCode = 1 }); child.once('exit', code => { process.exitCode = code || 0 })
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) Promise.resolve().then(async () => {
  assert(Number(process.versions.node.split('.')[0]) === 22, 'Use Node22 for dedicated OPS runtime')
  if (process.argv[2] === 'start') return start()
  if (process.argv[2] === 'stop') return stop()
  if (process.argv[2] === 'serve') return serve()
  throw Error('Usage: node scripts/demo/elklart-ops-app.mjs start|stop')
}).catch(() => { console.error('OPS launcher refused or failed; inspect private runtime configuration and process ownership'); process.exitCode = 1 })
