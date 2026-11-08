import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  validateAssignment, validateCapacity, validateAllocation, validateOriginalManifest,
  publishPrivate, runBounded, validateBackend, validateWrapperBinding, validateToolVersions,
} from '../scripts/simulation/track6/lib/prepare.mjs'

const now = Date.parse('2026-11-01T12:00:00Z')
const hash = (s: string | Buffer) => createHash('sha256').update(s).digest('hex')
const base = () => ({
  schema: 'track6-prepare-assignment-v1', workerId: 'codex-track6', exclusiveHost: true, model: 'actual-codex',
  allocationId: 'actual-owned-turn', environmentId: 't6-owned', sourceCommit: 'a'.repeat(40), sourceTree: 'b'.repeat(40),
  appDir: '/private/app', replayDir: '/private/replay', harnessDir: '/private/harness', simHome: '/private/home',
  projectId: 'owned-project', mode: 'test', expiresAtUtc: '2026-11-01T15:00:00Z',
  allowedActions: ['prepare', 'replay', 'build', 'up', 'run', 'down', 'cleanup'], budget: { prepare: 1 },
  producer: { ref: 'refs/tags/agent-claims/masterplan/producer-t6-owned', receipt: 'c'.repeat(40) },
  backend: { ref: 'refs/tags/agent-claims/masterplan/backend-t6-owned', receipt: 'd'.repeat(40) },
  hostBinding: { hostname: 'owned-host', bootId: 'observed-boot-id', dockerDaemonId: 'observed-daemon-id', dockerSocket: '/var/run/docker.sock', socketDev: '1', socketIno: '2' },
  ports: { app: 3106, api: 54321, db: 54322, smtp: 3625, imapTls: 3693, imapPlain: 3643, control: 3699 },
  greenmailImage: 'greenmail/standalone@sha256:' + 'e'.repeat(64), overlayRefs: [],
  originalsManifestSha256: 'f'.repeat(64),
})
const canonical = (v: unknown): string => Array.isArray(v) ? '[' + v.map(canonical).join(',') + ']' : v && typeof v === 'object'
  ? '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical((v as Record<string, unknown>)[k])).join(',') + '}' : JSON.stringify(v)
const allocation = (a: ReturnType<typeof base>) => ({ schema: 'track6-runtime-allocation-v1', kind: 'producer',
  assignmentPayloadSha256: hash(canonical({ ...a, producer: { ref: a.producer.ref }, backend: { ref: a.backend.ref } })) })
const dirs: string[] = []
const temp = () => { const d = mkdtempSync(join(tmpdir(), 't6-prepare-')); dirs.push(d); return d }
afterEach(() => dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })))

describe('T6 explicit preparation authority', () => {
  it('accepts an explicit finite assignment without creating backend authority', () => {
    expect(validateAssignment(base(), now).environmentId).toBe('t6-owned')
  })
  it('allows the harness to share the clean app while keeping replay separate', () => {
    const a = base(); a.harnessDir = a.appDir; expect(() => validateAssignment(a, now)).not.toThrow()
  })
  it.each([
    ['missing exclusive lease', (a: ReturnType<typeof base>) => { Reflect.deleteProperty(a, 'exclusiveHost') }],
    ['not exclusive', (a: ReturnType<typeof base>) => { a.exclusiveHost = false }],
    ['expired', (a: ReturnType<typeof base>) => { a.expiresAtUtc = '2026-11-01T11:59:59Z' }],
    ['unbounded expiry', (a: ReturnType<typeof base>) => { a.expiresAtUtc = '2027-11-01T15:00:00Z' }],
    ['duplicate port', (a: ReturnType<typeof base>) => { a.ports.db = a.ports.api }],
    ['missing cleanup', (a: ReturnType<typeof base>) => { a.allowedActions = a.allowedActions.filter(x => x !== 'cleanup') }],
    ['unbounded budget', (a: ReturnType<typeof base>) => { a.budget.prepare = 100 }],
    ['source-only claim as producer', (a: ReturnType<typeof base>) => { a.producer.ref = 'refs/tags/agent-claims/masterplan/file-' + 'a'.repeat(64) }],
    ['shared harness and replay checkout', (a: ReturnType<typeof base>) => { a.harnessDir = a.replayDir }],
    ['shared app and replay checkout', (a: ReturnType<typeof base>) => { a.replayDir = a.appDir }],
    ['remote Docker', (a: ReturnType<typeof base>) => { a.hostBinding.dockerSocket = 'tcp://foreign.invalid:2375' }],
  ])('refuses %s before native actions', (_name, mutate) => {
    const a = base(); mutate(a); expect(() => validateAssignment(a, now)).toThrow('BLOCKED: T6 prepare')
  })
  it('requires full source-applicable allocation receipts rather than matching source refs', () => {
    const a = base()
    const message = allocation(a)
    expect(() => validateAllocation(a, 'producer', { sha: a.producer.receipt, message: JSON.stringify(message) })).not.toThrow()
    expect(() => validateAllocation(a, 'producer', { sha: a.producer.receipt, message: JSON.stringify({ base: a.sourceCommit, files: [], operation: 'source only' }) })).toThrow()
    expect(() => validateAllocation(a, 'producer', { sha: a.producer.receipt, message: JSON.stringify({ ...message, assignmentPayloadSha256: '0'.repeat(64) }) })).toThrow()
  })
  it.each(['simHome', 'appDir', 'replayDir', 'harnessDir', 'projectId', 'ports', 'mode', 'greenmailImage', 'originalsManifestSha256'] as const)('refuses changed %s under the same authenticated budget capsule', key => {
    const a = base(), message = JSON.stringify(allocation(a))
    if (key === 'ports') a.ports.app++
    else if (key === 'mode') a.mode = 'production'
    else a[key] += '-changed'
    expect(() => validateAllocation(a, 'producer', { sha: a.producer.receipt, message })).toThrow()
  })
})

describe('T6 actual host capacity boundary', () => {
  const GiB = 1024 ** 3
  it('accepts exact qualifying overlay and vfs capacities', () => {
    expect(() => validateCapacity({ effectiveMemoryBytes: 8 * GiB, availableBytes: 15 * GiB, driver: 'overlay2' })).not.toThrow()
    expect(() => validateCapacity({ effectiveMemoryBytes: 8 * GiB, availableBytes: 40 * GiB, driver: 'vfs' })).not.toThrow()
  })
  it.each([
    { effectiveMemoryBytes: 8 * GiB - 1, availableBytes: 40 * GiB, driver: 'vfs' },
    { effectiveMemoryBytes: 16 * GiB, availableBytes: 40 * GiB - 1, driver: 'vfs' },
    { effectiveMemoryBytes: 16 * GiB, availableBytes: 15 * GiB - 1, driver: 'overlayfs' },
    { effectiveMemoryBytes: 16 * GiB, availableBytes: 40 * GiB, driver: 'unknown' },
    { effectiveMemoryBytes: NaN, availableBytes: 40 * GiB, driver: 'vfs' },
  ])('refuses underqualified or unknown actual capacity %#', c => expect(() => validateCapacity(c)).toThrow())
})

describe('T6 immutable original-byte admission', () => {
  const cohort = () => {
    const objects = new Map<string, Buffer>()
    const files = Array.from({ length: 28 }, (_, i) => ['eml', 'edi'].map(ext => {
      const path = `inbound/e66-${String(i + 1).padStart(3, '0')}.${ext}`
      const data = Buffer.from(`actual-original-${i}-${ext}`); objects.set('published/' + path, data)
      return { run: 'owned-run', relPath: path, original: { bytes: data.length, sha256: hash(data) }, published: { path: 'published/' + path, bytes: data.length, sha256: hash(data) } }
    })).flat()
    return { pointer: { run: 'owned-run', expectedInboundEml: 28 }, files, objects }
  }
  it('accepts 28 complete exact EML/EDI pairs read from retained Git objects', () => {
    const c = cohort(); expect(validateOriginalManifest(c.pointer, { files: c.files }, (p: string) => c.objects.get(p))).toEqual({ pairs: 28, files: 56 })
  })
  it.each(['missing', 'bytes', 'duplicate', 'hash', 'path'] as const)('refuses %s source evidence', kind => {
    const c = cohort()
    if (kind === 'missing') c.objects.delete(c.files[0].published.path)
    if (kind === 'bytes') c.files[0].original.bytes++
    if (kind === 'duplicate') c.files.push(c.files[0])
    if (kind === 'hash') c.files[0].original.sha256 = '0'.repeat(64)
    if (kind === 'path') c.files[0].published.path = '../foreign'
    expect(() => validateOriginalManifest(c.pointer, { files: c.files }, (p: string) => c.objects.get(p))).toThrow()
  })
})

describe('T6 observed backend binding', () => {
  const id = (x: string) => x.repeat(64)
  const container = (x: string, name: string, ports = {}) => ({ Id: id(x), Name: '/' + name, State: { Running: true }, Config: { Labels: { 'com.supabase.cli.project': 'owned-project' } }, NetworkSettings: { Ports: ports } })
  const observed = () => [container('a', 'supabase_db_owned-project', { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '54322' }] }), container('b', 'supabase_kong_owned-project', { '8000/tcp': [{ HostIp: '127.0.0.1', HostPort: '54321' }] }), container('c', 'supabase_storage_owned-project'), container('d', 'supabase_auth_owned-project'), container('e', 'supabase_rest_owned-project'), container('f', 'supabase_realtime_owned-project')]
  it('selects distinct running assigned services with exact loopback bindings', () => {
    const r = validateBackend(base(), observed()); expect(r.db.Id).toBe(id('a')); expect(r.api.Id).toBe(id('b')); expect(r.storage.Id).toBe(id('c'))
  })
  it.each(['db', 'kong', 'auth', 'rest', 'realtime', 'storage'])('refuses a missing actual %s service even if status contains local API keys', name => {
    const o = observed().filter(c => c.Name !== '/supabase_' + name + '_owned-project')
    expect(() => validateBackend(base(), o)).toThrow()
  })
  it.each(['foreign', 'wildcard', 'extra', 'stopped'] as const)('refuses %s backend state', kind => {
    const o = observed()
    if (kind === 'foreign') o[0].Config.Labels['com.supabase.cli.project'] = 'foreign'
    if (kind === 'wildcard') (o[0].NetworkSettings.Ports as Record<string, Array<{ HostIp: string }>>)['5432/tcp'][0].HostIp = '0.0.0.0'
    if (kind === 'extra') o.push(container('1', 'foreign'))
    if (kind === 'stopped') o[0].State.Running = false
    expect(() => validateBackend(base(), o)).toThrow()
  })
})

describe('T6 private evidence and finite subprocesses', () => {
  it('publishes once with private mode and never overwrites original evidence', () => {
    const file = join(temp(), 'receipt.json'); publishPrivate(file, { actual: 1 })
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(() => publishPrivate(file, { actual: 2 })).toThrow()
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ actual: 1 })
  })
  it('refuses a symlink target without writing through it', () => {
    const d = temp(), original = join(d, 'original'); writeFileSync(original, 'preserved'); symlinkSync(original, join(d, 'receipt'))
    expect(() => publishPrivate(join(d, 'receipt'), { bad: true })).toThrow(); expect(readFileSync(original, 'utf8')).toBe('preserved')
  })
  it('records actual completed command output', async () => {
    const log = join(temp(), 'build.log')
    await runBounded(process.execPath, ['-e', 'process.stdout.write("actual-completed-output")'], { log, timeoutMs: 5000 })
    expect(readFileSync(log, 'utf8')).toBe('actual-completed-output')
  })
  it('kills only the still-identical owned process after bounded TERM grace is ignored', async () => {
    const log = join(temp(), 'ignored-term.log'), started = Date.now()
    await expect(runBounded(process.execPath, ['-e', 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'], { log, timeoutMs: 300, terminateGraceMs: 100 })).rejects.toThrow('BLOCKED: T6 prepare')
    expect(Date.now() - started).toBeLessThan(3000)
  }, 5000)
  it('times out a real hung owned process instead of claiming completion', async () => {
    const log = join(temp(), 'hung.log'), started = Date.now()
    await expect(runBounded(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { log, timeoutMs: 100 })).rejects.toThrow('BLOCKED: T6 prepare')
    expect(Date.now() - started).toBeLessThan(6000)
  }, 7000)
})


describe('T6 actual same-shell producer wrapper', () => {
  const fixture = () => {
    const d = temp(), app = join(d, 'app'), replay = join(d, 'replay'), harness = join(d, 'harness'), home = join(d, 'home'), bin = join(d, 'bin')
    for (const p of [app, replay, harness, home, bin, join(replay, 'scripts'), join(harness, 'scripts'), join(harness, 'scripts/simulation'), join(harness, 'scripts/simulation/track6')]) mkdirSync(p, { mode: 0o700 })
    const trace = join(d, 'trace')
    const executable = (name: string, body: string) => { writeFileSync(name, body); chmodSync(name, 0o700) }
    executable(join(bin, 'supabase'), '#!/usr/bin/env bash\nexit 0\n')
    executable(join(bin, 'producer-node'), [
      '#!/usr/bin/env bash',
      'case "$2" in',
      ' --begin) mkdir "$T6_PRODUCER_HOME/producer"; : > "$T6_PRODUCER_HOME/producer/replay.log"; echo begin >> "$T6_TEST_TRACE" ;;',
      ' --replay-complete) echo replay-complete >> "$T6_TEST_TRACE" ;;',
      ' --produce) echo produce >> "$T6_TEST_TRACE"; [[ "${T6_TEST_FAIL_PHASE:-}" != produce ]] ;;',
      ' --cleanup-check) echo "check:$3" >> "$T6_TEST_TRACE"; [[ "${T6_TEST_FAIL_PHASE:-}" != unknown ]] ;;',
      ' *) exit 90 ;;',
      'esac',
    ].join('\n'))
    writeFileSync(join(replay, 'seed.sql'), 'preserved-seed')
    writeFileSync(join(replay, 'scripts/gridex-aud-003-clean-replay.sh'), [
      ': > "$T6_PRODUCER_REPLAY/seed.sql"',
      'echo replay >> "$T6_TEST_TRACE"',
      'cleanup() { printf preserved-seed > "$T6_PRODUCER_REPLAY/seed.sql"; echo canonical-cleanup >> "$T6_TEST_TRACE"; }',
      'trap cleanup EXIT',
    ].join('\n'))
    for (const name of ['up', 'run', 'down']) executable(join(harness, 'scripts/simulation/track6/' + name + '.sh'), '#!/usr/bin/env bash\necho ' + name + ' >> "$T6_TEST_TRACE"\n')
    expect(spawnSync('git', ['init', app]).status).toBe(0)
    expect(spawnSync('git', ['-C', app, '-c', 'user.name=T6 test', '-c', 'user.email=t6@example.invalid', 'commit', '--allow-empty', '-m', 'fixture']).status).toBe(0)
    return { replay, trace, env: { ...process.env, PATH: bin + ':' + process.env.PATH, T6_PRODUCER_NODE: join(bin, 'producer-node'),
      T6_PRODUCER_REPLAY: replay, T6_PRODUCER_APP: app, T6_PRODUCER_HARNESS: harness, T6_PRODUCER_HOME: home, T6_TEST_TRACE: trace } }
  }
  it('allows canonical replay to truncate its own seed and retains cleanup after consumers', () => {
    const f = fixture()
    const r = spawnSync('bash', ['scripts/simulation/track6/prepare.sh', '--inner', 'scenarios/smoke.test.ts'], { env: f.env, encoding: 'utf8', timeout: 5000 })
    expect(r.status, r.stderr).toBe(0)
    expect(readFileSync(f.trace, 'utf8').trim().split('\n')).toEqual(['begin', 'replay', 'replay-complete', 'produce', 'up', 'run', 'down', 'check:before', 'canonical-cleanup', 'check:after'])
    expect(readFileSync(join(f.replay, 'seed.sql'), 'utf8')).toBe('preserved-seed')
  })
  it('runs owned backend cleanup after a failed build without starting consumers', () => {
    const f = fixture()
    const r = spawnSync('bash', ['scripts/simulation/track6/prepare.sh', '--inner', 'scenarios/smoke.test.ts'], { env: { ...f.env, T6_TEST_FAIL_PHASE: 'produce' }, encoding: 'utf8', timeout: 5000 })
    expect(r.status).not.toBe(0)
    expect(readFileSync(f.trace, 'utf8').trim().split('\n')).toEqual(['begin', 'replay', 'replay-complete', 'produce', 'check:before', 'canonical-cleanup', 'check:after'])
    expect(readFileSync(join(f.replay, 'seed.sql'), 'utf8')).toBe('preserved-seed')
  })
  it('gives the actual wrapper TERM grace to run same-shell owned cleanup after a timeout', async () => {
    const f = fixture()
    const run = join(f.env.T6_PRODUCER_HARNESS, 'scripts/simulation/track6/run.sh')
    writeFileSync(run, '#!/usr/bin/env bash\necho run >> "$T6_TEST_TRACE"\nsleep 10\n')
    const log = join(temp(), 'timeout.log')
    await expect(runBounded('bash', ['scripts/simulation/track6/prepare.sh', '--inner', 'scenarios/smoke.test.ts'], {
      env: f.env, log, timeoutMs: 400, terminateGraceMs: 2000,
    })).rejects.toThrow('BLOCKED: T6 prepare')
    expect(readFileSync(f.trace, 'utf8')).toContain('canonical-cleanup')
    expect(readFileSync(join(f.replay, 'seed.sql'), 'utf8')).toBe('preserved-seed')
  }, 5000)
  it('preserves unknown backend state and refuses canonical cleanup', () => {
    const f = fixture()
    const r = spawnSync('bash', ['scripts/simulation/track6/prepare.sh', '--inner', 'scenarios/smoke.test.ts'], { env: { ...f.env, T6_TEST_FAIL_PHASE: 'unknown' }, encoding: 'utf8', timeout: 5000 })
    expect(r.status).not.toBe(0)
    expect(readFileSync(f.trace, 'utf8').trim().split('\n')).toEqual(['begin', 'replay', 'replay-complete', 'produce', 'up', 'run', 'down', 'check:before'])
    expect(readFileSync(join(f.replay, 'seed.sql'), 'utf8')).toBe('')
  })
})


describe('T6 observed wrapper provenance', () => {
  const observed = () => ({ pid: 120, group: 120, session: 120, ticks: '98765', cwd: '/private/replay', executable: '/usr/bin/bash',
    argv: ['bash', '/private/harness/scripts/simulation/track6/prepare.sh', '--inner', 'scenarios/smoke.test.ts'], wrapperBlob: '1'.repeat(40), wrapperSha256: '2'.repeat(64) })
  it('accepts the exact reviewed wrapper in its own observed session', () => expect(() => validateWrapperBinding(base(), observed(), '/usr/bin/bash', '1'.repeat(40), '2'.repeat(64))).not.toThrow())
  it.each(['argv', 'executable', 'cwd', 'session', 'blob'] as const)('refuses direct or changed %s provenance before receipts', key => {
    const o = observed()
    if (key === 'argv') o.argv = ['bash', '-c', 'fabricate replay marker; node prepare.mjs --produce']
    if (key === 'executable') o.executable = '/usr/bin/foreign'
    if (key === 'cwd') o.cwd = '/private/foreign'
    if (key === 'session') o.session++
    if (key === 'blob') o.wrapperBlob = '3'.repeat(40)
    expect(() => validateWrapperBinding(base(), o, '/usr/bin/bash', '1'.repeat(40), '2'.repeat(64))).toThrow()
  })
})


describe('T6 cleanup tooling is qualified before native', () => {
  const versions = () => ({ node: 'v22.23.4', supabase: '2.101.0', pgDump: 'pg_dump (PostgreSQL) 17.11', psql: 'psql (PostgreSQL) 17.11', npm: '10.9.2', python: 'Python 3.11.8', openssl: 'OpenSSL 3.0.1', timeout: 'timeout (GNU coreutils) 9.1', timeoutHelp: '--signal --kill-after' })
  it('accepts matching tools including the required finite-stop options', () => expect(() => validateToolVersions(versions())).not.toThrow())
  it.each(['timeout', 'timeoutHelp', 'openssl', 'python', 'node'] as const)('refuses unsupported %s before stack creation', key => {
    const v = versions(); v[key] = 'unsupported'; expect(() => validateToolVersions(v)).toThrow()
  })
})
