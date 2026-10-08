// Prospective supplemental DB-01 native upgrade; no approval tag.
// Historical reconstructed births use BASE56 source and database plus the
// pinned snapshot repair and one committed current AGT producer over BASE
// dependencies. Only its real BASE public creator receives a prospective
// legacy address UUID before INSERT. Then the two owned forwards run; current
// owners run in a fresh process. Original 42703/23502 failures stay preserved.
// Synthetic issuer verifier configuration is explicit fixture input, never an
// external legal approval. Nodemailer and a declared synthetic original publication input are the external fixture boundaries.
import {createHash, randomUUID} from 'node:crypto'
import {readFileSync, writeFileSync} from 'node:fs'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import type {SupabaseClient} from '@supabase/supabase-js'
import {supabaseService} from '@/lib/supabase/service'
import {createEdielMessage, createEdielTestRun, getEdielMessageById} from '@/lib/ediel/db'
import * as messageDb from '@/lib/ediel/db'
import {encodeEdifactLatin1} from '@/lib/ediel/core/edifactEncoding'
import {segmentComposite, tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {createEdielSupplierAgtOutboundCommand} from '@/lib/ediel/testing/agtEngine'
import {EDIEL_AGT_APPROVAL_VERSION_2026A, getEdielAgtRouteName, isEdielAgtRunApprovalVersion} from '@/lib/ediel/testing/agtRegistry'
import {saveEdielSystemTestSettings} from '@/lib/ediel/systemTestSettings'
import {buildContrlDraft} from '@/lib/ediel/ack'
import {createCanonicalAckMessage} from '@/lib/ediel/core/kernel'
import {resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
import {captureEdielTechnicalSyntaxAckEvidence, recordEdielTechnicalSyntaxDecision} from '@/lib/ediel/ack/technicalSyntaxAuthority'
import {assertEdielSmtpReadiness} from '@/lib/ediel/mailReadiness'
import {literal, nativeSql as sql} from '@/scripts/helpers/ediel-normal-switch-native-fixture'
import {nationalRescissionNativeChain} from '@/scripts/helpers/nationalRescissionNative'
import {recordOriginalMailboxNativeReception, seedOriginalMailboxNative} from '@/scripts/helpers/originalMailboxNative'
import {closureFixture} from '@/__tests__/helpers/closureWireFixtures'
import {utiltsNativeSourceFixture, utiltsTestEnvironmentWire} from '@/__tests__/helpers/utiltsNativeSourceFixture'
import type {CreateEdielMessageInput, EdielMessageRow} from '@/lib/ediel/types'

const provider = vi.hoisted(() => ({send: vi.fn()}))
const sourceSession = vi.hoisted(() => ({client: null as SupabaseClient | null}))
vi.mock('nodemailer', () => ({default: {createTransport: () => ({sendMail: (input: unknown) => provider.send(input)})}}))
vi.mock('@/lib/supabase/server', () => ({createSupabaseServerClient: async () => {
  if (!sourceSession.client) throw new Error('db01_actual_authenticated_source_session_required')
  return sourceSession.client
}}))
const chain = nationalRescissionNativeChain({provider: provider.send, sourceSession})
const rpc = supabaseService.rpc.bind(supabaseService) as unknown as
  (name: string, args: Record<string, unknown>) => PromiseLike<{data: unknown; error: unknown}>
type Json = Record<string, unknown>
type Authorized = Awaited<ReturnType<typeof chain.authorized>>
type Handoff = {version: 1; companyId: string; actorUserId: string; partyId: string; addressId: string;
  certificateId: string; historicalId: string; hOriginalId: string; profileId: string;
  lifecycle: {partyId: string; addressId: string; certificateId: string; profileId: string; messageId: string};
  table: Json; addressRows: Json; historicalRows: Json; graph: Json; route: Json;
  originalDraft: Record<string, unknown>; parentDelete: {state: string; message: string}; creators: Json;
  agt: {companyId: string; actorUserId: string; profileId: string; routeId: string; sender: string; addressId: string; messageId: string; rows: Json; route: Json}}
const phase = process.env.GRIDEX_DB01_NATIVE_PHASE
const handoffPath = process.env.GRIDEX_DB01_NATIVE_HANDOFF
if (!handoffPath || !['historical', 'current'].includes(phase ?? '')) throw new Error('db01_native_private_handoff_required')
const archive = 'gridex_ediel_legacy_archive.ediel_party_addresses'
const sha = (bytes: string) => createHash('sha256').update(bytes).digest('hex')
const readHandoff = () => JSON.parse(readFileSync(handoffPath, 'utf8')) as Handoff
beforeEach(() => {
  // Explicit synthetic external account input, fixed before any public birth.
  // Readiness is still computed by the actual common SMTP owner; no network.
  for (const [name, value] of Object.entries({EDIEL_SHARED_MAILBOX_ADDRESS: 'synthetic@example.invalid', EDIEL_APP_DKIM_ENABLED: 'false',
    EMAIL_PROVIDER: 'resend', EDIEL_EMAIL_PROVIDER: 'strato', EDIEL_SMTP_FROM: 'synthetic@example.invalid', EDIEL_SMTP_HOST: 'smtp.example.invalid',
    EDIEL_SMTP_PORT: '465', EDIEL_SMTP_USER: 'synthetic@example.invalid', EDIEL_SMTP_PASS: 'synthetic-only'})) vi.stubEnv(name, value)
  provider.send.mockImplementation(async () => {throw new Error('db01_unexpected_external_provider_entry')})
})
const jsonRows = (table: string, where: string) => `(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]'::jsonb) FROM ${table} t WHERE ${where})`
// Preserve multiplicity even for composite-key rows sharing one message ID.
// Only identifiers/counts/full-row hashes leave this SQL observation boundary.
const hashRows = (table: string, where = 'true') => `(SELECT jsonb_build_object('count',count(*),'rows',
  coalesce(jsonb_agg(jsonb_build_object('id',to_jsonb(t)->'id','message_id',to_jsonb(t)->'message_id',
    'source_message_id',to_jsonb(t)->'source_message_id','sha256',encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'))
    ORDER BY to_jsonb(t)::text),'[]'::jsonb)) FROM ${table} t WHERE ${where})`
function catalog(table: string) {
  return sql<Json>(`SELECT jsonb_build_object('oid',c.oid,'type_oid',c.reltype,'owner',c.relowner,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,
    'policies',(SELECT coalesce(jsonb_agg(jsonb_build_object('oid',p.oid,'name',p.polname,'command',p.polcmd,'roles',p.polroles,'permissive',p.polpermissive,'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY p.oid),'[]') FROM pg_policy p WHERE p.polrelid=c.oid),
    'indexes',(SELECT coalesce(jsonb_agg(jsonb_build_object('oid',i.indexrelid,'table',i.indrelid,'keys',i.indkey::text,'unique',i.indisunique,'primary',i.indisprimary,'valid',i.indisvalid) ORDER BY i.indexrelid),'[]') FROM pg_index i WHERE i.indrelid=c.oid),
    'fks',(SELECT jsonb_agg(jsonb_build_object('oid',k.oid,'name',k.conname,'from',k.conrelid,'to',k.confrelid,'from_keys',k.conkey,'to_keys',k.confkey,'delete',k.confdeltype,'update',k.confupdtype,'deferrable',k.condeferrable,'deferred',k.condeferred,'validated',k.convalidated) ORDER BY k.oid) FROM pg_constraint k WHERE k.contype='f' AND(c.oid=k.conrelid OR c.oid=k.confrelid))) FROM pg_class c WHERE c.oid=${literal(table)}::regclass`)
}
function graph(companyId: string) {
  const tables = ['public.ediel_messages', 'public.ediel_message_events', 'public.ediel_outbox', 'public.supplier_switch_requests',
    'public.customer_supply_periods', 'public.customers', 'public.customer_sites', 'public.customer_contracts',
    'public.metering_points', 'public.outbound_requests', 'public.ediel_message_intents',
    'public.ediel_route_profiles', 'public.communication_routes', 'public.ediel_certificates',
    'public.ediel_test_runs', 'public.ediel_test_run_messages', 'public.ediel_business_references',
    'gridex_ediel_outbound_owner.witnesses', 'gridex_bilateral_prodat.outbound_operations', 'gridex_bilateral_prodat.outbound_receipts',
    'gridex_ediel_outbound_owner.consumptions', 'gridex_ediel_source_rules.receipts', 'gridex_ediel_inbound_context.receipts',
    'gridex_received_sources.sources', 'gridex_ediel_inbound_receptions.receptions',
    'gridex_bilateral_prodat.artifacts', 'gridex_bilateral_prodat.profile_versions', 'gridex_bilateral_prodat.origins']
  return sql<Json>(`SELECT jsonb_build_object(${tables.map(t => `${literal(t)},${hashRows(t, `t.company_id=${literal(companyId)}`)}`).join(',')})`)
}
function historicalRows(h: Pick<Handoff, 'historicalId' | 'hOriginalId' | 'profileId'>) {
  return sql<Json>(`SELECT jsonb_build_object('messages',${hashRows('public.ediel_messages', `t.id IN(${literal(h.historicalId)},${literal(h.hOriginalId)})`)},
    'profile',${hashRows('public.ediel_route_profiles', `t.id=${literal(h.profileId)}`)})`)
}
function probe(statement: string) {
  // Actual PostgreSQL execution, isolated rollback; no simulated SQL result.
  return sql<{state: string; message: string}>(`BEGIN; CREATE TEMP TABLE db01_probe_setup(x int); CREATE FUNCTION pg_temp.db01_probe() RETURNS jsonb LANGUAGE plpgsql AS $probe$
    BEGIN ${statement}; RAISE EXCEPTION 'db01_expected_database_refusal_not_observed';
    EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('state',SQLSTATE,'message',SQLERRM); END $probe$;
    SELECT pg_temp.db01_probe(); ROLLBACK;`)
}
function creators(historical: boolean) {
  const expression = "nullif(p_draft->>'partyAddressId','')::uuid"
  return sql<Json>(`SELECT jsonb_object_agg(p.proname,jsonb_build_object('metadata',to_jsonb(p)-'prosrc',
    'body_hash',encode(sha256(convert_to(${historical ? `replace(p.prosrc,${literal(expression)},'NULL')` : 'p.prosrc'},'UTF8')),'hex')))
    FROM pg_proc p WHERE p.oid IN('public.ediel_create_bilateral_prodat_original_v1(uuid,uuid,jsonb)'::regprocedure,
    'public.ediel_create_national_supply_rescission_original_v1(uuid,uuid,jsonb)'::regprocedure)`)
}
function configureLegacy(f: Pick<Authorized, 'receiver' | 'companyId' | 'routeProfileId'>, lifecycle = false) {
  const partyId = randomUUID(), addressId = randomUUID(), certificateId = randomUUID(), profileId = lifecycle ? randomUUID() : f.routeProfileId
  const directoryId = lifecycle ? `${f.receiver}99` : f.receiver
  // Ordinary synthetic directory metadata, not certificate trust, production
  // activation or an approval source. It deliberately contradicts live routing.
  sql(`INSERT INTO public.ediel_parties(id,name,ediel_id,status,source) VALUES(${literal(partyId)},'Synthetic retired directory',${literal(directoryId)},'inactive','manual');
    INSERT INTO public.ediel_certificates(id,company_id,certificate_fingerprint,secret_reference,status,environment)
    VALUES(${literal(certificateId)},${literal(f.companyId)},${literal(certificateId)},'public://synthetic-unused-legacy','inactive','test');
    INSERT INTO public.ediel_party_addresses(id,party_id,ediel_id,message_family,environment,smtp_address,transport_security_mode,receiver_certificate_id,status,metadata)
    VALUES(${literal(addressId)},${literal(partyId)},${literal(directoryId)},'PRODAT','test','retired@example.invalid','needs_verification',${literal(certificateId)},'inactive','{"synthetic_directory_only":true}');`)
  if (lifecycle) sql(`INSERT INTO public.ediel_route_profiles(id,company_id,route_name,environment,message_family,party_address_id)
    VALUES(${literal(profileId)},${literal(f.companyId)},'Disposable legacy lifecycle metadata','test','PRODAT',${literal(addressId)});`)
  else sql(`UPDATE public.ediel_route_profiles SET party_address_id=${literal(addressId)} WHERE id=${literal(profileId)};`)
  return {partyId, addressId, certificateId, profileId}
}
function agtSnapshotAuthorization(f: {companyId: string; actorUserId: string}, otherCompanyId: string) {
  expect(otherCompanyId).not.toBe(f.companyId)
  return sql<{authorized: boolean; platformAdmin: boolean; otherCompany: boolean}>(`SELECT jsonb_build_object(
    'authorized',public.canonical_actor_is_authorized(${literal(f.companyId)},${literal(f.actorUserId)},'ediel.profile.write',false),
    'platformAdmin',public.canonical_actor_is_platform_admin(${literal(f.actorUserId)}),
    'otherCompany',public.canonical_actor_is_authorized(${literal(otherCompanyId)},${literal(f.actorUserId)},'ediel.profile.write',false))`)
}
function prepareAgtSnapshotActor(f: {companyId: string; actorUserId: string}, otherCompanyId: string) {
  // Declared prospective RBAC input for the real snapshot owner, not an
  // approval, source receipt or configuration snapshot. Direct user grants
  // do not satisfy this owner's role-backed canonical authorization predicate.
  const input = sql<{roles: Array<{id: string; key: string}>; permissions: Array<{id: string; key: string}>}>(`SELECT jsonb_build_object(
    'roles',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'key',r.key)),'[]'::jsonb)
      FROM public.user_roles ur JOIN public.roles r ON r.id=ur.role_id
      JOIN public.company_memberships cm ON cm.user_id=ur.user_id AND cm.company_id=ur.company_id
      JOIN auth.users u ON u.id=ur.user_id JOIN public.user_profiles up ON up.id=u.id
      WHERE ur.user_id=${literal(f.actorUserId)} AND ur.company_id=${literal(f.companyId)}
        AND ur.status='active' AND ur.is_active AND r.scope='company' AND r.is_active AND NOT r.is_system_role
        AND r.key='native_actor_'||r.id::text AND cm.status='active' AND cm.is_active
        AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until<=now())
        AND u.email_confirmed_at IS NOT NULL AND up.user_status='active'),
    'permissions',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'key',key)),'[]'::jsonb)
      FROM public.permissions WHERE key='ediel.profile.write' AND is_active))`)
  expect(input.roles).toHaveLength(1); expect(input.permissions).toHaveLength(1)
  const role = input.roles[0], permission = input.permissions[0]
  expect(sql(`SELECT coalesce(jsonb_agg(jsonb_build_object('actor',user_id,'company',company_id,'status',status,'active',is_active)),'[]'::jsonb)
    FROM public.user_roles WHERE role_id=${literal(role.id)}`))
    .toEqual([{actor: f.actorUserId, company: f.companyId, status: 'active', active: true}])
  expect(sql(`SELECT to_jsonb(count(*)) FROM public.role_permissions WHERE role_id=${literal(role.id)}`)).toBe(0)
  expect(agtSnapshotAuthorization(f, otherCompanyId)).toEqual({authorized: false, platformAdmin: false, otherCompany: false})
  const otherPermissions = sql<Json>(`SELECT ${hashRows('public.role_permissions', `t.role_id IS DISTINCT FROM ${literal(role.id)}`)}`)
  sql(`INSERT INTO public.role_permissions(role_id,role_key,permission_id,permission_key,effect)
    SELECT r.id,r.key,p.id,p.key,'allow' FROM public.roles r CROSS JOIN public.permissions p
    WHERE r.id=${literal(role.id)} AND r.key=${literal(role.key)} AND r.scope='company' AND r.is_active AND NOT r.is_system_role
      AND p.id=${literal(permission.id)} AND p.key='ediel.profile.write' AND p.is_active;`)
  expect(sql(`SELECT coalesce(jsonb_agg(jsonb_build_object('role_id',role_id,'role_key',role_key,
    'permission_id',permission_id,'permission_key',permission_key,'effect',effect)),'[]'::jsonb)
    FROM public.role_permissions WHERE role_id=${literal(role.id)}`))
    .toEqual([{role_id: role.id, role_key: role.key, permission_id: permission.id, permission_key: permission.key, effect: 'allow'}])
  expect(sql<Json>(`SELECT ${hashRows('public.role_permissions', `t.role_id IS DISTINCT FROM ${literal(role.id)}`)}`)).toEqual(otherPermissions)
  expect(agtSnapshotAuthorization(f, otherCompanyId)).toEqual({authorized: true, platformAdmin: false, otherCompany: false})
}
async function configureAgt(otherCompanyId: string) {
  const f = await chain.stage(), routeId = randomUUID(), profileId = randomUUID()
  prepareAgtSnapshotActor(f, otherCompanyId)
  sql(`UPDATE public.ediel_actor_settings SET actor_role='supplier',brp_ediel_id=${literal(f.brpEdielId)},mailbox='synthetic@example.invalid' WHERE company_id=${literal(f.companyId)} AND environment='test';
    INSERT INTO public.communication_routes(id,company_id,route_name,route_scope,environment_type,is_active,target_email)
    VALUES(${literal(routeId)},${literal(f.companyId)},${literal(getEdielAgtRouteName('PRODAT'))},'supplier_switch','agt_test',true,'portal@example.invalid');
    INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_family,business_code,sender_ediel_id,receiver_ediel_id,
      receiver_sub_address,application_reference,is_enabled,transport_security_mode,encryption_mode,mailbox,smtp_to,receiver_email,default_test_flag)
    VALUES(${literal(profileId)},${literal(f.companyId)},${literal(routeId)},'Synthetic actual AGT L7 profile','test','PRODAT','Z09',${literal(f.sender)},'91100',
      'PRODAT','23-DDQ-PRODAT',true,'unencrypted','none','synthetic@example.invalid','portal@example.invalid','portal@example.invalid',1);`)
  const settings = await saveEdielSystemTestSettings({companyId: f.companyId, actorUserId: f.actorUserId, testSuite: 'AGT', actorRole: 'supplier',
    messageFamily: 'PRODAT', setupPackage: 'agt_ddq_prodat_l', environmentType: 'agt_test', testPortalEdielId: '91100', testPortalName: 'Synthetic test portal',
    testPortalEmail: 'portal@example.invalid', testBrpEdielId: f.brpEdielId, defaultReceiverSubaddress: 'PRODAT', routeProfileId: profileId,
    applicationReference: '23-DDQ-PRODAT', isActive: true})
  expect(settings.routeProfileId).toBe(profileId)
  return {...f, routeId, routeProfileId: profileId}
}
function assertAgtCanonicalCustody(message: EdielMessageRow, f: {companyId: string; actorUserId: string; profileId: string; routeId: string}, runId: string) {
  expect(message).toMatchObject({company_id: f.companyId, created_by: f.actorUserId, environment: 'test', direction: 'outbound',
    message_family: 'PRODAT', message_code: 'Z09', route_profile_id: f.profileId, communication_route_id: f.routeId,
    rule_profile_key: 'PRODAT:Z09:G:26.A:r3', canonical_rule_pack_id: expect.stringMatching(/^[0-9a-f-]{36}$/i),
    rule_profile_version_id: expect.stringMatching(/^[0-9a-f-]{36}$/i), rule_profile_version: expect.any(String),
    rule_pack_checksum: expect.stringMatching(/^[0-9a-f]{64}$/), immutable_payload_hash: sha(message.raw_payload!),
    immutable_rendered_at: expect.any(String)})
  expect(message.raw_payload).toContain("CCI++Z13'CAV+E32'")
  expect(message.raw_payload).toContain("CCI++Z04'CAV+Z03'")
  expect(message.parsed_payload).toMatchObject({agt: true, agtTestCaseCode: 'L7', agtApprovalVersion: '2026A'})
  expect(message.validation_report).toMatchObject({lockedSendContext: {source: 'ediel_test_runs', testRunId: runId,
    testSuite: 'PRODAT', testCaseCode: 'L7', roleCode: 'supplier', routeProfileId: f.profileId, communicationRouteId: f.routeId}})
  expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_test_run_messages link JOIN public.ediel_test_runs run ON run.id=link.test_run_id
    WHERE link.ediel_message_id=${literal(message.id)} AND link.company_id=${literal(f.companyId)} AND run.id=${literal(runId)}
      AND run.company_id=link.company_id AND run.test_suite='PRODAT' AND run.test_case_code='L7' AND run.role_code='supplier'
      AND run.route_profile_id=${literal(f.profileId)} AND link.expected_direction='outbound' AND link.expected_family='PRODAT' AND link.expected_code='Z09'`)).toBe(1)
  expect(sql(`SELECT jsonb_build_object('witnesses',count(DISTINCT w.id),'consumptions',count(c.source_message_id),
    'exact',bool_and(w.company_id=m.company_id AND w.actor_user_id=${literal(f.actorUserId)}::uuid AND w.environment=m.environment
      AND w.family=m.message_family AND w.code=m.message_code AND w.payload_sha256=m.immutable_payload_hash
      AND c.company_id=m.company_id AND c.environment=m.environment AND c.payload_sha256=w.payload_sha256
      AND w.id::text=m.execution_context_snapshot->>'outboundOwnerWitnessId'
      AND w.evidence->>'rulePackId'=m.canonical_rule_pack_id::text
      AND w.evidence->>'messageProfileId'=m.rule_profile_version_id::text AND w.evidence->>'profileKey'=m.rule_profile_key
      AND w.evidence->>'version'=m.rule_profile_version AND w.evidence->>'sourceHash'=m.rule_pack_checksum
      AND m.immutable_payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')))
    FROM public.ediel_messages m JOIN gridex_ediel_outbound_owner.consumptions c ON c.source_message_id=m.id
    JOIN gridex_ediel_outbound_owner.witnesses w ON w.id=c.witness_id
    WHERE m.id=${literal(message.id)} AND m.company_id=${literal(f.companyId)}`))
    .toEqual({witnesses: 1, consumptions: 1, exact: true})
  expect(sql(`SELECT jsonb_build_object('registrations',count(DISTINCT f.id),'witnesses',count(DISTINCT w.id),
    'consumptions',count(c.message_id),'exact',bool_and(f.company_id=m.company_id AND f.run_id=${literal(runId)}::uuid
      AND f.role_code='supplier' AND f.case_code='L7' AND f.suite='PRODAT' AND f.revision='2026A' AND f.step_no=1
      AND f.expected_outcome='positive' AND f.expected_diagnostic_codes='[]'::jsonb
      AND f.source_reference='synthetic://native-db01-l7-original' AND f.owner_decision_reference='synthetic://native-db01-l7-owner'
      AND f.original_wire=m.raw_payload AND f.wire_sha256=encode(sha256(convert_to(m.raw_payload,'LATIN1')),'hex')
      AND f.original_file_sha256=f.wire_sha256 AND w.actor_user_id=${literal(f.actorUserId)}::uuid
      AND w.qualification->>'authorizesBusinessEffect'='false'
      AND w.id::text=m.execution_context_snapshot->>'sourceQualifiedPositiveFixtureWitnessId'))
    FROM public.ediel_messages m JOIN gridex_negative_fixtures.positive_consumptions c ON c.message_id=m.id
    JOIN gridex_negative_fixtures.positive_witnesses w ON w.id=c.witness_id
    JOIN gridex_negative_fixtures.positive_originals f ON f.id=w.registration_id
    WHERE m.id=${literal(message.id)} AND m.company_id=${literal(f.companyId)}`))
    .toEqual({registrations: 1, witnesses: 1, consumptions: 1, exact: true})
}
const authoritySql=`SELECT jsonb_build_object(
 'functions',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='gridex_negative_fixtures' OR(n.nspname='public' AND p.proname LIKE 'gridex_ediel_%_fixture_%')),
 'schema',(SELECT jsonb_build_object('owner',nspowner,'acl',nspacl) FROM pg_namespace WHERE nspname='gridex_negative_fixtures'),
 'tables',(SELECT jsonb_agg(jsonb_build_object('oid',c.oid,'owner',c.relowner,'acl',c.relacl,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity) ORDER BY c.oid)
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='gridex_negative_fixtures' AND c.relkind='r'),
 'publisherRole',(SELECT to_jsonb(r) FROM pg_roles r WHERE rolname='gridex_ediel_fixture_authority_owner'),
 'memberships',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.roleid,m.member),'[]'::jsonb) FROM pg_auth_members m
  WHERE m.roleid='gridex_ediel_fixture_authority_owner'::regrole OR m.member='gridex_ediel_fixture_authority_owner'::regrole))`

type Membership={oid:number;roleid:number;member:number;grantor:number;admin_option:boolean;inherit_option:boolean;set_option:boolean}
type NativeAuthority={authority:Json&{memberships:Membership[]};currentUser:string;sessionUser:string;currentRoleOid:number;
 publisherRoleOid:number;serverVersion:number;canSet:boolean;publicUsage:boolean;privateUsage:boolean;publicSchema:unknown;roles:unknown}
const nativeAuthoritySql=`SELECT jsonb_build_object('authority',(${authoritySql}),
 'currentUser',current_user,'sessionUser',session_user,'currentRoleOid',current_user::regrole::oid,
 'publisherRoleOid','gridex_ediel_fixture_authority_owner'::regrole::oid,
 'serverVersion',current_setting('server_version_num')::integer,
 'canSet',pg_has_role(current_user,'gridex_ediel_fixture_authority_owner','SET'),
 'publicUsage',has_schema_privilege('gridex_ediel_fixture_authority_owner','public','USAGE'),
 'privateUsage',has_schema_privilege('gridex_ediel_fixture_authority_owner','gridex_negative_fixtures','USAGE'),
 'publicSchema',(SELECT jsonb_build_object('oid',oid,'owner',nspowner,'acl',nspacl) FROM pg_namespace WHERE nspname='public'),
 'roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.oid) FROM pg_roles r WHERE rolname IN(current_user,'gridex_ediel_fixture_authority_owner')))`
const nativeAuthority=()=>sql<NativeAuthority>(nativeAuthoritySql)
let pristineAuthority:NativeAuthority|undefined,bridgeAttempted=false
const ownBridgeRow=(row:Membership,before:NativeAuthority)=>row.roleid===before.publisherRoleOid&&
 row.member===before.currentRoleOid&&row.grantor===before.currentRoleOid

function installNativePublisherBridge(){
 pristineAuthority=nativeAuthority()
 const before=pristineAuthority
 expect(before).toMatchObject({currentUser:'postgres',sessionUser:'postgres'})
 if(!before.publicUsage||!before.privateUsage)throw Error('native_db01_publisher_namespace_usage_required')
 expect(before.serverVersion).toBeGreaterThanOrEqual(160000)
 expect(before.authority.publisherRole).toMatchObject({rolcanlogin:false})
 if(before.canSet)return
 expect(before.authority.memberships.some(row=>row.roleid===before.publisherRoleOid&&row.member===before.currentRoleOid&&row.admin_option)).toBe(true)
 expect(before.authority.memberships.filter(row=>ownBridgeRow(row,before))).toEqual([])
 // Commit once before concurrent publishers start. A GRANT inside each A/B
 // transaction would serialize pg_auth_members and conceal the product race.
 bridgeAttempted=true
 sql(`BEGIN;
  GRANT gridex_ediel_fixture_authority_owner TO CURRENT_USER WITH SET TRUE GRANTED BY CURRENT_USER;
  GRANT gridex_ediel_fixture_authority_owner TO CURRENT_USER WITH INHERIT FALSE GRANTED BY CURRENT_USER;
  GRANT gridex_ediel_fixture_authority_owner TO CURRENT_USER WITH ADMIN FALSE GRANTED BY CURRENT_USER;
  COMMIT;`)
 const active=nativeAuthority(),added=active.authority.memberships.filter(row=>ownBridgeRow(row,before))
 expect(added).toHaveLength(1)
 expect(added[0]).toMatchObject({admin_option:false,inherit_option:false,set_option:true})
 expect(active.canSet).toBe(true)
 expect({...active,canSet:before.canSet,authority:{...active.authority,
  memberships:active.authority.memberships.filter(row=>!ownBridgeRow(row,before))}}).toEqual(before)
}

function restoreNativePublisherBridge(){
 const before=pristineAuthority
 if(!before)return
 // Inspect actual state even if exec timed out after a successful COMMIT.
 // Never revoke the original creator's membership or any foreign grantor.
 if(bridgeAttempted&&nativeAuthority().authority.memberships.some(row=>ownBridgeRow(row,before))){
  sql(`BEGIN;
   REVOKE gridex_ediel_fixture_authority_owner FROM CURRENT_USER GRANTED BY CURRENT_USER RESTRICT;
   COMMIT;`)
 }
 expect(nativeAuthority()).toEqual(before)
}


async function agtOriginal(f: {companyId: string; actorUserId: string; profileId: string; routeId: string; sender: string}, otherCompanyId: string, legacyAddressId?: string) {
  // The current phase reuses the historical role grant without regranting or
  // changing it after the forwards. Both phases call the actual predicate.
  expect(agtSnapshotAuthorization(f, otherCompanyId)).toEqual({authorized: true, platformAdmin: false, otherCompany: false})
  // Actual public run creation captures current configuration. No seeded
  // locked-run, certification/approval result or fabricated ready decision.
  const run = await createEdielTestRun({companyId: f.companyId, actorUserId: f.actorUserId, testSuite: 'PRODAT', roleCode: 'supplier',
    actorRole: 'supplier', messageFamily: 'PRODAT', businessCode: 'Z09', testCaseCode: 'L7', approvalVersion: EDIEL_AGT_APPROVAL_VERSION_2026A, status: 'running',
    startedAt: new Date().toISOString(), routeProfileId: f.profileId, environmentType: 'agt_test', encryptionMode: 'none'})
  expect(run).toMatchObject({company_id: f.companyId, test_suite: 'PRODAT', test_case_code: 'L7', role_code: 'supplier',
    approval_version: EDIEL_AGT_APPROVAL_VERSION_2026A, status: 'running', route_profile_id: f.profileId,
    environment: 'test', environment_type: 'agt_test', created_by: f.actorUserId})
  expect(isEdielAgtRunApprovalVersion(run.approval_version)).toBe(true)
  expect(run.route_profile_id).toBe(f.profileId)
  // Generated references are declared synthetic input, not acquired AGT
  // certification. Publish only the independently known own L7 run/step after
  // checking its frozen physical facts; delegate the genuine read unchanged.
  installNativePublisherBridge()
  let registrationId: string | undefined
  vi.spyOn(supabaseService, 'rpc').mockImplementation(((name: string, args: Json) => {
    if (name === 'gridex_ediel_positive_fixture_read_v1') {
      const context = args.p_context as Json
      expect(registrationId).toBeUndefined()
      expect(context).toMatchObject({companyId: f.companyId, actorUserId: f.actorUserId, runId: run.id, stepNo: 1, diagnosticCodes: []})
      const raw = String(context.rawPayload)
      const wire = tokenizeEdifact(raw)
      const unbs = wire.segments.filter(segment => segment.tag === 'UNB')
      const unhs = wire.segments.filter(segment => segment.tag === 'UNH')
      const bgms = wire.segments.filter(segment => segment.tag === 'BGM')
      expect(unbs).toHaveLength(1); expect(unhs).toHaveLength(1); expect(bgms).toHaveLength(1)
      expect(segmentComposite(unbs[0], 2, wire.una)[0]).toBe(f.sender)
      expect(segmentComposite(unbs[0], 3, wire.una)[0]).toBe('91100')
      expect(segmentComposite(unbs[0], 7, wire.una)[0]).toBe('23-DDQ-PRODAT')
      expect(segmentComposite(unbs[0], 11, wire.una)[0]).toBe('1')
      expect(segmentComposite(unhs[0], 2, wire.una)).toEqual(['PRODAT', 'D', '97A', 'UN', 'E2SE6A'])
      expect(segmentComposite(bgms[0], 1, wire.una)[0]).toBe('Z09')
      expect(raw).toContain("BGM+Z09+")
      expect(raw).toContain("CCI++Z13'CAV+E32'")
      expect(raw).toContain("CCI++Z04'CAV+Z03'")
      const source = {companyId: f.companyId, actorUserId: f.actorUserId, runId: run.id, stepNo: 1,
        roleCode: 'supplier', caseCode: 'L7', suite: 'PRODAT', revision: '2026A',
        expectedOutcome: 'positive', expectedDiagnosticCodes: [], testReceiverEdielId: '91100',
        sourceReference: 'synthetic://native-db01-l7-original', ownerDecisionReference: 'synthetic://native-db01-l7-owner',
        validUntil: new Date(Date.now() + 3600000).toISOString()}
      registrationId = sql<string>(`BEGIN; SET LOCAL ROLE gridex_ediel_fixture_authority_owner;
        SELECT to_jsonb(public.gridex_ediel_positive_fixture_publish_v1(${literal(source)}::jsonb,decode('${encodeEdifactLatin1(raw).toString('hex')}','hex'))); COMMIT;`)
      expect(registrationId).toMatch(/^[a-f0-9-]{36}$/)
    }
    return rpc(name, args)
  }) as typeof supabaseService.rpc)
  const command = () => createEdielSupplierAgtOutboundCommand({companyId: f.companyId, actorUserId: f.actorUserId, testRunId: run.id, testCaseCode: 'L7', balanceResponsibleEdielId: '99876'})
  if (phase === 'current') {
    expect(legacyAddressId).toBeUndefined()
    const message = await command()
    assertAgtCanonicalCustody(message, f, run.id)
    return message
  }
  expect(legacyAddressId).toMatch(/^[0-9a-f-]{36}$/i)
  expect(sql(`SELECT to_jsonb(p.party_address_id=${literal(legacyAddressId)}::uuid AND p.communication_route_id=${literal(f.routeId)}::uuid
    AND EXISTS(SELECT FROM public.ediel_party_addresses a WHERE a.id=p.party_address_id))
    FROM public.ediel_route_profiles p WHERE p.id=${literal(f.profileId)} AND p.company_id=${literal(f.companyId)}`)).toBe(true)
  // Explicit reconstructed historical DTO input at the public BASE port.
  // The canonical producer/owner already made the witness and pins. Change
  // only this non-authoritative prospective UUID before real SQL custody.
  const realCreate = messageDb.createEdielMessage.bind(messageDb), inputs: CreateEdielMessageInput[] = []
  const spy = vi.spyOn(messageDb, 'createEdielMessage').mockImplementation(async input => {
    expect(inputs).toHaveLength(0)
    expect(input).toMatchObject({companyId: f.companyId, actorUserId: f.actorUserId, environment: 'test', direction: 'outbound',
      messageStandard: 'edifact', messageFamily: 'PRODAT', messageCode: 'Z09', routeProfileId: f.profileId, communicationRouteId: f.routeId,
      canonicalRulePackId: expect.stringMatching(/^[0-9a-f-]{36}$/i), ruleProfileKey: 'PRODAT:Z09:G:26.A:r3',
      ruleProfileVersionId: expect.stringMatching(/^[0-9a-f-]{36}$/i), ruleProfileVersion: expect.any(String),
      rulePackChecksum: expect.stringMatching(/^[0-9a-f]{64}$/), executionContextSnapshot: {outboundOwnerWitnessId: expect.stringMatching(/^[0-9a-f-]{36}$/i)},
      parsedPayload: {agt: true, agtTestCaseCode: 'L7', agtApprovalVersion: '2026A'},
      validationReport: {lockedSendContext: {source: 'ediel_test_runs', testRunId: run.id, testSuite: 'PRODAT', testCaseCode: 'L7',
        roleCode: 'supplier', routeProfileId: f.profileId, communicationRouteId: f.routeId}}})
    expect(input.partyAddressId ?? null).toBeNull()
    inputs.push(structuredClone(input))
    return realCreate({...input, partyAddressId: legacyAddressId})
  })
  try {
    const message = await command()
    expect(inputs).toHaveLength(1)
    expect(message).toMatchObject({party_address_id: legacyAddressId, raw_payload: inputs[0].rawPayload,
      canonical_rule_pack_id: inputs[0].canonicalRulePackId, rule_profile_version_id: inputs[0].ruleProfileVersionId,
      rule_pack_snapshot: JSON.parse(JSON.stringify(inputs[0].rulePackSnapshot)),
      execution_context_snapshot: JSON.parse(JSON.stringify(inputs[0].executionContextSnapshot))})
    assertAgtCanonicalCustody(message, f, run.id)
    return message
  } finally {spy.mockRestore()}
}
async function directWire(f: Authorized, addressId: string) {
  const sourceId = randomUUID()
  const prospective = closureFixture({reason: 'Z24', document: `D${sourceId.replaceAll('-', '').slice(0, 13)}`}).wire
    .replaceAll('12345:14', `${f.receiver}:14`).replaceAll('12345:160:SVK', `${f.receiver}:160:SVK`)
    .replaceAll('54321:14', `${f.sender}:14`).replaceAll('54321:160:SVK', `${f.sender}:160:SVK`)
    .replace(/\+I(\+\+23-DDQ-PRODAT)/, `+X${sourceId.replaceAll('-', '').slice(0, 12)}$1`)
    .replace(/UNZ\+1\+I'/, `UNZ+1+X${sourceId.replaceAll('-', '').slice(0, 12)}'`)
  const source = utiltsNativeSourceFixture(utiltsTestEnvironmentWire(prospective), sourceId)
  const smtp = assertEdielSmtpReadiness()
  const mail = await seedOriginalMailboxNative(sql, literal, {companyId: f.companyId, environment: 'test', raw: source.raw, smtpFrom: smtp.from})
  const registry = sql<{packId: string; profileId: string; version: string; checksum: string; snapshot: Json}>(`SELECT jsonb_build_object('packId',pack.id,'profileId',profile.id,
    'version',pack.guide_version||':r'||pack.guide_revision,'checksum',pack.source_hash,'snapshot',profile.profile)
    FROM public.ediel_message_profiles profile JOIN public.ediel_rule_packs pack ON pack.id=profile.rule_pack_id
    WHERE profile.profile_key='PRODAT:Z05:C:26.A:r3' AND profile.is_enabled`)
  const input: CreateEdielMessageInput = {actorUserId: f.actorUserId, companyId: f.companyId, environment: 'test', direction: 'inbound',
    messageStandard: 'edifact', messageFamily: 'PRODAT', messageCode: 'Z05', messageVersion: 'E2SE6A', status: 'received',
    rawPayload: source.raw, parsedPayload: mail.parsed, mailboxMessageId: mail.inboundEmailMessageId,
    senderEdielId: f.receiver, receiverEdielId: f.sender, interchangeReference: mail.parsed.interchangeReference,
    applicationReference: '23-DDQ-PRODAT', partyAddressId: addressId, communicationRouteId: f.routeId, routeProfileId: f.routeProfileId,
    messageReceivedAt: new Date().toISOString(), canonicalRulePackId: registry.packId, ruleProfileKey: 'PRODAT:Z05:C:26.A:r3',
    ruleProfileVersionId: registry.profileId, ruleProfileVersion: registry.version, rulePackChecksum: registry.checksum, rulePackSnapshot: registry.snapshot}
  const message = await createEdielMessage(input)
  await recordOriginalMailboxNativeReception({...mail, companyId: f.companyId, sourceMessageId: message.id, actorUserId: f.actorUserId})
  return {message, input, mail}
}
async function originateWithHint(f: Authorized, addressId: string) {
  let originalDraft: Record<string, unknown> | null = null
  const spy = vi.spyOn(supabaseService, 'rpc').mockImplementation(((name: string, args: Record<string, unknown>) => {
    if (name === 'ediel_create_bilateral_prodat_original_v1') {
      expect(args.p_company_id).toBe(f.companyId); expect(args.p_actor_user_id).toBe(f.actorUserId)
      originalDraft = {...args.p_draft as Json, partyAddressId: addressId}
      return rpc(name, {...args, p_draft: originalDraft})
    }
    return rpc(name, args)
  }) as typeof supabaseService.rpc)
  try {
    const original = await chain.originate(f)
    expect(originalDraft).not.toBeNull()
    expect(original).toMatchObject({company_id: f.companyId, direction: 'outbound', message_code: 'Z03', environment: 'test'})
    return {original, originalDraft: originalDraft as unknown as Json}
  } finally {spy.mockRestore()}
}
afterEach(() => {
  try {restoreNativePublisherBridge()} finally {
    pristineAuthority = undefined; bridgeAttempted = false
    vi.restoreAllMocks(); vi.unstubAllEnvs(); provider.send.mockReset(); sourceSession.client = null
  }
})

if (phase === 'historical') {
  it('BASE56 actual public direct and protected H births retain prospective legacy hints before custody; capture upgrade witnesses', async () => {
    expect(sql(`SELECT to_jsonb(to_regclass('public.ediel_party_addresses') IS NOT NULL AND to_regclass(${literal(archive)}) IS NULL)`)).toBe(true)
    const f = await chain.authorized(), old = configureLegacy(f), lifecycleConfig = configureLegacy(f, true)
    // An independent public metadata birth has no bytes/accepted facts/custody.
    // It is the disposable FK action control, never the physical source proof.
    console.info('DB01_STAGE historical_audit START')
    const audit = await createEdielMessage({actorUserId: f.actorUserId, companyId: f.companyId, environment: 'test', direction: 'inbound',
      messageStandard: 'xml', messageFamily: 'OTHER', messageCode: 'DB01_METADATA', status: 'draft', partyAddressId: lifecycleConfig.addressId,
      requiresContrl: false, requiresAperak: false})
    expect(audit).toMatchObject({company_id: f.companyId, created_by: f.actorUserId, environment: 'test', direction: 'inbound',
      message_standard: 'xml', message_family: 'OTHER', message_code: 'DB01_METADATA', status: 'draft',
      party_address_id: lifecycleConfig.addressId, raw_payload: null, immutable_payload_hash: null, immutable_rendered_at: null,
      canonical_rule_pack_id: null, rule_profile_key: null, rule_profile_version_id: null, rule_profile_version: null,
      rule_pack_checksum: null, rule_pack_snapshot: {}, execution_context_snapshot: {}, requires_contrl: false, requires_aperak: false})
    expect(sql(`SELECT jsonb_build_object(
      'receivedSources',(SELECT count(*) FROM gridex_received_sources.sources WHERE source_message_id=${literal(audit.id)}),
      'technicalSources',(SELECT count(*) FROM gridex_ediel_technical_ack.sources WHERE source_message_id=${literal(audit.id)}),
      'identityReceipts',(SELECT count(*) FROM gridex_ediel_inbound_context.receipts WHERE source_message_id=${literal(audit.id)}),
      'ruleReceipts',(SELECT count(*) FROM gridex_ediel_source_rules.receipts WHERE source_message_id=${literal(audit.id)}),
      'receptions',(SELECT count(*) FROM gridex_ediel_inbound_receptions.receptions WHERE source_message_id=${literal(audit.id)}),
      'ownerConsumptions',(SELECT count(*) FROM gridex_ediel_outbound_owner.consumptions WHERE source_message_id=${literal(audit.id)}),
      'outbox',(SELECT count(*) FROM public.ediel_outbox WHERE ediel_message_id=${literal(audit.id)}),
      'supplyPeriods',(SELECT count(*) FROM public.customer_supply_periods WHERE source_message_id=${literal(audit.id)}))`))
      .toEqual({receivedSources: 0, technicalSources: 0, identityReceipts: 0, ruleReceipts: 0, receptions: 0, ownerConsumptions: 0, outbox: 0, supplyPeriods: 0})
    console.info('DB01_STAGE historical_audit PASS')
    const lifecycle = {...lifecycleConfig, messageId: audit.id}
    console.info('DB01_STAGE historical_direct START')
    const direct = await directWire(f, old.addressId)
    expect(direct.message).toMatchObject({party_address_id: old.addressId})
    expect(sha(direct.message.raw_payload!)).toBe(sha(direct.input.rawPayload!))
    console.info('DB01_STAGE historical_direct PASS')
    // No accepted/application/legal fact is assigned to this audit birth.
    console.info('DB01_STAGE historical_h START')
    const {original, originalDraft} = await originateWithHint(f, old.addressId)
    expect(original).toMatchObject({party_address_id: old.addressId})
    console.info('DB01_STAGE historical_h PASS')
    console.info('DB01_STAGE historical_agt_configuration START')
    const af = await configureAgt(f.companyId), aold = configureLegacy(af)
    console.info('DB01_STAGE historical_agt_configuration PASS')
    console.info('DB01_STAGE historical_agt_original START')
    console.info('DB01_AGT_BASIS reconstructed BASE56 creator/dependencies + committed current AGT producer + prospective legacy UUID before custody')
    const am = await agtOriginal({companyId: af.companyId, actorUserId: af.actorUserId, profileId: af.routeProfileId, routeId: af.routeId, sender: af.sender}, f.companyId, aold.addressId)
    expect(am).toMatchObject({party_address_id: aold.addressId, company_id: af.companyId, message_code: 'Z09'})
    console.info('DB01_STAGE historical_agt_original PASS')
    const table = catalog('public.ediel_party_addresses')
    expect(table.policies).toHaveLength(4)
    expect((table.fks as Array<{delete: string}>).map(k => k.delete).sort()).toEqual(['c', 'n', 'n', 'n'])
    const h: Handoff = {version: 1, companyId: f.companyId, actorUserId: f.actorUserId, ...old, lifecycle,
      historicalId: direct.message.id, hOriginalId: original.id, table, originalDraft,
      addressRows: sql<Json>(`SELECT ${hashRows('public.ediel_party_addresses')}`),
      historicalRows: {}, graph: graph(f.companyId), route: sql<Json>(`SELECT ${jsonRows('public.communication_routes', `t.id=${literal(f.routeId)}`)}`),
      parentDelete: probe(`DELETE FROM public.ediel_party_addresses WHERE id=${literal(old.addressId)}`), creators: creators(true),
      agt: {companyId: af.companyId, actorUserId: af.actorUserId, profileId: af.routeProfileId, routeId: af.routeId, sender: af.sender, addressId: aold.addressId,
        messageId: am.id, rows: sql<Json>(`SELECT ${hashRows('public.ediel_messages', `t.id=${literal(am.id)}`)}`),
        route: sql<Json>(`SELECT ${jsonRows('public.communication_routes', `t.id=${literal(af.routeId)}`)}`)}}
    h.historicalRows = historicalRows(h)
    writeFileSync(handoffPath, JSON.stringify(h), {mode: 0o600})
    console.info('DB01 historical public births and pre-forward witnesses captured; no external legal/market acceptance claim')
  })
} else {
  it('actual move preserves OID, type, owner, policies, indexes, all four FK identities/actions and every complete historical row', () => {
    const h = readHandoff(); expect(h.version).toBe(1)
    expect(sql(`SELECT to_jsonb(to_regclass('public.ediel_party_addresses') IS NULL AND to_regclass(${literal(archive)}) IS NOT NULL)`)).toBe(true)
    expect(catalog(archive)).toEqual(h.table)
    expect(creators(false)).toEqual(h.creators)
    expect(sql<Json>(`SELECT ${hashRows(archive)}`)).toEqual(h.addressRows)
    expect(historicalRows(h)).toEqual(h.historicalRows)
    expect(graph(h.companyId)).toEqual(h.graph)
    expect(sql<Json>(`SELECT ${hashRows('public.ediel_messages', `t.id=${literal(h.agt.messageId)}`)}`)).toEqual(h.agt.rows)
    expect(sql<Json>(`SELECT ${jsonRows('public.communication_routes', `t.id=(SELECT communication_route_id FROM public.ediel_route_profiles WHERE id=${literal(h.profileId)})`)}`)).toEqual(h.route)
    expect(sql(`SELECT to_jsonb(NOT EXISTS(SELECT FROM public.ediel_messages m WHERE m.party_address_id IS NOT NULL AND NOT EXISTS(SELECT FROM ${archive} a WHERE a.id=m.party_address_id))
      AND NOT EXISTS(SELECT FROM public.ediel_route_profiles p WHERE p.party_address_id IS NOT NULL AND NOT EXISTS(SELECT FROM ${archive} a WHERE a.id=p.party_address_id))
      AND NOT EXISTS(SELECT FROM ${archive} a WHERE NOT EXISTS(SELECT FROM public.ediel_parties p WHERE p.id=a.party_id) OR(a.receiver_certificate_id IS NOT NULL AND NOT EXISTS(SELECT FROM public.ediel_certificates c WHERE c.id=a.receiver_certificate_id))))`)).toBe(true)
  })

  it('historical public DTO retains the original legacy UUID and exact immutable wire after the move', async () => {
    const h = readHandoff(), direct = await getEdielMessageById(h.historicalId, {companyId: h.companyId}), original = await getEdielMessageById(h.hOriginalId, {companyId: h.companyId})
    expect(direct).toMatchObject({party_address_id: h.addressId, company_id: h.companyId})
    expect(original).toMatchObject({party_address_id: h.addressId, company_id: h.companyId})
    expect(historicalRows(h)).toEqual(h.historicalRows)
  })

  it('PUBLIC, anon, authenticated and service_role cannot read/write the archive; actual APIs expose neither old nor private table', async () => {
    const h = readHandoff(), before = graph(h.companyId)
    for (const role of ['anon', 'authenticated', 'service_role']) {
      expect(sql(`SELECT to_jsonb(NOT has_schema_privilege(${literal(role)},'gridex_ediel_legacy_archive','USAGE')
        AND NOT has_schema_privilege(${literal(role)},'gridex_ediel_legacy_archive','CREATE')
        AND NOT has_table_privilege(${literal(role)},${literal(archive)},'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))`)).toBe(true)
      for (const statement of [`SELECT id FROM ${archive}`, `DELETE FROM ${archive} WHERE id=${literal(h.addressId)}`]) {
        expect(probe(`SET LOCAL ROLE ${role}; ${statement}`)).toMatchObject({state: '42501'})
      }
    }
    expect(sql(`SELECT to_jsonb(NOT EXISTS(SELECT FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) a WHERE n.nspname='gridex_ediel_legacy_archive' AND a.grantee=0)
      AND NOT EXISTS(SELECT FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE c.oid=${literal(archive)}::regclass AND a.grantee=0))`)).toBe(true)
    const old = await supabaseService.from('ediel_party_addresses').select('id')
    expect(old.error).not.toBeNull(); expect(old.data).toBeNull()
    const hidden = await supabaseService.schema('gridex_ediel_legacy_archive').from('ediel_party_addresses').select('id')
    expect(hidden.error).not.toBeNull(); expect(hidden.data).toBeNull()
    expect(graph(h.companyId)).toEqual(before); expect(sql<Json>(`SELECT ${hashRows(archive)}`)).toEqual(h.addressRows)
  })

  for (const table of ['ediel_messages', 'ediel_route_profiles']) it(`actual direct ${table} INSERT rejects a retired hint atomically; original graph preserved`, () => {
    const h = readHandoff(), before = graph(h.companyId)
    const columns = table === 'ediel_messages' ? 'company_id,direction,message_standard,message_family,message_code,environment,party_address_id' : 'company_id,route_name,environment,party_address_id'
    const values = table === 'ediel_messages' ? `${literal(h.companyId)},'inbound','edifact','PRODAT','Z05','test',${literal(h.addressId)}` : `${literal(h.companyId)},'Retired hint refusal','test',${literal(h.addressId)}`
    expect(probe(`INSERT INTO public.${table}(${columns}) VALUES(${values})`)).toEqual({state: '23514', message: 'ediel_legacy_party_address_hint_retired'})
    expect(graph(h.companyId)).toEqual(before); expect(historicalRows(h)).toEqual(h.historicalRows)
  })

  it('actual BASE historical parent-delete behavior is unchanged; a real rollback preserves the complete graph', () => {
    const h = readHandoff(), before = graph(h.companyId), rows = sql<Json>(`SELECT ${hashRows(archive)}`)
    const result = probe(`DELETE FROM ${archive} WHERE id=${literal(h.addressId)}`)
    // An existing owner may refuse, or preserved SET NULL may succeed. The
    // BASE execution, not a fabricated guard expectation, fixes this contrast.
    expect(result).toEqual(h.parentDelete)
    expect(graph(h.companyId)).toEqual(before); expect(sql<Json>(`SELECT ${hashRows(archive)}`)).toEqual(rows)
  })

  it('disposable legacy directory keeps actual certificate SET NULL and party CASCADE/profile SET NULL lifecycle', () => {
    const h = readHandoff(), l = h.lifecycle
    // Always rolled back, so later witnesses still compare the original rows.
    expect(sql(`BEGIN; DELETE FROM public.ediel_certificates WHERE id=${literal(l.certificateId)};
      SELECT to_jsonb((SELECT receiver_certificate_id IS NULL FROM ${archive} WHERE id=${literal(l.addressId)})); ROLLBACK;`)).toBe(true)
    expect(sql(`BEGIN; DELETE FROM public.ediel_parties WHERE id=${literal(l.partyId)};
      SELECT to_jsonb(NOT EXISTS(SELECT FROM ${archive} WHERE id=${literal(l.addressId)}) AND(SELECT party_address_id IS NULL FROM public.ediel_route_profiles WHERE id=${literal(l.profileId)})
      AND(SELECT party_address_id IS NULL FROM public.ediel_messages WHERE id=${literal(l.messageId)})); ROLLBACK;`)).toBe(true)
    expect(historicalRows(h)).toEqual(h.historicalRows); expect(sql<Json>(`SELECT ${hashRows(archive)}`)).toEqual(h.addressRows)
  })

  it('current real public direct creator ignores stale/foreign/nonexistent hints and keeps current route, party and wire authority', async () => {
    const f = await chain.authorized(), h = readHandoff()
    for (const hint of [h.addressId, randomUUID()]) {
      const {message, input} = await directWire(f, hint)
      expect(message).toMatchObject({company_id: f.companyId, party_address_id: null, communication_route_id: f.routeId,
        route_profile_id: f.routeProfileId, sender_ediel_id: f.receiver, receiver_ediel_id: f.sender})
      expect(sha(message.raw_payload!)).toBe(sha(input.rawPayload!))
    }
    expect(historicalRows(h)).toEqual(h.historicalRows)
    expect(provider.send).not.toHaveBeenCalled()
  })

  it('current public protected H creator runs sign/archive/review/current qualification and creates NULL despite the optional retired hint', async () => {
    const f = await chain.authorized(), h = readHandoff(), {original} = await originateWithHint(f, h.addressId)
    expect(original).toMatchObject({party_address_id: null})
    expect(original).toMatchObject({company_id: f.companyId, communication_route_id: f.routeId, route_profile_id: f.routeProfileId})
    expect(sql(`SELECT to_jsonb(EXISTS(SELECT FROM public.ediel_outbox WHERE ediel_message_id=${literal(original.id)}))`)).toBe(true)
    expect(provider.send).not.toHaveBeenCalled(); expect(historicalRows(h)).toEqual(h.historicalRows)
  })

  it('current real AGT L7 public run/render/preflight/locked route ignores the retained old profile hint and preserves actual route authority', async () => {
    const h = readHandoff(), a = h.agt, message = await agtOriginal(a, h.companyId)
    expect(message).toMatchObject({company_id: a.companyId, party_address_id: null, communication_route_id: a.routeId,
      sender_ediel_id: a.sender, receiver_ediel_id: '91100', receiver_sub_address: 'PRODAT', message_code: 'Z09', environment: 'test'})
    expect(message.raw_payload?.includes("CCI++Z13'CAV+E32'")).toBe(true)
    expect(message.raw_payload?.includes("CCI++Z04'CAV+Z03'")).toBe(true)
    expect(sql<Json>(`SELECT ${jsonRows('public.communication_routes', `t.id=${literal(a.routeId)}`)}`)).toEqual(a.route)
    expect(sql<Json>(`SELECT ${hashRows('public.ediel_messages', `t.id=${literal(a.messageId)}`)}`)).toEqual(a.rows)
    expect(provider.send).not.toHaveBeenCalled(); expect(historicalRows(h)).toEqual(h.historicalRows)
  })

  it('protected creator current wrong actor still refuses its actual public RPC without original/outbox/period mutations', async () => {
    const h = readHandoff(), before = graph(h.companyId)
    const result = await rpc('ediel_create_bilateral_prodat_original_v1', {p_company_id: h.companyId, p_actor_user_id: randomUUID(), p_draft: h.originalDraft})
    expect(result.error).toMatchObject({code: '42501', message: 'bilateral_prodat_outbound_recorded_actor_forbidden'})
    expect(graph(h.companyId)).toEqual(before); expect(historicalRows(h)).toEqual(h.historicalRows)
    expect(provider.send).not.toHaveBeenCalled()
  })

  it('real technical syntax/ACK owner is a separate fresh NULL control, never a legacy-hint historical producer', async () => {
    const f = await chain.authorized(), h = readHandoff(), {message} = await directWire(f, h.addressId)
    const routeId = randomUUID(), profileId = randomUUID(), smtp = assertEdielSmtpReadiness()
    sql(`INSERT INTO public.communication_routes(id,company_id,route_name,route_scope,environment_type,is_active,target_email)
      VALUES(${literal(routeId)},${literal(f.companyId)},'Synthetic DB01 technical reply','ediel_ack','bilateral_test',true,'recipient@example.invalid');
      INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,payload_format,sender_ediel_id,receiver_ediel_id,application_reference,is_enabled,is_active,transport_security_mode,smtp_to,receiver_email,message_family,business_code,mailbox,smtp_host,smtp_port)
      VALUES(${literal(profileId)},${literal(f.companyId)},${literal(routeId)},'Synthetic DB01 CONTRL','test','edifact','edifact',${literal(f.sender)},${literal(f.receiver)},'23-DDQ-PRODAT',true,true,'unencrypted','recipient@example.invalid','recipient@example.invalid','CONTRL','CONTRL',${literal(smtp.from)},${literal(smtp.host)},${literal(smtp.port)});`)
    const decision = await resolveCanonicalRuntimeDecisionWithRegistry(message)
    expect(decision.syntaxDecision).toBe('accepted')
    if (decision.syntaxDecision !== 'accepted') throw new Error('db01_actual_technical_syntax_not_accepted')
    await recordEdielTechnicalSyntaxDecision({companyId: f.companyId, sourceMessageId: message.id, sourceHash: sha(message.raw_payload!), syntaxDecision: decision.syntaxDecision,
      reasonCodes: [], execution: {actorUserId: f.actorUserId, phase: 'prepare'}})
    const evidence = await captureEdielTechnicalSyntaxAckEvidence(f.companyId, message.id, {actorUserId: f.actorUserId, phase: 'prepare'})
    expect(evidence.sourceMessageId).toBe(message.id)
    const ack = await createCanonicalAckMessage({actorUserId: f.actorUserId, sourceMessage: message, ackFamily: 'CONTRL', outcome: 'positive',
      draft: buildContrlDraft({actorUserId: f.actorUserId, sourceMessage: message, outcome: 'positive'})})
    expect(ack).toMatchObject({party_address_id: null, company_id: f.companyId, related_message_id: message.id, message_family: 'CONTRL'})
    expect(provider.send).not.toHaveBeenCalled(); expect(historicalRows(h)).toEqual(h.historicalRows)
  })

  it('second protected national producer reaches real public legal archive/review/source guards and persists a fresh NULL original', async () => {
    const h = readHandoff()
    let calls = 0
    vi.spyOn(supabaseService, 'rpc').mockImplementation(((name: string, args: Record<string, unknown>) => {
      if (name === 'ediel_create_national_supply_rescission_original_v1') {
        calls++
        return rpc(name, {...args, p_draft: {...args.p_draft as Json, partyAddressId: h.addressId}})
      }
      return rpc(name, args)
    }) as typeof supabaseService.rpc)
    // The unchanged declared source fixture can block at a real earlier owner;
    // later NULL/output assertions remain strict and then are NOT_REACHED.
    const f = await chain.nationalRescissionOperation()
    expect(calls).toBe(1)
    expect(f.original).toMatchObject({party_address_id: null, company_id: f.companyId, message_code: 'Z08', source_operation_id: f.mandateId})
    expect(historicalRows(h)).toEqual(h.historicalRows)
  })
}
