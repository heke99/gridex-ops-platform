// Fresh full pinned history, never a partial schema or an existing replay stack.
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, it, onTestFailed } from 'vitest'

const root = resolve(__dirname, '..')
const pinned = 'ae56ee0a1e0e8adbce9d5f4d92da75cdcb8010c8'
const DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const fingerprint = 'c70fa2f017f6ce3af3ff806d948f18b58a3c196e4bf94daa9304629a3926680c'
const mode = process.env.GRIDEX_BACKFILL_NATIVE_MODE ?? 'outer'
const sha = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex')
function fileHash(path: string) {
  const fd = openSync(path, 'r'), hash = createHash('sha256'), chunk = Buffer.alloc(1_048_576)
  try { let count: number; while ((count = readSync(fd, chunk, 0, chunk.length, null)) !== 0) hash.update(chunk.subarray(0, count)) }
  finally { closeSync(fd) }
  return hash.digest('hex')
}
const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'"
type ScriptKind = 'dry-run' | 'apply'
const expectedHashes = {
  'dry-run': '9c23172b13bf27d28a2f84ed9c2b0141b286e56052b673226667a9db06b0b3a9',
  apply: 'ba07547e3e9983738db2345f08aec15d65c094acdedd63364fd820c5c9bdafe3',
}
function source(kind: ScriptKind): string {
  const text = readFileSync(join(root, 'scripts', `canonical-multitenant-backfill-${kind}.sql`), 'utf8')
  if (sha(text) !== expectedHashes[kind]) throw new Error('backfill_native_frozen_sql_changed')
  return text
}
function relations() {
  const extract = (text: string) => [...text.matchAll(/\('([a-z_]+)', '([a-z_]+)', '([a-z_]+)'\)/g)]
    .map(row => ({ child: row[1], column: row[2], parent: row[3] }))
  const rows = extract(source('apply'))
  if (rows.length !== 18 || JSON.stringify(rows) !== JSON.stringify(extract(source('dry-run')))) {
    throw new Error('backfill_native_relation_inventory_changed')
  }
  return rows
}
function assertScope(env: Readonly<Record<string, string | undefined>>) {
  if (env.CI !== 'true' || env.GRIDEX_BACKFILL_NATIVE_ALLOW_NEW_STACK !== '1' || !env.RUNNER_TEMP ||
    env.GRIDEX_REPLAY_DB_URL || process.versions.node.split('.')[0] !== '22') {
    throw new Error('backfill_native_requires_exclusive_local_ci_stack')
  }
}
function assertNoStack(output: string) {
  if (/supabase_db_gridex-ops-platform|(?:127\.0\.0\.1|0\.0\.0\.0|\[::\]):54322->/.test(output)) {
    throw new Error('backfill_native_existing_local_stack_refused')
  }
}
function historicalBytes(baseline: string) {
  const names = readdirSync(join(baseline, 'supabase/migrations')).filter(name => name.endsWith('.sql')).sort()
  if (names.length !== 653) throw new Error('backfill_native_baseline_inventory_mismatch')
  for (const name of names) {
    const current = join(root, 'supabase/migrations', name)
    if (!existsSync(current) || !readFileSync(current).equals(readFileSync(join(baseline, 'supabase/migrations', name)))) {
      throw new Error('backfill_native_historical_bytes_changed')
    }
  }
  return sha(names.map(name => name + ':' + sha(readFileSync(join(baseline, 'supabase/migrations', name)))).join('\n'))
}
// Subshell redirection also protects the original script's EXIT cleanup output.
// The original source is not under if/!, so errexit stays active during replay.
function harness() {
  return `#!/usr/bin/env bash
set -euo pipefail
umask 077
readonly BACKFILL_TEMP="$1" BACKFILL_CANDIDATE="$2" BACKFILL_NODE="$3"
unset DOCKER_CONTEXT GRIDEX_REPLAY_DB_URL
export DOCKER_HOST=unix:///var/run/docker.sock
(
  cd "$BACKFILL_TEMP/baseline"
  source scripts/gridex-aud-003-clean-replay.sh > "$BACKFILL_TEMP/baseline-clean.log" 2>&1
  [[ "$DB_URL" == ${DB} ]]
  [[ "$ACTUAL_FINGERPRINT" == ${fingerprint} ]]
  export GRIDEX_BACKFILL_NATIVE_MODE=inner
  export GRIDEX_BACKFILL_NATIVE_DIRECTORY="$BACKFILL_TEMP"
  export GRIDEX_BACKFILL_NATIVE_BASELINE_FINGERPRINT="$ACTUAL_FINGERPRINT"
  (
    cd "$BACKFILL_CANDIDATE"
    "$BACKFILL_NODE" node_modules/vitest/vitest.mjs run --config scripts/canonical-multitenant-backfill-20261001-native.config.ts > "$BACKFILL_TEMP/inner.log" 2>&1
  )
) > "$BACKFILL_TEMP/stack.log" 2>&1
`
}
type Witness = { case: string; outcome: string; sqlstate?: string; constraint?: string }
type Receipt = { baseline: string; historicalSha256: string; archiveSha256: string; oldReplaySha256: string; sqlSha256: typeof expectedHashes;
  witnesses: Witness[]; inventorySha256?: string; inventoryTriples?: number; warmupBefore?: string; warmupAfter?: string }

if (mode === 'source-check') {
  describe('source and Bash boundaries only; native PostgreSQL NOT_EXECUTED', () => {
    it('binds both complete frozen scripts to the same exact 18 triples', () => {
      expect(relations()).toHaveLength(18)
      expect(source('apply')).not.toMatch(/disable trigger|session_replication_role|bypassrls/i)
    })
    it.each([
      { CI: 'false', RUNNER_TEMP: '/tmp', GRIDEX_BACKFILL_NATIVE_ALLOW_NEW_STACK: '1' },
      { CI: 'true', RUNNER_TEMP: '/tmp' },
      { CI: 'true', RUNNER_TEMP: '/tmp', GRIDEX_BACKFILL_NATIVE_ALLOW_NEW_STACK: '1', GRIDEX_REPLAY_DB_URL: 'private' },
    ])('refuses unsafe provisioning context before any command', env => {
      expect(() => assertScope(env)).toThrow('backfill_native_requires_exclusive_local_ci_stack')
    })
    it('refuses the existing project container and any occupied configured database port', () => {
      expect(() => assertNoStack('supabase_db_gridex-ops-platform')).toThrow('existing_local_stack_refused')
      expect(() => assertNoStack('unrelated\t0.0.0.0:54322->5432/tcp')).toThrow('existing_local_stack_refused')
      expect(() => assertNoStack('unrelated\t0.0.0.0:54399->5432/tcp')).not.toThrow()
    })
    it('archives and compares every real pinned historical SQL byte without a database', () => {
      const directory = mkdtempSync(join(tmpdir(), 'backfill-source-check.'))
      try {
        const archive = join(directory, 'pinned-archive.tar')
        execFileSync('git', ['archive', pinned, '--output='+archive], { cwd: root })
        execFileSync('tar', ['-xf', archive, '-C', directory])
        expect(historicalBytes(directory)).toMatch(/^[0-9a-f]{64}$/)
      } finally { rmSync(directory, { recursive: true, force: true }) }
    })
    it.each([0, 7, 9])('executes the exact Bash wrapper with private synthetic logs and original failure %s', exit => {
      const directory = mkdtempSync(join(tmpdir(), 'backfill-wrapper-check.'))
      try {
        mkdirSync(join(directory, 'baseline/scripts'), { recursive: true })
        const cleanup = join(directory, 'cleanup-receipt')
        writeFileSync(join(directory, 'baseline/scripts/gridex-aud-003-clean-replay.sh'),
          `set -euo pipefail\ntrap 'echo disposed > "${cleanup}"; echo sb_secret_SYNTHETIC_CLEANUP' EXIT\necho sb_secret_SYNTHETIC_START\n` +
          (exit === 7 ? 'exit 7\n' : `DB_URL=${DB}\nACTUAL_FINGERPRINT=${fingerprint}\n`))
        const node = join(directory, 'node')
        writeFileSync(node, `#!/usr/bin/env bash\necho sb_publishable_SYNTHETIC_CHILD\nexit ${exit === 9 ? 9 : 0}\n`, { mode: 0o700 })
        writeFileSync(join(directory, 'harness.sh'), harness(), { mode: 0o600 })
        const result = spawnSync('bash', [join(directory, 'harness.sh'), directory, root, node], { encoding: 'utf8' })
        expect(result.status).toBe(exit)
        expect(result.stdout + result.stderr).not.toMatch(/sb_secret_|sb_publishable_/)
        expect(readFileSync(cleanup, 'utf8').trim()).toBe('disposed')
        expect(readFileSync(join(directory, 'stack.log'), 'utf8') + readFileSync(join(directory, 'baseline-clean.log'), 'utf8')).toContain('sb_secret_SYNTHETIC_CLEANUP')
        if (exit === 7) expect(existsSync(join(directory, 'inner.log'))).toBe(false)
      } finally { rmSync(directory, { recursive: true, force: true }) }
      expect(existsSync(directory)).toBe(false)
    })
  })
} else if (mode === 'outer') {
  it('provisions one exclusive pinned old Supabase stack and runs genuine PostgreSQL witnesses', () => {
    assertScope(process.env)
    const dockerEnv = { ...process.env }; delete dockerEnv.DOCKER_HOST; delete dockerEnv.DOCKER_CONTEXT
    let containers: string
    try { containers = execFileSync('docker', ['--host=unix:///var/run/docker.sock', 'ps', '--format', '{{.Names}}\t{{.Ports}}'],
      { env: dockerEnv, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }) }
    catch { throw new Error('backfill_native_local_docker_unavailable') }
    assertNoStack(containers)
    const directory = mkdtempSync(join(realpathSync(process.env.RUNNER_TEMP!), 'canonical-backfill-native.'))
    try {
      mkdirSync(join(directory, 'baseline'))
      const archive = join(directory, 'pinned-archive.tar')
      execFileSync('git', ['archive', pinned, '--output='+archive], { cwd: root })
      execFileSync('tar', ['-xf', archive, '-C', join(directory, 'baseline')])
      const receipt: Receipt = { baseline: pinned, historicalSha256: historicalBytes(join(directory, 'baseline')),
        archiveSha256: fileHash(archive), oldReplaySha256: sha(readFileSync(join(directory, 'baseline/scripts/gridex-aud-003-clean-replay.sh'))),
        sqlSha256: expectedHashes, witnesses: [] }
      relations()
      writeFileSync(join(directory, 'receipt.json'), JSON.stringify(receipt), { mode: 0o600 })
      writeFileSync(join(directory, 'harness.sh'), harness(), { mode: 0o600 })
      const result = spawnSync('bash', [join(directory, 'harness.sh'), directory, root, process.execPath],
        { env: process.env, encoding: 'utf8', maxBuffer: 10_000, stdio: ['pipe', 'pipe', 'pipe'] })
      const final = JSON.parse(readFileSync(join(directory, 'receipt.json'), 'utf8')) as Receipt
      // These fields contain only fixed enum labels, public identifiers and hashes.
      console.log('BACKFILL_NATIVE_RECEIPT ' + JSON.stringify(final))
      if (result.status !== 0) throw new Error('backfill_native_failed_private_context_removed')
      expect(final.witnesses.some(row => row.outcome === 'REPAIR_PASS')).toBe(true)
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
} else {
  const directory = process.env.GRIDEX_BACKFILL_NATIVE_DIRECTORY ?? ''
  let receipt: Receipt
  let boundary = 'initial_context'
  function save() { writeFileSync(join(directory, 'receipt.json'), JSON.stringify(receipt), { mode: 0o600 }) }
  function witness(value: Witness) { receipt.witnesses.push(value); save() }
  function sql(text: string, expectedFailure?: string): string {
    assertScope(process.env)
    try { return execFileSync('psql', [DB, '-XAtq', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'],
      { encoding: 'utf8', input: text, timeout: 120_000, maxBuffer: 30_000_000, stdio: ['pipe', 'pipe', 'pipe'] }).trim() }
    catch (error) {
      const stderr = String((error as { stderr?: unknown }).stderr ?? '')
      const code = stderr.match(/ERROR:\s+([0-9A-Z]{5}):/)?.[1] ?? 'UNKNOWN'
      if (receipt && code !== expectedFailure) witness({ case: boundary, outcome: 'ACTUAL_UNEXPECTED_SQL_FAILURE', sqlstate: code })
      throw Object.assign(new Error('backfill_native_postgres_' + code), { code })
    }
  }
  function json<T>(text: string): T {
    const output = sql(text).split('\n').filter(Boolean)
    return JSON.parse(output.at(-1)!) as T
  }
  const A = randomUUID(), B = randomUUID(), customerA = randomUUID(), customerB = randomUUID()
  const poaA = randomUUID(), poaB = randomUUID(), missingPoa = randomUUID()
  const cases = [
    { name: 'agreed_null', id: randomUUID(), company: null, poa: poaA, classification: 'safe_fill_from_parent' },
    { name: 'conflicting_null', id: randomUUID(), company: null, poa: poaB, classification: 'ambiguous_cross_tenant_conflict' },
    { name: 'missing_parent', id: randomUUID(), company: null, poa: missingPoa, classification: 'manual_review_unresolved_parent' },
    { name: 'nonnull_mismatch', id: randomUUID(), company: A, poa: poaB, classification: 'ambiguous_cross_tenant_conflict' },
  ]
  const seedResults: Record<string, { code: string; constraint: string }> = {}
  const tripleSql = () => relations().map(row => `(${quote(row.child)},${quote(row.column)},${quote(row.parent)})`).join(',')
  // Digests include every persistent row in the real old schemas, plus every
  // company-scoped quiet-tenant table; no synthetic typed table substitutes.
  function snapshot() {
    return json<{ whole: Record<string, string>; quiet: Record<string, string> }>(`begin;
      set transaction isolation level repeatable read;
      create temporary table backfill_snapshot(scope text,table_name text,digest text) on commit drop;
      do $snapshot$ declare r record; d text; begin
      for r in select c.oid,n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
       where n.nspname !~ '^pg_' and n.nspname not in
        ('information_schema','cron','net','realtime','extensions','graphql','graphql_public','vault') and c.relkind in ('r','p')
       order by n.nspname,c.relname loop
       execute format('select md5(coalesce(string_agg(to_jsonb(t)::text,E''\\n'' order by to_jsonb(t)::text),'''')) from %I.%I t',r.nspname,r.relname) into d;
       insert into backfill_snapshot values('whole',r.nspname||'.'||r.relname,d);
       if exists(select 1 from pg_attribute where attrelid=r.oid and attname='company_id' and atttypid='uuid'::regtype and not attisdropped) then
        execute format('select md5(coalesce(string_agg(to_jsonb(t)::text,E''\\n'' order by to_jsonb(t)::text),'''')) from %I.%I t where company_id=$1',r.nspname,r.relname) into d using ${quote(B)}::uuid;
        insert into backfill_snapshot values('quiet',r.nspname||'.'||r.relname,d);
       end if;
      end loop; end; $snapshot$;
      select jsonb_build_object('whole',(select jsonb_object_agg(table_name,digest) from backfill_snapshot where scope='whole'),
       'quiet',(select jsonb_object_agg(table_name,digest) from backfill_snapshot where scope='quiet')); commit;`)
  }
  function documents() {
    return json<Record<string, unknown>[]>(`select coalesce(jsonb_agg(to_jsonb(d) order by id),'[]')
      from public.customer_authorization_documents d where id in (${cases.map(row => quote(row.id)).join(',')});`)
  }
  function dryCandidates() {
    return json<{ row_id: string; classification: string }[]>(source('dry-run') + `\nselect coalesce(jsonb_agg(to_jsonb(r) order by row_id,relation_name),'[]')
      from canonical_multitenant_repair_candidates r where table_name='customer_authorization_documents' and row_id in (${cases.map(row => quote(row.id)).join(',')});`)
  }
  describe('genuine full-old-schema local PostgreSQL backfill', () => {
    beforeAll(() => {
      assertScope(process.env)
      const runner = realpathSync(process.env.RUNNER_TEMP!) + '/'
      if (!directory || !realpathSync(directory).startsWith(runner) || !directory.startsWith(runner + 'canonical-backfill-native.') ||
        (statSync(directory).mode & 0o077) !== 0 || process.env.GRIDEX_BACKFILL_NATIVE_BASELINE_FINGERPRINT !== fingerprint) {
        throw new Error('backfill_native_private_pinned_stack_required')
      }
      receipt = JSON.parse(readFileSync(join(directory, 'receipt.json'), 'utf8')) as Receipt
      expect(receipt.baseline).toBe(pinned)
      // The original sourced replay deliberately holds migrations outside its
      // directory until EXIT. Validate the preserved exact archive and original
      // source, not that temporarily reordered live directory.
      expect(fileHash(join(directory, 'pinned-archive.tar'))).toBe(receipt.archiveSha256)
      expect(sha(readFileSync(join(directory, 'baseline/scripts/gridex-aud-003-clean-replay.sh')))).toBe(receipt.oldReplaySha256)
      expect(sha(execFileSync('git', ['show', pinned+':scripts/gridex-aud-003-clean-replay.sh'], { cwd: root }))).toBe(receipt.oldReplaySha256)
      expect(json<string>('select to_jsonb(current_database());')).toBe('postgres')
      expect(sql(readFileSync(join(directory, 'baseline/scripts/gridex-aud-003-schema-fingerprint.sql'), 'utf8'))).toBe(fingerprint)
      expect(json<boolean>(`select to_jsonb(to_regprocedure('public.gridex_change_customer_billing_profile_v1(jsonb)') is null
       and not exists(select 1 from information_schema.columns where table_schema='public' and table_name='customers'
        and column_name in ('billing_profile','profile_revision','address_book_revision')));`)).toBe(true)
      boundary = 'actual_catalog_inventory'
      const inventory = json<unknown[]>(`with triples(child,column_name,parent) as (values ${tripleSql()})
       select jsonb_agg(jsonb_build_object('child',child,'column',column_name,'parent',parent,
        'child_exists',to_regclass('public.'||child) is not null,'parent_exists',to_regclass('public.'||parent) is not null,
        'company_not_null',(select attnotnull from pg_attribute where attrelid=to_regclass('public.'||child) and attname='company_id' and not attisdropped),
        'rls',(select relrowsecurity from pg_class where oid=to_regclass('public.'||child)),
        'constraints',(select coalesce(jsonb_agg(jsonb_build_object('name',conname,'validated',convalidated,'definition',pg_get_constraintdef(oid)) order by conname),'[]') from pg_constraint where conrelid=to_regclass('public.'||child)),
        'triggers',(select coalesce(jsonb_agg(jsonb_build_object('name',tgname,'enabled',tgenabled,'definition',pg_get_triggerdef(oid)) order by tgname),'[]') from pg_trigger where tgrelid=to_regclass('public.'||child) and not tgisinternal)) order by child,column_name) from triples;`)
      expect(inventory).toHaveLength(18)
      writeFileSync(join(directory, 'actual-catalog.json'), JSON.stringify(inventory), { mode: 0o600 })
      receipt.inventoryTriples = inventory.length; receipt.inventorySha256 = sha(JSON.stringify(inventory)); save()
      // Settle the original script's global known-tenant correlation scope on
      // the fresh baseline before creating tenants. Retain hashes, no hidden seed.
      receipt.warmupBefore = sha(JSON.stringify(snapshot()))
      boundary = 'baseline_complete_apply_prerequisite'
      sql(source('apply'))
      receipt.warmupAfter = sha(JSON.stringify(snapshot())); save()
      boundary = 'ordinary_company_customer_draft_poa_seed'
      sql(`insert into public.companies(id,name,status) values (${quote(A)},'Synthetic backfill A','active'),(${quote(B)},'Synthetic backfill quiet B','active');
       insert into public.customers(id,company_id,customer_number,name,customer_type) values
       (${quote(customerA)},${quote(A)},${quote('backfill-'+customerA)},'Synthetic backfill A','private'),
       (${quote(customerB)},${quote(B)},${quote('backfill-'+customerB)},'Synthetic backfill B','private');
       insert into public.powers_of_attorney(id,company_id,customer_id,status) values
       (${quote(poaA)},${quote(A)},${quote(customerA)},'draft'),(${quote(poaB)},${quote(B)},${quote(customerB)},'draft');`)
      for (const row of cases) {
        boundary = 'ordinary_document_seed_'+row.name
        const before = snapshot()
        const result = json<{ code: string; constraint: string }>(`create temporary table seed_result(code text,constraint_name text);
         do $seed$ declare code text; constraint_label text; begin
          begin insert into public.customer_authorization_documents(id,company_id,customer_id,power_of_attorney_id,document_type,status)
           values(${quote(row.id)},${row.company ? quote(row.company) : 'null'},${quote(customerA)},${quote(row.poa)},'other','uploaded');
           insert into seed_result values('00000','');
          exception when others then get stacked diagnostics code=returned_sqlstate,constraint_label=constraint_name;
           insert into seed_result values(code,coalesce(constraint_label,'')); end;
         end; $seed$;
         select jsonb_build_object('code',code,'constraint',constraint_name) from seed_result;`)
        seedResults[row.name] = result
        if (result.code !== '00000') {
          expect(snapshot()).toEqual(before)
          witness({ case: row.name, outcome: 'ACTUAL_SEED_GUARD_DENIED_ZERO_EFFECTS_REPAIR_NOT_QUALIFIED',
            sqlstate: /^[A-Z0-9]{5}$/.test(result.code) ? result.code : 'UNKNOWN',
            constraint: /^[a-zA-Z0-9_]{0,128}$/.test(result.constraint) ? result.constraint : 'REDACTED' })
        }
      }
    })
    beforeEach(() => {
      onTestFailed(() => witness({ case: boundary, outcome: 'ACTUAL_CASE_FAILED_PRIVATE_DETAILS_REMOVED' }))
    })
    afterEach(() => { if (receipt) save() })
    it('actual complete dry-run classifies every accepted graph and has zero persistent effects', () => {
      boundary = 'complete_dry_run'
      const before = snapshot(), rows = dryCandidates()
      expect(snapshot()).toEqual(before)
      for (const row of cases.filter(row => seedResults[row.name].code === '00000')) {
        const selected = rows.filter(value => value.row_id === row.id)
        expect(selected.length).toBeGreaterThan(0)
        expect(selected.every(value => value.classification === row.classification)).toBe(true)
      }
      witness({ case: 'dry_run', outcome: 'COMPLETE_SQL_ZERO_EFFECTS_PASS' })
    })
    it('authenticated and anon execute actual complete SQL with 42501 and zero effects', () => {
      boundary = 'low_role_actual_denial'
      for (const role of ['authenticated', 'anon']) {
        const before = snapshot()
        expect(() => sql('set role '+role+';\n'+source('apply'), '42501')).toThrow('backfill_native_postgres_42501')
        expect(snapshot()).toEqual(before)
      }
      witness({ case: 'low_roles', outcome: 'ACTUAL_42501_ZERO_EFFECTS_PASS' })
    })
    it('a real late audit rejection rolls back every persistent table', () => {
      boundary = 'late_audit_actual_rollback'
      if (seedResults.agreed_null.code !== '00000') throw new Error('backfill_native_required_null_seed_guard_denied')
      const suffix = randomUUID().replaceAll('-', ''), schema = 'backfill_native_fault_'+suffix
      const before = snapshot()
      sql(`create schema ${schema}; create function ${schema}.reject_audit() returns trigger language plpgsql as $$begin
       if new.action='canonical_multitenant_company_id_backfill' and new.entity_id=${quote(cases[0].id)} then
        raise exception using errcode='P0001',message='backfill_native_injected_late_audit_failure'; end if; return new; end$$;
       create trigger zz_backfill_native_fault before insert on public.audit_logs for each row execute function ${schema}.reject_audit();`)
      try {
        expect(() => sql(source('apply'), 'P0001')).toThrow('backfill_native_postgres_P0001')
        expect(snapshot()).toEqual(before)
      } finally { sql(`drop trigger zz_backfill_native_fault on public.audit_logs; drop schema ${schema} cascade;`) }
      witness({ case: 'late_audit', outcome: 'WHOLE_DATABASE_ROLLBACK_PASS' })
    })
    it('complete apply repairs only an agreed null, retains all manual graphs and quiet-tenant effects', () => {
      boundary = 'complete_apply'
      if (seedResults.agreed_null.code !== '00000') throw new Error('backfill_native_required_null_seed_guard_denied')
      const before = snapshot(), docs = documents()
      sql(source('apply'))
      const after = snapshot(), saved = documents()
      expect(after.quiet).toEqual(before.quiet)
      for (const table of Object.keys(before.whole).filter(table => !['public.audit_logs', 'public.customer_authorization_documents'].includes(table))) {
        expect(after.whole[table], table).toBe(before.whole[table])
      }
      expect(saved.find(row => row.id === cases[0].id)?.company_id).toBe(A)
      for (const row of cases.slice(1).filter(row => seedResults[row.name].code === '00000')) {
        expect(saved.find(value => value.id === row.id)).toEqual(docs.find(value => value.id === row.id))
      }
      const audits = json<Record<string, unknown>[]>(`select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]') from public.audit_logs a
       where entity_id in (${cases.map(row => quote(row.id)).join(',')}) and action in ('canonical_multitenant_company_id_backfill','canonical_multitenant_correlation_id_backfill');`)
      expect(audits).toHaveLength(1)
      expect(audits[0]).toMatchObject({ company_id: A, entity_id: cases[0].id, action: 'canonical_multitenant_company_id_backfill',
        old_values: { company_id: null }, new_values: { company_id: A },
        metadata: { safe_derivation: true, parent_relations: ['customer_id -> customers', 'power_of_attorney_id -> powers_of_attorney'] } })
      witness({ case: 'agreed_null', outcome: 'REPAIR_PASS' })
      for (const row of cases.slice(1).filter(row => seedResults[row.name].code === '00000')) {
        witness({ case: row.name, outcome: 'MANUAL_ZERO_COMPANY_CORRELATION_AUDIT_EFFECTS_PASS' })
      }
    })
    it('complete apply replay creates no additional persistent effect or audit', () => {
      boundary = 'complete_apply_replay'
      if (seedResults.agreed_null.code !== '00000') throw new Error('backfill_native_required_null_seed_guard_denied')
      const before = snapshot(); sql(source('apply')); expect(snapshot()).toEqual(before)
      witness({ case: 'replay', outcome: 'WHOLE_DATABASE_ZERO_EFFECTS_PASS' })
    })
  })
}
