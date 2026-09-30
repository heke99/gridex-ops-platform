// Focused embedded PostgreSQL check, not native/replay/type/schema evidence.
// Narrow actual row-shape stubs isolate the new dependency/immutable-evidence RPC.
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
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
   create table public.ediel_messages(id uuid,company_id uuid,environment text,direction text,message_family text,message_code text,rule_pack_checksum text,raw_payload text,route_profile_id uuid,communication_route_id uuid,canonical_rule_pack_id uuid,rule_profile_version_id uuid,customer_id uuid,status text);
   create table public.ediel_route_profiles(id uuid,company_id uuid,environment text,is_enabled boolean,is_active boolean,communication_route_id uuid,certificate_id uuid,receiver_certificate_id uuid,sender_ediel_id text,receiver_ediel_id text,sender_sub_address text,sender_subaddress text,receiver_sub_address text,receiver_subaddress text,mailbox_id uuid,transport_profile_id uuid);
   create table public.ediel_certificates(id uuid,company_id uuid,certificate_fingerprint text,certificate_valid_from timestamptz,certificate_valid_to timestamptz,status text,encryption_status text);
   create table public.tenant_ediel_profiles(id uuid,company_id uuid,environment text,market text,is_enabled boolean,valid_from timestamptz,valid_to timestamptz);
   create table public.tenant_actor_identifiers(id uuid,company_id uuid,environment text,actor_id uuid,identifier_type text,identifier_value text,valid_from timestamptz,valid_to timestamptz);
   create table public.tenant_actor_roles(id uuid,company_id uuid,environment text,actor_id uuid,role_code text,valid_from timestamptz,valid_to timestamptz);
   create table public.tenant_message_capabilities(id uuid,company_id uuid,environment text,message_family text,message_code text,transaction_subtype text,direction text,is_enabled boolean,valid_from timestamptz,valid_to timestamptz);
   create table public.ediel_service_assignments(id uuid,company_id uuid,environment text,provider_actor_id uuid,customer_id uuid);
   create table public.ediel_assignment_permission_links(id uuid,company_id uuid,permission_id uuid,assignment_id uuid);
   create table public.metering_permissions(id uuid,company_id uuid);
   create table public.ediel_data_access_grants(id uuid,company_id uuid,permission_link_id uuid);
   create function public.ediel_service_assignment_assessment_v1(uuid,uuid) returns jsonb language sql as $$select '{"status":"held"}'::jsonb$$;
   create table public.platform_runtime_readiness(id boolean,is_ready boolean);
   create table public.ediel_certification_evidence(id uuid,company_id uuid,environment text,status text,external_reference text,evidence_document_reference text,approved_by uuid,approved_at timestamptz,tested_at timestamptz,valid_until timestamptz,metadata jsonb,evidence_type text);`)
  const inherited = readFileSync(new URL('../supabase/migrations/20260923135706_ediel_utilts_consumption_binding_v1.sql', import.meta.url), 'utf8')
  await db.exec(inherited.slice(inherited.indexOf('CREATE FUNCTION gridex_utilts_binding.wire_tokens_v1'), inherited.indexOf('REVOKE ALL ON FUNCTION gridex_utilts_binding.wire_tokens_v1')))
  await db.exec(readFileSync(new URL('../supabase/migrations/20260930145202_ediel_scoped_capability_readiness.sql', import.meta.url), 'utf8')); checks++
  const args = [uid(1), uid(2), uid(3), 'electricity_supplier', 'PRODAT', 'Z01', 'L', null, 'f'.repeat(40), 'a'.repeat(64)]
  const placeholders = args.map((_, n) => `$${n + 1}`).join(',')
  const readiness = async () => (await db.query(`select public.ediel_scoped_capability_readiness_v1(${placeholders}) result`, args)).rows[0].result
  await db.exec(`insert into companies values('${uid(1)}');insert into platform_release_receipts values('${uid(99)}',repeat('f',40),'synthetic-CI','synthetic-deployment','production','verified','2000-01-01','2000-01-01','synthetic-schema');insert into platform_runtime_readiness values(true,true);
   insert into ediel_messages values('${uid(2)}','${uid(1)}','production','outbound','PRODAT','Z01',repeat('a',64),'UNH+1+PRODAT:D:97A:UN:E2SE6A''BGM+Z01+DOC+9''CCI++Z13''CAV+Z22''','${uid(4)}','${uid(5)}',null,null,null,'queued');
   insert into ediel_route_profiles(id,company_id,environment,is_enabled,is_active,communication_route_id,sender_ediel_id,receiver_ediel_id) values('${uid(4)}','${uid(1)}','production',true,true,'${uid(5)}','54321','91101');
   insert into tenant_ediel_profiles values('${uid(6)}','${uid(1)}','production','electricity',true,'2000-01-01',null);
   insert into tenant_actor_identifiers values('${uid(7)}','${uid(1)}','production','${uid(3)}','EdielId','54321','2000-01-01',null);
   insert into tenant_actor_roles values('${uid(8)}','${uid(1)}','production','${uid(3)}','electricity_supplier','2000-01-01',null),('${uid(9)}','${uid(1)}','production','${uid(3)}','grid_owner','2000-01-01',null);
   insert into tenant_message_capabilities values('${uid(10)}','${uid(1)}','production','PRODAT','Z01','L','outbound',true,'2000-01-01',null),('${uid(11)}','${uid(1)}','production','PRODAT','Z04','L','outbound',true,'2000-01-01',null);`)
  const first = await readiness(); assert.equal(first.ready, false); assert.equal(first.scope.actorRole, 'electricity_supplier'); checks++
  await db.exec(`update tenant_actor_roles set valid_to='2001-01-01' where id='${uid(9)}';update tenant_message_capabilities set is_enabled=false where id='${uid(11)}'`)
  assert.equal((await readiness()).dependencyHash, first.dependencyHash); checks++
  await db.exec(`update ediel_route_profiles set receiver_subaddress='changed' where id='${uid(4)}'`)
  const changed = await readiness(); assert.notEqual(changed.dependencyHash, first.dependencyHash); checks++
  await assert.rejects(db.query(`select public.ediel_record_scoped_capability_evidence_v1(${placeholders},$11,$12::uuid[],$13::timestamptz)`, [...args, changed.dependencyHash, [], '2099-01-01']), /ediel_scoped_capability_evidence_required/); checks++
  const evidenceIds = ['TGT', 'AGT', 'SHADOW_PRODUCTION', 'LIVE_TENANT_INTEGRITY', 'RESTORE_REPLAY'].map((type, index) => ({ type, id: uid(20 + index) }))
  for (const evidence of evidenceIds) {
    const metadata = { edielScopedReadiness: { scope: changed.scope, dependencyHash: changed.dependencyHash, tests: [{ testId: 'SYNTHETIC-CHECK-ONLY', sourceRevision: 'fixture', evidenceReference: 'fixture', candidateSha: 'f'.repeat(40), result: 'passed', payloadSha256: 'b'.repeat(64) }] } }
    await db.query(`insert into ediel_certification_evidence values($1,$2,'production','passed','SYNTHETIC ONLY','SYNTHETIC ONLY',$3,'2000-01-01','2000-01-01','2099-12-31',$4,$5)`, [evidence.id, uid(1), uid(3), JSON.stringify(metadata), evidence.type])
  }
  const proof = await db.query(`select public.ediel_record_scoped_capability_evidence_v1(${placeholders},$11,$12::uuid[],$13::timestamptz) id`, [...args, changed.dependencyHash, evidenceIds.map(e => e.id), '2099-01-01']); assert.ok(proof.rows[0].id); checks++
  assert.equal((await readiness()).ready, true); checks++
  await db.query('select public.ediel_require_scoped_capability_for_message_v1($1,$2)', [uid(1),uid(2)]); checks++
  await db.exec(`update ediel_certification_evidence set status='revoked' where id='${uid(20)}'`)
  assert.equal((await readiness()).ready, false); checks++
  const acl = await db.query(`select has_function_privilege('authenticated','public.ediel_scoped_capability_readiness_v1(uuid,uuid,uuid,text,text,text,text,uuid,text,text)','execute') rpc,has_table_privilege('service_role','gridex_ediel_readiness.evidence','insert') direct_write`)
  assert.deepEqual(acl.rows, [{ rpc: false, direct_write: false }]); checks++
  await assert.rejects(db.exec('delete from gridex_ediel_readiness.evidence'), /ediel_scoped_evidence_immutable/); checks++
  console.log(`Focused PostgreSQL scoped dependency/evidence/revocation/ACL checks: ${checks} PASS`)
} finally { await db.close() }
