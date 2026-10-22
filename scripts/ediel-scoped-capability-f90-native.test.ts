// reality-defects: F90 (scoped production capability evidence: one sendable scope per tenant; every release SHA voids all proofs)
// Native proof against the installed readiness SQL (gridex_ediel_readiness.capture,
// ediel_scoped_capability_readiness_v1, ediel_record_scoped_capability_evidence_v1,
// ediel_require_scoped_capability_for_message_v1). A fresh synthetic tenant is cloned
// from an existing local production outbound PRODAT Z03 + Z01 (the reality world's
// scenario F output: originating a production Z03/Z01 needs the whole production
// switch chain). Everything runs in ONE transaction that is rolled back, so no
// immutable proof row, release receipt or tenant survives the test.
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { expect, it } from 'vitest'

type Step = Record<string, unknown> & { step: string }

const SHA1 = 'f9'.repeat(20)
const SHA2 = 'a9'.repeat(20)
const HELD = 'ediel_scoped_capability_evidence_required'
// Optional: pin the donor tenant (a local tenant with production outbound PRODAT Z03 and Z01).
const DONOR = /^[0-9a-f-]{36}$/.test(process.env.GRIDEX_F90_DONOR_COMPANY ?? '') ? process.env.GRIDEX_F90_DONOR_COMPANY : null

function runRolledBack(script: string): Step[] {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321') throw Error('owned_local_only')
  const out = execFileSync('psql', ['postgresql://postgres:postgres@127.0.0.1:54322/postgres', '-XAtq', '-v', 'ON_ERROR_STOP=1'],
    { input: script, encoding: 'utf8', timeout: 300_000, maxBuffer: 20_000_000 }).trim()
  return out.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line) as Step)
}

const script = String.raw`
BEGIN;
-- Donor: a local production outbound PRODAT Z03 and Z01 of one tenant (prefer different routes).
CREATE TEMP TABLE f90 ON COMMIT DROP AS
SELECT gen_random_uuid() company, gen_random_uuid() actor, gen_random_uuid() approver,
 z3.company_id donor, z3.id donor_z03, z1.id donor_z01,
 gen_random_uuid() z03, gen_random_uuid() z01, gen_random_uuid() z03_route2
FROM public.ediel_messages z3
JOIN public.ediel_messages z1 ON z1.company_id=z3.company_id AND z1.environment='production' AND z1.direction='outbound'
 AND z1.message_family='PRODAT' AND z1.message_code='Z01' AND z1.raw_payload IS NOT NULL
WHERE z3.environment='production' AND z3.direction='outbound' AND z3.message_family='PRODAT' AND z3.message_code='Z03' AND z3.raw_payload IS NOT NULL
 ${DONOR ? `AND z3.company_id='${DONOR}'` : ''}
ORDER BY (z1.route_profile_id IS DISTINCT FROM z3.route_profile_id) DESC, z3.created_at DESC LIMIT 1;
SELECT jsonb_build_object('step','donor','found',count(*)=1,'distinctRoutes',bool_and((SELECT a.route_profile_id IS DISTINCT FROM b.route_profile_id FROM public.ediel_messages a, public.ediel_messages b WHERE a.id=f90.donor_z03 AND b.id=f90.donor_z01))) FROM f90;

-- Fresh isolated tenant. Its Ediel production configuration rows are the donor's,
-- re-keyed to new ids, a new company and a new legal actor.
CREATE TEMP TABLE f90_map ON COMMIT DROP AS
SELECT DISTINCT old, gen_random_uuid() new FROM (
 SELECT route_profile_id old FROM public.ediel_messages WHERE id IN (SELECT donor_z03 FROM f90 UNION ALL SELECT donor_z01 FROM f90)
 UNION SELECT communication_route_id FROM public.ediel_messages WHERE id IN (SELECT donor_z03 FROM f90 UNION ALL SELECT donor_z01 FROM f90)) s;
INSERT INTO public.companies(id,name,status) SELECT company,'Synthetic F90 scoped capability tenant','active' FROM f90;
INSERT INTO public.tenant_ediel_profiles SELECT (jsonb_populate_record(NULL::public.tenant_ediel_profiles,to_jsonb(x)||jsonb_build_object('id',gen_random_uuid(),'company_id',f.company))).*
 FROM public.tenant_ediel_profiles x, f90 f WHERE x.company_id=f.donor AND x.environment='production';
INSERT INTO public.tenant_actor_identifiers SELECT (jsonb_populate_record(NULL::public.tenant_actor_identifiers,to_jsonb(x)||jsonb_build_object('id',gen_random_uuid(),'company_id',f.company,'actor_id',f.actor))).*
 FROM public.tenant_actor_identifiers x, f90 f WHERE x.company_id=f.donor AND x.environment='production';
INSERT INTO public.tenant_actor_roles SELECT (jsonb_populate_record(NULL::public.tenant_actor_roles,to_jsonb(x)||jsonb_build_object('id',gen_random_uuid(),'company_id',f.company,'actor_id',f.actor))).*
 FROM public.tenant_actor_roles x, f90 f WHERE x.company_id=f.donor AND x.environment='production';
INSERT INTO public.tenant_counterparty_relations SELECT (jsonb_populate_record(NULL::public.tenant_counterparty_relations,to_jsonb(x)||jsonb_build_object('id',gen_random_uuid(),'company_id',f.company))).*
 FROM public.tenant_counterparty_relations x, f90 f WHERE x.company_id=f.donor AND x.environment='production';
INSERT INTO public.communication_routes SELECT (jsonb_populate_record(NULL::public.communication_routes,to_jsonb(x)||jsonb_build_object('id',m.new,'company_id',f.company))).*
 FROM public.communication_routes x JOIN f90_map m ON m.old=x.id, f90 f;
INSERT INTO public.ediel_route_profiles SELECT (jsonb_populate_record(NULL::public.ediel_route_profiles,to_jsonb(x)||jsonb_build_object('id',m.new,'company_id',f.company,'communication_route_id',(SELECT new FROM f90_map WHERE old=x.communication_route_id)))).*
 FROM public.ediel_route_profiles x JOIN f90_map m ON m.old=x.id, f90 f;
-- Copied originals keep their wire references; only the namespace/origin witnesses
-- (row triggers) would refuse a byte copy. The gate under test is not a trigger.
SET LOCAL session_replication_role = replica;
INSERT INTO public.ediel_messages SELECT (jsonb_populate_record(NULL::public.ediel_messages,to_jsonb(x)||jsonb_build_object('id',CASE x.id WHEN f.donor_z03 THEN f.z03 ELSE f.z01 END,'company_id',f.company,
  'route_profile_id',(SELECT new FROM f90_map WHERE old=x.route_profile_id),'communication_route_id',(SELECT new FROM f90_map WHERE old=x.communication_route_id),'status','queued'))).*
 FROM public.ediel_messages x, f90 f WHERE x.id IN (f.donor_z03,f.donor_z01);
-- The same Z03 business scope addressed over the Z01 message's route (second counterparty route).
INSERT INTO public.ediel_messages SELECT (jsonb_populate_record(NULL::public.ediel_messages,to_jsonb(x)||jsonb_build_object('id',f.z03_route2,'outbound_request_id',gen_random_uuid(),'route_profile_id',z1.route_profile_id,'communication_route_id',z1.communication_route_id))).*
 FROM public.ediel_messages x JOIN f90 f ON x.id=f.z03 JOIN public.ediel_messages z1 ON z1.id=f.z01;
SET LOCAL session_replication_role = origin;

-- Tenant-enabled outbound capabilities (no product writer exists; see report) and the
-- certification evidence go-live requires: passed, approved, current engine version.
INSERT INTO public.tenant_message_capabilities(company_id,environment,message_family,message_code,transaction_subtype,direction,is_enabled,valid_from,metadata)
 SELECT company,'production','PRODAT',c,'L','outbound',true,clock_timestamp()-interval '1 minute','{"f90_native":true}' FROM f90, unnest(ARRAY['Z03','Z01']) c;
INSERT INTO public.ediel_certification_evidence(company_id,environment,evidence_type,status,engine_schema_version,external_reference,evidence_document_reference,tested_at,approved_by,approved_at,metadata)
 SELECT company,'production',t,'passed',public.canonical_current_ediel_engine_schema_version(),'SYNTHETIC-F90:'||t,'synthetic://f90/'||t,now()-interval '1 minute',approver,now(),'{"f90_native":true}'
 FROM f90, unnest(ARRAY['TGT','AGT','SHADOW_PRODUCTION','LIVE_TENANT_INTEGRITY','RESTORE_REPLAY','LIMITED_PILOT']) t;
INSERT INTO public.platform_release_receipts(release_sha,ci_run_id,deployment_id,environment,schema_migration_version,status,verified_at,evidence)
 VALUES('${SHA1}','synthetic-f90-ci-1','synthetic-f90-deployment-1','production','synthetic-f90','verified',clock_timestamp()+interval '1 hour','{"f90_native":true}');
SELECT jsonb_build_object('step','companyEvidenceGate','value',public.canonical_ediel_production_evidence_readiness(company)) FROM f90;

-- Helpers. Each call is its own subtransaction; a raised gate error is an observation.
CREATE FUNCTION pg_temp.msg(which text) RETURNS uuid LANGUAGE sql AS $$ SELECT CASE which WHEN 'z03' THEN z03 WHEN 'z01' THEN z01 ELSE z03_route2 END FROM f90 $$;
CREATE FUNCTION pg_temp.ready(which text, sha text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE f f90%rowtype; m public.ediel_messages%rowtype; r jsonb; BEGIN
 SELECT * INTO f FROM f90; SELECT * INTO m FROM public.ediel_messages WHERE id=pg_temp.msg(which);
 r:=public.ediel_scoped_capability_readiness_v1(f.company,m.id,f.actor,'electricity_supplier','PRODAT',m.message_code,'L',NULL,sha,m.rule_pack_checksum);
 RETURN jsonb_build_object('ready',r->'ready','evidenceId',r->'evidenceId','dependencyHash',r->'dependencyHash','scope',r->'scope','routeId',r#>'{dependencies,route,id}','releaseSha',r#>'{dependencies,releaseSha}');
EXCEPTION WHEN raise_exception THEN RETURN jsonb_build_object('error',SQLERRM); END $$;
-- What a test-phase publication must leave on the certification rows today.
CREATE FUNCTION pg_temp.bind(which text, sha text, ids uuid[]) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb:=pg_temp.ready(which,sha); BEGIN
 UPDATE public.ediel_certification_evidence SET metadata=metadata||jsonb_build_object('edielScopedReadiness',jsonb_build_object('scope',r->'scope','dependencyHash',r->>'dependencyHash',
  'tests',jsonb_build_array(jsonb_build_object('testId','SYNTHETIC-F90-'||evidence_type||'-'||(r#>>'{scope,code}'),'sourceRevision',sha,'evidenceReference','synthetic://f90/test/'||id,
  'candidateSha',sha,'result','passed','payloadSha256',encode(sha256(convert_to((SELECT raw_payload FROM public.ediel_messages WHERE id=pg_temp.msg(which)),'UTF8')),'hex'))))),updated_at=clock_timestamp()
 WHERE id=ANY(ids); RETURN r; END $$;
CREATE FUNCTION pg_temp.record(which text, sha text, ids uuid[]) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE f f90%rowtype; m public.ediel_messages%rowtype; r jsonb:=pg_temp.ready(which,sha); BEGIN
 SELECT * INTO f FROM f90; SELECT * INTO m FROM public.ediel_messages WHERE id=pg_temp.msg(which);
 RETURN jsonb_build_object('proofId',public.ediel_record_scoped_capability_evidence_v1(f.company,m.id,f.actor,'electricity_supplier','PRODAT',m.message_code,'L',NULL,sha,m.rule_pack_checksum,
  r->>'dependencyHash',ids,clock_timestamp()+interval '30 days'));
EXCEPTION WHEN raise_exception THEN RETURN jsonb_build_object('error',SQLERRM); END $$;
CREATE FUNCTION pg_temp.provider_entry(which text) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN PERFORM public.ediel_require_scoped_capability_for_message_v1((SELECT company FROM f90),pg_temp.msg(which)); RETURN jsonb_build_object('allowed',true);
EXCEPTION WHEN raise_exception THEN RETURN jsonb_build_object('allowed',false,'error',SQLERRM); END $$;
CREATE TEMP TABLE f90_rows ON COMMIT DROP AS SELECT array_agg(e.id ORDER BY e.evidence_type) ids FROM public.ediel_certification_evidence e, f90 f WHERE e.company_id=f.company;

-- 1. Certify PRODAT Z03 (release SHA1).
SELECT jsonb_build_object('step','z03.before','value',pg_temp.ready('z03','${SHA1}'));
SELECT jsonb_build_object('step','z03.bind','value',pg_temp.bind('z03','${SHA1}',ids)) FROM f90_rows;
SELECT jsonb_build_object('step','z03.record','value',pg_temp.record('z03','${SHA1}',ids)) FROM f90_rows;
SELECT jsonb_build_object('step','z03.afterRecord','value',pg_temp.ready('z03','${SHA1}'),'providerEntry',pg_temp.provider_entry('z03'));

-- 2. PRODAT Z01: same rows, still bound to the Z03 scope.
SELECT jsonb_build_object('step','z01.recordWithZ03Rows','value',pg_temp.record('z01','${SHA1}',ids)) FROM f90_rows;
CREATE FUNCTION pg_temp.try_second_row() RETURNS jsonb LANGUAGE plpgsql AS $$ BEGIN
 INSERT INTO public.ediel_certification_evidence(company_id,environment,evidence_type,status,engine_schema_version,external_reference,evidence_document_reference,tested_at,approved_by,approved_at,metadata)
  SELECT company,'production','TGT','passed',public.canonical_current_ediel_engine_schema_version(),'SYNTHETIC-F90:TGT-2','synthetic://f90/TGT-2',now()-interval '1 minute',approver,now(),'{}' FROM f90;
 RETURN jsonb_build_object('inserted',true);
EXCEPTION WHEN unique_violation THEN RETURN jsonb_build_object('inserted',false,'error',SQLERRM); END $$;
SELECT jsonb_build_object('step','z01.secondCurrentEngineRow','value',pg_temp.try_second_row());

-- 3. Rebind the same rows to Z01 (what certifying the second scope requires).
SELECT jsonb_build_object('step','z01.bind','value',pg_temp.bind('z01','${SHA1}',ids)) FROM f90_rows;
SELECT jsonb_build_object('step','z01.record','value',pg_temp.record('z01','${SHA1}',ids)) FROM f90_rows;
SELECT jsonb_build_object('step','afterZ01','z01',pg_temp.ready('z01','${SHA1}'),'z03',pg_temp.ready('z03','${SHA1}'),
 'z03ProofsUnexpired',(SELECT count(*) FROM gridex_ediel_readiness.evidence e, f90 f WHERE e.company_id=f.company AND e.scope->>'code'='Z03' AND e.expires_at>clock_timestamp()),
 'providerEntryZ03',pg_temp.provider_entry('z03'),'providerEntryZ01',pg_temp.provider_entry('z01'));

-- 4. Same Z03 scope over a second counterparty route: another dependency hash.
SELECT jsonb_build_object('step','z03.secondRoute','value',pg_temp.ready('z03_route2','${SHA1}'),'firstRoute',pg_temp.ready('z03','${SHA1}'));

-- 5. The only schema-level coexistence: a second row set under another engine_schema_version.
SAVEPOINT engine_version_misuse;
INSERT INTO public.ediel_certification_evidence(company_id,environment,evidence_type,status,engine_schema_version,external_reference,evidence_document_reference,tested_at,approved_by,approved_at,metadata)
 SELECT company,'production',t,'passed',public.canonical_current_ediel_engine_schema_version()||'#scope-z03','SYNTHETIC-F90-B:'||t,'synthetic://f90-b/'||t,now()-interval '1 minute',approver,now(),'{"f90_native":true}'
 FROM f90, unnest(ARRAY['TGT','AGT','SHADOW_PRODUCTION','LIVE_TENANT_INTEGRITY','RESTORE_REPLAY','LIMITED_PILOT']) t;
CREATE TEMP TABLE f90_rows_b ON COMMIT DROP AS SELECT array_agg(e.id ORDER BY e.evidence_type) ids FROM public.ediel_certification_evidence e, f90 f WHERE e.company_id=f.company AND e.engine_schema_version LIKE '%#scope-z03';
SELECT jsonb_build_object('step','misuse.bind','value',pg_temp.bind('z03','${SHA1}',ids)->'ready') FROM f90_rows_b;
SELECT jsonb_build_object('step','misuse.record','value',pg_temp.record('z03','${SHA1}',ids)) FROM f90_rows_b;
SELECT jsonb_build_object('step','misuse.both','z01',pg_temp.ready('z01','${SHA1}')->'ready','z03',pg_temp.ready('z03','${SHA1}')->'ready',
 'companyEvidenceGate',public.canonical_ediel_production_evidence_readiness(company)) FROM f90;
ROLLBACK TO SAVEPOINT engine_version_misuse;

-- 6. Redeploy: a newer verified production release receipt (SHA2).
INSERT INTO public.platform_release_receipts(release_sha,ci_run_id,deployment_id,environment,schema_migration_version,status,verified_at,evidence)
 VALUES('${SHA2}','synthetic-f90-ci-2','synthetic-f90-deployment-2','production','synthetic-f90','verified',clock_timestamp()+interval '2 hours','{"f90_native":true}');
SELECT jsonb_build_object('step','redeploy','z01OldSha',pg_temp.ready('z01','${SHA1}'),'z01NewSha',pg_temp.ready('z01','${SHA2}'),
 'providerEntryZ01',pg_temp.provider_entry('z01'));
SELECT jsonb_build_object('step','redeploy.recordWithOldTests','value',pg_temp.record('z01','${SHA2}',ids)) FROM f90_rows;
SELECT jsonb_build_object('step','redeploy.rebind','bind',pg_temp.bind('z01','${SHA2}',ids)->'ready','record',pg_temp.record('z01','${SHA2}',ids)) FROM f90_rows;
SELECT jsonb_build_object('step','redeploy.after','z01',pg_temp.ready('z01','${SHA2}')->'ready','z03',pg_temp.ready('z03','${SHA2}')->'ready');
SELECT jsonb_build_object('step','tenant','company',company) FROM f90;
ROLLBACK;
`

it('F90: certifying a second scope voids the first scope proof, and a new release SHA voids every proof', () => {
  const steps = runRolledBack(script)
  const at = (name: string) => {
    const found = steps.find(s => s.step === name)
    if (!found) throw Error(`f90_step_missing:${name}:${JSON.stringify(steps.map(s => s.step))}`)
    return found
  }
  if (process.env.GRIDEX_F90_OBSERVATIONS) writeFileSync(process.env.GRIDEX_F90_OBSERVATIONS, JSON.stringify(steps, null, 1))
  expect(at('donor')).toMatchObject({ found: true, distinctRoutes: true })
  expect(at('companyEvidenceGate').value).toMatchObject({ ready: true, missing: [] })

  // 1. One scope certifies through the platform's own record RPC.
  const z03 = at('z03.before').value as Record<string, unknown>
  expect(z03).toMatchObject({ ready: false, scope: { family: 'PRODAT', code: 'Z03', subtype: 'L' } })
  expect((at('z03.record').value as { proofId?: string }).proofId).toMatch(/^[0-9a-f-]{36}$/)
  expect(at('z03.afterRecord')).toMatchObject({ value: { ready: true }, providerEntry: { allowed: true } })

  // 2. A second scope cannot use the same rows, and no second row set is admitted.
  expect(at('z01.recordWithZ03Rows').value).toEqual({ error: HELD })
  expect(at('z01.secondCurrentEngineRow').value).toMatchObject({ inserted: false, error: expect.stringContaining('ediel_certification_evidence_company_id_environment_evidenc_key') })

  // 3. Rebinding the rows certifies Z01 and silently voids the Z03 proof (still unexpired).
  expect((at('z01.record').value as { proofId?: string }).proofId).toMatch(/^[0-9a-f-]{36}$/)
  const after = at('afterZ01')
  expect(after).toMatchObject({ z01: { ready: true }, z03: { ready: false, evidenceId: null }, z03ProofsUnexpired: 1,
    providerEntryZ01: { allowed: true }, providerEntryZ03: { allowed: false, error: HELD } })
  expect((after.z03 as { dependencyHash: string }).dependencyHash).toBe(z03.dependencyHash)

  // 4. One certification row set also names one route: the same scope over another route is another hash.
  const route = at('z03.secondRoute')
  expect((route.value as { scope: unknown }).scope).toEqual((route.firstRoute as { scope: unknown }).scope)
  expect((route.value as { dependencyHash: string }).dependencyHash).not.toBe((route.firstRoute as { dependencyHash: string }).dependencyHash)

  // 5. Coexistence is only reachable by mislabelling engine_schema_version (not a procedure).
  expect((at('misuse.record').value as { proofId?: string }).proofId).toMatch(/^[0-9a-f-]{36}$/)
  expect(at('misuse.both')).toMatchObject({ z01: true, z03: true, companyEvidenceGate: { ready: true } })

  // 6. A new verified release SHA voids the proof, and the old tests cannot be re-recorded.
  const redeploy = at('redeploy')
  expect(redeploy.z01OldSha).toEqual({ error: HELD })
  expect(redeploy.z01NewSha).toMatchObject({ ready: false, evidenceId: null, releaseSha: SHA2 })
  expect(redeploy.providerEntryZ01).toEqual({ allowed: false, error: HELD })
  expect(at('redeploy.recordWithOldTests').value).toEqual({ error: HELD })
  expect(at('redeploy.rebind')).toMatchObject({ bind: false, record: { proofId: expect.stringMatching(/^[0-9a-f-]{36}$/) } })
  expect(at('redeploy.after')).toMatchObject({ z01: true, z03: false })

  // Rolled back: the synthetic tenant and its immutable proofs never persisted.
  const company = at('tenant').company as string
  const left = execFileSync('psql', ['postgresql://postgres:postgres@127.0.0.1:54322/postgres', '-XAtq', '-c',
    `SELECT (SELECT count(*) FROM public.companies WHERE id='${company}')+(SELECT count(*) FROM gridex_ediel_readiness.evidence WHERE company_id='${company}')+(SELECT count(*) FROM public.platform_release_receipts WHERE release_sha IN ('${SHA1}','${SHA2}'))`],
    { encoding: 'utf8' }).trim()
  expect(left).toBe('0')
}, 300_000)
