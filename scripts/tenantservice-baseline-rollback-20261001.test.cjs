// Exact Bash/SQL source checks; PostgreSQL core is distinct from native restore.
const assert = require('node:assert/strict')
const { execFileSync, spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { mkdtempSync, readFileSync, readdirSync, rmSync, mkdirSync, writeFileSync, existsSync, statSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { resolve, join } = require('node:path')
const { test } = require('node:test')
const { PGlite } = require('@electric-sql/pglite')
const script = resolve(__dirname, 'tenantservice-baseline-rollback-20261001.sh')
const root = resolve(__dirname, '..')
const pinned = 'ae56ee0a1e0e8adbce9d5f4d92da75cdcb8010c8'
const old = path => execFileSync('git', ['show', pinned+':'+path], { cwd: root, encoding: 'utf8', maxBuffer: 30_000_000 })
const sha = text => createHash('sha256').update(text).digest('hex')

test('plan validates pinned old sources and exact trusted restore helper without a database, then cleans every private file', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'baseline-rollback-test.'))
  try {
    const result = spawnSync('bash', [script, '--plan-only'], { encoding: 'utf8', timeout: 30_000,
      env: { ...process.env, RUNNER_TEMP: temporary, CI: 'false' } })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /TENANTSERVICE_BASELINE_ROLLBACK_HELPER_SHA256=[0-9a-f]{64}/)
    const helpers = readFileSync(resolve(__dirname, 'tenantservice-upgrade-restore.sh'), 'utf8')
    const region = helpers.slice(helpers.indexOf('tenantservice_local_docker(){\n'), helpers.indexOf('tenantservice_private_cleanup(){\n'))
    assert.ok(result.stdout.includes('HELPER_SHA256='+sha(region)))
    assert.ok(result.stdout.includes('HELPER_SOURCE_SHA256='+sha(helpers)))
    for (const name of ['tenantservice-restore-bootstrap-acl.sh','tenantservice-restore-bootstrap-acl.cjs']) {
      assert.ok(result.stdout.includes('BOOTSTRAP_SOURCE_SHA256 script='+name+' sha256='+sha(readFileSync(resolve(__dirname,name)))))
    }
    assert.match(result.stdout, /baseline_migrations=653/)
    assert.match(result.stdout, /TENANTSERVICE_BASELINE_ROLLBACK_PLAN_ONLY_NATIVE_NOT_EXECUTED/)
    assert.doesNotMatch(result.stdout, /REAL_ARCHIVE_PASS|ALL_PASS/)
    assert.deepEqual(readdirSync(temporary), [])
  } finally { rmSync(temporary, { recursive: true, force: true }) }
})

for (const [name, env] of [['external URL', { GRIDEX_REPLAY_DB_URL: 'postgresql://private@example.invalid/live' }],
  ['non-CI execution', { CI: 'false' }]]) test('refuses '+name+' before any provisioning', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'baseline-rollback-test.'))
  try {
    const result = spawnSync('bash', [script], { encoding: 'utf8', timeout: 5_000,
      env: { ...process.env, CI: 'true', RUNNER_TEMP: temporary, ...env } })
    assert.equal(result.status, 2)
    assert.doesNotMatch(result.stderr + result.stdout, /private@example/)
    assert.deepEqual(readdirSync(temporary), [])
  } finally { rmSync(temporary, { recursive: true, force: true }) }
})

test('old-schema proof has no new forward RPC or session-authority assertion', () => {
  const source = readFileSync(script, 'utf8')
  assert.match(source, /gridex_change_customer_contact_v1/)
  assert.doesNotMatch(source, /tenantservice-upgrade-postcheck\.sql|tenantservice-restore-proof\.sql|forward\.list/)
  assert.doesNotMatch(source, /APPLY.*filename|session_expiry.*PASS/)
})

test('ambiguous helper boundaries fail before archive/provisioning and remove the private directory', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'baseline-rollback-test.'))
  try {
    mkdirSync(join(temporary, 'scripts')); mkdirSync(join(temporary, 'runner'))
    writeFileSync(join(temporary, 'scripts', 'tenantservice-baseline-rollback-20261001.sh'), readFileSync(script))
    const helper = readFileSync(resolve(__dirname, 'tenantservice-upgrade-restore.sh'), 'utf8')
    writeFileSync(join(temporary, 'scripts', 'tenantservice-upgrade-restore.sh'), helper+'\ntenantservice_local_docker(){\n}\n')
    const result = spawnSync('bash', [join(temporary, 'scripts', 'tenantservice-baseline-rollback-20261001.sh'), '--plan-only'],
      { encoding:'utf8', timeout:5_000, env:{...process.env,RUNNER_TEMP:join(temporary,'runner')} })
    assert.equal(result.status,1)
    assert.match(result.stderr,/HELPER_BOUNDARY_INVALID/)
    assert.deepEqual(readdirSync(join(temporary,'runner')),[])
  } finally { rmSync(temporary,{recursive:true,force:true}) }
})

// Execute the actual extracted helper region. All processes are controlled
// stubs: this qualifies Bash boundaries/pipeline/privacy, never a real restore.
function runHelper(scenario) {
  const directory = mkdtempSync(join(tmpdir(),'tenantservice-upgrade-restore.'))
  try {
    const main = readFileSync(script,'utf8')
    const extractor = main.match(/python3 - "\$TENANTSERVICE_CANDIDATE_ROOT" "\$TENANTSERVICE_TEMP" <<'PY'\n[\s\S]*?\nPY\nbash -n "\$TENANTSERVICE_TEMP\/restore-helpers.sh"\nsource "\$TENANTSERVICE_TEMP\/restore-helpers.sh"/)?.[0]
    assert.ok(extractor,'actual extractor missing')
    const result = spawnSync('bash',['-c',`
set -euo pipefail
umask 077
TENANTSERVICE_CANDIDATE_ROOT="$1"; TENANTSERVICE_TEMP="$2"; RUNNER_TEMP="$(dirname "$2")"
CI=true; DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
TENANTSERVICE_PG_RESTORE=fake_restore; SCENARIO="$3"
${extractor}
psql(){ if [[ "$*" == *rolsuper* ]]; then echo 'postgres|false'; else echo 42001; fi; }
fake_restore(){
 [[ "$*" == *--file=-* && "$*" == *--single-transaction* && "$*" == *--use-list=* ]] || return 92
 [[ "$*" != *--no-owner* && "$*" != *--no-acl* && "$*" != *--no-privileges* ]] || return 93
 echo 'BEGIN; CREATE SCHEMA auth AUTHORIZATION supabase_admin; COMMIT;'
 echo 'sb_secret_SYNTHETIC_PRIVATE' >&2
 if [[ "$SCENARIO" == generator-failure ]]; then return 7; fi
}
env(){ [[ "$1 $2 $3 $4 $5" == '-u DOCKER_HOST -u DOCKER_CONTEXT docker' ]] || return 94; shift 5; fake_docker "$@"; }
fake_docker(){
 [[ "$1" == --host=unix:///var/run/docker.sock ]] || return 95
 [[ "$*" == *supabase_db_gridex-ops-platform* && "$*" == *--host=127.0.0.1* && "$*" == *--username=supabase_admin* && "$*" == *--no-password* ]] || return 96
 if [[ "$*" == *' exec -i '* ]]; then
  cat >/dev/null; echo 'sb_publishable_SYNTHETIC_PRIVATE' >&2
  if [[ "$SCENARIO" == consumer-failure ]]; then return 8; fi
 else
  if [[ "$SCENARIO" == wrong-oid ]]; then echo 'supabase_admin|supabase_admin|true|99999'
  else echo 'supabase_admin|supabase_admin|true|42001'; fi
 fi
}
tenantservice_restore_archive tenantservice_restore_100_200 postgresql://postgres:postgres@127.0.0.1:54322/tenantservice_restore_100_200
`, 'rollback-helper',root,directory,scenario],{encoding:'utf8',timeout:5_000,
      env:{...process.env,DOCKER_HOST:'tcp://remote.invalid:2376',DOCKER_CONTEXT:'production'}})
    const privateLog = readdirSync(directory).includes('restore.log') ? readFileSync(join(directory,'restore.log'),'utf8') : ''
    assert.doesNotMatch(result.stdout+result.stderr,/sb_(?:secret|publishable)_SYNTHETIC_PRIVATE/)
    return {...result,privateLog}
  } finally { rmSync(directory,{recursive:true,force:true}) }
}
test('actual extracted local-admin helper preserves unstripped stream and keeps private output private',()=>{
  const result=runHelper('valid')
  assert.equal(result.status,0,result.stderr)
  assert.match(result.stdout,/LOCAL_ADMIN_AUTHORITY_PASS/)
  assert.match(result.privateLog,/sb_secret_SYNTHETIC_PRIVATE/)
  assert.match(result.privateLog,/sb_publishable_SYNTHETIC_PRIVATE/)
})
for (const scenario of ['wrong-oid','generator-failure','consumer-failure']) test('actual extracted helper fails closed for '+scenario,()=>{
  const result=runHelper(scenario)
  assert.notEqual(result.status,0)
  if(scenario==='wrong-oid') assert.equal(result.privateLog,'')
  else assert.match(result.stderr,/PG_RESTORE_FAILED/)
})

for(const status of [0,23]) test('actual replay source and cleanup preserve original exit '+status+' without revealing startup output',()=>{
  const temporary=mkdtempSync(join(tmpdir(),'rollback-source-test.'))
  try {
    mkdirSync(join(temporary,'private','baseline','scripts'),{recursive:true})
    const main=readFileSync(script,'utf8')
    const cleanup=main.match(/^tenantservice_baseline_cleanup\(\)\{[\s\S]*?^\}\ntrap 'tenantservice_baseline_cleanup "\$\?"' EXIT/m)?.[0]
    const replay=main.match(/  cd "\$TENANTSERVICE_TEMP\/baseline"[\s\S]*?  echo 'TENANTSERVICE_BASELINE_ROLLBACK_PINNED_PRE_FORWARD_REPLAY_PASS'/)?.[0]
    assert.ok(cleanup && replay,'actual source/cleanup boundaries absent')
    writeFileSync(join(temporary,'private','baseline','scripts','gridex-aud-003-clean-replay.sh'),`
cleanup(){ touch "$OBSERVED_CLEANUP"; }
trap cleanup EXIT
printf '%s\\n' 'sb_secret_SYNTHETIC_START_PRIVATE'
DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
if [[ "$SYNTHETIC_STATUS" != 0 ]]; then exit "$SYNTHETIC_STATUS"; fi
`)
    const result=spawnSync('bash',['-c',`set -euo pipefail
TENANTSERVICE_TEMP="$1/private"; OBSERVED_CLEANUP="$1/stack-cleanup"; SYNTHETIC_STATUS="$2"
${cleanup}
(
${replay}
)
`,'rollback-source',temporary,String(status)],{encoding:'utf8',timeout:5000})
    assert.equal(result.status,status,result.stderr)
    assert.doesNotMatch(result.stdout+result.stderr,/sb_secret_SYNTHETIC_START_PRIVATE/)
    assert.deepEqual(readdirSync(temporary),['stack-cleanup'])
  } finally { rmSync(temporary,{recursive:true,force:true}) }
})

// Real trusted-source capture/guard, actual root-owned shell helper and actual
// planner CLI run. Only psql/Docker/fingerprint processes are synthetic here.
// The original strict comparison corridor is executed AFTER ACL reconciliation.
function runBootstrap(scenario) {
  const directory=mkdtempSync(join(tmpdir(),'rollback-bootstrap-test.'))
  try {
    const candidate=join(directory,'candidate'), runner=join(directory,'runner')
    mkdirSync(join(candidate,'scripts','sql'),{recursive:true});mkdirSync(runner)
    const temporary=mkdtempSync(join(runner,'tenantservice-upgrade-restore.'))
    const paths=['scripts/tenantservice-restore-bootstrap-acl.sh','scripts/tenantservice-restore-bootstrap-acl.cjs',
      'scripts/tenantservice-restore-catalog-diagnostic.cjs','scripts/sql/tenantservice-restore-data-fingerprint.sql']
    for(const path of paths) writeFileSync(join(candidate,path),readFileSync(join(root,path)))
    const source=readFileSync(script,'utf8')
    const capture=source.match(/# BEGIN_BASELINE_BOOTSTRAP_SOURCE\n([\s\S]*?)# END_BASELINE_BOOTSTRAP_SOURCE/)?.[1]
    const corridor=source.match(/  tenantservice_baseline_bootstrap_source_guard\n  tenantservice_restore_bootstrap_acl[\s\S]*?  echo 'TENANTSERVICE_BASELINE_ROLLBACK_OLD_BUSINESS_AUTH_ISSUED_OWNER_ACL_FINGERPRINT_PASS'/)?.[0]
    assert.ok(capture && corridor,'actual bootstrap capture/call/strict corridor missing')
    const owner={kind:'relation:r',schema_name:'extensions',object_name:'spatial_ref_sys',arguments:'',owner_name:'supabase_admin'}
    const acl=grantee=>({kind:'relation',schema_name:'extensions',object_name:'spatial_ref_sys',arguments:'',column_name:'',
      grantee,grantor:'supabase_admin',privilege_type:'SELECT',is_grantable:false})
    const before={owners:[owner],defaultAcl:[],acl:[acl('supabase_admin'),acl('service_role')]}
    const after=scenario==='no-difference'?before:{...before,acl:[acl('supabase_admin')]}
    if(scenario==='unsupported-extra') after.acl.push({...acl('service_role'),privilege_type:'DELETE'})
    writeFileSync(join(temporary,'restore-catalog-before.json'),JSON.stringify(before))
    writeFileSync(join(temporary,'synthetic-target.json'),JSON.stringify(after))
    writeFileSync(join(temporary,'issued-before.sha256'),'1'.repeat(64)+'\n')
    writeFileSync(join(temporary,'data-before.sha256'),'2'.repeat(64)+'\n'+'3'.repeat(64)+'\n')
    const result=spawnSync('bash',['-c',`
set -euo pipefail
umask 077
TENANTSERVICE_CANDIDATE_ROOT="$1"; TENANTSERVICE_TEMP="$2"; RUNNER_TEMP="$(dirname "$2")"
CI=true; export CI RUNNER_TEMP; REAL_NODE="$3"; SCENARIO="$4"
DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
TENANTSERVICE_RESTORE_DATABASE=tenantservice_restore_100_200
TENANTSERVICE_RESTORE_URL=postgresql://postgres:postgres@127.0.0.1:54322/tenantservice_restore_100_200
node(){ "$REAL_NODE" "$@"; }
${capture}
psql(){ if [[ "$*" == *tenantservice_catalog_detail=1* ]]; then cat "$TENANTSERVICE_TEMP/synthetic-target.json"; else echo 42001; fi; }
tenantservice_local_docker(){
 [[ "$*" == *supabase_db_gridex-ops-platform* && "$*" == *--host=127.0.0.1* && "$*" == *--username=supabase_admin* && "$*" == *--no-password* ]] || return 91
 if [[ "$1 $2" == 'exec -i' ]]; then
  cat >"$TENANTSERVICE_TEMP/synthetic-applied.sql"
  echo sb_secret_SYNTHETIC_BOOTSTRAP_ONLY_PRIVATE >&2
 else
  if [[ "$SCENARIO" == wrong-oid ]]; then echo 'supabase_admin|supabase_admin|true|99999'
  else echo 'supabase_admin|supabase_admin|true|42001'; fi
 fi
}
tenantservice_baseline_fingerprints(){
 cp "$TENANTSERVICE_TEMP/issued-before.sha256" "$TENANTSERVICE_TEMP/issued-restored.sha256"
 cp "$TENANTSERVICE_TEMP/data-before.sha256" "$TENANTSERVICE_TEMP/data-restored.sha256"
 cp "$TENANTSERVICE_TEMP/restore-catalog-before.json" "$TENANTSERVICE_TEMP/restore-catalog-restored.json"
 if [[ "$SCENARIO" == strict-mismatch ]]; then echo DIFFERENT_SYNTHETIC_DIGEST > "$TENANTSERVICE_TEMP/data-restored.sha256"; fi
}
if [[ "$SCENARIO" == source-changed ]]; then echo '// synthetic source drift' >> "$TENANTSERVICE_CANDIDATE_ROOT/scripts/tenantservice-restore-bootstrap-acl.cjs"; fi
${corridor}
`,'bootstrap-corridor',candidate,temporary,process.execPath,scenario],{encoding:'utf8',timeout:10_000})
    assert.doesNotMatch(result.stdout+result.stderr,/sb_secret_SYNTHETIC_BOOTSTRAP_ONLY_PRIVATE/)
    assert.equal(statSync(join(temporary,'bootstrap-helpers.sh')).mode&0o777,0o600)
    assert.equal(statSync(join(temporary,'bootstrap-source.json')).mode&0o777,0o600)
    const applied=existsSync(join(temporary,'synthetic-applied.sql'))?readFileSync(join(temporary,'synthetic-applied.sql'),'utf8'):null
    return {...result,applied}
  } finally {rmSync(directory,{recursive:true,force:true})}
}
test('actual bootstrap integration replays only source-missing allowed ACL before the original strict digest gate',()=>{
 const result=runBootstrap('supported-missing')
 assert.equal(result.status,0,result.stderr)
 assert.match(result.applied,/GRANT SELECT ON TABLE "extensions"\."spatial_ref_sys" TO "service_role"/)
 assert.match(result.applied,/restore_bootstrap_target_catalog_changed/)
 assert.match(result.stdout,/SOURCE_BOOTSTRAP_ACL_RECONCILIATION_PASS/)
 assert.match(result.stdout,/OLD_BUSINESS_AUTH_ISSUED_OWNER_ACL_FINGERPRINT_PASS/)
})
test('an equal captured catalog needs no ACL write and still executes the strict comparison gate',()=>{
 const result=runBootstrap('no-difference')
 assert.equal(result.status,0,result.stderr);assert.equal(result.applied,null)
 assert.match(result.stdout,/OLD_BUSINESS_AUTH_ISSUED_OWNER_ACL_FINGERPRINT_PASS/)
})
for(const scenario of ['wrong-oid','unsupported-extra','source-changed']) test('bootstrap integration rejects '+scenario+' before ACL write or strict success',()=>{
 const result=runBootstrap(scenario)
 assert.notEqual(result.status,0);assert.equal(result.applied,null)
 assert.doesNotMatch(result.stdout,/OLD_BUSINESS_AUTH_ISSUED_OWNER_ACL_FINGERPRINT_PASS/)
})
test('bootstrap reconciliation cannot turn a later strict restored fingerprint mismatch green',()=>{
 const result=runBootstrap('strict-mismatch')
 assert.notEqual(result.status,0)
 assert.match(result.stdout,/SOURCE_BOOTSTRAP_ACL_RECONCILIATION_PASS/)
 assert.match(result.stderr,/DATA_OR_OWNER_ACL_FINGERPRINT_MISMATCH/)
 assert.doesNotMatch(result.stdout,/OLD_BUSINESS_AUTH_ISSUED_OWNER_ACL_FINGERPRINT_PASS/)
})

function proofSql() {
  const source=readFileSync(script,'utf8')
  const sql=source.match(/<<'OLD_SCHEMA_PROOF'\n([\s\S]*?)\nOLD_SCHEMA_PROOF/)?.[1]
  assert.ok(sql,'actual old proof missing')
  return sql
}
function commandCorridor() {
  const source=proofSql()
  const shape=source.match(/do \$old_shape\$[\s\S]*?\$old_shape\$;/)?.[0]
  const start=source.indexOf('do $old_command$')
  assert.ok(shape && start>=0)
  return 'begin;\n'+shape+'\nset local role service_role;\n'+source.slice(start).replace(/^\\echo.*$/gm,'')
}
async function fixture() {
  const db=new PGlite()
  await db.exec(`create role service_role bypassrls; create role authenticated; create role anon;
   create schema auth; create schema private; create schema extensions;
   create function extensions.digest(bytea,text) returns bytea language sql immutable as $$select sha256($1)$$;
   create function extensions.digest(text,text) returns bytea language sql immutable as $$select sha256(convert_to($1,'UTF8'))$$;
   create table auth.users(id uuid primary key,deleted_at timestamptz,banned_until timestamptz);
   create table public.companies(id uuid primary key,is_active boolean default true,status text default 'active');
   create table public.customers(id uuid primary key,company_id uuid,status text default 'active',archived_at timestamptz,
    contact_revision bigint default 0,customer_type text default 'private',first_name text,last_name text,email text,phone text,updated_at timestamptz,updated_by uuid);
   create table public.customer_contacts(id uuid primary key default gen_random_uuid(),company_id uuid,customer_id uuid,type text,is_primary boolean,
    name text,title text,email text,phone text,created_by uuid,updated_by uuid,updated_at timestamptz);
   create table public.company_memberships(id uuid primary key default gen_random_uuid(),company_id uuid,user_id uuid,is_active boolean default true,status text default 'active');
   create table public.admin_users(id uuid primary key,user_id uuid,is_active boolean,role text);
   create table public.roles(id uuid primary key,key text,name text,is_active boolean);
   create table public.permissions(id uuid primary key default gen_random_uuid(),key text,name text);
   create table public.user_roles(id uuid primary key,user_id uuid,company_id uuid,role_id uuid,role text,is_active boolean,status text);
   create table public.user_permissions(id uuid primary key default gen_random_uuid(),user_id uuid,company_id uuid,permission_id uuid,permission_key text,status text,is_active boolean,effect text);
   create table public.role_permissions(id uuid primary key,role_id uuid,permission_id uuid,effect text);
   create table public.integration_api_clients(id uuid primary key,company_id uuid,status text,revoked_at timestamptz,deleted_at timestamptz,expires_at timestamptz,scopes text[]);
   create table public.customer_portal_accounts(id uuid primary key,company_id uuid,customer_id uuid,portal_user_id uuid,user_id uuid,external_account_id text,status text,is_active boolean);
   create table public.customer_portal_completions(id uuid primary key,company_id uuid,customer_id uuid,api_client_id uuid,completion_type text,status text,
    submitted_payload jsonb,result_payload jsonb,idempotency_key text,request_hash text,completion_reference text,created_at timestamptz);
   create table public.canonical_command_results(id uuid primary key default gen_random_uuid(),company_id uuid,command_type text,idempotency_key text,
    request_payload jsonb,result_payload jsonb,actor_user_id uuid,request_hash text,unique(company_id,command_type,idempotency_key));
   create table public.canonical_audit_events(id uuid primary key default gen_random_uuid(),company_id uuid,event_type text,aggregate_type text,aggregate_id uuid,
    state_version bigint,actor_user_id uuid,reason text,idempotency_key text,before_state jsonb,after_state jsonb,metadata jsonb,unique(company_id,event_type,idempotency_key));
   create table public.canonical_domain_events(id uuid primary key default gen_random_uuid(),company_id uuid,event_type text,aggregate_type text,aggregate_id uuid,
    aggregate_version bigint,idempotency_key text,payload jsonb,created_by uuid);
   create table public.canonical_event_outbox(id uuid primary key default gen_random_uuid(),company_id uuid,domain_event_id uuid,topic text,idempotency_key text,payload jsonb);`)
  const schema=old('supabase/schema.sql')
  for(const name of ['canonical_json_sha256','gridex_normalize_platform_role','gridex_get_user_permissions_in_company','gridex_actor_has_company_permission','canonical_command_request_hash_guard']) {
    const start=schema.indexOf('CREATE FUNCTION public.'+name+'('),stop=schema.indexOf('$$;',start)
    assert.ok(start>=0 && stop>start,'pinned actual function '+name)
    await db.exec(schema.slice(start,stop+3))
  }
  const helper=old('supabase/migrations/20260928164025_contact_actor_lock_privilege.sql')
  await db.exec(helper.slice(helper.indexOf('create or replace function private.'),helper.indexOf('$helper$;')+9))
  await db.exec(old('supabase/migrations/20260928213000_secondary_contact_atomic_command.sql'))
  await db.exec(`create trigger request_hash before insert on canonical_command_results for each row execute function canonical_command_request_hash_guard();
   grant usage on schema public,private,extensions to service_role; grant all on all tables in schema public to service_role;
   grant execute on function private.gridex_contact_actor_active_v1(uuid) to service_role;
   insert into companies(id) values('e4954930-0000-4000-8000-000000000001'),('e4954930-0000-4000-8000-000000000002');
   insert into auth.users(id) values('e4954930-0000-4000-8000-000000000011'),('e4954930-0000-4000-8000-000000000012');
   insert into company_memberships(company_id,user_id) select 'e4954930-0000-4000-8000-000000000001',id from auth.users;
   insert into permissions(key,name) values('masterdata.write','Contact');
   insert into user_permissions(user_id,company_id,permission_id,permission_key,effect)
    select u.id,'e4954930-0000-4000-8000-000000000001',p.id,p.key,
     case when u.id='e4954930-0000-4000-8000-000000000011' then 'allow' else 'deny' end from auth.users u,permissions p;
   insert into customers(id,company_id,email,phone) values
    ('e4954930-0000-4000-8000-000000000031','e4954930-0000-4000-8000-000000000001','contact-only@example.invalid','+4600000000'),
    ('e4954930-0000-4000-8000-000000000032','e4954930-0000-4000-8000-000000000002','foreign-contact@example.invalid','+4600000001');
   insert into customer_contacts(id,company_id,customer_id,type,is_primary,name,email,phone) values
    ('e4954930-0000-4000-8000-000000000041','e4954930-0000-4000-8000-000000000001','e4954930-0000-4000-8000-000000000031','primary',true,'Synthetic Contact','contact-only@example.invalid','+4600000000');`)
  return db
}
async function state(db) {
  const result={}
  for(const table of ['customers','customer_contacts','user_permissions','canonical_command_results','canonical_audit_events','canonical_domain_events','canonical_event_outbox']) {
    result[table]=(await db.query('select to_jsonb(t) as value from public.'+table+' t order by id')).rows.map(r=>r.value)
  }
  return result
}
test('actual embedded old command executes pinned full production authority/contact SQL, replay and revocation, then completely rolls back',async()=>{
  const db=await fixture()
  try {
    const before=await state(db)
    await db.exec(commandCorridor())
    assert.deepEqual(await state(db),before)
    assert.equal((await db.query('select current_user as role')).rows[0].role,'postgres')
  } finally { await db.close() }
})
test('actual old-shape assertion rejects an accidentally upgraded schema before command execution',async()=>{
  const db=await fixture()
  try {
    await db.exec('alter table customers add column billing_profile jsonb')
    await assert.rejects(db.exec(commandCorridor()),error=>error.message==='baseline_rollback_was_not_pre_forward_old_schema')
    await db.exec('rollback')
    assert.equal((await db.query('select count(*)::int n from canonical_command_results')).rows[0].n,0)
  } finally { await db.close() }
})
test('actual old-grant assertion rejects a wrongly restored authenticated command grant',async()=>{
  const db=await fixture()
  try {
    await db.exec('grant execute on function public.gridex_change_customer_contact_v1(jsonb) to authenticated')
    await assert.rejects(db.exec(commandCorridor()),error=>error.message==='baseline_rollback_old_contact_grants_not_retained')
    await db.exec('rollback')
    assert.equal((await db.query('select count(*)::int n from canonical_command_results')).rows[0].n,0)
  } finally { await db.close() }
})
