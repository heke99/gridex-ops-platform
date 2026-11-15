/** Local boundary supervisors; private process metadata is outside snapshot trees. */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
const script = fileURLToPath(import.meta.url)
const repository = path.resolve(path.dirname(script), '../..')
const ROOT = '/workspace/elklart-runtime'
const targets = { capway: 'elklart-capway-provider.mjs', resend: 'elklart-resend-provider.mjs' }
const assert = (ok, message) => { if (!ok) throw Error(message) }
export function privateOwned(file, directory = false) {
  for (let current = file; current !== path.dirname(current); current = path.dirname(current)) assert(!fs.lstatSync(current).isSymbolicLink(), 'Symlink refused')
  const stat = fs.statSync(file)
  assert(stat.uid === process.getuid() && !(stat.mode & 0o7077) && (directory ? stat.isDirectory() : stat.isFile()), 'Private ownership/type required')
}
export function parseIdentity(stat) {
  const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
  return { state: fields[0], group: Number(fields[2]), session: Number(fields[3]), started: fields[19] }
}
const identity = pid => parseIdentity(fs.readFileSync(`/proc/${pid}/stat`, 'utf8'))
export function ownsCommand(command, executable, name) {
  return command.split('\0').filter(Boolean).join('\0') === [executable, script, 'serve', name].join('\0')
}
export function validateCapwaySecrets(secrets) {
  for (const key of ['ELKLART_CAPWAY_API_KEY', 'ELKLART_CAPWAY_WEBHOOK_SECRET']) assert(typeof secrets[key] === 'string' && secrets[key].length >= 32, 'Private Capway credentials missing')
  return { ELKLART_CAPWAY_API_KEY: secrets.ELKLART_CAPWAY_API_KEY, ELKLART_CAPWAY_WEBHOOK_SECRET: secrets.ELKLART_CAPWAY_WEBHOOK_SECRET, ELKLART_CAPWAY_ENVIRONMENT: 'test' }
}
function environment(name) {
  privateOwned(ROOT, true)
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'C.UTF-8', NODE_EXTRA_CA_CERTS: `${ROOT}/tls/ca.pem` }
  privateOwned(`${ROOT}/tls/ca.pem`)
  if (name === 'capway') {
    const source = `${ROOT}/ops/app-secrets.json`; privateOwned(source)
    Object.assign(env, validateCapwaySecrets(JSON.parse(fs.readFileSync(source, 'utf8'))))
  } else {
    privateOwned(`${ROOT}/provider-mail/api-key`)
    assert(/^[A-Za-z0-9_-]{32,}$/.test(fs.readFileSync(`${ROOT}/provider-mail/api-key`, 'utf8').trim()), 'Private Resend API key invalid')
    for (const filename of ['server-key.pem', 'server.pem']) privateOwned(`${ROOT}/tls/${filename}`)
  }
  return env
}
const recordFile = name => `${ROOT}/boundary-processes-${name}.json`
function liveMembers(group) {
  let count = 0
  for (const pid of fs.readdirSync('/proc').filter(name => /^\d+$/.test(name))) {
    try {
      const info = identity(pid)
      if (info.group === group && !['Z', 'X'].includes(info.state)) {
        assert(fs.statSync(`/proc/${pid}`).uid === process.getuid(), 'Foreign group process')
        count++
      }
    } catch (error) { if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error }
  }
  return count
}
async function start(name) {
  const env = environment(name), target = recordFile(name)
  const recordHandle = fs.openSync(target, 'wx', 0o600)
  let log, child
  try {
    log = fs.openSync(`${ROOT}/boundary-${name}.log`, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW, 0o600)
    assert(fs.fstatSync(log).isFile() && fs.fstatSync(log).uid === process.getuid(), 'Unsafe boundary log'); fs.fchmodSync(log, 0o600)
    child = spawn(process.execPath, [script, 'serve', name], { cwd: repository, env, detached: true, stdio: ['ignore', log, log] })
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
    const record = { pid: child.pid, executable: process.execPath, ...identity(child.pid) }
    assert(record.group === record.pid && record.session === record.pid, 'Dedicated session required')
    fs.writeFileSync(recordHandle, JSON.stringify(record)); fs.fsyncSync(recordHandle); child.unref()
  } catch (error) { if (child?.pid) child.kill('SIGTERM'); fs.unlinkSync(target); throw error }
  finally { fs.closeSync(recordHandle); if (log !== undefined) fs.closeSync(log) }
  console.log(`Dedicated ${name} supervisor started; verify readiness separately.`)
}
async function stop(name) {
  privateOwned(ROOT, true); privateOwned(recordFile(name))
  const record = JSON.parse(fs.readFileSync(recordFile(name), 'utf8'))
  assert(Number.isSafeInteger(record.pid) && record.pid > 1, 'Invalid supervisor PID')
  let current
  try { current = identity(record.pid) } catch (error) { if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error }
  if (current) {
    assert(current.started === record.started && current.group === record.pid && current.session === record.pid, 'Supervisor identity mismatch')
    if (!['Z', 'X'].includes(current.state)) {
      assert(ownsCommand(fs.readFileSync(`/proc/${record.pid}/cmdline`, 'utf8'), record.executable, name), 'Supervisor command mismatch')
      process.kill(-record.pid, 'SIGTERM')
    }
  }
  for (let attempt = 0; attempt < 200; attempt++) {
    if (!liveMembers(record.pid)) { fs.unlinkSync(recordFile(name)); console.log(`Dedicated ${name} supervisor stopped.`); return }
    if (attempt === 199) throw Error('Live group members remain; process metadata retained')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}
async function serve(name) {
  const child = spawn(process.execPath, [path.join(path.dirname(script), targets[name])], { cwd: repository, env: environment(name), stdio: 'inherit' })
  process.on('SIGTERM', () => {}); process.on('SIGINT', () => {})
  child.once('error', () => { process.exitCode = 1 }); child.once('exit', code => { process.exitCode = code || 0 })
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) Promise.resolve().then(() => {
  const [action, name] = process.argv.slice(2)
  assert(Object.hasOwn(targets, name), 'Expected capway or resend')
  if (action === 'start') return start(name)
  if (action === 'stop') return stop(name)
  if (action === 'serve') return serve(name)
  throw Error('Expected start|stop capway|resend')
}).catch(() => { console.error('Boundary supervisor refused or failed; inspect private configuration and process ownership'); process.exitCode = 1 })
