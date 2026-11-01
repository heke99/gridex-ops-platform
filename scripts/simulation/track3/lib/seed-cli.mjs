// T3 runtime admission and fixture CLI. Private inputs are JSON data, never shell source.
// A coordinator assignment attests an already held exclusive environment/producer lease;
// this helper cannot acquire that lease or manufacture replay/build evidence.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const track = resolve(here, '..')
const checkout = resolve(track, '../../..')
const fail = (reason) => { throw new Error(`BLOCKED: T3 runtime ${reason}`) }
const need = (ok, reason) => { if (!ok) fail(reason) }
const hash = (value) => createHash('sha256').update(value).digest('hex')
const fullSha = (value, length = 40) => typeof value === 'string' && new RegExp(`^[a-f0-9]{${length}}$`).test(value)
const within = (file, dir) => { const rel = relative(dir, file); return rel === '' || rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel) }
const has = (file) => { try { lstatSync(file); return true } catch (error) { if (error.code === 'ENOENT') return false; throw error } }

function privatePath(file, directory = false) {
  need(typeof file === 'string' && isAbsolute(file) && resolve(file) === file, 'requires an absolute canonical private path')
  const stat = lstatSync(file)
  need(realpathSync(file) === file && stat.uid === process.getuid()
    && (stat.mode & 0o777) === (directory ? 0o700 : 0o600)
    && (directory ? stat.isDirectory() : stat.isFile()), 'private input has wrong owner, type, mode or symlink')
  return file
}

function command(name, args) {
  const result = spawnSync(name, args, { encoding: 'utf8', timeout: 15_000, maxBuffer: 4_000_000 })
  need(result.status === 0, `${name} identity check failed`)
  return result.stdout.trimEnd()
}

function outsideGit(directory) {
  for (const flag of ['--is-inside-work-tree', '--is-inside-git-dir']) {
    const result = spawnSync('git', ['-C', directory, 'rev-parse', flag], { encoding: 'utf8', timeout: 15_000 })
    need(!(result.status === 0 && result.stdout.trim() === 'true'), 'private input must be outside every Git checkout and metadata directory')
  }
}

const scenarioKeys = ['T3_E01_N', 'T3_E01_OWN_ID', 'T3_E02_OWN_ID', 'T3_E03_OWN_ID', 'T3_APP_AUTOMATION_ACTOR_USER_ID']
const envKeys = new Set([
  'T3_MODE', 'T3_APP_PORT', 'T3_APP_URL', 'T3_SMTP_PORT', 'T3_IMAP_TLS_PORT', 'T3_IMAP_PLAIN_PORT', 'T3_CONTROL_PORT',
  'T3_MAILBOX_ADDRESS', 'T3_IMAP_USER', 'T3_IMAP_PASS', 'T3_SIM_HOME', 'T3_DB_URL',
  'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'NODE_EXTRA_CA_CERTS',
  'EDIEL_EMAIL_PROVIDER', 'EDIEL_SMTP_HOST', 'EDIEL_SMTP_PORT', 'EDIEL_SMTP_SECURE', 'EDIEL_SMTP_USER', 'EDIEL_SMTP_PASS',
  'EDIEL_SMTP_FROM', 'EDIEL_SHARED_MAILBOX_ADDRESS', 'EDIEL_MESSAGE_ID_DOMAIN', 'EDIEL_IMAP_HOST', 'EDIEL_IMAP_PORT',
  'EDIEL_IMAP_USER', 'EDIEL_IMAP_PASS', 'EDIEL_CRON_SECRET', 'EDIEL_INBOUND_CRON_SECRET', 'EDIEL_AUTOMATION_ACTOR_USER_ID',
  'NEXT_TELEMETRY_DISABLED',
  ...scenarioKeys,
])

function environment(home) {
  const values = JSON.parse(readFileSync(privatePath(join(home, 'env/track3.json')), 'utf8'))
  need(values && !Array.isArray(values) && typeof values === 'object', 'environment must be a JSON object')
  for (const [key, value] of Object.entries(values)) {
    need(envKeys.has(key) && typeof value === 'string' && !value.includes('\0'), 'environment contains an unknown key or invalid value')
  }
  if (values.T3_E01_N !== undefined) need(/^(?:[1-9]|1[0-9]|2[0-8])$/.test(values.T3_E01_N), 'EDIEL01 cohort must be a canonical integer from 1 to 28')
  for (const key of ['T3_E01_OWN_ID', 'T3_E02_OWN_ID', 'T3_E03_OWN_ID']) {
    if (values[key] !== undefined) need(/^[0-9]{5}$/.test(values[key]), 'scenario party ID must contain exactly five ASCII digits')
  }
  if (values.T3_APP_AUTOMATION_ACTOR_USER_ID !== undefined) need(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(values.T3_APP_AUTOMATION_ACTOR_USER_ID), 'scenario app actor must be a UUID')
  return values
}

function scenarioConfiguration(values) {
  const e01CohortSize = Number(values.T3_E01_N ?? 28)
  return { e01CohortSize, e01CohortScope: e01CohortSize === 28 ? 'full_cohort_28' : 'diagnostic_reduced_cohort',
    overrides: Object.fromEntries(scenarioKeys.filter((key) => values[key] !== undefined).map((key) => [key, values[key]])) }
}

const inspectFormat = '{"Id":{{json .Id}},"Running":{{json .State.Running}},"Name":{{json .Name}},"Image":{{json .Config.Image}},"Labels":{{json .Config.Labels}},"Ports":{{json .NetworkSettings.Ports}}}'
const inspect = (id) => JSON.parse(command('docker', ['inspect', '--type', 'container', '--format', inspectFormat, id]))

function processStat(pid) {
  try {
    const raw = readFileSync(`/proc/${pid}/stat`, 'utf8')
    const fields = raw.slice(raw.lastIndexOf(')') + 2).trim().split(/\s+/)
    return { state: fields[0], group: Number(fields[2]), session: Number(fields[3]), ticks: fields[19] }
  } catch (error) { if (error.code === 'ENOENT' || error.code === 'ESRCH') return null; throw error }
}

function groupMembers(group) {
  return readdirSync('/proc').filter((name) => /^\d+$/.test(name)).map(Number)
    .filter((pid) => { const stat = processStat(pid); return stat && stat.group === group && stat.state !== 'Z' })
}

const expectedArgv = (runtime, role) => role === 'app'
  ? [process.execPath, join(runtime.app, 'node_modules/next/dist/bin/next'), 'start', '-p', String(runtime.a.ports.app), '-H', '127.0.0.1']
  : [process.execPath, join(track, 'counterparty/mail-counterparty.mjs')]

function ownedProcess(runtime, role, receipt, allowStopped = false) {
  need(receipt?.role === role && receipt.environmentId === runtime.a.environmentId && receipt.assignmentSha256 === runtime.assignmentHash
    && Number.isInteger(receipt.pid) && receipt.pid > 1 && /^\d+$/.test(receipt.startTicks), 'process receipt does not bind this assignment')
  const stat = processStat(receipt.pid)
  if (!stat || stat.state === 'Z') {
    need(groupMembers(receipt.pid).length === 0, 'recorded process leader is gone but its group is not empty')
    need(allowStopped, 'assigned process is no longer running')
    return false
  }
  need(stat.group === receipt.pid && stat.session === receipt.pid && stat.ticks === receipt.startTicks, 'process PID/session/start identity differs')
  const legacy = join(runtime.home, `pids/${role}.pid`)
  if (has(legacy)) need(readFileSync(privatePath(legacy), 'utf8').trim() === String(receipt.pid), 'pending process ID disagrees with receipt')
  const cwd = realpathSync(`/proc/${receipt.pid}/cwd`)
  const argv = readFileSync(`/proc/${receipt.pid}/cmdline`, 'utf8').split('\0').filter(Boolean)
  const executable = realpathSync(`/proc/${receipt.pid}/exe`)
  // Next start-server sets process.title, replacing /proc/cmdline. Bind that exact
  // installed-version title as well as the executable, PID birth/session and cwd.
  const nextVersion = role === 'app' ? JSON.parse(readFileSync(join(runtime.app, 'node_modules/next/package.json'), 'utf8')).version : null
  const nextTitle = role === 'app' && argv.length === 1 && argv[0] === `next-server (v${nextVersion})`
  need(executable === realpathSync(process.execPath) && cwd === (role === 'app' ? runtime.app : track)
    && (JSON.stringify(argv) === JSON.stringify(expectedArgv(runtime, role)) || nextTitle), 'process command, executable or working directory differs')
  return true
}

function greenmail(runtime, receipt) {
  need(receipt?.assignmentSha256 === runtime.assignmentHash && fullSha(receipt.id, 64), 'mail container receipt does not bind this assignment')
  const actual = inspect(receipt.id)
  const ports = actual.Ports?.['3143/tcp']
  need(actual.Id === receipt.id && actual.Running === true && actual.Name === `/${runtime.a.greenmailName}`
    && actual.Image === runtime.a.greenmailImage && actual.Labels?.['sim.environment'] === runtime.a.environmentId
    && actual.Labels?.['sim.worker'] === 'codex-track3' && actual.Labels?.['sim.campaign'] === '20261029-3f1a8ab1' && Array.isArray(ports) && ports.length === 1
    && ports[0].HostIp === '127.0.0.1' && ports[0].HostPort === String(runtime.a.ports.imapPlain), 'mail container identity, labels, image or binding differs')
  return actual
}

export function verifyPreparation(prepared, preparationBytes, host, expected, a, replayBytes) {
  const preparation = JSON.parse(preparationBytes)
  need(prepared.preparationRunSha256 === hash(preparationBytes)
    && preparation.schema === 'track3-preparation-run-v1' && fullSha(preparation.planSha256, 64)
    && preparation.appCommit === expected && preparation.harnessCommit === a.harnessCommit
    && prepared.harnessCommit === a.harnessCommit
    && ['bootId', 'daemonId', 'driver', 'dockerRootDir', 'socket', 'socketDev', 'socketInode'].every(key => preparation.host?.[key] === host[key])
    && ['backend', 'replay', 'build'].every(phase => preparation.events?.filter(event => event.phase === phase && event.state === 'COMPLETED').length === 1)
    && preparation.replayReceiptSha256 === hash(replayBytes), 'same-host producer preparation receipt missing or changed')
}

function admission(action) {
  need(['up', 'run', 'down'].includes(action), 'unknown action')
  const app = process.env.SIM_RUN_DIR
  const expected = process.env.T3_APP_COMMIT
  const home = privatePath(process.env.SIM_HOME, true)
  outsideGit(home)
  need(isAbsolute(app ?? '') && realpathSync(app) === app && fullSha(expected), 'explicit canonical app checkout and full source SHA required')
  need(!['.env', '.env.local', '.env.production', '.env.production.local'].some((name) => has(join(app, name))), 'unassigned dotenv file requires coordinator reconciliation')
  need(!within(home, app) && !within(home, checkout), 'private SIM_HOME must be outside both checkouts')
  const assignmentFile = privatePath(process.env.T3_RUNTIME_ASSIGNMENT_FILE)
  outsideGit(dirname(assignmentFile))
  need(!within(assignmentFile, app) && !within(assignmentFile, checkout), 'assignment must be outside checkouts')
  const assignmentBytes = readFileSync(assignmentFile)
  const a = JSON.parse(assignmentBytes)
  need(a?.schema === 'track3-runtime-assignment-v1' && a.workerId === 'codex-track3'
    && typeof a.environmentId === 'string' && a.environmentId.length >= 8 && a.environmentId.length <= 80
    && /^t3-[a-zA-Z0-9-]+$/.test(a.environmentId), 'assignment schema, worker or environment differs')
  need(a.exclusiveHost === true && typeof a.backendReservation === 'string' && a.backendReservation.length > 0
    && Array.isArray(a.allowedActions) && a.allowedActions.includes(action), 'coordinator has not assigned an exclusive backend/producer for this action')
  need(typeof a.expiresAtUtc === 'string' && /(?:Z|\+00:00)$/.test(a.expiresAtUtc) && Date.parse(a.expiresAtUtc) > Date.now(), 'assignment expired or lacks UTC expiry')
  need(a.appDir === app && a.appCommit === expected && a.simHome === home && Array.isArray(a.overlayRefs), 'assigned source, checkout, home or overlays differ')
  need(fullSha(a.harnessCommit) && fullSha(a.harnessTree)
    && command('git', ['-C', checkout, 'rev-parse', 'HEAD']) === a.harnessCommit
    && command('git', ['-C', checkout, 'rev-parse', 'HEAD^{tree}']) === a.harnessTree
    && !command('git', ['-C', checkout, 'status', '--porcelain', '--untracked-files=normal']), 'observed harness source or clean checkout differs')
  need(typeof a.model === 'string' && a.model.trim(), 'explicit model identity required')
  need(a.ports && Object.keys(a.ports).sort().join(',') === 'api,app,control,db,imapPlain,imapTls,smtp'
    && Object.values(a.ports).every((port) => Number.isInteger(port) && port > 0 && port < 65536)
    && new Set(Object.values(a.ports)).size === 7, 'seven distinct explicit ports required')
  need(a.greenmailName === `${a.environmentId}-greenmail` && /^greenmail\/standalone@sha256:[a-f0-9]{64}$/.test(a.greenmailImage), 'assigned mail name or pinned image invalid')
  need(process.version.startsWith('v22.'), 'Node 22 required')
  need(typeof a.projectId === 'string' && /^[a-z0-9][a-z0-9_-]{2,62}$/.test(a.projectId) && a.projectId !== 'gridex-ops-platform', 'explicit non-default backend project required')
  const config = JSON.parse(command('python3', ['-c', 'import json,sys,tomllib;x=tomllib.load(open(sys.argv[1],"rb"));print(json.dumps({"projectId":x["project_id"],"apiPort":x["api"]["port"],"dbPort":x["db"]["port"]}))', join(app, 'supabase/config.toml')]))
  need(config.projectId === a.projectId && config.apiPort === a.ports.api && config.dbPort === a.ports.db, 'backend project/config ports differ')
  const values = environment(home)
  const url = new URL(process.env.T3_DB_URL)
  need(['postgres:', 'postgresql:'].includes(url.protocol) && url.hostname === '127.0.0.1' && url.port === String(a.ports.db)
    && url.pathname === '/postgres' && !url.search && !url.hash && values.T3_DB_URL === process.env.T3_DB_URL, 'DB endpoint is not the assigned canonical loopback database')
  need(['test', 'production'].includes(values.T3_MODE) && values.T3_SIM_HOME === home && values.T3_APP_URL === `http://127.0.0.1:${a.ports.app}`
    && values.NEXT_PUBLIC_SUPABASE_URL === `http://127.0.0.1:${a.ports.api}` && (values.SUPABASE_URL ?? values.NEXT_PUBLIC_SUPABASE_URL) === values.NEXT_PUBLIC_SUPABASE_URL, 'app/API/Storage endpoint differs from assignment')
  const portKeys = { app: 'T3_APP_PORT', smtp: 'T3_SMTP_PORT', imapTls: 'T3_IMAP_TLS_PORT', imapPlain: 'T3_IMAP_PLAIN_PORT', control: 'T3_CONTROL_PORT' }
  need(Object.entries(portKeys).every(([port, key]) => values[key] === String(a.ports[port]))
    && values.EDIEL_SMTP_HOST === '127.0.0.1' && values.EDIEL_SMTP_PORT === String(a.ports.smtp)
    && values.EDIEL_IMAP_HOST === '127.0.0.1' && values.EDIEL_IMAP_PORT === String(a.ports.imapTls)
    && values.EDIEL_SMTP_SECURE === 'true' && values.T3_MAILBOX_ADDRESS === 'ediel@t3.sim.invalid'
    && values.EDIEL_SMTP_USER === values.T3_MAILBOX_ADDRESS && values.EDIEL_IMAP_USER === values.T3_IMAP_USER
    && values.EDIEL_EMAIL_PROVIDER === 'strato' && values.NODE_EXTRA_CA_CERTS === join(home, 'ca/ca.pem'), 'mail/CA endpoint differs from assignment')
  for (const key of ['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'EDIEL_SMTP_PASS', 'T3_IMAP_PASS']) need(values[key]?.length, 'required local credential missing')
  need(values.EDIEL_IMAP_PASS === values.T3_IMAP_PASS, 'IMAP credentials disagree')
  const backendBytes = readFileSync(privatePath(process.env.T3_BACKEND_ASSIGNMENT_FILE))
  const backend = JSON.parse(backendBytes)
  need(hash(backendBytes) === a.backendAssignmentSha256 && backend.version === 1 && backend.workerId === 'T3'
    && backend.environmentId === a.environmentId && backend.projectId === a.projectId && backend.host === '127.0.0.1'
    && backend.port === a.ports.db && backend.database === 'postgres' && fullSha(backend.containerId, 64)
    && /^\d+$/.test(backend.systemIdentifier), 'exact backend assignment differs')
  const actual = inspect(backend.containerId)
  const bindings = actual.Ports?.['5432/tcp']
  need(actual.Id === backend.containerId && actual.Running === true && actual.Labels?.['com.supabase.cli.project'] === a.projectId
    && Array.isArray(bindings) && bindings.length === 1 && bindings[0].HostIp === '127.0.0.1'
    && bindings[0].HostPort === String(a.ports.db), 'backend container identity or loopback binding differs')
  need(fullSha(a.apiContainerId, 64) && fullSha(a.storageContainerId, 64)
    && new Set([backend.containerId, a.apiContainerId, a.storageContainerId]).size === 3, 'distinct assigned DB/API/Storage container IDs required')
  const api = inspect(a.apiContainerId), storage = inspect(a.storageContainerId)
  const apiBindings = api.Ports?.['8000/tcp']
  need(api.Id === a.apiContainerId && api.Running === true && api.Labels?.['com.supabase.cli.project'] === a.projectId
    && Array.isArray(apiBindings) && apiBindings.length === 1 && apiBindings[0].HostIp === '127.0.0.1'
    && apiBindings[0].HostPort === String(a.ports.api), 'assigned API gateway identity or binding differs')
  need(storage.Id === a.storageContainerId && storage.Running === true && storage.Labels?.['com.supabase.cli.project'] === a.projectId, 'assigned Storage service identity differs')
  const dbargs = [process.env.T3_DB_URL, '-XAtq', '-v', 'ON_ERROR_STOP=1']
  const identitySql = "SET default_transaction_read_only=on; SELECT jsonb_build_object('systemIdentifier',(pg_control_system()).system_identifier::text,'database',current_database(),'serverMajor',current_setting('server_version_num')::int/10000)"
  const identity = JSON.parse(command('psql', [...dbargs, '-c', identitySql]))
  need(identity.systemIdentifier === backend.systemIdentifier && identity.database === backend.database && identity.serverMajor === 17, 'observed database system identity or PostgreSQL 17 version differs')
  const runtime = { a, app, home, values, backend, assignmentHash: hash(assignmentBytes) }
  if (action !== 'down') {
    need(command('git', ['-C', app, 'rev-parse', 'HEAD']) === expected && !command('git', ['-C', app, 'status', '--porcelain', '--untracked-files=normal']), 'observed source SHA or clean checkout differs')
    const preparedBytes = readFileSync(privatePath(join(home, 'prepared-runtime.json')))
    const prepared = JSON.parse(preparedBytes)
    need(hash(preparedBytes) === a.preparedReceiptSha256 && prepared.schema === 'track3-prepared-runtime-v1'
      && typeof prepared.producerReservation === 'string' && prepared.producerReservation.length > 0, 'qualified producer replay/build receipt missing or changed')
    const preparationBytes = readFileSync(privatePath(join(home, 'preparation-run.json')))
    const host = JSON.parse(command('python3', [join(track, 'prepare.py'), 'host-check']))
    verifyPreparation(prepared, preparationBytes, host, expected, a, readFileSync(privatePath(join(home, 'producer-replay.json'))))
    need(prepared.appCommit === expected && prepared.replayCommit === expected && prepared.appTree === command('git', ['-C', app, 'rev-parse', 'HEAD^{tree}'])
      && typeof prepared.nextBuildId === 'string' && prepared.nextBuildId.trim().length > 0
      && prepared.nextBuildId === readFileSync(join(app, '.next/BUILD_ID'), 'utf8').trim()
      && prepared.sourceSchemaSha256 === hash(readFileSync(join(app, 'supabase/schema.sql')))
      && prepared.publicBuildEnvSha256 === hash(JSON.stringify([values.NEXT_PUBLIC_SUPABASE_URL, values.NEXT_PUBLIC_SUPABASE_ANON_KEY]))
      && prepared.postReplayAppliedMigrations === 0 && JSON.stringify(prepared.overlayRefs) === JSON.stringify(a.overlayRefs), 'observed source/build/replay/schema/overlay identity differs')
    const ledger = command('psql', [...dbargs, '-F', '\t', '-c', "SET default_transaction_read_only=on; SELECT version, coalesce(name,'') FROM supabase_migrations.schema_migrations ORDER BY version"])
    const fp = command('psql', [...dbargs, '-f', join(app, 'scripts/gridex-aud-003-schema-fingerprint.sql')])
    need(prepared.ledgerMigrationsSha256 === hash(`${ledger}\n`) && fullSha(fp, 64) && prepared.schemaFingerprint === fp, 'observed migration ledger or partial schema fingerprint differs')
    runtime.prepared = prepared
  }
  if (action === 'run') {
    const ready = JSON.parse(readFileSync(privatePath(join(home, 'runtime-ready.json')), 'utf8'))
    need(ready.assignmentSha256 === runtime.assignmentHash && ready.preparedReceiptSha256 === a.preparedReceiptSha256
      && ready.privateEnvSha256 === hash(readFileSync(join(home, 'env/track3.json'))), 'ready receipt or private environment changed')
    for (const role of ['app', 'counterparty']) ownedProcess(runtime, role, JSON.parse(readFileSync(privatePath(join(home, `pids/${role}-process.json`)), 'utf8')))
    greenmail(runtime, JSON.parse(readFileSync(privatePath(join(home, 'pids/greenmail-container.json')), 'utf8')))
  }
  return runtime
}

function savePrivate(file, value) { writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 }) }

async function main(args) {
  if (args[0] === '--env-values') {
    for (const [key, value] of Object.entries(environment(privatePath(process.env.SIM_HOME, true)))) process.stdout.write(`${key}=${value}\0`)
    return
  }
  if (args[0] === '--admit') { admission(args[1]); return }
  if (args[0] === '--prepare-paths') {
    const runtime = admission('up')
    for (const dir of ['pids', 'logs', 'runs', 'evidence', 'mail', 'mail/inbox-dso']) {
      const file = join(runtime.home, dir)
      if (!has(file)) mkdirSync(file, { mode: 0o700 })
      privatePath(file, true)
    }
    for (const name of ['ca/server.key', 'ca/server.pem', 'ca/ca.pem', 'secrets/smtp-pass']) privatePath(join(runtime.home, name))
    need(readFileSync(join(runtime.home, 'secrets/smtp-pass'), 'utf8').trim() === runtime.values.EDIEL_SMTP_PASS, 'prepared local SMTP credential differs')
    return
  }
  if (args[0] === '--apply-fixture') {
    const runtime = admission('up')
    const fixture = JSON.parse(readFileSync(privatePath(join(runtime.home, 'fixture.json')), 'utf8'))
    need(typeof fixture.actorUserId === 'string' && /^[a-f0-9-]{36}$/.test(fixture.actorUserId), 'fixture actor identity invalid')
    const file = privatePath(join(runtime.home, 'env/track3.json'))
    savePrivate(join(runtime.home, 'env/track3.before-fixture.json'), runtime.values)
    writeFileSync(file, `${JSON.stringify({ ...runtime.values, EDIEL_AUTOMATION_ACTOR_USER_ID: fixture.actorUserId }, null, 2)}\n`, { mode: 0o600 })
    return
  }
  if (args[0] === '--ready' || args[0] === '--run-identity') {
    const runtime = admission(args[0] === '--ready' ? 'up' : 'run')
    if (args[0] === '--ready') {
      const fixture = JSON.parse(readFileSync(privatePath(join(runtime.home, 'fixture.json')), 'utf8'))
      need(fixture.mode === runtime.values.T3_MODE && fixture.actorUserId === runtime.values.EDIEL_AUTOMATION_ACTOR_USER_ID
        && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(fixture.actorUserId), 'fixture actor or mode differs from prepared private environment')
      for (const role of ['app', 'counterparty']) ownedProcess(runtime, role, JSON.parse(readFileSync(privatePath(join(runtime.home, `pids/${role}-process.json`)), 'utf8')))
      greenmail(runtime, JSON.parse(readFileSync(privatePath(join(runtime.home, 'pids/greenmail-container.json')), 'utf8')))
      const processes = ['app', 'counterparty'].map((role) => {
        const birth = JSON.parse(readFileSync(privatePath(join(runtime.home, `pids/${role}-process.json`)), 'utf8'))
        ownedProcess(runtime, role, birth)
        const proc = `/proc/${birth.pid}`
        return { pid: birth.pid, startTimeTicks: processStat(birth.pid).ticks,
          exe: realpathSync(`${proc}/exe`), cwd: realpathSync(`${proc}/cwd`),
          cmdlineSha256: hash(readFileSync(`${proc}/cmdline`)), pidFile: `${role}.pid` }
      })
      const mail = JSON.parse(readFileSync(privatePath(join(runtime.home, 'pids/greenmail-container.json')), 'utf8'))
      savePrivate(join(runtime.home, 'cleanup-assignment.json'), {
        schema: 'track3-cleanup-assignment-v1', worker: 'codex-track3', environmentId: runtime.a.environmentId,
        simHome: runtime.home, runDir: runtime.app, runtimeAssignmentSha256: runtime.assignmentHash,
        processes, greenmail: { id: mail.id, labels: { 'sim.track': 'track3', 'sim.campaign': '20261029-3f1a8ab1',
          'sim.worker': 'codex-track3', 'sim.environment': runtime.a.environmentId } },
      })
      savePrivate(join(runtime.home, 'runtime-ready.json'), { assignmentSha256: runtime.assignmentHash, preparedReceiptSha256: runtime.a.preparedReceiptSha256, privateEnvSha256: hash(readFileSync(join(runtime.home, 'env/track3.json'))), readyAtUtc: new Date().toISOString() })
    } else {
      process.stdout.write(`${JSON.stringify({ workerId: runtime.a.workerId, model: runtime.a.model, environmentId: runtime.a.environmentId, appCommit: runtime.a.appCommit, appTree: runtime.prepared.appTree, harnessCommit: runtime.a.harnessCommit, harnessTree: runtime.a.harnessTree, historicalBaselineCommit: '1c0c088cb4ed66d0dd8b3e34c9606019342a1a56', overlayRefs: runtime.a.overlayRefs, nextBuildId: runtime.prepared.nextBuildId, replayCommit: runtime.prepared.replayCommit, sourceSchemaSha256: runtime.prepared.sourceSchemaSha256, schemaFingerprint: runtime.prepared.schemaFingerprint, schemaFingerprintScope: 'partial selected-table identity', ledgerMigrationsSha256: runtime.prepared.ledgerMigrationsSha256, databaseSystemIdentifier: runtime.backend.systemIdentifier, backendContainerId: runtime.backend.containerId, assignmentSha256: runtime.assignmentHash, scenarioConfiguration: scenarioConfiguration(runtime.values) }, null, 2)}\n`)
    }
    return
  }
  if (args[0] === '--resource') {
    const runtime = admission(args[2])
    need(['greenmailName', 'greenmailImage'].includes(args[1]), 'unknown public resource field')
    process.stdout.write(`${runtime.a[args[1]]}\n`)
    return
  }
  if (args[0] === '--record-process') {
    const runtime = admission('up'), role = args[1], pid = Number(args[2])
    need(['app', 'counterparty'].includes(role) && Number.isInteger(pid) && pid > 1, 'invalid process role or PID')
    const stat = processStat(pid)
    need(stat, 'new process exited before identity recording')
    const receipt = { role, pid, startTicks: stat.ticks, environmentId: runtime.a.environmentId, assignmentSha256: runtime.assignmentHash }
    ownedProcess(runtime, role, receipt)
    savePrivate(join(runtime.home, `pids/${role}-process.json`), receipt)
    return
  }
  if (args[0] === '--record-greenmail') {
    const runtime = admission('up'), receipt = { id: args[1], assignmentSha256: runtime.assignmentHash }
    greenmail(runtime, receipt)
    savePrivate(join(runtime.home, 'pids/greenmail-container.json'), receipt)
    return
  }
  const runtime = admission('up')
  const get = (flag, fallback) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : fallback }
  const mode = get('--mode', runtime.values.T3_MODE)
  need(mode === runtime.values.T3_MODE, 'fixture mode differs from private environment')
  const out = get('--out', null)
  need(out === join(runtime.home, 'fixture.json') && !has(out), 'fixture receipt must be fresh under assigned home')
  const { seedFixture } = await import('./seed.mjs')
  ownedProcess(runtime, 'counterparty', JSON.parse(readFileSync(privatePath(join(runtime.home, 'pids/counterparty-process.json')), 'utf8')))
  greenmail(runtime, JSON.parse(readFileSync(privatePath(join(runtime.home, 'pids/greenmail-container.json')), 'utf8')))
  Object.assign(process.env, runtime.values)
  const fixture = await seedFixture({ mode })
  savePrivate(out, { ...fixture, mode })
  console.log(JSON.stringify({ ok: true, companyId: fixture.companyId, actorUserId: fixture.actorUserId, mode }))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) try { await main(process.argv.slice(2)) } catch (error) {
  // Never print captured commands, DB URLs, environment values or raw errors.
  console.error(error.message?.startsWith('BLOCKED: T3 runtime ') ? error.message : 'BLOCKED: T3 runtime private input or identity check failed')
  process.exitCode = 1
}
