// T6's own source-bound prepare producer. Allocation is authenticated, never acquired here.
import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { closeSync, constants, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, statSync, statfsSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { hostname } from 'node:os'
import { fileURLToPath } from 'node:url'

const moduleFile = fileURLToPath(import.meta.url)
const track = resolve(dirname(moduleFile), '..')
const checkout = resolve(track, '../../..')
const actions = ['prepare', 'replay', 'build', 'up', 'run', 'down', 'cleanup']
const fail = reason => { throw new Error(`BLOCKED: T6 prepare ${reason}`) }
const need = (ok, reason) => { if (!ok) fail(reason) }
const sha = b => createHash('sha256').update(b).digest('hex')
const full = (s, n = 40) => typeof s === 'string' && new RegExp(`^[a-f0-9]{${n}}$`).test(s)
const stable = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v)
const inside = (p, root) => { const r = relative(root, p); return !r || r !== '..' && !r.startsWith('../') && !isAbsolute(r) }
const text = p => readFileSync(p, 'utf8')
const fresh = p => { try { lstatSync(p); return false } catch (e) { if (e.code === 'ENOENT') return true; throw e } }
const localPath = p => typeof p === 'string' && isAbsolute(p) && resolve(p) === p && !p.includes('\0')

export function validateAssignment(a, now = Date.now()) {
  need(a?.schema === 'track6-prepare-assignment-v1' && a.workerId === 'codex-track6' && a.exclusiveHost === true, 'explicit producer assignment required')
  need(typeof a.model === 'string' && a.model.trim() && /^[A-Za-z0-9_-]{1,80}$/.test(a.allocationId)
    && /^t6-[A-Za-z0-9-]+$/.test(a.environmentId), 'invalid producer identity')
  need(full(a.sourceCommit) && full(a.sourceTree), 'full source commit/tree required')
  const dirs = ['appDir', 'replayDir', 'harnessDir', 'simHome'].map(k => a[k])
  need(dirs.every(localPath) && a.appDir !== a.replayDir && !inside(a.appDir, a.replayDir) && !inside(a.replayDir, a.appDir)
    && !inside(a.harnessDir, a.replayDir) && !inside(a.replayDir, a.harnessDir)
    && dirs.slice(0, 3).every(d => !inside(a.simHome, d)), 'canonical separate app/replay and private output paths required')
  const expiry = Date.parse(a.expiresAtUtc)
  need(typeof a.expiresAtUtc === 'string' && /(?:Z|\+00:00)$/.test(a.expiresAtUtc) && expiry > now && expiry - now <= 6 * 3600_000,
    'assignment expiry must be future UTC within six hours')
  need(Array.isArray(a.allowedActions) && stable([...a.allowedActions].sort()) === stable([...actions].sort())
    && stable(a.budget) === stable({ prepare: 1 }), 'explicit complete actions and one preparation budget required')
  for (const kind of ['producer', 'backend']) need(a[kind] && new RegExp(`^refs/tags/agent-claims/masterplan/${kind}-t6-[A-Za-z0-9_-]+$`).test(a[kind].ref)
    && full(a[kind].receipt), `separate ${kind} reservation required`)
  const h = a.hostBinding
  need(h && ['hostname', 'bootId', 'dockerDaemonId'].every(k => typeof h[k] === 'string' && h[k].trim())
    && localPath(h.dockerSocket) && /^[0-9]+$/.test(h.socketDev) && /^[0-9]+$/.test(h.socketIno), 'explicit local host/daemon/socket binding required')
  need(a.ports && Object.keys(a.ports).sort().join(',') === 'api,app,control,db,imapPlain,imapTls,smtp'
    && Object.values(a.ports).every(p => Number.isInteger(p) && p > 0 && p < 65536) && new Set(Object.values(a.ports)).size === 7,
    'seven distinct ports required')
  // Canonical replay currently targets these exact DB/API ports. No config editing or external replay fallback.
  need(a.ports.db === 54322 && a.ports.api === 54321 && /^[A-Za-z0-9_-]+$/.test(a.projectId)
    && ['test', 'production'].includes(a.mode), 'canonical local replay profile required')
  need(/^greenmail\/standalone@sha256:[a-f0-9]{64}$/.test(a.greenmailImage) && full(a.originalsManifestSha256, 64)
    && Array.isArray(a.overlayRefs) && a.overlayRefs.length === 0, 'pinned mail/originals and qualified no-overlay source required')
  return a
}

export function validateAllocation(a, kind, commit) {
  need(['producer', 'backend'].includes(kind) && commit?.sha === a[kind].receipt, 'allocation receipt SHA differs')
  let m
  try { m = JSON.parse(commit.message) } catch { fail('allocation receipt is not a full allocation capsule') }
  // Bind every assignment field, including output home (one-attempt budget),
  // ports, paths, modes and original bytes. Only the two circular receipt SHAs
  // are omitted; their exact ref names remain part of the authenticated payload.
  const payload = { ...a, producer: { ref: a.producer.ref }, backend: { ref: a.backend.ref } }
  const expected = { schema: 'track6-runtime-allocation-v1', kind, assignmentPayloadSha256: sha(stable(payload)) }
  need(stable(m) === stable(expected), 'allocation capsule does not authorize this exact source/host/turn')
}

export function validateCapacity(c) {
  need(c && ['vfs', 'overlay2', 'overlayfs'].includes(c.driver), 'unknown Docker storage driver')
  need(Number.isFinite(c.effectiveMemoryBytes) && c.effectiveMemoryBytes >= 8 * 1024 ** 3, 'less than 8 GiB effective memory')
  need(Number.isFinite(c.availableBytes) && c.availableBytes >= (c.driver === 'vfs' ? 40 : 15) * 1024 ** 3,
    'insufficient free space at actual DockerRootDir')
  return c
}

export function validateOriginalManifest(pointer, manifest, bytesFor) {
  need(pointer?.expectedInboundEml === 28 && typeof pointer.run === 'string' && Array.isArray(manifest?.files), 'original cohort manifest invalid')
  const seen = new Set(), pairs = new Map()
  const files = manifest.files.filter(f => f.run === pointer.run && /^inbound\/e66-[0-9]{3}\.(eml|edi)$/.test(f.relPath))
  for (const f of files) {
    const path = f.published?.path
    need(typeof path === 'string' && path.split('/').every(c => c && c !== '.' && c !== '..') && !isAbsolute(path)
      && !seen.has(f.relPath), 'original path is duplicate or invalid')
    seen.add(f.relPath)
    const b = bytesFor(path)
    need(Buffer.isBuffer(b) && b.length === f.original?.bytes && b.length === f.published?.bytes
      && sha(b) === f.original?.sha256 && sha(b) === f.published?.sha256, 'original bytes/hash differ')
    const key = f.relPath.replace(/\.(eml|edi)$/, '')
    pairs.set(key, (pairs.get(key) ?? 0) | (f.relPath.endsWith('.eml') ? 1 : 2))
  }
  need(files.length === 56 && pairs.size === 28 && [...pairs.values()].every(v => v === 3), '28 complete original EML/EDI pairs required')
  return { pairs: pairs.size, files: files.length }
}

export function validateBackend(a, containers) {
  need(Array.isArray(containers) && containers.length >= 3 && containers.every(c => full(c.Id, 64) && c.State?.Running === true
    && c.Config?.Labels?.['com.supabase.cli.project'] === a.projectId
    && ['db', 'kong', 'auth', 'rest', 'realtime', 'storage', 'pg_meta'].some(service => c.Name === `/supabase_${service}_${a.projectId}`)), 'backend contains unknown, foreign or stopped resources')
  const service = name => {
    const found = containers.filter(c => c.Name === `/supabase_${name}_${a.projectId}`)
    need(found.length === 1, `exact assigned ${name} service missing`)
    return found[0]
  }
  const db = service('db'), api = service('kong'), storage = service('storage')
  for (const name of ['auth', 'rest', 'realtime']) service(name)
  need(new Set([db.Id, api.Id, storage.Id]).size === 3, 'distinct backend services required')
  for (const [c, port, host] of [[db, '5432/tcp', a.ports.db], [api, '8000/tcp', a.ports.api]]) {
    const p = c.NetworkSettings?.Ports?.[port]
    need(Array.isArray(p) && p.length === 1 && p[0].HostIp === '127.0.0.1' && p[0].HostPort === String(host), 'backend is not exactly loopback bound')
  }
  return { db, api, storage }
}

export function publishPrivate(file, value) {
  const fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
  try { writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`) } finally { closeSync(fd) }
}

function processIdentity(pid) {
  try {
    const raw = text(`/proc/${pid}/stat`), f = raw.slice(raw.lastIndexOf(')') + 2).trim().split(/\s+/)
    return { pid, state: f[0], group: Number(f[2]), session: Number(f[3]), ticks: f[19] }
  } catch (e) { if (['ENOENT', 'ESRCH'].includes(e.code)) return null; throw e }
}
const groupMembers = pid => readdirSync('/proc').filter(n => /^[0-9]+$/.test(n)).map(Number)
  .map(processIdentity).filter(p => p && p.group === pid && p.state !== 'Z')

export async function runBounded(command, args, { log, timeoutMs, cwd = undefined, env = process.env, terminateGraceMs = 0 }) {
  need(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 2 * 3600_000, 'finite command deadline required')
  need(Number.isInteger(terminateGraceMs) && terminateGraceMs >= 0 && terminateGraceMs <= 300_000, 'finite termination grace required')
  const fd = openSync(log, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
  try {
    await new Promise((resolveRun, reject) => {
      const child = spawn(command, args, { cwd, env, detached: true, stdio: ['ignore', fd, fd] })
      let timedOut = false, identity, graceTimer
      const sendOwned = signal => {
        const actual = identity && processIdentity(child.pid)
        if (!actual || actual.ticks !== identity.ticks || actual.group !== child.pid || actual.session !== child.pid) {
          child.unref()
          reject(new Error('BLOCKED: T6 prepare child identity is unknown; resources preserved'))
          return false
        }
        try { process.kill(-child.pid, signal); return true } catch (e) { if (e.code !== 'ESRCH') reject(e); return false }
      }
      const terminate = () => {
        if (timedOut) return
        timedOut = true
        if (sendOwned(terminateGraceMs ? 'SIGTERM' : 'SIGKILL') && terminateGraceMs) {
          graceTimer = setTimeout(() => sendOwned('SIGKILL'), terminateGraceMs)
        }
      }
      const timer = setTimeout(terminate, timeoutMs)
      // If this supervisor is itself an owned producer child, propagate TERM to
      // its own detached build child before returning control to shell cleanup.
      process.on('SIGTERM', terminate)
      process.on('SIGINT', terminate)
      const clear = () => { clearTimeout(timer); clearTimeout(graceTimer); process.off('SIGTERM', terminate); process.off('SIGINT', terminate) }
      child.once('spawn', () => { identity = processIdentity(child.pid) })
      child.once('error', () => { clear(); reject(new Error('BLOCKED: T6 prepare command could not start')) })
      child.once('close', (code, signal) => {
        clear()
        if (timedOut || signal || code !== 0 || groupMembers(child.pid).length) reject(new Error('BLOCKED: T6 prepare command incomplete, timed out or left live group members'))
        else resolveRun()
      })
    })
  } finally { closeSync(fd) }
}

function privateFile(p, directory = false) {
  need(localPath(p), 'canonical private path required')
  const s = lstatSync(p)
  need(realpathSync(p) === p && s.uid === process.getuid() && (s.mode & 0o777) === (directory ? 0o700 : 0o600)
    && (directory ? s.isDirectory() : s.isFile()), 'private path owner/type/mode differs')
  return p
}
function call(cmd, args, options = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 30_000, killSignal: 'SIGKILL', maxBuffer: 16_000_000, ...options })
  need(!r.error && !r.signal && r.status === 0, 'read-only tool or identity check failed')
  return Buffer.isBuffer(r.stdout) ? r.stdout : r.stdout.trimEnd()
}
const git = (dir, args) => call('git', ['-C', dir, ...args])
const json = (cmd, args, opts) => JSON.parse(call(cmd, args, opts))
const safeEnvironment = () => Object.fromEntries(['PATH', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'CURL_CA_BUNDLE', 'REQUESTS_CA_BUNDLE'].filter(k => process.env[k]).map(k => [k, process.env[k]]))
function assignment() {
  const file = privateFile(process.env.T6_PREPARE_ASSIGNMENT_FILE)
  const a = validateAssignment(JSON.parse(text(file)))
  need([a.appDir, a.replayDir, a.harnessDir].every(d => !inside(file, d)), 'allocation must remain outside checkouts')
  privateFile(a.simHome, true)
  return { a, assignmentSha256: sha(readFileSync(file)), file }
}
function dockerEnv(a) { return { ...safeEnvironment(), DOCKER_HOST: `unix://${a.hostBinding.dockerSocket}` } }
const docker = (a, args) => call('docker', args, { env: dockerEnv(a) })
function authenticate(a) {
  for (const kind of ['producer', 'backend']) {
    const ref = json('gh', ['api', `repos/heke99/gridex-ops-platform/git/ref/${a[kind].ref.slice(5)}`])
    need(ref.ref === a[kind].ref && ref.object?.type === 'commit' && ref.object.sha === a[kind].receipt, 'current producer/backend custody differs')
    validateAllocation(a, kind, json('gh', ['api', `repos/heke99/gridex-ops-platform/git/commits/${a[kind].receipt}`]))
  }
}
function verifySource(a, withReplay = true) {
  need(a.harnessDir === checkout, 'executing harness path differs')
  for (const d of [...new Set([a.appDir, a.harnessDir, ...(withReplay ? [a.replayDir] : [])])]) {
    need(localPath(d) && realpathSync(d) === d && git(d, ['rev-parse', '--show-toplevel']) === d && git(d, ['rev-parse', 'HEAD']) === a.sourceCommit
      && git(d, ['rev-parse', 'HEAD^{tree}']) === a.sourceTree && !git(d, ['status', '--porcelain', '--untracked-files=normal']), 'source checkout is dirty, rebound or not the assigned commit/tree')
  }
  // Next loads ignored .env files during build/start. Refuse them rather than inheriting provider secrets.
  for (const name of ['.env', '.env.local', '.env.production', '.env.production.local']) need(fresh(join(a.appDir, name)), 'app contains an implicit environment file')
  const cfg = JSON.parse(call('python3', ['-c', 'import json,sys,tomllib;x=tomllib.load(open(sys.argv[1],"rb"));print(json.dumps({"projectId":x["project_id"],"api":x["api"]["port"],"db":x["db"]["port"],"major":x["db"]["major_version"]}))', join(a.appDir, 'supabase/config.toml')]))
  need(cfg.projectId === a.projectId && cfg.api === a.ports.api && cfg.db === a.ports.db && cfg.major === 17
    && readFileSync(join(a.appDir, 'supabase/config.toml')).equals(readFileSync(join(a.replayDir, 'supabase/config.toml'))), 'canonical backend config differs')
}
function host(a, checkCapacity = true) {
  const h = a.hostBinding, socket = statSync(h.dockerSocket)
  need(socket.isSocket() && String(socket.dev) === h.socketDev && String(socket.ino) === h.socketIno
    && realpathSync(h.dockerSocket) === h.dockerSocket && hostname() === h.hostname
    && text('/proc/sys/kernel/random/boot_id').trim() === h.bootId, 'host boot/socket identity differs')
  const info = JSON.parse(docker(a, ['info', '--format', '{{json .}}']))
  need(info.ID === h.dockerDaemonId && localPath(info.DockerRootDir) && realpathSync(info.DockerRootDir) === info.DockerRootDir, 'Docker daemon/root identity differs')
  if (!checkCapacity) return { dockerRootDir: info.DockerRootDir, driver: info.Driver }
  const physical = Number(/^MemTotal:\s+(\d+)\s+kB$/m.exec(text('/proc/meminfo'))?.[1]) * 1024
  const limits = ['/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory/memory.limit_in_bytes'].filter(existsSync)
    .map(p => text(p).trim()).filter(x => x !== 'max').map(Number)
  need(limits.every(n => Number.isFinite(n) && n > 0), 'effective memory limit unknown')
  const disk = statfsSync(info.DockerRootDir)
  const c = validateCapacity({ effectiveMemoryBytes: Math.min(physical, ...limits), availableBytes: disk.bavail * disk.bsize, driver: info.Driver })
  return { ...c, dockerRootDir: info.DockerRootDir, cpuMax: existsSync('/sys/fs/cgroup/cpu.max') ? text('/sys/fs/cgroup/cpu.max').trim() : null }
}
function originals(a) {
  const p = JSON.parse(text(join(a.harnessDir, 'scripts/simulation/track6/fixtures/t3-originals/source.json')))
  need(full(p.commit) && typeof p.dir === 'string' && p.dir.split('/').every(c => c && c !== '.' && c !== '..') && p.manifest === 'manifest.json', 'pinned original pointer invalid')
  const read = path => Buffer.from(call('git', ['-C', a.appDir, 'show', `${p.commit}:${p.dir}/${path}`], { encoding: 'buffer' }))
  const manifest = read(p.manifest)
  need(sha(manifest) === a.originalsManifestSha256, 'original manifest source differs')
  return validateOriginalManifest(p, JSON.parse(manifest.toString()), path => read(path))
}
export function validateToolVersions(v) {
  const python = /^Python ([0-9]+)\.([0-9]+)/.exec(v.python)
  need(/^v22\./.test(v.node) && v.supabase === '2.101.0' && /^pg_dump \(PostgreSQL\) 17\./.test(v.pgDump)
    && /^psql \(PostgreSQL\) 17\./.test(v.psql) && /^10\./.test(v.npm)
    && python && (Number(python[1]) > 3 || Number(python[1]) === 3 && Number(python[2]) >= 11)
    && /^OpenSSL /.test(v.openssl) && /^timeout \(GNU coreutils\)/.test(v.timeout)
    && v.timeoutHelp.includes('--kill-after') && v.timeoutHelp.includes('--signal'), 'pinned tooling or finite cleanup timeout unavailable')
}
function tools(a) {
  need(process.version.startsWith('v22.'), 'Node 22 required')
  const versions = { node: process.version, nodeExecutable: realpathSync(process.execPath), supabase: call('supabase', ['--version']), pgDump: call('pg_dump', ['--version']), psql: call('psql', ['--version']), npm: call('npm', ['--version']), python: call('python3', ['--version']), openssl: call('openssl', ['version']), timeout: call('timeout', ['--version']), timeoutHelp: call('timeout', ['--help']) }
  validateToolVersions(versions)
  const image = JSON.parse(docker(a, ['image', 'inspect', a.greenmailImage]))
  need(Array.isArray(image) && image.length === 1 && image[0].RepoDigests?.includes(a.greenmailImage), 'assigned mail digest is not preloaded')
  return versions
}
export function preflight() {
  const ctx = assignment(), { a } = ctx
  authenticate(a); verifySource(a)
  need(fresh(join(a.appDir, '.next')), 'existing app build/cache must be preserved; use a fresh app checkout')
  const capacity = host(a), toolchain = tools(a)
  need(!docker(a, ['ps', '-aq', '--no-trunc']), 'exclusive assigned daemon is not empty')
  for (const p of ['producer-operation.json', 'prepared-runtime.json', 'runtime-assignment.json', 'backend-assignment.json', 'fixture.json', 'runtime-ready.json', 'env', 'ca', 'secrets', 'producer', 'run.lock']) need(fresh(join(a.simHome, p)), 'previous producer/runtime evidence exists; preserve it')
  const original = originals(a)
  return { ...ctx, capacity, original, toolchain }
}
const operationFile = a => join(a.simHome, 'producer-operation.json')
function operation(ctx) {
  const o = JSON.parse(text(privateFile(operationFile(ctx.a))))
  need(o.schema === 'track6-prepare-operation-v1' && o.assignmentSha256 === ctx.assignmentSha256
    && o.sourceCommit === ctx.a.sourceCommit && o.sourceTree === ctx.a.sourceTree, 'operation does not bind assignment/source')
  return o
}
export function validateWrapperBinding(a, observed, expectedExecutable, expectedBlob, expectedSha256) {
  need(observed && observed.pid > 1 && observed.group === observed.pid && observed.session === observed.pid
    && /^[0-9]+$/.test(observed.ticks) && observed.cwd === a.replayDir && observed.executable === expectedExecutable
    && Array.isArray(observed.argv) && observed.argv[1] === join(a.harnessDir, 'scripts/simulation/track6/prepare.sh')
    && observed.argv[2] === '--inner' && observed.argv.length > 3
    && observed.argv.slice(3).every(f => /^scenarios\/[A-Za-z0-9._-]+\.test\.ts$/.test(f))
    && observed.wrapperBlob === expectedBlob && observed.wrapperSha256 === expectedSha256,
  'parent is not the exact source-bound producer wrapper/session')
}
function parentWrapper(a) {
  const p = processIdentity(process.ppid), wrapper = join(a.harnessDir, 'scripts/simulation/track6/prepare.sh')
  need(p && localPath(process.env.T6_PRODUCER_BASH) && realpathSync(wrapper) === wrapper, 'producer shell binding missing')
  const birth = { pid: p.pid, group: p.group, session: p.session, ticks: p.ticks }
  const observed = { ...birth, cwd: realpathSync(`/proc/${p.pid}/cwd`), executable: realpathSync(`/proc/${p.pid}/exe`),
    argv: text(`/proc/${p.pid}/cmdline`).split('\0').filter(Boolean),
    wrapperBlob: git(a.harnessDir, ['rev-parse', `${a.sourceCommit}:scripts/simulation/track6/prepare.sh`]), wrapperSha256: sha(readFileSync(wrapper)) }
  const expectedBlob = git(a.harnessDir, ['hash-object', '--', wrapper])
  validateWrapperBinding(a, observed, realpathSync(process.env.T6_PRODUCER_BASH), expectedBlob, sha(readFileSync(wrapper)))
  need(p.state !== 'Z', 'producer shell exited')
  return observed
}
function begin() {
  const ctx = preflight(), { a } = ctx
  need(process.env.T6_PRODUCER_REPLAY === a.replayDir && process.env.T6_PRODUCER_APP === a.appDir
    && process.env.T6_PRODUCER_HARNESS === a.harnessDir && process.env.T6_PRODUCER_HOME === a.simHome, 'same-host wrapper paths differ')
  mkdirSync(join(a.simHome, 'producer'), { mode: 0o700 })
  closeSync(openSync(join(a.simHome, 'producer/replay.log'), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600))
  publishPrivate(operationFile(a), { schema: 'track6-prepare-operation-v1', assignmentSha256: ctx.assignmentSha256,
    sourceCommit: a.sourceCommit, sourceTree: a.sourceTree, shell: parentWrapper(a), capacity: ctx.capacity, toolchain: ctx.toolchain,
    originals: ctx.original, startedAtUtc: new Date().toISOString(), budgetConsumed: 1 })
}
function sameShell(ctx) {
  const o = operation(ctx), current = parentWrapper(ctx.a)
  need(stable(current) === stable(o.shell), 'producer shell/source birth identity differs')
  return o
}
const psql = (url, args) => call('psql', [url, '-XAtq', '-v', 'ON_ERROR_STOP=1', ...args], { env: { ...safeEnvironment(), PGCONNECT_TIMEOUT: '5' } })
function containers(a) {
  const ids = docker(a, ['ps', '-aq', '--no-trunc']).split('\n').filter(Boolean)
  need(ids.length && ids.every(id => full(id, 64)), 'backend resources missing or ambiguous')
  // Inspect fixed nonsecret identity fields only, never Config.Env.
  return ids.map(id => JSON.parse(docker(a, ['inspect', '--type', 'container', '--format', '{"Id":{{json .Id}},"Name":{{json .Name}},"State":{"Running":{{json .State.Running}}},"Config":{"Labels":{{json .Config.Labels}}},"NetworkSettings":{"Ports":{{json .NetworkSettings.Ports}}}}', id])))
}
function completeReplay() {
  const ctx = assignment(), { a } = ctx
  const o = sameShell(ctx); authenticate(a); verifySource(a, false); host(a)
  const replay = join(a.replayDir, 'scripts/gridex-aud-003-clean-replay.sh')
  need(git(a.replayDir, ['hash-object', '--', replay]) === git(a.replayDir, ['rev-parse', `${a.sourceCommit}:scripts/gridex-aud-003-clean-replay.sh`]), 'executed replay source drifted')
  const log = privateFile(join(a.simHome, 'producer/replay.log'))
  need(text(log).includes('[GRIDEX-REM-002 replay] PASS: empty local Supabase -> verified reconstructed foundation -> canonical checksum-pinned history -> CLI-owned observed dev ledger'), 'canonical replay did not complete')
  const observed = containers(a); validateBackend(a, observed)
  publishPrivate(join(a.simHome, 'producer/backend-created.json'), { assignmentSha256: ctx.assignmentSha256, containers: observed })
  publishPrivate(join(a.simHome, 'producer/replay-completed.json'), { shell: o.shell, assignmentSha256: ctx.assignmentSha256, replayLogSha256: sha(readFileSync(log)), replaySourceSha256: sha(readFileSync(replay)), atUtc: new Date().toISOString() })
}
async function produce() {
  const ctx = assignment(), { a } = ctx, o = sameShell(ctx)
  authenticate(a); verifySource(a, false); host(a)
  const log = join(a.simHome, 'producer/replay.log')
  privateFile(log)
  const completed = JSON.parse(text(privateFile(join(a.simHome, 'producer/replay-completed.json'))))
  need(completed.assignmentSha256 === ctx.assignmentSha256 && completed.replayLogSha256 === sha(readFileSync(log)) && stable(completed.shell) === stable(o.shell), 'same-wrapper replay completion missing or changed')
  need(text(log).includes('[GRIDEX-REM-002 replay] PASS: empty local Supabase -> verified reconstructed foundation -> canonical checksum-pinned history -> CLI-owned observed dev ledger'), 'genuine canonical replay did not finish')
  const observed = containers(a), services = validateBackend(a, observed)
  const captured = JSON.parse(text(privateFile(join(a.simHome, 'producer/backend-created.json'))))
  need(captured.assignmentSha256 === ctx.assignmentSha256 && stable(captured.containers) === stable(observed), 'backend changed after wrapper replay completion')
  const status = json('supabase', ['status', '-o', 'json'], { cwd: a.replayDir, env: { ...safeEnvironment(), DOCKER_HOST: `unix://${a.hostBinding.dockerSocket}`, SUPABASE_HOME: join(a.simHome, 'producer/supabase-state') } })
  need(status.API_URL === `http://127.0.0.1:${a.ports.api}` && typeof status.ANON_KEY === 'string' && status.ANON_KEY.length > 10
    && typeof status.SERVICE_ROLE_KEY === 'string' && status.SERVICE_ROLE_KEY.length > 10, 'actual local Auth/API keys missing or endpoint differs')
  const db = `postgresql://postgres:postgres@127.0.0.1:${a.ports.db}/postgres`
  const identitySql = "SET default_transaction_read_only=on; SELECT jsonb_build_object('systemIdentifier',(pg_control_system()).system_identifier::text,'database',current_database(),'serverMajor',current_setting('server_version_num')::int/10000)"
  const identity = JSON.parse(psql(db, ['-c', identitySql]))
  const containerIdentity = JSON.parse(docker(a, ['exec', services.db.Id, 'psql', '-U', 'postgres', '-d', 'postgres', '-XAtq', '-v', 'ON_ERROR_STOP=1', '-c', identitySql]))
  need(identity.serverMajor === 17 && identity.database === 'postgres' && /^[0-9]+$/.test(identity.systemIdentifier)
    && stable(identity) === stable(containerIdentity), 'host/container Postgres identity differs')
  const ledger = psql(db, ['-F', '\t', '-c', "SET default_transaction_read_only=on; SELECT version, coalesce(name,'') FROM supabase_migrations.schema_migrations ORDER BY version"])
  const fingerprint = psql(db, ['-f', join(a.appDir, 'scripts/gridex-aud-003-schema-fingerprint.sql')])
  need(ledger.length > 0 && full(fingerprint, 64), 'canonical ledger/partial fingerprint unavailable')
  for (const d of ['ca', 'secrets', 'env']) mkdirSync(join(a.simHome, d), { mode: 0o700 })
  const ca = join(a.simHome, 'ca'), secret = randomBytes(32).toString('hex'), imap = randomBytes(32).toString('hex')
  const openssl = args => call('openssl', args, { cwd: ca })
  // Random locally generated keys/passwords only; no external provider credentials.
  openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem', '-days', '1', '-subj', '/CN=T6 local disposable CA'])
  openssl(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'server.key', '-out', 'server.csr', '-subj', '/CN=localhost'])
  writeFileSync(join(ca, 'server.ext'), 'subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n', { flag: 'wx', mode: 0o600 })
  openssl(['x509', '-req', '-in', 'server.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'server.pem', '-days', '1', '-extfile', 'server.ext'])
  // OpenSSL's public outputs also remain private input files required by consumer admission.
  for (const f of readdirSync(ca)) {
    const p = join(ca, f); const fd = openSync(p, constants.O_RDONLY | constants.O_NOFOLLOW)
    try { const fs = await import('node:fs'); fs.fchmodSync(fd, 0o600) } finally { closeSync(fd) }
  }
  writeFileSync(join(a.simHome, 'secrets/smtp-pass'), secret + '\n', { flag: 'wx', mode: 0o600 })
  const env = { T6_MODE: a.mode, T6_APP_PORT: String(a.ports.app), T6_APP_URL: `http://127.0.0.1:${a.ports.app}`, T6_SMTP_PORT: String(a.ports.smtp),
    T6_IMAP_TLS_PORT: String(a.ports.imapTls), T6_IMAP_PLAIN_PORT: String(a.ports.imapPlain), T6_CONTROL_PORT: String(a.ports.control),
    T6_MAILBOX_ADDRESS: 'ediel@t6.sim.invalid', T6_IMAP_USER: 'ediel@t6.sim.invalid', T6_IMAP_PASS: imap, T6_SIM_HOME: a.simHome,
    T6_DB_URL: db, NEXT_PUBLIC_SUPABASE_URL: status.API_URL, SUPABASE_URL: status.API_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY, NODE_EXTRA_CA_CERTS: join(ca, 'ca.pem'), EDIEL_EMAIL_PROVIDER: 'strato', EDIEL_SMTP_HOST: '127.0.0.1',
    EDIEL_SMTP_PORT: String(a.ports.smtp), EDIEL_SMTP_SECURE: 'true', EDIEL_SMTP_USER: 'ediel@t6.sim.invalid', EDIEL_SMTP_PASS: secret,
    EDIEL_SMTP_FROM: 'ediel@t6.sim.invalid', EDIEL_SHARED_MAILBOX_ADDRESS: 'ediel@t6.sim.invalid', EDIEL_MESSAGE_ID_DOMAIN: 't6.sim.invalid',
    EDIEL_IMAP_HOST: '127.0.0.1', EDIEL_IMAP_PORT: String(a.ports.imapTls), EDIEL_IMAP_USER: 'ediel@t6.sim.invalid', EDIEL_IMAP_PASS: imap,
    EDIEL_CRON_SECRET: randomBytes(32).toString('hex'), EDIEL_INBOUND_CRON_SECRET: randomBytes(32).toString('hex'),
    GRIDEX_INVOICE_DELIVERY_RESOLVER: 'shared', NEXT_TELEMETRY_DISABLED: '1' }
  publishPrivate(join(a.simHome, 'env/track6.json'), env)
  need(fresh(join(a.appDir, '.next')), 'existing app build/cache must be preserved; use a fresh app checkout')
  await runBounded('npm', ['run', 'build'], { cwd: a.appDir, env: { ...safeEnvironment(), PATH: `${dirname(process.execPath)}:${process.env.PATH}`, HOME: a.simHome, ...env }, log: join(a.simHome, 'producer/build.log'), timeoutMs: 30 * 60_000 })
  verifySource(a, false); authenticate(a)
  const nextBuildId = text(join(a.appDir, '.next/BUILD_ID')).trim()
  need(nextBuildId.length > 0 && Date.now() + 15 * 60_000 < Date.parse(a.expiresAtUtc), 'fresh build missing or insufficient cleanup/run lifetime')
  const backend = { version: 1, workerId: 'T6', environmentId: a.environmentId, containerId: services.db.Id, projectId: a.projectId,
    host: '127.0.0.1', port: a.ports.db, database: 'postgres', systemIdentifier: identity.systemIdentifier }
  const prepared = { schema: 'track6-prepared-runtime-v1', producerReservation: a.producer.receipt, appCommit: a.sourceCommit, appTree: a.sourceTree,
    replayCommit: a.sourceCommit, nextBuildId, sourceSchemaSha256: sha(readFileSync(join(a.appDir, 'supabase/schema.sql'))), schemaFingerprint: fingerprint,
    ledgerMigrationsSha256: sha(`${ledger}\n`), overlayRefs: a.overlayRefs, postReplayAppliedMigrations: 0,
    producerOperationSha256: sha(readFileSync(operationFile(a))), replayLogSha256: sha(readFileSync(log)), buildLogSha256: sha(readFileSync(join(a.simHome, 'producer/build.log'))) }
  publishPrivate(join(a.simHome, 'backend-assignment.json'), backend)
  publishPrivate(join(a.simHome, 'prepared-runtime.json'), prepared)
  publishPrivate(join(a.simHome, 'runtime-assignment.json'), { schema: 'track6-runtime-assignment-v1', workerId: a.workerId, model: a.model,
    environmentId: a.environmentId, appDir: a.appDir, appCommit: a.sourceCommit, simHome: a.simHome, projectId: a.projectId,
    apiContainerId: services.api.Id, storageContainerId: services.storage.Id, ports: a.ports, exclusiveHost: a.exclusiveHost, backendReservation: a.backend.receipt,
    allowedActions: ['up', 'run', 'down'], expiresAtUtc: a.expiresAtUtc, overlayRefs: a.overlayRefs,
    backendAssignmentSha256: sha(readFileSync(join(a.simHome, 'backend-assignment.json'))), preparedReceiptSha256: sha(readFileSync(join(a.simHome, 'prepared-runtime.json'))),
    greenmailName: `${a.environmentId}-greenmail`, greenmailImage: a.greenmailImage })
  publishPrivate(join(a.simHome, 'producer/produced.json'), { state: 'PREPARED_NOT_RUNTIME_READY', assignmentSha256: ctx.assignmentSha256,
    sourceCommit: a.sourceCommit, sourceTree: a.sourceTree, producerStartedAt: o.startedAtUtc, atUtc: new Date().toISOString() })
}
function cleanupCheck(after = false) {
  const ctx = assignment(), { a } = ctx
  // Allocation can drift after prepare/build/run. Reauthenticate current refs
  // before destructive canonical cleanup; a stale lease preserves resources.
  authenticate(a)
  sameShell(ctx); host(a, false)
  const recordedPath = join(a.simHome, 'producer/backend-created.json')
  if (!after) {
    need(!fresh(recordedPath), 'backend identity was not captured; preserve unknown resources')
    const recorded = JSON.parse(text(privateFile(recordedPath)))
    need(recorded.assignmentSha256 === ctx.assignmentSha256, 'cleanup backend receipt differs')
    const actual = containers(a)
    need(stable(actual) === stable(recorded.containers), 'backend resources drifted; refuse cleanup')
  } else {
    need(!docker(a, ['ps', '-aq', '--no-trunc']), 'owned backend cleanup incomplete')
    verifySource(a)
  }
}
async function execute(scenarios) {
  const ctx = preflight(), { a } = ctx
  need(scenarios.length > 0 && scenarios.every(f => /^scenarios\/[A-Za-z0-9._-]+\.test\.ts$/.test(f)
    && realpathSync(join(track, f)) === join(track, f)) && new Set(scenarios).size === scenarios.length, 'explicit unique owned scenario files required')
  const inherited = { ...safeEnvironment(), ...Object.fromEntries(['HOME', 'GH_TOKEN', 'GITHUB_TOKEN', 'GH_HOST', 'GH_CONFIG_DIR', 'OIC_MANIFEST_PATH'].filter(k => process.env[k]).map(k => [k, process.env[k]])) }
  const env = { ...inherited, T6_PREPARE_ASSIGNMENT_FILE: ctx.file, PATH: `${dirname(process.execPath)}:${process.env.PATH}`, DOCKER_HOST: `unix://${a.hostBinding.dockerSocket}`,
    SUPABASE_HOME: join(a.simHome, 'producer/supabase-state'), T6_PRODUCER_REPLAY: a.replayDir, T6_PRODUCER_APP: a.appDir,
    T6_PRODUCER_HARNESS: a.harnessDir, T6_PRODUCER_HOME: a.simHome, T6_PRODUCER_NODE: process.execPath,
    T6_PRODUCER_BASH: realpathSync(call('bash', ['-c', 'type -P bash'])) }
  // Process supervision captures this exact child's PID/birth/session before any timeout signal.
  const outerLog = join(a.simHome, 'producer-driver.log')
  let completed = false
  try {
    await runBounded(env.T6_PRODUCER_BASH, [join(track, 'prepare.sh'), '--inner', ...scenarios], { cwd: a.replayDir, env, log: outerLog,
      timeoutMs: Math.min(2 * 3600_000, Date.parse(a.expiresAtUtc) - Date.now() - 300_000), terminateGraceMs: 240_000 })
    host(a, false); verifySource(a)
    need(!docker(a, ['ps', '-aq', '--no-trunc']), 'backend remains after producer command')
    completed = true
  } finally {
    // A failure remains unqualified even when some cleanup succeeded; evidence never implies scenario PASS.
    publishPrivate(join(a.simHome, 'producer-terminal.json'), { state: completed ? 'LIFECYCLE_COMPLETED_SCENARIO_VERDICT_SEPARATE' : 'FAILED_UNQUALIFIED',
      assignmentSha256: ctx.assignmentSha256, sourceCommit: a.sourceCommit, sourceTree: a.sourceTree, atUtc: new Date().toISOString() })
  }
}
async function main(args) {
  if (args[0] === '--check' && args.length === 1) { preflight(); console.log('T6 producer preflight qualified; backend NOT_PROVISIONED; no operations executed'); return }
  if (args[0] === '--begin' && args.length === 1) { begin(); return }
  if (args[0] === '--replay-complete' && args.length === 1) { completeReplay(); return }
  if (args[0] === '--produce' && args.length === 1) { await produce(); return }
  if (args[0] === '--cleanup-check' && args.length === 2) { need(['before', 'after'].includes(args[1]), 'invalid cleanup phase'); cleanupCheck(args[1] === 'after'); return }
  if (args[0] === '--execute') { await execute(args.slice(1)); return }
  fail('usage: --check or --execute scenarios/<owned-file>.test.ts [...]')
}
if (process.argv[1] && resolve(process.argv[1]) === moduleFile) {
  try { await main(process.argv.slice(2)) } catch (e) {
    console.error(e.message?.startsWith('BLOCKED: T6 prepare ') ? e.message : 'BLOCKED: T6 prepare private input, evidence or process check failed')
    process.exitCode = 1
  }
}
