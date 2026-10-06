// Focused embedded PostgreSQL check, not native/replay/type/schema evidence.
// Narrow actual row-shape stubs isolate the new dependency/immutable-evidence RPC.
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
const modulePath = process.env.EDIEL_PGLITE_MODULE
if (!modulePath) throw new Error('EDIEL_PGLITE_MODULE required; pinned @electric-sql/pglite@0.3.14 temporary tooling')
const { PGlite } = await import(pathToFileURL(modulePath).href)
const db = new PGlite()
const uid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
let checks = 0
try {
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema extensions;create schema gridex_utilts_binding;
   create function extensions.digest(bytea,text) returns bytea language sql immutable as 'select sha256($1)';
   create table public.companies(id uuid primary key);
   create table public.ediel_configuration_snapshots(id uuid);
   create table public.platform_release_receipts(id uuid,release_sha text,ci_run_id text,deployment_id text,environment text,status text,verified_at timestamptz,recorded_at timestamptz,schema_migration_version text);
   create table public.ediel_messages(id uuid,company_id uuid,environment text,direction text,message_family text,message_code text,rule_pack_checksum text,raw_payload text,route_profile_id uuid,communication_route_id uuid,canonical_rule_pack_id uuid,rule_profile_version_id uuid,customer_id uuid,status text,parsed_payload jsonb);
   create table public.ediel_route_profiles(id uuid,company_id uuid,environment text,is_enabled boolean,is_active boolean,communication_route_id uuid,certificate_id uuid,receiver_certificate_id uuid,sender_ediel_id text,receiver_ediel_id text,sender_sub_address text,sender_subaddress text,receiver_sub_address text,receiver_subaddress text,mailbox_id uuid,transport_profile_id uuid,metadata jsonb default '{}',route_version integer default 1,created_by uuid,updated_by uuid,updated_at timestamptz default now());
   create table public.ediel_route_history(route_profile_id uuid,company_id uuid,route_version integer,snapshot jsonb,change_reason text,created_by uuid,unique(route_profile_id,route_version));
   create table public.communication_routes(id uuid,company_id uuid,is_active boolean,environment_type text,target_email text,endpoint text,counterparty_ediel_id text);
   create table public.platform_actor_routes(id uuid,actor_id uuid,environment text,message_family text,application_reference text,subaddress text,communication_type text,communication_address text,party_id text,interchange_party_id text,is_verified boolean,status text,source text,metadata jsonb);
   create table public.ediel_certificates(id uuid,company_id uuid,certificate_fingerprint text,certificate_valid_from timestamptz,certificate_valid_to timestamptz,status text,encryption_status text);
   create table public.tenant_ediel_profiles(id uuid,company_id uuid,environment text,market text,is_enabled boolean,valid_from timestamptz,valid_to timestamptz);
   create table public.tenant_actor_identifiers(id uuid,company_id uuid,environment text,actor_id uuid,identifier_type text,identifier_value text,valid_from timestamptz,valid_to timestamptz);
   create table public.tenant_actor_roles(id uuid,company_id uuid,environment text,actor_id uuid,role_code text,valid_from timestamptz,valid_to timestamptz);
   create table public.tenant_counterparty_relations(id uuid,company_id uuid,environment text,counterparty_actor_id uuid,relation_type text,is_enabled boolean,valid_from timestamptz,valid_to timestamptz);
   create table public.platform_actor_identifiers(id uuid,actor_id uuid,identifier_type text,identifier_value text,valid_from date,valid_to date);
   create table public.tenant_message_capabilities(id uuid,company_id uuid,environment text,message_family text,message_code text,transaction_subtype text,direction text,is_enabled boolean,valid_from timestamptz,valid_to timestamptz);
   create table public.ediel_service_assignments(id uuid,company_id uuid,environment text,provider_actor_id uuid,customer_id uuid);
   create table public.ediel_assignment_permission_links(id uuid,company_id uuid,permission_id uuid,assignment_id uuid);
   create table public.metering_permissions(id uuid,company_id uuid);
   create table public.ediel_data_access_grants(id uuid,company_id uuid,permission_link_id uuid);
   create function public.ediel_service_assignment_assessment_v1(uuid,uuid) returns jsonb language sql as $$select '{"status":"held"}'::jsonb$$;
   create table public.ediel_rule_packs(id uuid,family text,market text,status text,source_hash text,guide_version text,guide_revision text,valid_from date,valid_to date);
   create table public.ediel_message_profiles(id uuid,rule_pack_id uuid,profile_key text,transaction_subtype text,profile jsonb,is_enabled boolean,message_code text,direction text);
   create table public.ediel_rule_profile_versions(id uuid,company_id uuid,version text,status text,checksum text,source_revision text);
   create table public.platform_runtime_readiness(id boolean,is_ready boolean);
   create table public.ediel_certification_evidence(id uuid,company_id uuid,environment text,status text,external_reference text,evidence_document_reference text,approved_by uuid,approved_at timestamptz,tested_at timestamptz,valid_until timestamptz,metadata jsonb,evidence_type text);`)
  const inherited = readFileSync(new URL('../supabase/migrations/20260923135706_ediel_utilts_consumption_binding_v1.sql', import.meta.url), 'utf8')
  await db.exec(inherited.slice(inherited.indexOf('CREATE FUNCTION gridex_utilts_binding.wire_tokens_v1'), inherited.indexOf('REVOKE ALL ON FUNCTION gridex_utilts_binding.wire_tokens_v1')))
  await db.exec(readFileSync(new URL('../supabase/migrations/20260930145202_ediel_scoped_capability_readiness.sql', import.meta.url), 'utf8')); checks++
  await db.exec(readFileSync(new URL('../supabase/migrations/20260930154424_ediel_readiness_current_rule_dependencies.sql', import.meta.url), 'utf8')); checks++
  await db.exec(readFileSync(new URL('../supabase/migrations/20260930161907_ediel_readiness_current_source_scope.sql', import.meta.url), 'utf8')); checks++
  const routeHistory = readFileSync(new URL('../supabase/migrations/20260601184500_ediel_runtime_hardening_rls_route_history.sql', import.meta.url), 'utf8')
  await db.exec(routeHistory.slice(routeHistory.indexOf('create or replace function public.gridex_capture_ediel_route_profile_history'), routeHistory.lastIndexOf('commit;')))
  await db.exec(readFileSync(new URL('../supabase/migrations/20260930165148_ediel_monotonic_route_security_dependencies.sql', import.meta.url), 'utf8')); checks++
  const args = [uid(1), uid(2), uid(3), 'electricity_supplier', 'PRODAT', 'Z01', 'L', null, 'f'.repeat(40), 'a'.repeat(64)]
  const placeholders = args.map((_, n) => `$${n + 1}`).join(',')
  const readiness = async () => (await db.query(`select public.ediel_scoped_capability_readiness_v1(${placeholders}) result`, args)).rows[0].result
  await db.exec(`insert into companies values('${uid(1)}');insert into platform_release_receipts values('${uid(99)}',repeat('f',40),'synthetic-CI','synthetic-deployment','production','verified','2000-01-01','2000-01-01','synthetic-schema');insert into platform_runtime_readiness values(true,true);
   insert into ediel_messages values('${uid(2)}','${uid(1)}','production','outbound','PRODAT','Z01',repeat('a',64),'UNB+UNOC:3+54321:14+91101:14+260930:1200+I++23-DDQ-PRODAT''UNH+1+PRODAT:D:97A:UN:E2SE6A''BGM+Z01+DOC+9''CCI++Z13''CAV+Z22''','${uid(4)}','${uid(5)}','${uid(100)}','${uid(101)}',null,'queued','{}');
   insert into ediel_rule_packs values('${uid(100)}','PRODAT','electricity','active',repeat('a',64),'26.A','3','2000-01-01',null);
   insert into ediel_message_profiles values('${uid(101)}','${uid(100)}','scoped-z01','L','{"reasonForTransaction":"Z22"}',true,'Z01','outbound');
   insert into ediel_route_profiles(id,company_id,environment,is_enabled,is_active,communication_route_id,sender_ediel_id,receiver_ediel_id) values('${uid(4)}','${uid(1)}','production',true,true,'${uid(5)}','54321','91101');
   insert into communication_routes values('${uid(5)}','${uid(1)}',true,'production','original@example.invalid','original@example.invalid','91101');
   insert into tenant_ediel_profiles values('${uid(6)}','${uid(1)}','production','electricity',true,'2000-01-01',null);
   insert into tenant_actor_identifiers values('${uid(7)}','${uid(1)}','production','${uid(3)}','EdielId','54321','2000-01-01',null);
   insert into tenant_actor_roles values('${uid(8)}','${uid(1)}','production','${uid(3)}','electricity_supplier','2000-01-01',null),('${uid(9)}','${uid(1)}','production','${uid(3)}','grid_owner','2000-01-01',null);
   insert into tenant_message_capabilities values('${uid(10)}','${uid(1)}','production','PRODAT','Z01','L','outbound',true,'2000-01-01',null),('${uid(11)}','${uid(1)}','production','PRODAT','Z04','L','outbound',true,'2000-01-01',null);`)
  const first = await readiness(); assert.equal(first.ready, false); assert.equal(first.scope.actorRole, 'electricity_supplier'); checks++
  await db.exec(`update tenant_actor_roles set valid_to='2001-01-01' where id='${uid(9)}';update tenant_message_capabilities set is_enabled=false where id='${uid(11)}'`)
  assert.equal((await readiness()).dependencyHash, first.dependencyHash); checks++
  await db.exec(`update ediel_route_profiles set receiver_subaddress='changed' where id='${uid(4)}'`)
  const routeChanged = await readiness(); assert.notEqual(routeChanged.dependencyHash, first.dependencyHash); checks++
  assert.deepEqual((await db.query('select route_version from ediel_route_history order by route_version')).rows, [{ route_version: 1 }, { route_version: 2 }]); checks++
  await db.exec(`update ediel_route_profiles set updated_at=clock_timestamp() where id='${uid(4)}'`)
  assert.equal((await readiness()).dependencyHash, routeChanged.dependencyHash); checks++
  await db.exec(`update communication_routes set target_email='changed@example.invalid' where id='${uid(5)}'`)
  const addressChanged = await readiness(); assert.notEqual(addressChanged.dependencyHash, routeChanged.dependencyHash); checks++
  await db.exec(`update ediel_message_profiles set profile=profile||'{"ownSourceRevision":"new"}' where id='${uid(101)}'`)
  const changed = await readiness(); assert.notEqual(changed.dependencyHash, addressChanged.dependencyHash); checks++
  await assert.rejects(db.query(`select public.ediel_record_scoped_capability_evidence_v1(${placeholders},$11,$12::uuid[],$13::timestamptz)`, [...args, changed.dependencyHash, [], '2099-01-01']), /ediel_scoped_capability_evidence_required/); checks++
  const evidenceIds = ['TGT', 'AGT', 'SHADOW_PRODUCTION', 'LIVE_TENANT_INTEGRITY', 'RESTORE_REPLAY'].map((type, index) => ({ type, id: uid(20 + index) }))
  for (const evidence of evidenceIds) {
    const metadata = { edielScopedReadiness: { scope: changed.scope, dependencyHash: changed.dependencyHash, tests: [{ testId: 'SYNTHETIC-CHECK-ONLY', sourceRevision: 'fixture', evidenceReference: 'fixture', candidateSha: 'f'.repeat(40), result: 'passed', payloadSha256: 'b'.repeat(64) }] } }
    await db.query(`insert into ediel_certification_evidence values($1,$2,'production','passed','SYNTHETIC ONLY','SYNTHETIC ONLY',$3,'2000-01-01','2000-01-01','2099-12-31',$4,$5)`, [evidence.id, uid(1), uid(3), JSON.stringify(metadata), evidence.type])
  }
  const proof = await db.query(`select public.ediel_record_scoped_capability_evidence_v1(${placeholders},$11,$12::uuid[],$13::timestamptz) id`, [...args, changed.dependencyHash, evidenceIds.map(e => e.id), '2099-01-01']); assert.ok(proof.rows[0].id); checks++
  assert.equal((await readiness()).ready, true); checks++
  await db.query('select public.ediel_require_scoped_capability_for_message_v1($1,$2)', [uid(1),uid(2)]); checks++
  for (const [index, value] of [[2, uid(999)], [3, 'grid_owner'], [6, 'LK']]) {
    const wrong = [...args]; wrong[index] = value
    await assert.rejects(db.query(`select public.ediel_scoped_capability_readiness_v1(${placeholders})`, wrong), /ediel_scoped_capability_evidence_required/); checks++
  }
  // Direct provider entry cannot derive its identity/reason from a prior proof.
  await db.exec(`update ediel_messages set raw_payload=replace(raw_payload,'CAV+Z22','CAV+Z23')`)
  await assert.rejects(db.query('select public.ediel_require_scoped_capability_for_message_v1($1,$2)', [uid(1),uid(2)]), /ediel_scoped_capability_evidence_required/); checks++
  await db.exec(`update ediel_messages set raw_payload=replace(raw_payload,'CAV+Z23','CAV+Z22');update ediel_messages set raw_payload=replace(raw_payload,'54321:14','22222:14')`)
  await assert.rejects(db.query('select public.ediel_require_scoped_capability_for_message_v1($1,$2)', [uid(1),uid(2)]), /ediel_scoped_capability_evidence_required/); checks++
  await db.exec(`update ediel_messages set raw_payload=replace(raw_payload,'22222:14','54321:14');insert into tenant_actor_identifiers values('${uid(900)}','${uid(1)}','production','${uid(901)}','EdielId','22222','2000-01-01',null)`)
  await assert.rejects(db.query('select public.ediel_require_scoped_capability_for_message_v1($1,$2)', [uid(1),uid(2)]), /ediel_scoped_capability_evidence_required/); checks++
  await db.exec(`delete from tenant_actor_identifiers where id='${uid(900)}'`)
  // Unrelated active profiles and another role's source projection do not
  // invalidate this DDQ dependency; only own canonical content enters its hash.
  await db.exec(`insert into ediel_message_profiles values('${uid(102)}','${uid(100)}','dgi-z13','V','{"reasonForTransaction":"S17"}',true,'Z13','outbound');insert into gridex_ediel_readiness.source_editions select repeat('e',64),input_manifest,(select jsonb_agg(case when x->>'code'='Z13' then x||'{"fixtureOnlyOtherScopeVersion":2}' else x end) from jsonb_array_elements(catalog) x),clock_timestamp() from gridex_ediel_readiness.source_editions order by recorded_at desc limit 1`)
  assert.equal((await readiness()).dependencyHash, changed.dependencyHash); checks++
  await db.query('select public.ediel_require_scoped_capability_for_message_v1($1,$2)', [uid(1),uid(2)]); checks++
  await db.exec(`update ediel_certification_evidence set status='revoked' where id='${uid(20)}'`)
  assert.equal((await readiness()).ready, false); checks++
  await assert.rejects(db.exec(`update ediel_route_profiles set company_id='${uid(999)}' where id='${uid(4)}'`), /ediel_route_history_tenant_immutable/); checks++
  await db.exec(`insert into platform_actor_routes values('${uid(300)}','${uid(301)}','production','PRODAT','23-DDQ-PRODAT',null,'SMTP','wrong@example.invalid','91101','91101',true,'active','authentic-fixture-only','{}');update ediel_route_profiles set metadata=jsonb_build_object('platform_actor_route_id','${uid(300)}') where id='${uid(4)}'`)
  await assert.rejects(readiness(), /ediel_scoped_capability_evidence_required/); checks++
  await db.exec(`update platform_actor_routes set communication_address='changed@example.invalid',party_id='OTHER' where id='${uid(300)}'`)
  await assert.rejects(readiness(), /ediel_scoped_capability_evidence_required/); checks++
  await db.exec(`update platform_actor_routes set party_id='91101' where id='${uid(300)}'`)
  assert.equal((await readiness()).dependencies.selectedRouteSecurity.registryRoute.id, uid(300)); checks++
  const acl = await db.query(`select has_function_privilege('authenticated','public.ediel_scoped_capability_readiness_v1(uuid,uuid,uuid,text,text,text,text,uuid,text,text)','execute') rpc,has_table_privilege('service_role','gridex_ediel_readiness.evidence','insert') direct_write`)
  assert.deepEqual(acl.rows, [{ rpc: false, direct_write: false }]); checks++
  await assert.rejects(db.exec('delete from gridex_ediel_readiness.evidence'), /ediel_scoped_evidence_immutable/); checks++

  // IMP05: reuse this one database and the real public readiness RPCs. These
  // finite upstream rows are local fixtures, not live certification/activation.
  // No private readiness proof, route version or history row is fabricated.
  const imp05Checks = []
  const scopes = []
  for (const base of [400, 500, 600]) {
    const company = uid(base + 1), message = uid(base + 2), actor = uid(base + 3)
    const profile = uid(base + 4), communication = uid(base + 5), certificate = uid(base + 12)
    const scopeArgs = [company, message, actor, ...args.slice(3)]
    await db.query('insert into companies values($1)', [company])
    await db.query(`insert into ediel_messages select $1,$2,environment,direction,message_family,message_code,rule_pack_checksum,raw_payload,$3,$4,canonical_rule_pack_id,rule_profile_version_id,customer_id,status,parsed_payload from ediel_messages where id=$5`, [message, company, profile, communication, uid(2)])
    await db.query(`insert into ediel_route_profiles(id,company_id,environment,is_enabled,is_active,communication_route_id,receiver_certificate_id,sender_ediel_id,receiver_ediel_id,metadata)
      values($1,$2,'production',true,true,$3,$4,'54321','91101',jsonb_build_object('platform_actor_route_id',$5::text))`, [profile, company, communication, certificate, uid(300)])
    await db.query(`insert into communication_routes values($1,$2,true,'production','changed@example.invalid','changed@example.invalid','91101')`, [communication, company])
    await db.query(`insert into ediel_certificates values($1,$2,$3,'2000-01-01','2099-01-01','valid','valid')`, [certificate, company, `SYNTHETIC-OLD-${base}`])
    await db.query(`insert into tenant_ediel_profiles values($1,$2,'production','electricity',true,'2000-01-01',null)`, [uid(base + 6), company])
    await db.query(`insert into tenant_actor_identifiers values($1,$2,'production',$3,'EdielId','54321','2000-01-01',null)`, [uid(base + 7), company, actor])
    await db.query(`insert into tenant_actor_roles values($1,$2,'production',$3,'electricity_supplier','2000-01-01',null)`, [uid(base + 8), company, actor])
    await db.query(`insert into tenant_message_capabilities values($1,$2,'production','PRODAT','Z01','L','outbound',true,'2000-01-01',null)`, [uid(base + 10), company])
    const evaluate = async () => (await db.query(`select public.ediel_scoped_capability_readiness_v1(${placeholders}) result`, scopeArgs)).rows[0].result
    const before = await evaluate()
    const ids = []
    for (const [index, type] of evidenceIds.map(e => e.type).entries()) {
      const id = uid(base + 20 + index); ids.push(id)
      const metadata = { edielScopedReadiness: { scope: before.scope, dependencyHash: before.dependencyHash, tests: [{ testId: 'IMP05-LOCAL-ROUTE-VERSION-FIXTURE', sourceRevision: 'fixture', evidenceReference: 'fixture', candidateSha: 'f'.repeat(40), result: 'passed', payloadSha256: 'b'.repeat(64) }] } }
      await db.query(`insert into ediel_certification_evidence values($1,$2,'production','passed','SYNTHETIC ONLY','SYNTHETIC ONLY',$3,'2000-01-01','2000-01-01','2099-12-31',$4,$5)`, [id, company, actor, JSON.stringify(metadata), type])
    }
    const recorded = (await db.query(`select public.ediel_record_scoped_capability_evidence_v1(${placeholders},$11,$12::uuid[],$13::timestamptz) id`, [...scopeArgs, before.dependencyHash, ids, '2099-01-01'])).rows[0].id
    const ready = await evaluate()
    assert.equal(ready.ready, true); assert.equal(ready.evidenceId, recorded)
    await db.query('select public.ediel_require_scoped_capability_for_message_v1($1,$2)', [company, message])
    scopes.push({ base, company, message, profile, communication, certificate, scopeArgs, evaluate, ready })
  }
  checks += 3; imp05Checks.push('two-affected-and-one-independent-scope-ready-through-public-evidence-api')
  const proofRows = async () => (await db.query(`select to_jsonb(e)::text row from gridex_ediel_readiness.evidence e where company_id=any($1::uuid[]) order by id`, [scopes.map(s => s.company)])).rows
  const oldProofs = await proofRows()
  const historyRows = async () => (await db.query(`select to_jsonb(h)::text row from ediel_route_history h where route_profile_id=any($1::uuid[]) order by route_profile_id,route_version`, [scopes.map(s => s.profile)])).rows
  const oldHistory = await historyRows()
  const unaffected = scopes[2]
  const unaffectedBefore = JSON.stringify(await unaffected.evaluate())
  const affected = scopes.slice(0, 2)
  for (const scope of affected) {
    // A genuine certificate-field update drives the installed BEFORE UPDATE
    // trigger. Setting route_version directly would not prove this effect.
    await db.query(`insert into ediel_certificates values($1,$2,$3,'2000-01-01','2099-01-01','valid','valid')`, [uid(scope.base + 13), scope.company, `SYNTHETIC-NEW-${scope.base}`])
    await db.query('update ediel_route_profiles set receiver_certificate_id=$1 where id=$2', [uid(scope.base + 13), scope.profile])
    const version = (await db.query('select route_version from ediel_route_profiles where id=$1', [scope.profile])).rows[0].route_version
    assert.equal(version, 2)
    const stale = await scope.evaluate()
    assert.equal(stale.dependencies.route.routeVersion, 2)
    assert.notEqual(stale.dependencyHash, scope.ready.dependencyHash)
    assert.equal(stale.ready, false); assert.equal(stale.evidenceId, null)
    await assert.rejects(db.query('select public.ediel_require_scoped_capability_for_message_v1($1,$2)', [scope.company, scope.message]), /ediel_scoped_capability_evidence_required/)
    // The public recorder cannot carry the prior dependency/proof to a new
    // version, even while its old certification records remain unchanged.
    await assert.rejects(db.query(`select public.ediel_record_scoped_capability_evidence_v1(${placeholders},$11,$12::uuid[],$13::timestamptz)`, [...scope.scopeArgs, scope.ready.dependencyHash, evidenceIds.map((_, i) => uid(scope.base + 20 + i)), '2099-01-01']), /ediel_scoped_capability_evidence_required/)
  }
  checks += 2; imp05Checks.push('real-certificate-update-increments-both-affected-route-versions')
  imp05Checks.push('both-affected-actors-tenants-held-and-stale-proof-renewal-denied')
  assert.equal(JSON.stringify(await unaffected.evaluate()), unaffectedBefore)
  await db.query('select public.ediel_require_scoped_capability_for_message_v1($1,$2)', [unaffected.company, unaffected.message])
  checks++; imp05Checks.push('independent-tenant-proof-dependencies-and-dispatch-remain-exact')
  assert.deepEqual(await proofRows(), oldProofs)
  const changedHistory = await historyRows()
  for (const row of oldHistory) assert.ok(changedHistory.some(current => current.row === row.row))
  for (const scope of affected) {
    const saved = (await db.query('select snapshot from ediel_route_history where route_profile_id=$1 and route_version=1', [scope.profile])).rows[0].snapshot
    assert.equal(saved.receiver_certificate_id, scope.certificate)
    assert.equal(saved.route_version, 1)
  }
  checks++; imp05Checks.push('old-proof-and-certificate-route-history-preserved-byte-for-byte')
  const beforeDenied = JSON.stringify({ proofs: await proofRows(), history: await historyRows(), messages: (await db.query('select to_jsonb(m)::text row from ediel_messages m where company_id=any($1::uuid[]) order by id', [scopes.map(s => s.company)])).rows })
  // A new actual mailbox still cannot dispatch against any cached old proof.
  // Signed leaf/address binding remains covered by the existing recipient suite;
  // this SQL assertion establishes the independent current-readiness barrier.
  for (const scope of affected) {
    await db.query('update communication_routes set target_email=$1,endpoint=$1 where id=$2', ['new-mailbox@example.invalid', scope.communication])
    await assert.rejects(scope.evaluate(), /ediel_scoped_capability_evidence_required/)
    await assert.rejects(db.query('select public.ediel_require_scoped_capability_for_message_v1($1,$2)', [scope.company, scope.message]), /ediel_scoped_capability_evidence_required/)
  }
  const afterDenied = JSON.stringify({ proofs: await proofRows(), history: await historyRows(), messages: (await db.query('select to_jsonb(m)::text row from ediel_messages m where company_id=any($1::uuid[]) order by id', [scopes.map(s => s.company)])).rows })
  assert.equal(afterDenied, beforeDenied)
  assert.equal(JSON.stringify(await unaffected.evaluate()), unaffectedBefore)
  checks++; imp05Checks.push('new-mailbox-old-registry-scope-denied-with-zero-message-proof-history-effects')

  // One actual registry import now withdraws a shared selected route. Extend
  // finite upstream shapes in the SAME DB; every custody/history/import body
  // below is loaded from its existing migration, not replaced with a verdict.
  const source = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8')
  const extract = (text, start, end) => {
    const first = text.indexOf(start), last = text.indexOf(end, first + start.length)
    assert.ok(first >= 0 && last > first, `actual SQL boundary required: ${start}`)
    return text.slice(first, last)
  }
  await db.exec(`create schema auth; create table auth.users(id uuid primary key);
    create table user_profiles(id uuid,user_status text); create table admin_users(user_id uuid); create table user_roles(id uuid,user_id uuid);
    create function canonical_actor_is_platform_admin(uuid) returns boolean language sql as $$select exists(select from public.admin_users a join public.user_profiles u on u.id=a.user_id where a.user_id=$1 and u.user_status='active')$$;
    insert into auth.users values('${uid(700)}');insert into user_profiles values('${uid(700)}','active');insert into admin_users values('${uid(700)}');
    alter table platform_actor_identifiers add primary key(id),alter column id set default gen_random_uuid(),add column source text,add column is_verified boolean default false,add column metadata jsonb default '{}',add column updated_at timestamptz default now();
    alter table platform_actor_routes add primary key(id),alter column id set default gen_random_uuid(),add column edi_charset text,add column edi_syntax text,add column party_id_qualifier text,add column party_id_responsible text,add column interchange_id_qualifier text,add column auto_send_allowed boolean default false,add column valid_from date,add column valid_to date,add column updated_at timestamptz default now();
    create schema gridex_received_sources; create schema gridex_service_administration; create schema gridex_ediel_ack_replay;`)
  await db.exec(extract(source('20260611123000_actor_registry_message_semantics_tenant_automation.sql'), 'create table if not exists public.platform_market_actors', '-- 2) Message semantics'))
  await db.exec(extract(source('20260615130000_batch_o3_o6_actor_registry_certificate_hardening.sql'), 'create table if not exists public.actor_registry_import_runs', '-- Complete existing certificate cache'))
  await db.exec(extract(source('20260613100000_actor_auto_readiness_certificates.sql'), 'create table if not exists public.platform_actor_certificates', 'create unique index'))
  await db.exec(`create unique index fixture_registry_cert_key on platform_actor_certificates(actor_id,environment,purpose,fingerprint_sha256) where fingerprint_sha256 is not null`)
  await db.exec(source('20260930153118_ediel_actor_legal_identity_name_search_v1.sql'))
  const reject = source('20260922095911_ediel_received_source_ledger.sql')
  await db.exec(extract(reject, 'CREATE FUNCTION gridex_received_sources.reject_mutation()', 'REVOKE ALL ON FUNCTION gridex_received_sources.reject_mutation'))
  await db.exec(source('20260930172759_ediel_atomic_registry_import_v1.sql'))
  await db.exec(extract(source('20260930182758_ediel_current_service_origin_and_registry_conflict_guards.sql'), 'CREATE OR REPLACE FUNCTION public.ediel_apply_actor_registry_v1', '-- Atomic projection'))
  await db.exec(source('20261001000600_ediel_registry_txt_preview_and_route_history.sql'))
  await db.exec(source('20261001031233_ediel_registry_declared_route_source_fields.sql'))
  // Import/custody boundaries only: do not replace this runner's already-real
  // readiness functions or introduce an alternate transport implementation.
  await db.exec(source('20261001040159_ediel_registry_market_source_isolation.sql').slice(0, source('20261001040159_ediel_registry_market_source_isolation.sql').indexOf('ALTER FUNCTION gridex_ediel_readiness.capture')) + 'COMMIT;')
  await db.exec(source('20261001040445_ediel_registry_market_txt_prerequisite.sql'))
  await db.exec(source('20261001040446_ediel_current_registry_txt_source_parity.sql'))
  const graph = extract(source('20261001004953_ediel_current_company_permission_denies.sql'), 'CREATE OR REPLACE FUNCTION gridex_ediel_ack_replay.lock_current_graph_v2()', 'COMMIT;')
  // These uncalled owner tables supply only lockable upstream shapes; the
  // actual current graph lock body/modes are preserved, not stubbed away.
  for (const relation of graph.match(/LOCK TABLE ([\s\S]*?) IN SHARE MODE;/)[1].split(',').map(s => s.trim())) {
    await db.exec(`create table if not exists ${relation}(id uuid)`)
  }
  await db.exec(graph)
  const currentImport = source('20261001103439_ediel_registry_current_actor_source_guards.sql')
  await db.exec(extract(currentImport, 'DO $import_graph$', '-- Paired current forward'))
  await db.exec(extract(currentImport, 'DO $current_txt$', 'CREATE OR REPLACE FUNCTION gridex_registry_import.current_el_tenant_actor_source_v1'))
  await db.exec(extract(currentImport, 'DO $import_lock$', '-- Preview and actual verification'))
  // Complete the selected CURRENT readiness/source path after the older
  // assertions, without a fake capture or a second installed authority.
  await db.exec(`alter table ediel_messages add column application_reference text,add column receiver_ediel_id text,add column receiver_sub_address text,add column receiver_email text,add column transport_type text;
    alter table ediel_route_profiles add column message_family text,add column transport_type text,add column application_reference text;
    alter table communication_routes add column auth_config jsonb default '{}',add column route_type text;`)
  await db.exec(extract(source('20261001040159_ediel_registry_market_source_isolation.sql'), 'ALTER FUNCTION gridex_ediel_readiness.capture', 'ALTER FUNCTION gridex_ediel_transport.mutate_v1'))
  await db.exec(extract(currentImport, 'CREATE OR REPLACE FUNCTION gridex_registry_import.route_source_v1', '-- Acquire the installed graph'))
  const registryRecord = (edielId, address) => ({ name: `Local IMP05 registry ${edielId}`, legalName: `Local IMP05 registry ${edielId}`, orgNumber: null, edielId, eic: null, svkId: null, market: 'EL', countryCode: 'SE', roles: ['grid_owner'], routes: [{ messageFamily: 'PRODAT', environment: 'production', communicationType: 'SMTP', communicationAddress: address, partyId: edielId, interchangePartyId: edielId, applicationReference: '23-DDQ-PRODAT' }], certificates: [], raw: { fixture: 'LOCAL SYSTEM BEHAVIOUR ONLY' } })
  const applyRegistry = async records => {
    const bytes = Buffer.from(JSON.stringify(records))
    const result = (await db.query('select public.ediel_apply_actor_registry_v1($1,$2,$3,$4,$5,$6) result', [uid(700), bytes.toString('base64'), createHash('sha256').update(bytes).digest('hex'), 'csv', 'imp05-local-registry.csv', JSON.stringify(records)])).rows[0].result
    return { result, bytes, sourceHash: createHash('sha256').update(bytes).digest('hex') }
  }
  const originalImport = await applyRegistry([registryRecord('91101', 'changed@example.invalid'), registryRecord('91102', 'independent@example.invalid')])
  assert.equal(originalImport.result.activation, 'held_pending_current_source_readiness')
  const selected = (await db.query('select id,party_id from platform_actor_routes where id=any($1::uuid[]) order by party_id', [originalImport.result.routeIds])).rows
  assert.equal(selected.length, 2)
  // Explicit finite upstream active-route inputs allow the local system's
  // current-readiness consumer to be tested; they grant no market activation.
  await db.query("update platform_actor_routes set is_verified=true,auto_send_allowed=true,status='active' where id=any($1::uuid[])", [selected.map(r => r.id)])
  for (const scope of scopes) {
    const own = scope === unaffected ? selected[1] : selected[0]
    const address = scope === unaffected ? 'independent@example.invalid' : 'changed@example.invalid'
    await db.query("update ediel_route_profiles set metadata=jsonb_build_object('platform_actor_route_id',$1::text),receiver_ediel_id=$2,message_family='PRODAT',transport_type='smtp',application_reference='23-DDQ-PRODAT' where id=$3", [own.id, own.party_id, scope.profile])
    await db.query("update communication_routes set target_email=$1,endpoint=$1,counterparty_ediel_id=$2,route_type='ediel_partner' where id=$3", [address, own.party_id, scope.communication])
    await db.query("update ediel_messages set raw_payload=replace(raw_payload,'91101:14',$1)||$3,receiver_ediel_id=$4,application_reference='23-DDQ-PRODAT',receiver_email=$5,transport_type='smtp' where id=$2", [`${own.party_id}:14`, scope.message, `NAD+DO+${own.party_id}::SVK'`, own.party_id, address])
    const current = await scope.evaluate(), ids = []
    assert.equal(current.dependencies.sourceQualifiedRegistryMarket.sourceSha256, originalImport.sourceHash)
    assert.equal(current.dependencies.sourceQualifiedRegistryMarket.routeId, own.id)
    for (const [index, type] of evidenceIds.map(e => e.type).entries()) {
      const id = uid(scope.base + 30 + index); ids.push(id)
      const metadata = { edielScopedReadiness: { scope: current.scope, dependencyHash: current.dependencyHash, tests: [{ testId: 'IMP05-LOCAL-IMPORT-FANOUT-FIXTURE', sourceRevision: 'fixture', evidenceReference: 'fixture', candidateSha: 'f'.repeat(40), result: 'passed', payloadSha256: 'b'.repeat(64) }] } }
      await db.query(`insert into ediel_certification_evidence values($1,$2,'production','passed','SYNTHETIC ONLY','SYNTHETIC ONLY',$3,'2000-01-01','2000-01-01','2099-12-31',$4,$5)`, [id, scope.company, scope.scopeArgs[2], JSON.stringify(metadata), type])
    }
    await db.query(`select public.ediel_record_scoped_capability_evidence_v1(${placeholders},$11,$12::uuid[],$13::timestamptz)`, [...scope.scopeArgs, current.dependencyHash, ids, '2099-01-01'])
    scope.beforeImport = await scope.evaluate(); assert.equal(scope.beforeImport.ready, true)
    await db.query('select public.ediel_require_scoped_capability_for_message_v1($1,$2)', [scope.company, scope.message])
  }
  imp05Checks.push('actual-imported-shared-route-and-distinct-registry-route-have-public-ready-proofs'); checks++
  const currentProofRows = await proofRows(), currentHistory = await historyRows()
  const currentMessages = (await db.query('select to_jsonb(m)::text row from ediel_messages m where company_id=any($1::uuid[]) order by id', [scopes.map(s => s.company)])).rows
  const registryHistory = (await db.query('select to_jsonb(v)::text row from gridex_registry_import.route_versions v order by id')).rows
  const independentRegistry = (await db.query('select to_jsonb(r)::text row from platform_actor_routes r where id=$1', [selected[1].id])).rows
  const custody = (await db.query('select to_jsonb(b)::text row from gridex_registry_import.batches b where source_sha256=$1', [originalImport.sourceHash])).rows
  // ONE real public import is the event. No affected tenant/profile update or
  // readiness fabrication occurs between the ready baseline and these holds.
  const replacement = await applyRegistry([registryRecord('91101', 'replacement@example.invalid')])
  assert.notEqual(replacement.result.routeIds[0], selected[0].id)
  assert.equal(replacement.result.activation, 'held_pending_current_source_readiness')
  const retired = (await db.query('select communication_address,is_verified,auto_send_allowed,status from platform_actor_routes where id=$1', [selected[0].id])).rows[0]
  assert.deepEqual(retired, { communication_address: 'changed@example.invalid', is_verified: false, auto_send_allowed: false, status: 'needs_review' })
  for (const scope of affected) {
    await assert.rejects(scope.evaluate(), /ediel_scoped_capability_evidence_required/)
    await assert.rejects(db.query('select public.ediel_require_scoped_capability_for_message_v1($1,$2)', [scope.company, scope.message]), /ediel_scoped_capability_evidence_required/)
  }
  imp05Checks.push('one-real-import-address-change-invalidates-both-selected-tenant-actor-scopes'); checks++
  assert.deepEqual(await unaffected.evaluate(), unaffected.beforeImport)
  await db.query('select public.ediel_require_scoped_capability_for_message_v1($1,$2)', [unaffected.company, unaffected.message])
  assert.deepEqual((await db.query('select to_jsonb(r)::text row from platform_actor_routes r where id=$1', [selected[1].id])).rows, independentRegistry)
  imp05Checks.push('other-registry-actor-route-tenant-proof-and-dispatch-remain-byte-exact'); checks++
  assert.deepEqual(await proofRows(), currentProofRows); assert.deepEqual(await historyRows(), currentHistory)
  assert.deepEqual((await db.query('select to_jsonb(m)::text row from ediel_messages m where company_id=any($1::uuid[]) order by id', [scopes.map(s => s.company)])).rows, currentMessages)
  assert.deepEqual((await db.query('select to_jsonb(b)::text row from gridex_registry_import.batches b where source_sha256=$1', [originalImport.sourceHash])).rows, custody)
  const retainedHistory = (await db.query('select to_jsonb(v)::text row from gridex_registry_import.route_versions v order by id')).rows
  for (const row of registryHistory) assert.ok(retainedHistory.some(v => v.row === row.row))
  assert.ok((await db.query('select snapshot from gridex_registry_import.route_versions where route_id=$1 order by revision desc limit 1', [selected[0].id])).rows[0].snapshot.is_verified)
  const replay = await applyRegistry([registryRecord('91101', 'changed@example.invalid'), registryRecord('91102', 'independent@example.invalid')])
  assert.equal(replay.result.reusedExistingRun, true); assert.equal(replay.result.importRunId, originalImport.result.importRunId)
  for (const scope of affected) await assert.rejects(scope.evaluate(), /ediel_scoped_capability_evidence_required/)
  imp05Checks.push('old-batch-bytes-route-history-and-proofs-retained-without-replay-reactivation'); checks++
  // Restoring mutable flags cannot turn the old immutable source into the
  // current imported route edition. The actual current source reader denies it.
  await db.query("update platform_actor_routes set is_verified=true,auto_send_allowed=true,status='active' where id=$1", [selected[0].id])
  for (const scope of affected) {
    await assert.rejects(scope.evaluate(), /ediel_registry_current_el_route_source_required/)
    await assert.rejects(db.query('select public.ediel_require_scoped_capability_for_message_v1($1,$2)', [scope.company, scope.message]), /ediel_scoped_capability_evidence_required/)
  }
  assert.deepEqual(await unaffected.evaluate(), unaffected.beforeImport)
  assert.deepEqual(await proofRows(), currentProofRows)
  imp05Checks.push('current-immutable-registry-source-holds-old-edition-even-if-mutable-flags-restored'); checks++
  console.log(`IMP05_ROUTE_VERSION_RESULT ${JSON.stringify({ checks: imp05Checks, wholeRule: 'NOT_APPROVED', returnPath: 'NOT_EXERCISED', fixture: 'ONE_EXISTING_EMBEDDED_DATABASE' })}`)
  console.log(`Focused PostgreSQL scoped dependency/evidence/revocation/ACL checks: ${checks} PASS`)
} finally { await db.close() }
