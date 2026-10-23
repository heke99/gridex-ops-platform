// reality-defects: F89, F90, F91 (company-certified per-scope production proofs, owner decision 2026-10-23 "Automatiska bevis")
// Native proof against the installed, unchanged v1 readiness SQL (gridex_ediel_readiness.capture,
// ediel_scoped_capability_readiness_v1, ediel_require_scoped_capability_for_message_v1) plus the new
// recorder migration 20261023160000, which is executed INSIDE the test transaction. A fresh synthetic
// tenant is cloned from a local production outbound PRODAT Z03 + Z01 (the reality world's scenario F
// output) and gets a synthetic UTILTS E73 scope. Everything runs in ONE transaction that is rolled back:
// no function, proof row, capability row, release receipt or tenant survives the test.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

type Step = Record<string, unknown> & { step: string }

const SHA1 = 'c1'.repeat(20)
const SHA2 = 'c2'.repeat(20)
const HELD = 'ediel_scoped_capability_evidence_required'
const DONOR = /^[0-9a-f-]{36}$/.test(process.env.GRIDEX_F90_DONOR_COMPANY ?? '') ? process.env.GRIDEX_F90_DONOR_COMPANY : null
const MIGRATION = readFileSync(resolve('supabase/migrations/20261023160000_ediel_company_certified_scope_evidence.sql'), 'utf8')

function runRolledBack(script: string): Step[] {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321') throw Error('owned_local_only')
  const out = execFileSync('psql', ['postgresql://postgres:postgres@127.0.0.1:54322/postgres', '-XAtq', '-v', 'ON_ERROR_STOP=1'],
    { input: script, encoding: 'utf8', timeout: 300_000, maxBuffer: 20_000_000 }).trim()
  return out.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line) as Step)
}

const script = String.raw`
BEGIN;
-- The recorder under test, installed only inside this transaction.
${MIGRATION}

CREATE TEMP TABLE cc ON COMMIT DROP AS
SELECT gen_random_uuid() company, gen_random_uuid() foreign_company, gen_random_uuid() actor, gen_random_uuid() approver,
 z3.company_id donor, z3.id donor_z03, z1.id donor_z01, gen_random_uuid() z03, gen_random_uuid() z01, gen_random_uuid() e73,
 gen_random_uuid() e73_route, gen_random_uuid() e73_communication
FROM public.ediel_messages z3
JOIN public.ediel_messages z1 ON z1.company_id=z3.company_id AND z1.environment='production' AND z1.direction='outbound'
 AND z1.message_family='PRODAT' AND z1.message_code='Z01' AND z1.raw_payload IS NOT NULL
WHERE z3.environment='production' AND z3.direction='outbound' AND z3.message_family='PRODAT' AND z3.message_code='Z03' AND z3.raw_payload IS NOT NULL
 ${DONOR ? `AND z3.company_id='${DONOR}'` : ''}
ORDER BY z3.created_at DESC LIMIT 1;
-- A synthetic active UTILTS edition with the E73 (metering data request) profile, cloned from the newest
-- E73 edition: the local world has no UTILTS pack active today (the 2025 edition ended 2026-09-30 and the
-- next one is still 'future'). Rolled back with everything else.
CREATE TEMP TABLE cc_utilts ON COMMIT DROP AS
SELECT gen_random_uuid() pack, encode(sha256(convert_to('synthetic-cc-utilts-'||gen_random_uuid()::text,'UTF8')),'hex') source_hash, gen_random_uuid() profile,
 rp.id template_pack, mp.id template_profile
FROM public.ediel_rule_packs rp JOIN public.ediel_message_profiles mp ON mp.rule_pack_id=rp.id
WHERE rp.family='UTILTS' AND rp.market='electricity' AND mp.message_code='E73' AND mp.transaction_subtype='' AND mp.direction IN ('outbound','both')
ORDER BY rp.valid_from DESC LIMIT 1;
SET LOCAL session_replication_role = replica;
INSERT INTO public.ediel_rule_packs SELECT (jsonb_populate_record(NULL::public.ediel_rule_packs,to_jsonb(x)||jsonb_build_object('id',u.pack,'status','active','source_hash',u.source_hash,
  'valid_from',current_date-1,'valid_to',NULL,'guide_version',coalesce(x.guide_version,'')||'-synthetic-cc'))).*
 FROM public.ediel_rule_packs x JOIN cc_utilts u ON x.id=u.template_pack;
INSERT INTO public.ediel_message_profiles SELECT (jsonb_populate_record(NULL::public.ediel_message_profiles,to_jsonb(x)||jsonb_build_object('id',u.profile,'rule_pack_id',u.pack,'is_enabled',true))).*
 FROM public.ediel_message_profiles x JOIN cc_utilts u ON x.id=u.template_profile;
SET LOCAL session_replication_role = origin;
SELECT jsonb_build_object('step','donor','found',(SELECT count(*) FROM cc)=1,'utiltsProfile',(SELECT count(*) FROM cc_utilts)=1);

-- Fresh isolated tenant: the donor's Ediel production configuration re-keyed to a new company and legal actor.
CREATE TEMP TABLE cc_map ON COMMIT DROP AS
SELECT DISTINCT old, gen_random_uuid() new FROM (
 SELECT route_profile_id old FROM public.ediel_messages WHERE id IN (SELECT donor_z03 FROM cc UNION ALL SELECT donor_z01 FROM cc)
 UNION SELECT communication_route_id FROM public.ediel_messages WHERE id IN (SELECT donor_z03 FROM cc UNION ALL SELECT donor_z01 FROM cc)) s;
INSERT INTO public.companies(id,name,status) SELECT company,'Synthetic company-certified scope tenant','active' FROM cc;
INSERT INTO public.companies(id,name,status) SELECT foreign_company,'Synthetic foreign certified tenant','active' FROM cc;
INSERT INTO public.tenant_ediel_profiles SELECT (jsonb_populate_record(NULL::public.tenant_ediel_profiles,to_jsonb(x)||jsonb_build_object('id',gen_random_uuid(),'company_id',f.company))).*
 FROM public.tenant_ediel_profiles x, cc f WHERE x.company_id=f.donor AND x.environment='production';
INSERT INTO public.tenant_actor_identifiers SELECT (jsonb_populate_record(NULL::public.tenant_actor_identifiers,to_jsonb(x)||jsonb_build_object('id',gen_random_uuid(),'company_id',f.company,'actor_id',f.actor))).*
 FROM public.tenant_actor_identifiers x, cc f WHERE x.company_id=f.donor AND x.environment='production';
INSERT INTO public.tenant_actor_roles SELECT (jsonb_populate_record(NULL::public.tenant_actor_roles,to_jsonb(x)||jsonb_build_object('id',gen_random_uuid(),'company_id',f.company,'actor_id',f.actor))).*
 FROM public.tenant_actor_roles x, cc f WHERE x.company_id=f.donor AND x.environment='production';
INSERT INTO public.tenant_counterparty_relations SELECT (jsonb_populate_record(NULL::public.tenant_counterparty_relations,to_jsonb(x)||jsonb_build_object('id',gen_random_uuid(),'company_id',f.company))).*
 FROM public.tenant_counterparty_relations x, cc f WHERE x.company_id=f.donor AND x.environment='production';
INSERT INTO public.communication_routes SELECT (jsonb_populate_record(NULL::public.communication_routes,to_jsonb(x)||jsonb_build_object('id',m.new,'company_id',f.company))).*
 FROM public.communication_routes x JOIN cc_map m ON m.old=x.id, cc f;
INSERT INTO public.ediel_route_profiles SELECT (jsonb_populate_record(NULL::public.ediel_route_profiles,to_jsonb(x)||jsonb_build_object('id',m.new,'company_id',f.company,'communication_route_id',(SELECT new FROM cc_map WHERE old=x.communication_route_id)))).*
 FROM public.ediel_route_profiles x JOIN cc_map m ON m.old=x.id, cc f;
-- A local (non-registry) UTILTS route for E73 (metering data request), production-approved like the PRODAT routes.
INSERT INTO public.communication_routes SELECT (jsonb_populate_record(NULL::public.communication_routes,to_jsonb(x)||jsonb_build_object('id',f.e73_communication,'auth_config',coalesce(x.auth_config,'{}'::jsonb)-'platform_actor_route_id'-'materialized_from'))).*
 FROM public.communication_routes x, cc f WHERE x.id=(SELECT m.new FROM cc_map m JOIN public.ediel_messages d ON d.communication_route_id=m.old WHERE d.id=f.donor_z01);
INSERT INTO public.ediel_route_profiles SELECT (jsonb_populate_record(NULL::public.ediel_route_profiles,(to_jsonb(x)||jsonb_build_object('id',f.e73_route,'communication_route_id',f.e73_communication,
  'message_family','UTILTS','message_code','E73','is_enabled',true,'is_active',true,'is_production_ready',true,'production_mode','live','metadata',coalesce(x.metadata,'{}'::jsonb)-'platform_actor_route_id'-'materialized_from')))).*
 FROM public.ediel_route_profiles x, cc f WHERE x.id=(SELECT m.new FROM cc_map m JOIN public.ediel_messages d ON d.route_profile_id=m.old WHERE d.id=f.donor_z01);
SET LOCAL session_replication_role = replica;
INSERT INTO public.ediel_messages SELECT (jsonb_populate_record(NULL::public.ediel_messages,to_jsonb(x)||jsonb_build_object('id',CASE x.id WHEN f.donor_z03 THEN f.z03 ELSE f.z01 END,'company_id',f.company,
  'route_profile_id',(SELECT new FROM cc_map WHERE old=x.route_profile_id),'communication_route_id',(SELECT new FROM cc_map WHERE old=x.communication_route_id),'status','queued'))).*
 FROM public.ediel_messages x, cc f WHERE x.id IN (f.donor_z03,f.donor_z01);
INSERT INTO public.ediel_messages SELECT (jsonb_populate_record(NULL::public.ediel_messages,to_jsonb(x)||jsonb_build_object('id',f.e73,'outbound_request_id',gen_random_uuid(),
  'message_family','UTILTS','message_code','E73','route_profile_id',f.e73_route,'communication_route_id',f.e73_communication,'rule_pack_checksum',u.source_hash,
  'canonical_rule_pack_id',u.pack,'rule_profile_version_id',u.profile,'parsed_payload','{}'::jsonb,
  'raw_payload',split_part(x.raw_payload,'''',1)||''''||split_part(x.raw_payload,'''',2)||'''UNH+1+UTILTS:D:02B:UN:E5SE1B''BGM+E73+SYNTH-E73+9''UNT+3+1''UNZ+1+SYNTH''',
  'raw_payload_hash',NULL,'immutable_payload_hash',NULL,'immutable_rendered_at',NULL))).*
 FROM public.ediel_messages x JOIN cc f ON x.id=f.z01, cc_utilts u;
SET LOCAL session_replication_role = origin;

-- The foreign tenant holds a complete, passed company certification of its own.
INSERT INTO public.ediel_certification_evidence(company_id,environment,evidence_type,status,engine_schema_version,external_reference,evidence_document_reference,tested_at,approved_by,approved_at,metadata)
 SELECT foreign_company,'production',t,'passed',public.canonical_current_ediel_engine_schema_version(),'SYNTHETIC-FOREIGN:'||t,'synthetic://foreign/'||t,now()-interval '1 minute',approver,now(),'{}'
 FROM cc, unnest(ARRAY['TGT','AGT','SHADOW_PRODUCTION','LIVE_TENANT_INTEGRITY','RESTORE_REPLAY','LIMITED_PILOT']) t;
-- Our tenant: live, ediel_production capability ready, running release SHA1 verified. No certification yet.
INSERT INTO public.ediel_production_state(company_id,state) SELECT company,'live' FROM cc;
INSERT INTO public.company_capabilities(company_id,capability_code,enabled,readiness_status) SELECT company,'ediel_production',true,'ready' FROM cc
 ON CONFLICT (company_id,capability_code) DO UPDATE SET enabled=true,readiness_status='ready';
INSERT INTO public.platform_release_receipts(release_sha,ci_run_id,deployment_id,environment,schema_migration_version,status,verified_at,evidence)
 VALUES('${SHA1}','synthetic-cc-ci-1','synthetic-cc-deployment-1','production','synthetic-cc','verified',clock_timestamp()+interval '1 hour','{"cc_native":true}');

CREATE FUNCTION pg_temp.msg(which text) RETURNS uuid LANGUAGE sql AS $$ SELECT CASE which WHEN 'z03' THEN z03 WHEN 'z01' THEN z01 ELSE e73 END FROM cc $$;
-- What the TS gate asks: v1 readiness for the message's canonical source scope.
CREATE FUNCTION pg_temp.ready(which text, sha text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE m public.ediel_messages%rowtype; d jsonb; r jsonb; BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=pg_temp.msg(which); d:=gridex_ediel_readiness.source_scope(m);
 r:=public.ediel_scoped_capability_readiness_v1(m.company_id,m.id,(d->>'actorId')::uuid,d->>'actorRole',d->>'family',d->>'code',d->>'subtype',(d->>'assignmentId')::uuid,sha,m.rule_pack_checksum);
 RETURN jsonb_build_object('ready',r->'ready','evidenceId',r->'evidenceId','dependencyHash',r->'dependencyHash','scope',r->'scope');
EXCEPTION WHEN raise_exception THEN RETURN jsonb_build_object('error',SQLERRM); END $$;
-- What the SQL transport gate asks (prepare/enter), unchanged.
CREATE FUNCTION pg_temp.entry(which text) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN PERFORM public.ediel_require_scoped_capability_for_message_v1((SELECT company FROM cc),pg_temp.msg(which)); RETURN jsonb_build_object('allowed',true);
EXCEPTION WHEN raise_exception THEN RETURN jsonb_build_object('allowed',false,'error',SQLERRM); END $$;
CREATE FUNCTION pg_temp.rec(which text, sha text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.ediel_record_company_certified_scope_evidence_v1((SELECT company FROM cc),pg_temp.msg(which),sha,NULL) $$;
CREATE FUNCTION pg_temp.job(sha text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT x-'results'||jsonb_build_object('byCode',(SELECT jsonb_object_agg(r->>'code',jsonb_build_object('status',r->>'status','reason',r->>'reason','detail',r->>'detail')) FROM jsonb_array_elements(x->'results') r))
 FROM public.ediel_record_company_certified_scopes_v1(sha,NULL,50,(SELECT company FROM cc)) x $$;
-- Volatile SQL helpers: each reads a fresh snapshot, after the job's writes in the same statement.
CREATE FUNCTION pg_temp.proofs() RETURNS bigint LANGUAGE sql AS $$ SELECT count(*) FROM gridex_ediel_readiness.evidence e, cc WHERE e.company_id=cc.company $$;
CREATE FUNCTION pg_temp.capability_rows() RETURNS jsonb LANGUAGE sql AS $$
 SELECT coalesce(jsonb_agg(c.message_family||'/'||c.message_code||'/'||c.transaction_subtype ORDER BY c.message_family,c.message_code),'[]')
 FROM public.tenant_message_capabilities c, cc WHERE c.company_id=cc.company AND c.is_enabled $$;
CREATE FUNCTION pg_temp.snapshot_ids() RETURNS jsonb LANGUAGE sql AS $$
 SELECT coalesce(jsonb_agg(DISTINCT (SELECT jsonb_agg(x->>'id' ORDER BY x->>'id') FROM jsonb_array_elements(e.certification_records) x)),'[]')
 FROM gridex_ediel_readiness.evidence e, cc WHERE e.company_id=cc.company $$;
-- The rows the company gate counts (LIMITED_PILOT is required only after the tenant's first production send).
CREATE FUNCTION pg_temp.own_rows() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_agg(e.id::text ORDER BY e.id::text) FROM public.ediel_certification_evidence e, cc WHERE e.company_id=cc.company
  AND e.evidence_type IN (SELECT jsonb_array_elements_text(public.canonical_ediel_production_evidence_readiness(cc.company)->'passed')) $$;
CREATE FUNCTION pg_temp.rebound() RETURNS bigint LANGUAGE sql AS $$
 SELECT count(*) FROM public.ediel_certification_evidence e, cc WHERE e.company_id=cc.company AND e.metadata ? 'edielScopedReadiness' $$;
CREATE FUNCTION pg_temp.sendable() RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object(
 'z03',(pg_temp.ready('z03',(SELECT release_sha FROM public.platform_release_receipts WHERE environment='production' AND status='verified' ORDER BY verified_at DESC,recorded_at DESC,id LIMIT 1))->'ready') IS NOT DISTINCT FROM 'true'::jsonb,
 'z01',(pg_temp.ready('z01',(SELECT release_sha FROM public.platform_release_receipts WHERE environment='production' AND status='verified' ORDER BY verified_at DESC,recorded_at DESC,id LIMIT 1))->'ready') IS NOT DISTINCT FROM 'true'::jsonb,
 'e73',(pg_temp.ready('e73',(SELECT release_sha FROM public.platform_release_receipts WHERE environment='production' AND status='verified' ORDER BY verified_at DESC,recorded_at DESC,id LIMIT 1))->'ready') IS NOT DISTINCT FROM 'true'::jsonb,
 'entryZ03',pg_temp.entry('z03')->'allowed','entryZ01',pg_temp.entry('z01')->'allowed','entryE73',pg_temp.entry('e73')->'allowed') $$;

-- 1. Without the tenant's own certification (only the foreign tenant has one): nothing is recorded.
SELECT jsonb_build_object('step','noOwnCertification','job',pg_temp.job('${SHA1}'),'proofs',pg_temp.proofs(),'sendable',pg_temp.sendable(),
 'foreignCallerOwnMessage',public.ediel_record_company_certified_scope_evidence_v1((SELECT foreign_company FROM cc),pg_temp.msg('z01'),'${SHA1}',NULL)->>'reason',
 'capabilityRows',pg_temp.capability_rows());
INSERT INTO public.ediel_certification_evidence(company_id,environment,evidence_type,status,engine_schema_version,external_reference,evidence_document_reference,tested_at,approved_by,approved_at,metadata)
 SELECT company,'production',t,'passed',public.canonical_current_ediel_engine_schema_version(),'SYNTHETIC-CC:'||t,'synthetic://cc/'||t,now()-interval '1 minute',approver,now(),'{"cc_native":true}'
 FROM cc, unnest(ARRAY['TGT','AGT','SHADOW_PRODUCTION','LIVE_TENANT_INTEGRITY','RESTORE_REPLAY','LIMITED_PILOT']) t;
SELECT jsonb_build_object('step','companyGate','value',public.canonical_ediel_production_evidence_readiness(company),
 'decision',(SELECT to_jsonb(d) FROM public.canonical_tenant_operation_decision(company,'ediel.production.send') d)) FROM cc;

-- 2. Capability not ready / role not allowed / explicit deny / foreign release: nothing is recorded.
SAVEPOINT negative;
UPDATE public.company_capabilities SET enabled=false,readiness_status='blocked' WHERE company_id=(SELECT company FROM cc) AND capability_code='ediel_production';
SELECT jsonb_build_object('step','capabilityNotReady','direct',pg_temp.rec('z01','${SHA1}')->>'reason','job',pg_temp.job('${SHA1}'),'proofs',pg_temp.proofs());
ROLLBACK TO SAVEPOINT negative;
UPDATE public.tenant_actor_roles SET role_code='grid_owner' WHERE company_id=(SELECT company FROM cc);
SELECT jsonb_build_object('step','roleNotAllowed','job',pg_temp.job('${SHA1}'),'proofs',pg_temp.proofs(),'capabilityRows',pg_temp.capability_rows());
ROLLBACK TO SAVEPOINT negative;
UPDATE public.ediel_route_profiles SET is_production_ready=false,production_mode='disabled' WHERE id=(SELECT route_profile_id FROM public.ediel_messages WHERE id=pg_temp.msg('z01'));
SELECT jsonb_build_object('step','routeNotApproved','z01',pg_temp.rec('z01','${SHA1}')->>'reason','proofs',pg_temp.proofs());
ROLLBACK TO SAVEPOINT negative;
INSERT INTO public.tenant_message_capabilities(company_id,environment,message_family,message_code,transaction_subtype,direction,is_enabled,valid_from,metadata)
 SELECT company,'production','PRODAT','Z01','L','outbound',false,now()-interval '1 minute','{"cc_native":"explicit deny"}' FROM cc;
SELECT jsonb_build_object('step','explicitDeny','z01',pg_temp.rec('z01','${SHA1}')->>'reason','z03',pg_temp.rec('z03','${SHA1}')->>'status','sendable',pg_temp.sendable());
ROLLBACK TO SAVEPOINT negative;
SELECT jsonb_build_object('step','notRunningRelease','z01',pg_temp.rec('z01','${SHA2}')->>'reason','proofs',pg_temp.proofs());

-- 3. The job: Z03, Z01 and UTILTS E73 all sendable at the same time from the one company certification.
SELECT jsonb_build_object('step','before','sendable',pg_temp.sendable());
SELECT jsonb_build_object('step','job1','job',pg_temp.job('${SHA1}'),'sendable',pg_temp.sendable(),'proofs',pg_temp.proofs(),
 'capabilityRows',pg_temp.capability_rows(),'snapshotIds',pg_temp.snapshot_ids(),'ownRows',pg_temp.own_rows(),'rowsRebound',pg_temp.rebound());
SELECT jsonb_build_object('step','job1Again','job',pg_temp.job('${SHA1}'),'proofs',pg_temp.proofs());

-- 4. Redeploy (new verified release SHA2): OPS-01 intact, the gate refuses until the job runs again.
INSERT INTO public.platform_release_receipts(release_sha,ci_run_id,deployment_id,environment,schema_migration_version,status,verified_at,evidence)
 VALUES('${SHA2}','synthetic-cc-ci-2','synthetic-cc-deployment-2','production','synthetic-cc','verified',clock_timestamp()+interval '2 hours','{"cc_native":true}');
SELECT jsonb_build_object('step','redeploy','sendable',pg_temp.sendable(),'z01OldSha',pg_temp.ready('z01','${SHA1}'));
SELECT jsonb_build_object('step','job2','job',pg_temp.job('${SHA2}'),'sendable',pg_temp.sendable(),'proofs',pg_temp.proofs());

-- 5. A changed company certification row voids every proof (v1 snapshot check); the job re-records.
UPDATE public.ediel_certification_evidence SET metadata=metadata||'{"cc_native_touch":true}' WHERE company_id=(SELECT company FROM cc) AND evidence_type='TGT';
SELECT jsonb_build_object('step','certificationChanged','sendable',pg_temp.sendable());
SELECT jsonb_build_object('step','job3','job',pg_temp.job('${SHA2}'),'sendable',pg_temp.sendable());
SELECT jsonb_build_object('step','tenant','company',company,'foreign',foreign_company) FROM cc;
ROLLBACK;
`

it('F89/F90/F91: the job records company-certified proofs for every enabled scope at once; v1 still refuses until it runs', () => {
  expect(MIGRATION).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im)
  const steps = runRolledBack(script)
  const at = (name: string) => {
    const found = steps.find(s => s.step === name)
    if (!found) throw Error(`cc_step_missing:${name}:${JSON.stringify(steps.map(s => s.step))}`)
    return found
  }
  if (process.env.GRIDEX_CC_OBSERVATIONS) writeFileSync(process.env.GRIDEX_CC_OBSERVATIONS, JSON.stringify(steps, null, 1))
  expect(at('donor')).toEqual({ step: 'donor', found: true, utiltsProfile: true })
  const refused = { z03: false, z01: false, e73: false, entryZ03: false, entryZ01: false, entryE73: false }
  const allReady = { z03: true, z01: true, e73: true, entryZ03: true, entryZ01: true, entryE73: true }

  // 1. Another tenant's certification never counts; a foreign caller cannot name our message.
  const none = at('noOwnCertification')
  expect(none.job).toMatchObject({ scopes: 3, recorded: 0, current: 0, held: 3 })
  for (const code of ['Z03', 'Z01', 'E73']) expect((none.job as { byCode: Record<string, unknown> }).byCode[code]).toMatchObject({ status: 'held', reason: 'company_certification_not_ready' })
  expect(none).toMatchObject({ proofs: 0, capabilityRows: [], foreignCallerOwnMessage: 'message_not_found_for_tenant' })
  expect(none.sendable).toEqual(refused)
  expect(at('companyGate')).toMatchObject({ value: { ready: true, missing: [] }, decision: { allowed: true } })

  // 2. Every other precondition holds nothing back as recorded.
  expect(at('capabilityNotReady')).toMatchObject({ direct: 'company_capability_ediel_production_not_ready', job: { scopes: 0, recorded: 0 }, proofs: 0 })
  const role = at('roleNotAllowed')
  expect(role).toMatchObject({ job: { scopes: 3, recorded: 0, held: 3 }, proofs: 0, capabilityRows: [] })
  for (const code of ['Z03', 'Z01', 'E73']) expect((role.job as { byCode: Record<string, unknown> }).byCode[code]).toMatchObject({ reason: 'scope_role_or_identity_not_allowed' })
  expect(at('routeNotApproved')).toMatchObject({ z01: 'route_profile_not_production_approved', proofs: 0 })
  expect(at('explicitDeny')).toMatchObject({ z01: 'scope_explicitly_disabled', z03: 'recorded', sendable: { z03: true, z01: false, entryZ03: true, entryZ01: false } })
  expect(at('notRunningRelease')).toMatchObject({ z01: 'release_receipt_missing_for_running_sha', proofs: 0 })

  // 3. One job run: all three scopes sendable simultaneously from the one, unmodified company certification.
  expect(at('before').sendable).toEqual(refused)
  const job1 = at('job1')
  expect(job1.job).toMatchObject({ scopes: 3, recorded: 3, held: 0 })
  expect(job1.sendable).toEqual(allReady)
  expect(job1.proofs).toBe(3)
  expect(job1.capabilityRows).toEqual(['PRODAT/Z01/L', 'PRODAT/Z03/L', 'UTILTS/E73/*'])
  expect(job1.ownRows).toHaveLength(5)
  expect(job1.snapshotIds).toEqual([job1.ownRows])
  expect(job1.rowsRebound).toBe(0)
  expect(at('job1Again')).toMatchObject({ job: { scopes: 3, recorded: 0, current: 3 }, proofs: 3 })

  // 4. A new release SHA voids every proof at the unchanged gate until the job runs again.
  const redeploy = at('redeploy')
  expect(redeploy.sendable).toEqual(refused)
  expect(redeploy.z01OldSha).toEqual({ error: HELD })
  expect(at('job2')).toMatchObject({ job: { scopes: 3, recorded: 3 }, sendable: allReady, proofs: 6 })

  // 5. A changed certification row voids all proofs; the job records against the current rows.
  expect(at('certificationChanged').sendable).toEqual(refused)
  expect(at('job3')).toMatchObject({ job: { recorded: 3 }, sendable: allReady })

  // Rolled back: nothing persisted (tenants, proofs, receipts, the recorder functions).
  const tenant = at('tenant')
  const left = execFileSync('psql', ['postgresql://postgres:postgres@127.0.0.1:54322/postgres', '-XAtq', '-c',
    `SELECT (SELECT count(*) FROM public.companies WHERE id IN ('${tenant.company}','${tenant.foreign}'))+(SELECT count(*) FROM gridex_ediel_readiness.evidence WHERE company_id='${tenant.company}')
      +(SELECT count(*) FROM public.platform_release_receipts WHERE release_sha IN ('${SHA1}','${SHA2}'))`],
    { encoding: 'utf8' }).trim()
  expect(left).toBe('0')
}, 300_000)
