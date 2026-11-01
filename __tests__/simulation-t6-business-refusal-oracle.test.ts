// Actual T6 callbacks/helpers with finite Auth/DB/CLI/IO ports. No native proof.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ts from 'typescript'
import { spawnSync as realSpawnSync, spawn as realSpawn, type ChildProcess, type SpawnSyncOptions } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import { runInNewContext } from 'node:vm'
import * as path from 'node:path'
import * as url from 'node:url'
import type { CreatedRestoreDb, Tooling } from '../scripts/simulation/track6/lib/custody/restore'

type Callback = (...args: unknown[]) => unknown
type Row = Record<string, unknown>
type RestoreHelper = Pick<typeof import('../scripts/simulation/track6/lib/custody/restore'), 'createDb' | 'dropDb' | 'restore' | 'restoreUrl' | 'dbExists' | 'consistencyBlocks' | 'runBlock' | 'platformOnly' | 'dump' | 'chooseTooling'>
const root = process.cwd(), database = 't6_restore_reviewowned', runId = 'reviewowned'
const sourceUrl = 'postgresql://postgres:synthetic@127.0.0.1:15432/postgres'
function load(file: string, modules: Record<string, unknown>, bridge = '', review: Row = {}) {
  const filename = path.join(root, file)
  const input = readFileSync(filename, 'utf8').replaceAll('import.meta.url', JSON.stringify(url.pathToFileURL(filename).href))
  const compiled = ts.transpileModule(input + '\n' + bridge, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText
  const vmModule = { exports: {} as Row }
  runInNewContext(compiled, { module: vmModule, exports: vmModule.exports, require: (id: string) => {
    if (!(id in modules)) throw new Error(`uncontrolled import: ${id}`)
    return modules[id]
  }, review, process: { env: { T6_BACKEND_ASSIGNMENT_FILE: '/private/assignment.json' } }, console, URL, Buffer, Date, setTimeout, clearTimeout }, { filename, timeout: 2000 })
  return vmModule.exports
}
function registration() {
  const cases = new Map<string, Callback>(), after: Callback[] = []
  return { cases, after, vitest: { expect, describe: (_name: string, fn: Callback) => fn(), it: (name: string, fn: Callback) => cases.set(name, fn), beforeAll: () => undefined, afterAll: (fn: Callback) => after.push(fn) } }
}
class Evidence { observe() {} save() {} finalize() {} }
const fixed = { rowSha256: 'fixed-row-hash', bodySha256: 'fixed-body-hash', bodyBytes: 100 }
const restResult = (status: number, rows: unknown[] | null = null, code: string | null = null, message: string | null = null) => ({ status, rows, code, message, text: 'controlled response' })
function custody03(read: ReturnType<typeof restResult>, mutation: ReturnType<typeof restResult>, options: { userError?: boolean; changedFingerprint?: boolean; missingAfterDelete?: boolean } = {}) {
  const r = registration(), calls: string[] = []
  load('scripts/simulation/track6/scenarios/custody01-03.test.ts', {
    vitest: r.vitest, '../lib/evidence': { Evidence }, '../lib/seed.mjs': { newRunContext: () => ({ runId }) },
    '../lib/custody/app': {}, '../lib/counterparty': {}, '../lib/db': { lit: (s: string) => JSON.stringify(s) },
    '../lib/custody/base': { mode: () => 'test', messageFingerprint: () => options.changedFingerprint ? { ...fixed, rowSha256: 'changed' } : fixed, sha256: () => 'hash', sqlIn: () => { throw new Error('unexpected SQL') }, sqlTry: () => { throw new Error('unexpected SQL') } },
    '../lib/custody/e66': {}, '../lib/custody/intake': {}, '../lib/custody/tenant': {}, '../lib/mime': {},
    '../lib/custody/postgrest': { createTenantUser: async () => { if (options.userError) throw new Error('Auth unavailable'); return { accessToken: 'synthetic' } }, rest: async (method: string) => {
      calls.push(method)
      return method === 'GET' ? options.missingAfterDelete && calls.length > 1 ? restResult(200, []) : read : mutation
    } },
  }, `tenant={companyId:'own-company'}; sourceId='own-source'; baseline=${JSON.stringify(fixed)};`)
  return { callback: [...r.cases].find(([name]) => name.includes('(a) authenticated'))![1], calls }
}
const ownRead = () => restResult(200, [{ id: 'own-source' }])

type ProcessResult = { status: number | null; signal?: string | null; error?: NodeJS.ErrnoException; stdout?: string | null; stderr?: string | null }
const clean = { status: 0, stdout: '', stderr: '' }
const platform = 'pg_restore: while PROCESSING TOC:\npg_restore: from TOC entry 1; 0 0 TABLE DATA spatial_ref_sys postgres\npg_restore: error: permission denied\nCommand was: COPY extensions.spatial_ref_sys (srid) FROM stdin;\npg_restore: warning: errors ignored on restore: 1\n'
function backend(processResult: ProcessResult = clean) {
  const state = {
    exists: false, createError: false, identityError: false, dropError: false, opens: 0, closes: 0, sourceUrl,
    identity: { database, oid: '40001', ownerOid: '10', ownerName: 'postgres', creator: 'postgres' },
    assignment: { version: 1 as const, workerId: 'T6' as const, environmentId: 'owned', containerId: 'a'.repeat(64), projectId: 'project', host: '127.0.0.1' as const, port: 15432, database: 'postgres', systemIdentifier: '123' },
    queries: [] as string[], commands: [] as Array<{ command: string; args: string[]; options: SpawnSyncOptions }>, diagnosticRows: new Map<string, string[]>(), processResult,
    versionResult: { status: 0, stdout: 'pg_dump (PostgreSQL) 17.6', stderr: '' } as ProcessResult,
    restoreVersionResult: null as ProcessResult | null,
    timeoutResult: { status: 0, stdout: 'timeout (GNU coreutils) 9.4', stderr: '' } as ProcessResult,
    versionRunner: null as ((options: SpawnSyncOptions) => ProcessResult) | null,
  }
  const sourceIdentity = () => ({ systemIdentifier: '123', database: 'postgres', serverMajor: 17 })
  const sqlIn = (sql: string) => {
    state.queries.push(sql)
    if (sql.includes('pg_control_system')) return sourceIdentity()
    if (sql.startsWith('CREATE DATABASE')) {
      if (state.exists || state.createError) throw new Error('CREATE failed or collision')
      state.exists = true; return undefined
    }
    if (sql.startsWith('DROP DATABASE')) {
      if (state.dropError) throw Object.assign(new Error('active connection'), { code: '55006' })
      state.exists = false; return undefined
    }
    if (sql.includes('EXISTS(SELECT 1 FROM pg_database')) return state.exists
    if (sql.includes('FROM pg_database WHERE datname=')) {
      if (state.identityError) throw new Error('post-create identity unavailable')
      return state.exists ? { ...state.identity } : undefined
    }
    throw new Error('unexpected SQL port')
  }
  const helper = load('scripts/simulation/track6/lib/custody/restore.ts', {
    'node:child_process': { spawnSync: (command: string, args: string[], options: SpawnSyncOptions = {}) => {
      state.commands.push({ command, args, options })
      if (command === 'docker' && args[0] === 'inspect') return { status: 0, stdout: JSON.stringify({ Id: state.assignment.containerId, Running: true, Labels: { 'com.supabase.cli.project': state.assignment.projectId }, Ports: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '15432' }] } }), stderr: '' }
      if (command === 'docker' && args[0] === 'exec' && args.includes('psql')) return { status: 0, stdout: JSON.stringify(sourceIdentity()), stderr: '' }
      if (args.includes('--version')) {
        if (command === 'docker') return state.timeoutResult
        return state.versionRunner ? state.versionRunner(options) : command === 'pg_restore' && state.restoreVersionResult ? state.restoreVersionResult : state.versionResult
      }
      if (command === 'pg_restore' || command === 'pg_dump' || command === 'docker' && args.some(arg => arg === 'pg_restore' || arg === 'pg_dump')) return state.processResult
      if (command === 'psql') return { status: 0, stdout: (state.diagnosticRows.get(args[0] + '|' + args.at(-1)) ?? []).join('\n') + '\n', stderr: '' }
      throw new Error('unexpected process port')
    } },
    'node:fs': { mkdirSync: () => undefined, statSync: () => ({ size: 15 }), lstatSync: () => ({ isFile: () => true, mode: 0o600 }), openSync: (file: string) => { expect(file).toBe('/private/review.dump'); state.opens++; return 123 }, closeSync: () => { state.closes++ }, readFileSync: (file: string) => {
      if (file === '/private/review.dump') return Buffer.from('synthetic dump')
      if (file === '/private/assignment.json') return JSON.stringify(state.assignment)
      if (file === path.join(root, 'supabase/sql/checks/production_consistency_checks.sql')) return readFileSync(file, 'utf8')
      throw new Error('unexpected filesystem read')
    } }, 'node:path': path, 'node:url': url,
    './base': { custodyDir: () => '/private/review', sha256: (text: string) => createHash('sha256').update(text).digest('hex'), sqlIn },
    '../seed.mjs': { dbUrl: () => state.sourceUrl },
  }) as unknown as RestoreHelper
  const tooling: Tooling = { kind: 'host', hostMajor: 17, serverMajor: 17, assignment: { ...state.assignment } }
  const create = () => helper.createDb(database, runId)
  const drops = () => state.queries.filter(q => q.startsWith('DROP DATABASE'))
  return { helper, state, tooling, create, drops }
}
function custody05(b = backend(), options: { foreignFailure?: boolean; healthFailure?: boolean; observationFailure?: boolean; finalizeFailure?: boolean; writeFailure?: boolean } = {}) {
  const r = registration(), steps: string[] = [], writes: string[] = []
  class LocalEvidence {
    observe(name: string) { steps.push('observe:' + name); if (name === 'cleanup_receipt' && options.observationFailure) throw new Error('observe failed') }
    save() {}
    finalize() { steps.push('finalize'); if (options.finalizeFailure) throw new Error('finalize failed') }
  }
  load('scripts/simulation/track6/scenarios/custody01-05.test.ts', {
    vitest: r.vitest, '../lib/custody/app': {}, '../lib/custody/foreign': {}, '../lib/custody/postgrest': {},
    '../lib/custody/base': { mode: () => 'test', custodyDir: () => '/private/review' }, '../lib/custody/restore': b.helper,
    '../lib/seed.mjs': { dbUrl: () => sourceUrl, newRunContext: () => ({ runId }) },
    '../lib/evidence': { Evidence: LocalEvidence }, 'node:path': path, 'node:fs': { writeFileSync: (_file: string, data: string) => { steps.push('receipt_write'); writes.push(data); if (options.writeFailure) throw new Error('write failed') } },
  }, "tooling=review.tooling;dumpFile='/private/review.dump';foreign=review.foreign;health=review.health;", {
    tooling: b.tooling,
    foreign: { stop: async () => { steps.push('foreign_stop'); if (options.foreignFailure) throw new Error('foreign stop failed'); return [] } },
    health: { stop: async () => { steps.push('health_stop'); if (options.healthFailure) throw new Error('health stop failed'); return {} } },
  })
  return { callback: [...r.cases].find(([name]) => name.includes('pg_restore till NY'))![1], consistency: [...r.cases].find(([name]) => name.includes('checklistans steg 3'))![1], after: r.after[0], steps, writes, b }
}

beforeEach(() => { vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unexpected network')) })
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); vi.restoreAllMocks() })

describe('T6 authenticated refusal must have a working own-target read', () => {
  it.each([
    ['registered guard', restResult(400, null, 'P0001', 'ediel_registered_reception_original_immutable')],
    ['payload guard', restResult(400, null, '23514', 'immutable_ediel_payload_cannot_change')],
    ['RLS zero array', restResult(200, [])],
  ])('retains legitimate %s and fingerprint checks', async (_name, result) => {
    const run = custody03(ownRead(), result); await run.callback()
    expect(run.calls).toEqual(['GET', 'DELETE', 'GET', 'PATCH', 'GET'])
  })
  it.each([
    ['unavailable positive read', restResult(503), restResult(403)],
    ['expired session', restResult(401), restResult(401)],
    ['absent target', restResult(200, []), restResult(200, [])],
    ['foreign target', restResult(200, [{ id: 'foreign-source' }]), restResult(200, [])],
    ['wrong route', restResult(404), restResult(404)],
  ])('rejects %s before mutation', async (_name, read, mutation) => {
    const run = custody03(read, mutation); await expect(run.callback()).rejects.toThrow(); expect(run.calls).toEqual(['GET'])
  })
  it.each([
    ['malformed query400', restResult(400, null, '42601', 'syntax error')],
    ['nonJSON200', restResult(200, null)],
    ['generic403', restResult(403, null, '42501', 'permission denied')],
    ['expired401', restResult(401)],
    ['wrong404', restResult(404)],
    ['backend500', restResult(500)],
    ['known message wrong status', restResult(500, null, 'P0001', 'ediel_registered_reception_original_immutable')],
    ['known message wrong state', restResult(400, null, '57014', 'ediel_registered_reception_original_immutable')],
    ['successful affected row', restResult(200, [{ id: 'own-source' }])],
  ])('rejects %s without trying a second mutation', async (_name, mutation) => {
    const run = custody03(ownRead(), mutation); await expect(run.callback()).rejects.toThrow(); expect(run.calls).toEqual(['GET', 'DELETE'])
  })
  it('propagates failed Auth setup and vanished/changed target', async () => {
    await expect(custody03(ownRead(), restResult(200, []), { userError: true }).callback()).rejects.toThrow('Auth unavailable')
    const vanished = custody03(ownRead(), restResult(200, []), { missingAfterDelete: true })
    await expect(vanished.callback()).rejects.toThrow(); expect(vanished.calls).not.toContain('PATCH')
    await expect(custody03(ownRead(), restResult(200, []), { changedFingerprint: true }).callback()).rejects.toThrow()
  })
})

describe('T6 database mutation requires actual current-attempt creation identity', () => {
  it('mints a frozen observed handle and uses ordinary DROP only for its own DB', () => {
    const b = backend(), handle = b.create()
    expect(handle).toMatchObject({ database, runId, oid: '40001', ownerOid: '10', ownerName: 'postgres' })
    expect(Object.isFrozen(handle)).toBe(true)
    b.helper.dropDb(database, handle, runId)
    expect(b.drops()).toEqual([`DROP DATABASE "${database}"`]); expect(b.state.exists).toBe(false)
    expect(() => b.helper.dropDb(database, handle, runId)).toThrow()
  })
  it.each(['collision', 'create', 'post-create identity'] as const)('never grants cleanup after %s failure', kind => {
    const b = backend(); b.state.exists = kind === 'collision'; b.state.createError = kind === 'create'; b.state.identityError = kind === 'post-create identity'
    expect(() => b.create()).toThrow()
    expect(() => b.helper.dropDb(database, undefined as unknown as CreatedRestoreDb, runId)).toThrow()
    expect(b.drops()).toEqual([])
    if (kind !== 'create') expect(b.state.exists).toBe(true)
  })
  it.each(['clone', 'run', 'name', 'oid', 'owner', 'database', 'allocation', 'absent'] as const)('rejects %s drift/forgery before DROP', kind => {
    const b = backend(), original = b.create()
    const handle = kind === 'clone' ? JSON.parse(JSON.stringify(original)) as CreatedRestoreDb : original
    if (kind === 'oid') b.state.identity.oid = '40002'
    if (kind === 'owner') b.state.identity.ownerOid = '11'
    if (kind === 'database') b.state.identity.database = 'other'
    if (kind === 'allocation') b.state.assignment.environmentId = 'other'
    if (kind === 'absent') b.state.exists = false
    expect(() => b.helper.dropDb(kind === 'name' ? 't6_restore_other' : database, handle, kind === 'run' ? 'other' : runId)).toThrow()
    expect(b.drops()).toEqual([])
  })
  it('also refuses RESTORE without a genuine current creation handle', () => {
    const b = backend(); b.state.exists = true
    expect(() => b.helper.restore(b.tooling, '/private/review.dump', database, {} as CreatedRestoreDb, runId)).toThrow()
    expect(b.state.opens).toBe(0); expect(b.state.commands.filter(c => c.command === 'pg_restore')).toEqual([])
  })
  it('revalidates source endpoint/tooling before any owned restore mutation', () => {
    const b = backend(), handle = b.create(); b.state.assignment.port = 15433
    expect(() => b.helper.restore(b.tooling, '/private/review.dump', database, handle, runId)).toThrow()
    expect(b.state.opens).toBe(0); expect(b.drops()).toEqual([])
  })
  it.each(['?dbname=t6_restore_other', '?host=foreign.invalid', '/encoded'])('preserves source-override refusal %s before CREATE', variant => {
    const b = backend()
    b.state.sourceUrl = variant === '/encoded' ? sourceUrl.replace(/\/postgres$/, '/%70ostgres') : sourceUrl + variant
    expect(() => b.create()).toThrow()
    expect(b.state.queries.filter(q => q.startsWith('CREATE DATABASE'))).toEqual([])
    expect(b.drops()).toEqual([]); expect(b.state.opens).toBe(0)
  })
})

describe('T6 actual restore process has finite fully-accounted outcomes', () => {
  it.each([['clean0', clean], ['allowed platform1', { status: 1, stdout: '', stderr: platform }]])('accepts %s', (_name, result) => {
    const b = backend(result), handle = b.create()
    const r = b.helper.restore(b.tooling, '/private/review.dump', database, handle, runId)
    expect(r.status).toBe(result.status); expect(b.state.opens).toBe(1); expect(b.state.closes).toBe(1)
  })
  it.each([
    ['Docker125', { status: 125, stderr: 'docker: daemon unavailable' }],
    ['signal', { status: null, signal: 'SIGTERM', stderr: '' }],
    ['ENOENT', { status: null, error: Object.assign(new Error('missing executable'), { code: 'ENOENT' }), stderr: '' }],
    ['null', { status: null, stderr: '' }],
    ['unexpected2', { status: 2, stderr: platform }],
    ['zero with errors', { status: 0, stderr: platform }],
    ['zero unknown stderr', { status: 0, stderr: 'unknown warning' }],
    ['one no blocks', { status: 1, stderr: '' }],
    ['one unknown fatal', { status: 1, stderr: 'pg_restore: fatal: bad archive' }],
    ['one missing summary', { status: 1, stderr: platform.replace(/pg_restore: warning:[^\n]*\n/, '') }],
    ['one wrong count', { status: 1, stderr: platform.replace('restore: 1', 'restore: 2') }],
    ['one unknown line', { status: 1, stderr: platform + 'unknown output\n' }],
    ['forbidden COPY', { status: 1, stderr: platform.replace('extensions.spatial_ref_sys', 'public.ediel_messages') }],
  ])('rejects %s and closes input without pretending restore success', (_name, result) => {
    const b = backend(result), handle = b.create()
    expect(() => b.helper.restore(b.tooling, '/private/review.dump', database, handle, runId)).toThrow('pg_restore_refused:')
    expect(b.state.opens).toBe(1); expect(b.state.closes).toBe(1)
  })
})

describe('T6 dump and restore commands have finite child lifetimes', () => {
  it.each(['dump', 'restore'] as const)('bounds the host %s process and refuses an interrupted command', operation => {
    const b = backend({ status: null, signal: 'SIGKILL', error: Object.assign(new Error('deadline'), { code: 'ETIMEDOUT' }) })
    const handle = b.create()
    expect(() => operation === 'dump' ? b.helper.dump(b.tooling, '/private/review.dump')
      : b.helper.restore(b.tooling, '/private/review.dump', database, handle, runId)).toThrow()
    const call = b.state.commands.find(c => c.command === `pg_${operation}`)!
    expect(call.options.timeout).toBeGreaterThan(0)
    expect(call.options.timeout).toBeLessThanOrEqual(300_000)
    expect(call.options.killSignal).toBe('SIGKILL')
    expect(b.state.closes).toBe(1)
  })
  it.each(['dump', 'restore'] as const)('times out %s inside the owned container, rather than only killing docker exec', operation => {
    const b = backend({ status: 137, stderr: '' }), handle = b.create()
    const docker: Tooling = { kind: 'docker', hostMajor: null, serverMajor: 17, container: b.state.assignment.containerId, assignment: b.state.assignment }
    expect(() => operation === 'dump' ? b.helper.dump(docker, '/private/review.dump')
      : b.helper.restore(docker, '/private/review.dump', database, handle, runId)).toThrow()
    const call = b.state.commands.find(c => c.command === 'docker' && c.args.includes(`pg_${operation}`))!
    expect(call.args).toContain('timeout')
    expect(call.args).toContain('--foreground')
    expect(call.args).toContain('--signal=KILL')
    expect(call.args).toContain('300s')
    expect(call.options.timeout).toBeGreaterThan(300_000)
    expect(call.options.timeout).toBeLessThanOrEqual(315_000)
    if (operation === 'restore') { expect(() => b.helper.dropDb(database, handle, runId)).toThrow('process state is unknown'); expect(b.drops()).toEqual([]) }
  })
  it.each([
    ['outer timeout', { status: null, signal: 'SIGKILL', error: Object.assign(new Error('deadline'), { code: 'ETIMEDOUT' }) }],
    ['daemon failure', { status: 125, stderr: 'daemon connection lost' }],
    ['ambiguous137', { status: 137, stderr: '' }],
  ])('preserves the owned restore DB when %s leaves in-container client state unknown', (_name, result) => {
    const b = backend(result), handle = b.create()
    const docker: Tooling = { kind: 'docker', hostMajor: null, serverMajor: 17, container: b.state.assignment.containerId, assignment: b.state.assignment }
    expect(() => b.helper.restore(docker, '/private/review.dump', database, handle, runId)).toThrow()
    expect(() => b.helper.dropDb(database, handle, runId)).toThrow('process state is unknown')
    expect(b.drops()).toEqual([]); expect(b.state.exists).toBe(true)
  })
  it('refuses container tooling before opening an archive when the inner deadline utility is unsupported', () => {
    const b = backend(), handle = b.create(); b.state.timeoutResult = { status: 0, stdout: 'BusyBox timeout' }
    const docker: Tooling = { kind: 'docker', hostMajor: null, serverMajor: 17, container: b.state.assignment.containerId, assignment: b.state.assignment }
    expect(() => b.helper.restore(docker, '/private/review.dump', database, handle, runId)).toThrow()
    expect(b.state.opens).toBe(0)
    expect(b.state.commands.some(c => c.args.includes('pg_restore'))).toBe(false)
  })
  it('does not fall back to container mutation after a hung version probe', () => {
    const b = backend(); b.state.versionResult = { status: null, signal: 'SIGKILL', error: Object.assign(new Error('deadline'), { code: 'ETIMEDOUT' }) }
    expect(() => b.helper.chooseTooling()).toThrow()
    const call = b.state.commands.find(c => c.command === 'pg_dump')!
    expect(call.options.timeout).toBeGreaterThan(0); expect(call.options.timeout).toBeLessThanOrEqual(10_000)
    expect(b.state.commands.some(c => c.command === 'docker' && c.args.includes('timeout'))).toBe(false)
  })
  it('does not select a host restore too old to read the chosen dump archive', () => {
    const b = backend(); b.state.versionResult = { status: 0, stdout: 'pg_dump (PostgreSQL) 18.1' }
    b.state.restoreVersionResult = { status: 0, stdout: 'pg_restore (PostgreSQL) 17.6' }
    expect(b.helper.chooseTooling().kind).toBe('docker')
  })
  it('actually kills a harmless version probe that ignores SIGTERM, and returns refusal', () => {
    const b = backend(); let childPid = 0, actualCode: string | undefined, actualSignal: string | null | undefined, actualOutput = ''
    b.state.versionRunner = options => {
      // No DB/native tool is run. The real child receives the production deadline.
      if (!options.timeout || options.timeout > 10_000) throw new Error('unbounded version probe')
      const result = realSpawnSync(process.execPath, ['-e', "process.on('SIGTERM',()=>{});process.stdout.write('ready');setInterval(()=>{},1000)"], options)
      childPid = result.pid
      actualCode = (result.error as NodeJS.ErrnoException | undefined)?.code
      actualSignal = result.signal; actualOutput = String(result.stdout ?? '')
      return result as ProcessResult
    }
    expect(() => b.helper.chooseTooling()).toThrow()
    expect(childPid).toBeGreaterThan(1)
    expect(actualCode).toBe('ETIMEDOUT'); expect(actualSignal).toBe('SIGKILL'); expect(actualOutput).toBe('ready')
    expect(() => process.kill(childPid, 0)).toThrow()
  }, 15_000)
})

describe('T6 custody SQL never treats an interrupted client as a business refusal', () => {
  function sqlPort(result: ProcessResult) {
    const calls: Array<{ args: string[]; options: SpawnSyncOptions }> = []
    const helper = load('scripts/simulation/track6/lib/custody/base.ts', {
      'node:child_process': { spawnSync: (_name: string, args: string[], options: SpawnSyncOptions) => { calls.push({ args, options }); return result } },
      'node:crypto': { createHash }, 'node:fs': { mkdirSync: () => undefined }, 'node:path': path,
      '../seed.mjs': { dbUrl: () => sourceUrl, lit: (value: string) => JSON.stringify(value) },
    }) as Pick<typeof import('../scripts/simulation/track6/lib/custody/base'), 'sqlIn' | 'sqlTry'>
    return { helper, calls }
  }
  it.each(['sqlIn', 'sqlTry'] as const)('%s bounds its direct psql child with an uncatchable signal', method => {
    const port = sqlPort({ status: 0, stdout: 'true', stderr: '' })
    port.helper[method]('SELECT true')
    expect(port.calls[0].options.timeout).toBeGreaterThan(0)
    expect(port.calls[0].options.timeout).toBeLessThanOrEqual(120_000)
    expect(port.calls[0].options.killSignal).toBe('SIGKILL')
  })
  it.each([
    ['timeout with guard text', { status: null, error: Object.assign(new Error('deadline'), { code: 'ETIMEDOUT' }), stderr: 'ERROR: P0001: ediel_registered_reception_original_immutable' }],
    ['signal with guard text', { status: null, signal: 'SIGKILL', stderr: 'ERROR: 23514: immutable_ediel_payload_cannot_change' }],
    ['misleading status0/error', { status: 0, error: Object.assign(new Error('unavailable'), { code: 'EIO' }), stdout: 'true' }],
    ['unknown null status', { status: null, stdout: null, stderr: null }],
    ['fatal exit1 with stale guard text', { status: 1, stderr: 'ERROR: P0001: ediel_registered_reception_original_immutable' }],
    ['connection exit2 with stale guard text', { status: 2, stderr: 'ERROR: P0001: ediel_registered_reception_original_immutable' }],
    ['unexpected exit125 with stale guard text', { status: 125, stderr: 'ERROR: 23514: immutable_ediel_payload_cannot_change' }],
  ] satisfies Array<[string, ProcessResult]>)('rejects %s before parsing a SQLSTATE or success payload', (_name, result) => {
    const port = sqlPort(result)
    expect(() => port.helper.sqlIn('CREATE DATABASE own')).toThrow('process_did_not_complete_normally')
    expect(() => port.helper.sqlTry('DELETE FROM own')).toThrow('process_did_not_complete_normally')
  })
  it('preserves genuine completed SQLSTATE refusal with the original message', () => {
    const port = sqlPort({ status: 3, stdout: '', stderr: 'ERROR: P0001: ediel_registered_reception_original_immutable\n' })
    expect(port.helper.sqlTry('DELETE FROM own')).toEqual({ ok: false, sqlstate: 'P0001', message: 'ediel_registered_reception_original_immutable', stdout: '' })
    expect(() => port.helper.sqlIn('DELETE FROM own')).toThrow('ediel_registered_reception_original_immutable')
  })
  it('handles missing diagnostic/output buffers without inventing a business SQLSTATE', () => {
    const failed = sqlPort({ status: 3, stdout: null, stderr: null })
    expect(failed.helper.sqlTry('SELECT true')).toEqual({ ok: false, sqlstate: null, message: '', stdout: '' })
    expect(() => failed.helper.sqlIn('SELECT true')).toThrow('psql:')
    const empty = sqlPort({ status: 0, stdout: null, stderr: null })
    expect(empty.helper.sqlIn('SELECT true')).toBeUndefined()
    expect(empty.helper.sqlTry('SELECT true')).toEqual({ ok: true, sqlstate: null, message: null, stdout: '' })
  })
})

describe('T6 owned background children must exit before cleanup reads their evidence', () => {
  class ControlledChild extends EventEmitter {
    exitCode: number | null = null
    signalCode: NodeJS.Signals | null = null
    signals: NodeJS.Signals[] = []
    acceptSignal = true
    kill(signal: NodeJS.Signals) { this.signals.push(signal); return this.acceptSignal }
    finish(code: number | null = 0, signal: NodeJS.Signals | null = null) {
      this.exitCode = code; this.signalCode = signal; this.emit('exit', code, signal)
    }
  }
  function background(kind: 'health' | 'foreign', child: ControlledChild | ChildProcess) {
    let reads = 0
    const modules = {
      'node:child_process': { spawn: () => child },
      'node:fs': { writeFileSync: () => undefined, readFileSync: () => { reads++; return '' } },
      'node:path': path,
      './base': { custodyDir: () => '/private/owned', env: () => 'synthetic', appUrl: () => 'http://127.0.0.1:3106', mode: () => 'test' },
    }
    const app = load('scripts/simulation/track6/lib/custody/app.ts', modules) as typeof import('../scripts/simulation/track6/lib/custody/app')
    const foreign = load('scripts/simulation/track6/lib/custody/foreign.ts', { ...modules, './app': app }) as typeof import('../scripts/simulation/track6/lib/custody/foreign')
    const handle = kind === 'health' ? app.startHealthPoll(1) : foreign.startForeignRun({ companyId: 'own', customerId: 'own', accessToken: 'synthetic', tag: 'owned' })
    return { handle, reads: () => reads, app }
  }
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })
  it.each(['health', 'foreign'] as const)('%s rejects failed signals and an unknown live child without reading its log', async kind => {
    const child = new ControlledChild(); child.acceptSignal = false
    const b = background(kind, child)
    const outcome = b.handle.stop().then(() => ({ ok: true, message: '' }), error => ({ ok: false, message: String(error.message) }))
    await vi.advanceTimersByTimeAsync(25_000)
    expect(await outcome).toMatchObject({ ok: false })
    expect(child.signals).toEqual(['SIGTERM', 'SIGKILL']); expect(b.reads()).toBe(0)
  })
  it.each(['health', 'foreign'] as const)('%s waits for observed KILL exit before parsing a potentially changing log', async kind => {
    const child = new ControlledChild(), b = background(kind, child)
    let settled = false
    const stopped = b.handle.stop().then(value => { settled = true; return value })
    await vi.advanceTimersByTimeAsync(kind === 'health' ? 12_000 : 20_000)
    expect(child.signals).toEqual(['SIGTERM', 'SIGKILL'])
    expect(settled).toBe(false); expect(b.reads()).toBe(0)
    child.finish(null, 'SIGKILL')
    await stopped
    expect(b.reads()).toBe(1); expect(vi.getTimerCount()).toBe(0)
  })
  it.each(['health', 'foreign'] as const)('%s handles already-observed normal or signal exits without sending another signal', async kind => {
    for (const signalled of [false, true]) {
      const child = new ControlledChild(); child.exitCode = signalled ? null : 0; child.signalCode = signalled ? 'SIGTERM' : null
      const b = background(kind, child), stopped = b.handle.stop()
      await vi.advanceTimersByTimeAsync(25_000); await stopped
      expect(child.signals).toEqual([]); expect(b.reads()).toBe(1)
    }
  })
  it.each(['health', 'foreign'] as const)('%s clears its deadline after a TERM exit and shares one stop operation', async kind => {
    const child = new ControlledChild(), b = background(kind, child)
    const first = b.handle.stop(), second = b.handle.stop()
    await vi.advanceTimersByTimeAsync(500)
    child.finish(0)
    await Promise.all([first, second])
    expect(child.signals).toEqual(['SIGTERM']); expect(vi.getTimerCount()).toBe(0)
  })
  it.each(['health', 'foreign'] as const)('%s refuses a child error rather than emitting an unhandled process event', async kind => {
    const child = new ControlledChild(), b = background(kind, child)
    expect(() => child.emit('error', new Error('spawn or signal error'))).not.toThrow()
    const outcome = b.handle.stop().then(() => false, () => true)
    await vi.advanceTimersByTimeAsync(25_000)
    expect(await outcome).toBe(true); expect(b.reads()).toBe(0)
  })
  it.each(['health', 'foreign'] as const)('%s rejects an accepted KILL without any terminal observation', async kind => {
    const child = new ControlledChild(), b = background(kind, child)
    const outcome = b.handle.stop().then(() => false, () => true)
    await vi.advanceTimersByTimeAsync(25_000)
    expect(await outcome).toBe(true); expect(b.reads()).toBe(0)
    expect(child.signals).toEqual(['SIGTERM', 'SIGKILL'])
  })
  it.each(['health', 'foreign'] as const)('%s remembers an exit before stop and remains idempotent after completion', async kind => {
    const child = new ControlledChild(), b = background(kind, child)
    child.finish(0)
    await b.handle.stop(); await b.handle.stop()
    expect(child.signals).toEqual([]); expect(b.reads()).toBe(2); expect(vi.getTimerCount()).toBe(0)
  })
  it.each(['health', 'foreign'] as const)('%s surfaces a failed TERM even when the later KILL is observed', async kind => {
    const child = new ControlledChild()
    child.kill = signal => { child.signals.push(signal); if (signal === 'SIGKILL') child.finish(null, 'SIGKILL'); return signal !== 'SIGTERM' }
    const b = background(kind, child)
    const outcome = b.handle.stop().then(() => false, () => true)
    await vi.advanceTimersByTimeAsync(25_000)
    expect(await outcome).toBe(true); expect(b.reads()).toBe(0)
  })
  it('terminates and observes a harmless real child that ignores TERM using only its original handle', async () => {
    vi.useRealTimers()
    const child = realSpawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});process.stdout.write('ready');setInterval(()=>{},1000)"], { stdio: ['ignore', 'pipe', 'ignore'] })
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('harmless child readiness deadline')), 2000)
        child.stdout!.once('data', () => { clearTimeout(timer); resolve() })
        child.once('error', error => { clearTimeout(timer); reject(error) })
      })
      const b = background('health', child)
      // The same shared stopper used by both actual callbacks, with a shorter
      // grace for this harmless fixture; the KILL observation contract is real.
      const stop = (b.app as unknown as { ownedChildStopper: (child: ChildProcess, graceMs: number) => () => Promise<void> }).ownedChildStopper(child, 25)
      await stop()
      expect(child.signalCode).toBe('SIGKILL'); expect(child.exitCode).toBeNull()
      expect(() => process.kill(child.pid!, 0)).toThrow()
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }
  })
})

describe('T6 actual cleanup callback attempts all safe resources and surfaces failures', () => {
  it('preserves a preexisting name when this run never attempted creation', async () => {
    const b = backend(); b.state.exists = true; const run = custody05(b); await run.after()
    expect(b.drops()).toEqual([]); expect(b.state.exists).toBe(true)
  })
  it.each(['collision', 'post-create identity'] as const)('preserves unknown DB after %s and records HOLD', async kind => {
    const b = backend(); b.state.exists = kind === 'collision'; b.state.identityError = kind === 'post-create identity'; const run = custody05(b)
    expect(() => run.callback()).toThrow(); await expect(run.after()).rejects.toThrow('T6 cleanup failed: database')
    expect(b.drops()).toEqual([]); expect(b.state.exists).toBe(true)
    expect(run.steps).toContain('foreign_stop'); expect(run.steps).toContain('health_stop'); expect(run.steps).toContain('receipt_write')
  })
  it('cleans its own positive creation receipt and preserves final evidence', async () => {
    const run = custody05(); run.callback(); await run.after()
    expect(run.b.drops()).toEqual([`DROP DATABASE "${database}"`])
    expect(JSON.parse(run.writes[0])).toMatchObject({ created: true, dropped: true, cleanupFailures: [] })
    expect(run.steps).toEqual(['observe:pg_restore', 'observe:pg_restore_platform_only', 'foreign_stop', 'health_stop', 'observe:storage_bytes_note', 'observe:cleanup_receipt', 'finalize', 'receipt_write'])
  })
  it.each(['database', 'foreign_stop', 'health_stop', 'receipt_observation', 'evidence_finalize', 'receipt_write'] as const)('surfaces %s failure and still tries later safe cleanup/evidence', async step => {
    const b = backend(); b.state.dropError = step === 'database'
    const run = custody05(b, { foreignFailure: step === 'foreign_stop', healthFailure: step === 'health_stop', observationFailure: step === 'receipt_observation', finalizeFailure: step === 'evidence_finalize', writeFailure: step === 'receipt_write' })
    run.callback(); await expect(run.after()).rejects.toThrow(step)
    for (const attempt of ['foreign_stop', 'health_stop', 'observe:cleanup_receipt', 'finalize', 'receipt_write']) expect(run.steps).toContain(attempt)
    expect(b.drops().every(q => !q.includes('FORCE'))).toBe(true)
  })
  it('preserves every simultaneous failure after attempting all safe actions', async () => {
    const b = backend(); b.state.dropError = true
    const run = custody05(b, { foreignFailure: true, healthFailure: true, observationFailure: true, finalizeFailure: true, writeFailure: true }); run.callback()
    await expect(run.after()).rejects.toThrow('database, foreign_stop, health_stop, receipt_observation, evidence_finalize, receipt_write')
    expect(run.steps).toContain('receipt_write'); expect(b.state.exists).toBe(true)
  })
})

describe('T6 actual ten consistency blocks must be empty, not just identical', () => {
  it('accepts all ten empty actual SQL results', () => {
    const run = custody05(); expect(run.b.helper.consistencyBlocks()).toHaveLength(10); run.consistency()
  })
  it.each(Array.from({ length: 10 }, (_, i) => i + 1))('rejects identical nonzero source/restored block%d', n => {
    const run = custody05(), block = run.b.helper.consistencyBlocks().find(b => b.n === n)!
    for (const db of [sourceUrl, run.b.helper.restoreUrl(database)]) run.b.state.diagnosticRows.set(db + '|' + block.sql, ['synthetic violation'])
    expect(() => run.consistency()).toThrow()
  })
  it.each(['source', 'restored'])('rejects a %s-only duplicate-underlay violation', side => {
    const run = custody05(), block = run.b.helper.consistencyBlocks().find(b => b.n === 7)!
    const db = side === 'source' ? sourceUrl : run.b.helper.restoreUrl(database)
    run.b.state.diagnosticRows.set(db + '|' + block.sql, ['own-company|contract|2027|2|2|{one,two}'])
    expect(() => run.consistency()).toThrow()
  })
})
