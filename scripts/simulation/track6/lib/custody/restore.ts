// Backup/restore-hjälpare för CUSTODY01.05: pg_dump -Fc av stackens databas, pg_restore till en NY databas på samma server, jämförelse.
// Bara databasen t6_restore_<runid> skapas/tas bort; inga andra databaser eller containrar ändras.
// Återställning MED ägare och ACL (ingen --no-owner/--no-acl): pg_restore körs som den lokala superusern supabase_admin (roller är klusterglobala och finns
// redan på samma server), så att ALTER OWNER, GRANT/REVOKE, SECURITY DEFINER-ägare och policies återskapas. Skyddsjämförelsen (protectionsInventory) verifierar det.
// Avvikelse från docs/backup-restore-checklist.md (Supabase PITR/backup in i projektet): lokalt återställs en dump in i en ny, tom databas på samma kluster. Fel på
// plattformsobjekt accepteras bara om de exakt matchar platformOnly (listan loggas); alla andra fel underkänner.
// Steg 3 i checklistan (supabase/sql/checks/production_consistency_checks.sql, checklistan rad 27) körs blockvis mot både källan och den återställda databasen (consistencyBlocks/runBlock).
// Verktyg: explicit T6-tilldelning krävs även för värdverktyg. Ingen container väljs från en global namnlista.
import { spawnSync } from 'node:child_process'
import { closeSync, lstatSync, mkdirSync, openSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { custodyDir, sha256, sqlIn } from './base'
import { dbUrl } from '../seed.mjs'

type BackendAssignment = {
  version: 1; workerId: 'T6'; environmentId: string; containerId: string; projectId: string
  host: '127.0.0.1' | 'localhost'; port: number; database: string; systemIdentifier: string
}
type DatabaseIdentity = { systemIdentifier: string; database: string; serverMajor: number }
export type Tooling = (
  { kind: 'host'; hostMajor: number; serverMajor: number }
  | { kind: 'docker'; container: string; hostMajor: number | null; serverMajor: number }
) & { assignment: BackendAssignment }

const blocked = (reason: string): never => { throw new Error(`BLOCKED: T6 backend assignment ${reason}`) }
const IDENTITY_SQL = `SET default_transaction_read_only=on; SELECT jsonb_build_object('systemIdentifier', (pg_control_system()).system_identifier::text, 'database', current_database(), 'serverMajor', current_setting('server_version_num')::int/10000)`

function readAssignment(): BackendAssignment {
  const file = process.env.T6_BACKEND_ASSIGNMENT_FILE
  if (!file || !isAbsolute(file)) return blocked('missing (T6_BACKEND_ASSIGNMENT_FILE must name an explicit private allocation)')
  let value: Partial<BackendAssignment>
  try {
    const info = lstatSync(file)
    if (!info.isFile() || (info.mode & 0o077) !== 0) return blocked('file must be a private regular file (0600)')
    value = JSON.parse(readFileSync(file, 'utf8')) as Partial<BackendAssignment>
  } catch { return blocked('file is unavailable or invalid') }
  if (!value || value.version !== 1 || value.workerId !== 'T6'
    || typeof value.environmentId !== 'string' || !value.environmentId.trim()
    || typeof value.containerId !== 'string' || !/^[a-f0-9]{64}$/.test(value.containerId)
    || typeof value.projectId !== 'string' || !value.projectId.trim()
    || !['127.0.0.1', 'localhost'].includes(value.host ?? '')
    || !Number.isInteger(value.port) || value.port! < 1 || value.port! > 65535
    || typeof value.database !== 'string' || !/^[a-zA-Z0-9_][a-zA-Z0-9_-]{0,62}$/.test(value.database)
    || typeof value.systemIdentifier !== 'string' || !/^\d+$/.test(value.systemIdentifier)) return blocked('fields do not identify an explicit T6 allocation')
  return {
    version: 1, workerId: 'T6', environmentId: value.environmentId, containerId: value.containerId,
    projectId: value.projectId, host: value.host as BackendAssignment['host'], port: value.port!,
    database: value.database, systemIdentifier: value.systemIdentifier,
  }
}

/** Read-only checks against the allocated container AND the configured host DB; never discovers or stamps an allocation. */
function requireOwnedBackend(tooling?: Tooling): { assignment: BackendAssignment; serverMajor: number } {
  const assignment = readAssignment()
  const source = new URL(dbUrl())
  // libpq query parameters can override URI path/host (including restore targets).
  // Accept only the canonical local endpoint, with no query/fragment or encoded DB alias.
  if (!['postgresql:', 'postgres:'].includes(source.protocol) || source.search || source.hash
    || source.hostname !== assignment.host || Number(source.port) !== assignment.port
    || source.pathname !== `/${assignment.database}`) return blocked('does not match the canonical configured source DB endpoint')
  if (tooling && (JSON.stringify(tooling.assignment) !== JSON.stringify(assignment)
    || (tooling.kind === 'docker' && tooling.container !== assignment.containerId))) return blocked('changed since tooling selection')

  // Select only nonsecret identity fields, not Config.Env or the full inspect payload.
  const format = '{"Id":{{json .Id}},"Running":{{json .State.Running}},"Labels":{{json .Config.Labels}},"Ports":{{json .NetworkSettings.Ports}}}'
  const inspect = spawnSync('docker', ['inspect', '--type', 'container', '--format', format, assignment.containerId], { encoding: 'utf8', timeout: 10_000, maxBuffer: 1_000_000 })
  if (inspect.status !== 0) return blocked('container inspection failed')
  let actual: { Id?: string; Running?: boolean; Labels?: Record<string, string>; Ports?: Record<string, Array<{ HostIp: string; HostPort: string }>> }
  try { actual = JSON.parse(inspect.stdout) as typeof actual } catch { return blocked('container inspection is ambiguous or invalid') }
  if (!actual || Array.isArray(actual) || actual.Id !== assignment.containerId || actual.Running !== true
    || actual.Labels?.['com.supabase.cli.project'] !== assignment.projectId) return blocked('container ID, state or project ownership does not match')
  const ports = actual.Ports?.['5432/tcp']
  if (!Array.isArray(ports) || !ports.some(p => p && ['127.0.0.1', '::1'].includes(p.HostIp) && p.HostPort === String(assignment.port))) return blocked('database port is not published on the assigned loopback endpoint')

  let host: DatabaseIdentity
  try { host = sqlIn<DatabaseIdentity>(IDENTITY_SQL) } catch { return blocked('host DB identity query failed') }
  const queried = spawnSync('docker', ['exec', assignment.containerId, 'psql', '-U', dbUser(), '-d', assignment.database, '-XAtq', '-v', 'ON_ERROR_STOP=1', '-c', IDENTITY_SQL], { encoding: 'utf8', timeout: 10_000, maxBuffer: 100_000 })
  if (queried.status !== 0) return blocked('container DB identity query failed')
  let container: DatabaseIdentity
  try { container = JSON.parse(queried.stdout) as DatabaseIdentity } catch { return blocked('container DB identity is invalid') }
  for (const identity of [host, container]) {
    if (!identity || identity.systemIdentifier !== assignment.systemIdentifier || identity.database !== assignment.database
      || !Number.isInteger(identity.serverMajor) || identity.serverMajor < 10) return blocked('runtime database identity does not match')
  }
  if (host.serverMajor !== container.serverMajor) return blocked('host and container DB versions differ')
  return { assignment, serverMajor: host.serverMajor }
}

/** Vitest globalSetup: refuse every T6 scenario before collection without an owned DB binding. */
export function setup(): void {
  requireOwnedBackend()
}

export function chooseTooling(): Tooling {
  const { assignment, serverMajor } = requireOwnedBackend()
  const v = spawnSync('pg_dump', ['--version'], { encoding: 'utf8' })
  const hostMajor = v.status === 0 ? Number(/(\d+)(?:\.\d+)?/.exec(v.stdout)?.[1] ?? 0) : null
  if (hostMajor !== null && hostMajor >= serverMajor && spawnSync('pg_restore', ['--version']).status === 0) return { kind: 'host', hostMajor, serverMajor, assignment }
  return { kind: 'docker', container: assignment.containerId, hostMajor, serverMajor, assignment }
}

const urlFor = (db: string, role?: string): string => { const u = new URL(dbUrl()); u.pathname = `/${db}`; if (role) u.username = role; return u.toString() }
export const restoreUrl = (db: string) => urlFor(db)
const dbUser = () => decodeURIComponent(new URL(dbUrl()).username || 'postgres')
const baseDb = () => decodeURIComponent(new URL(dbUrl()).pathname.slice(1))

export function dump(t: Tooling, file: string): { ms: number; bytes: number; sha256: string; stderr: string } {
  requireOwnedBackend(t)
  const t0 = Date.now()
  mkdirSync(join(file, '..'), { recursive: true })
  const out = openSync(file, 'w', 0o600)
  try {
    const r = t.kind === 'host'
      ? spawnSync('pg_dump', ['-Fc', '-d', dbUrl()], { stdio: ['ignore', out, 'pipe'], env: { ...process.env, PGPASSWORD: 'postgres' } })
      : spawnSync('docker', ['exec', t.container, 'pg_dump', '-Fc', '-U', dbUser(), baseDb()], { stdio: ['ignore', out, 'pipe'] })
    if (r.status !== 0) throw new Error(`pg_dump misslyckades (${r.status}): ${String(r.stderr).slice(0, 800)}`)
    return { ms: Date.now() - t0, bytes: statSync(file).size, sha256: sha256(readFileSync(file)), stderr: String(r.stderr).slice(0, 2000) }
  } finally { closeSync(out) }
}

const requireRestoreDb = (db: string) => {
  if (!/^t6_restore_[a-zA-Z0-9_]+$/.test(db) || db.length > 63 || db === baseDb()) return blocked('temporary restore DB name is not allowed')
}
export const dbExists = (db: string) => { requireRestoreDb(db); requireOwnedBackend(); return sqlIn<boolean>(`SELECT to_jsonb(EXISTS(SELECT 1 FROM pg_database WHERE datname='${db}'))`) }

type RestoreIdentity = { database: string; oid: string; ownerOid: string; ownerName: string; creator: string }
export type CreatedRestoreDb = Readonly<{
  version: 1; runId: string; database: string; oid: string; ownerOid: string; ownerName: string
  backend: Readonly<BackendAssignment>
}>
// A serialized receipt records evidence but cannot manufacture cleanup authority.
const createdDatabases = new WeakMap<CreatedRestoreDb, string>()
function restoreIdentity(db: string): RestoreIdentity {
  const value = sqlIn<RestoreIdentity | undefined>(`SET default_transaction_read_only=on; SELECT jsonb_build_object('database',datname,'oid',oid::text,'ownerOid',datdba::text,'ownerName',pg_get_userbyid(datdba),'creator',current_user) FROM pg_database WHERE datname='${db}'`)
  if (!value || value.database !== db || typeof value.oid !== 'string' || typeof value.ownerOid !== 'string'
    || !/^[1-9][0-9]*$/.test(value.oid) || !/^[1-9][0-9]*$/.test(value.ownerOid)
    || value.ownerName !== value.creator || value.creator !== dbUser()) return blocked('restore DB identity is unknown or not created by the current role')
  return value
}
function requireCreatedDb(db: string, handle: CreatedRestoreDb, runId: string, tooling?: Tooling): void {
  requireRestoreDb(db)
  const { assignment } = requireOwnedBackend(tooling)
  if (!handle || !createdDatabases.has(handle) || handle.database !== db || handle.runId !== runId
    || createdDatabases.get(handle) !== JSON.stringify(assignment)) return blocked('restore DB has no matching current-attempt creation handle')
  const actual = restoreIdentity(db)
  if (actual.oid !== handle.oid || actual.ownerOid !== handle.ownerOid || actual.ownerName !== handle.ownerName) return blocked('restore DB identity changed after creation')
}
export function createDb(db: string, runId: string): CreatedRestoreDb {
  requireRestoreDb(db)
  if (typeof runId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(runId)
    || db !== `t6_restore_${runId.replace(/[^a-z0-9]/gi, '').toLowerCase()}`) return blocked('restore DB run identity does not match')
  const { assignment } = requireOwnedBackend()
  sqlIn(`CREATE DATABASE "${db}"`)
  // Failure after CREATE leaves an unknown target for coordinator reconciliation.
  const current = requireOwnedBackend()
  if (JSON.stringify(current.assignment) !== JSON.stringify(assignment)) return blocked('allocation changed during restore DB creation')
  const identity = restoreIdentity(db)
  const handle: CreatedRestoreDb = Object.freeze({ version: 1, runId, database: db, oid: identity.oid,
    ownerOid: identity.ownerOid, ownerName: identity.ownerName, backend: Object.freeze({ ...assignment }) })
  createdDatabases.set(handle, JSON.stringify(assignment))
  return handle
}
export function dropDb(db: string, handle: CreatedRestoreDb, runId: string): void {
  requireCreatedDb(db, handle, runId)
  // Requires the separately qualified exclusive DDL producer. Identity-check +
  // DROP is not transactional; no FORCE against unidentified connections.
  sqlIn(`DROP DATABASE "${db}"`)
  createdDatabases.delete(handle)
}

export type RestoreErrorBlock = { error: string; command: string }
const RESTORE_ROLE = 'supabase_admin'
export function restore(t: Tooling, file: string, db: string, handle: CreatedRestoreDb, runId: string): { ms: number; status: number; errors: string[]; blocks: RestoreErrorBlock[]; stderrTail: string } {
  requireCreatedDb(db, handle, runId, t)
  const t0 = Date.now()
  const input = openSync(file, 'r')
  try {
    const r = t.kind === 'host'
      ? spawnSync('pg_restore', ['-d', urlFor(db, RESTORE_ROLE)], { stdio: [input, 'ignore', 'pipe'], env: { ...process.env, PGPASSWORD: 'postgres' }, maxBuffer: 64_000_000 })
      : spawnSync('docker', ['exec', '-i', t.container, 'pg_restore', '-U', RESTORE_ROLE, '-d', db], { stdio: [input, 'ignore', 'pipe'], maxBuffer: 64_000_000 })
    const stderr = r.stderr == null ? '' : String(r.stderr)
    const refuse = (reason: string): never => {
      const code = (r.error as NodeJS.ErrnoException | undefined)?.code
      throw Object.assign(new Error(`pg_restore_refused: ${reason}`), { restoreFailure: {
        reason, status: Number.isInteger(r.status) ? r.status : null, signal: r.signal ?? null,
        spawnCode: typeof code === 'string' && /^[A-Z0-9_]+$/.test(code) ? code : null,
        ms: Date.now() - t0, stderrBytes: Buffer.byteLength(stderr), stderrSha256: sha256(stderr),
      } })
    }
    // Process completion is checked before interpreting any stderr as allowed SQL errors.
    if (r.error || r.signal || (r.status !== 0 && r.status !== 1)) refuse('process_did_not_complete_normally')
    const pattern = /^pg_restore: error: ([^\n]*)\nCommand was: ([^\n]*)(?:\n|$)/gm
    const blocks: RestoreErrorBlock[] = [...stderr.matchAll(pattern)].map(m => ({ error: m[1], command: m[2] }))
    const errors = stderr.split('\n').filter(l => /error:/i.test(l))
    const summaries = [...stderr.matchAll(/^pg_restore: warning: errors ignored on restore: ([1-9][0-9]*)\s*$/gm)]
    const residue = stderr.replace(pattern, '').replace(/^pg_restore: warning: errors ignored on restore: [1-9][0-9]*\s*$/gm, '')
      .split('\n').filter(l => l.trim() && !/^pg_restore: (while PROCESSING TOC:|from TOC entry [0-9]+; [^\r\n]+)$/.test(l))
    const allowed = r.status === 0 ? stderr.trim() === '' : blocks.length > 0 && blocks.every(platformOnly)
      && errors.length === blocks.length && summaries.length === 1 && Number(summaries[0][1]) === blocks.length && residue.length === 0
    if (!allowed) refuse('unaccounted_restore_diagnostics')
    return { ms: Date.now() - t0, status: r.status!, errors: errors.slice(0, 200), blocks, stderrTail: stderr.slice(-3000) }
  } finally { closeSync(input) }
}

/** psql mot given URL; returnerar råa rader (fältsep '|'). */
export function psqlRows(url: string, script: string): string[][] {
  const r = spawnSync('psql', [url, '-XAtq', '-v', 'ON_ERROR_STOP=1'], { input: script, encoding: 'utf8', timeout: 300_000, maxBuffer: 128_000_000, env: { ...process.env, PGPASSWORD: 'postgres' } })
  if (r.status !== 0) throw new Error(`psql ${url.replace(/:[^:@/]*@/, ':***@')}: ${r.stderr.slice(0, 600)}`)
  return r.stdout.split('\n').filter(Boolean).map((l) => l.split('|'))
}

export const baseTables = (url: string): string[] => psqlRows(url, `SELECT table_schema||'.'||table_name FROM information_schema.tables WHERE table_type='BASE TABLE' AND table_schema NOT IN ('pg_catalog','information_schema') ORDER BY 1;`).map((r) => r[0])

const q = (t: string) => t.split('.').map((p) => `"${p}"`).join('.')
export function rowCounts(url: string, tables: string[]): Record<string, number> {
  const rows = psqlRows(url, tables.map((t) => `SELECT '${t}', count(*) FROM ${q(t)};`).join('\n'))
  return Object.fromEntries(rows.map((r) => [r[0], Number(r[1])]))
}

/** Innehållshash (sha256 över ordnat innehåll) för kustodytabellerna; originalkropparna i ediel_messages, rows_sha256-fakturafiler, underlag, gridex_billing_source/received_sources, storage.objects-metadata. */
export function contentHashes(url: string, allTables: string[]): Record<string, { rows: number; sha256: string }> {
  const generic = (t: string, cols = 'to_jsonb(x)::text') => `SELECT '${t}', count(*), encode(sha256(convert_to(coalesce(string_agg(r, E'\\n' ORDER BY r),''),'UTF8')),'hex') FROM (SELECT ${cols} r FROM ${q(t)} x) z;`
  const custom: Record<string, string> = {
    'public.ediel_messages': generic('public.ediel_messages', `x.id::text||':'||coalesce(x.raw_payload,'')||':'||coalesce(x.immutable_payload_hash,'')||':'||coalesce(x.interchange_reference,'')`),
    'public.invoice_export_files': generic('public.invoice_export_files', `x.id::text||':'||x.rows_sha256||':'||x.rows::text`),
    'storage.objects': generic('storage.objects', `x.id::text||':'||x.bucket_id||':'||x.name||':'||coalesce(x.metadata::text,'')||':'||coalesce(x.version,'')`),
  }
  const scope = allTables.filter((t) => t === 'public.billing_underlays' || t === 'public.ediel_messages' || t === 'public.invoice_export_files' || t === 'storage.objects' || t.startsWith('gridex_billing_source.') || t.startsWith('gridex_received_sources.') || t.startsWith('gridex_ediel_inbound_receptions.'))
  const rows = psqlRows(url, scope.map((t) => custom[t] ?? generic(t)).join('\n'))
  return Object.fromEntries(rows.map((r) => [r[0], { rows: Number(r[1]), sha256: r[2] }]))
}

/** Triggerinventering (skydden som ska överleva återställning). */
export const triggerInventory = (url: string): string[] => psqlRows(url, `SELECT c.relnamespace::regnamespace::text||'.'||c.relname||':'||t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal AND c.relnamespace::regnamespace::text NOT IN ('pg_catalog','information_schema') ORDER BY 1;`).map((r) => r[0])
export { custodyDir }

/** Fel som beror på att postgres-rollen inte äger plattformsobjekt (supabase_admin), inte på custody-data. Allt annat är datapåverkande/okänt. */
export const platformOnly = (b: RestoreErrorBlock): boolean =>
  /permission denied/.test(b.error) && /(COPY extensions\.spatial_ref_sys|COPY vault\.secrets|FUNCTION realtime\.list_changes)/.test(b.command)

const checksPath = () => fileURLToPath(new URL('../../../../../supabase/sql/checks/production_consistency_checks.sql', import.meta.url))
/** Delar production_consistency_checks.sql i dess numrerade block ("-- N) ..."); filen säger "Run each block separately". */
export function consistencyBlocks(): Array<{ n: number; title: string; sql: string }> {
  const text = readFileSync(checksPath(), 'utf8')
  const marks = [...text.matchAll(/^-- (\d+)\) (.*)$/gm)]
  return marks.map((m, i) => ({ n: Number(m[1]), title: m[2], sql: text.slice(m.index! + m[0].length, marks[i + 1]?.index ?? text.length).trim() }))
}
/** Kör ett block (skrivskyddad diagnostik) mot en URL; returnerar utdatarader sorterade (blocken saknar ORDER BY på alla). */
export function runBlock(url: string, sqlText: string): string[] {
  const r = spawnSync('psql', [url, '-XAt', '-v', 'ON_ERROR_STOP=1', '-c', 'SET default_transaction_read_only=on', '-c', sqlText], { encoding: 'utf8', timeout: 300_000, maxBuffer: 64_000_000, env: { ...process.env, PGPASSWORD: 'postgres' } })
  if (r.status !== 0) throw new Error(`consistency block misslyckades: ${r.stderr.slice(0, 500)}`)
  return r.stdout.split('\n').filter((l) => l && l !== 'SET').sort()
}

const PLATFORM_SCHEMAS = `'pg_catalog','information_schema','pg_toast','auth','extensions','vault','graphql','graphql_public','pgsodium','pgsodium_masks','realtime','supabase_functions','supabase_migrations','net','cron','_realtime','_analytics','pgbouncer','storage'`
const effTuple = `x.grantor::regrole::text||':'||CASE x.grantee WHEN 0 THEN 'PUBLIC' ELSE x.grantee::regrole::text END||':'||x.privilege_type||':'||x.is_grantable::text`
const oneLine = (e: string) => `replace(replace(coalesce(${e},''),E'\\n',' '),E'\\r',' ')`
/**
 * Skyddsinventering (ska vara identisk, sorterad, i källa och återställd databas): policies, ACL/ägare (tabeller, kolumner, scheman, funktioner),
 * SECURITY DEFINER + proconfig (search_path), RLS-flaggor samt triggers. Plattformsscheman undantas utom att policies/RLS på storage ingår (produktens storage-skydd).
 */
export function protectionsInventory(url: string): Record<string, string[]> {
  const q = (name: string, sqlText: string) => [name, psqlRows(url, sqlText).map((r) => r.join('|'))] as const
  return Object.fromEntries([
    q('policies', `SELECT schemaname||'.'||tablename||'|'||policyname||'|'||cmd||'|'||permissive::text||'|'||roles::text||'|'||${oneLine('qual')}||'|'||${oneLine('with_check')} FROM pg_policies WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY 1;`),
    q('rls_flags', `SELECT n.nspname||'.'||c.relname||'|'||c.relrowsecurity::text||'|'||c.relforcerowsecurity::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND (n.nspname NOT IN (${PLATFORM_SCHEMAS}) OR n.nspname='storage') ORDER BY 1;`),
    // Effektiva privilegier: pg_dump skriver ingen GRANT för en ACL som är lika med ägarens default, så källan kan ha explicit {owner=arwdDxtm/owner} medan den återställda
    // har NULL (= acldefault). Båda normaliseras via aclexplode(coalesce(acl, acldefault(typ, ägare))). Kolumner har ingen default (NULL = tom mängd).
    q('relation_acl_owner', `SELECT n.nspname||'.'||c.relname||'|'||c.relkind::text||'|'||pg_get_userbyid(c.relowner)||'|'||coalesce((SELECT string_agg(${effTuple}, ',' ORDER BY x.grantor, x.grantee, x.privilege_type) FROM aclexplode(coalesce(c.relacl, acldefault(CASE WHEN c.relkind='S' THEN 's'::"char" ELSE 'r'::"char" END, c.relowner))) x),'') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p','v','m','S','f') AND n.nspname NOT IN (${PLATFORM_SCHEMAS}) ORDER BY 1;`),
    q('column_acl', `SELECT n.nspname||'.'||c.relname||'.'||a.attname||'|'||(SELECT string_agg(${effTuple}, ',' ORDER BY x.grantor, x.grantee, x.privilege_type) FROM aclexplode(a.attacl) x) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE a.attacl IS NOT NULL AND cardinality(a.attacl)>0 AND NOT a.attisdropped AND n.nspname NOT IN (${PLATFORM_SCHEMAS}) ORDER BY 1;`),
    q('schema_acl_owner', `SELECT nspname||'|'||pg_get_userbyid(nspowner)||'|'||coalesce((SELECT string_agg(${effTuple}, ',' ORDER BY x.grantor, x.grantee, x.privilege_type) FROM aclexplode(coalesce(nspacl, acldefault('n'::"char", nspowner))) x),'') FROM pg_namespace WHERE nspname NOT IN (${PLATFORM_SCHEMAS}) AND nspname NOT LIKE 'pg_temp%' AND nspname NOT LIKE 'pg_toast_temp%' ORDER BY 1;`),
    q('function_owner_acl_secdef_config', `SELECT n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')|'||pg_get_userbyid(p.proowner)||'|'||p.prosecdef::text||'|'||coalesce(p.proconfig::text,'')||'|'||coalesce((SELECT string_agg(${effTuple}, ',' ORDER BY x.grantor, x.grantee, x.privilege_type) FROM aclexplode(coalesce(p.proacl, acldefault('f'::"char", p.proowner))) x),'') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT IN (${PLATFORM_SCHEMAS}) ORDER BY 1;`),
    // Rå ACL-text (endast observation; ingår inte i påståendet).
    q('raw_relation_acl', `SELECT n.nspname||'.'||c.relname||'|'||coalesce(c.relacl::text,'') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p','v','m','S','f') AND n.nspname NOT IN (${PLATFORM_SCHEMAS}) ORDER BY 1;`),
    q('raw_schema_acl', `SELECT nspname||'|'||coalesce(nspacl::text,'') FROM pg_namespace WHERE nspname NOT IN (${PLATFORM_SCHEMAS}) AND nspname NOT LIKE 'pg_temp%' AND nspname NOT LIKE 'pg_toast_temp%' ORDER BY 1;`),
    q('raw_function_acl', `SELECT n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')|'||coalesce(p.proacl::text,'') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT IN (${PLATFORM_SCHEMAS}) ORDER BY 1;`),
    ['triggers', triggerInventory(url)] as const,
  ])
}
