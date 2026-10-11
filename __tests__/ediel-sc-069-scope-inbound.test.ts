// masterplan: SC-069
// Actual readiness SQL + actual TS callers run against finite DB ports. The
// named certification/assignment/source ports are synthetic, not native, TGT,
// mandate or live transport evidence. No readiness verdict is mocked.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EdielMessageRow } from '@/lib/ediel/types'

type Row = Record<string, unknown>
const port = vi.hoisted(() => ({
  db: null as PGlite | null, tables: {} as Record<string, Row[]>,
  calls: [] as Array<{ name: string; args: Row }>, writes: [] as Array<{ table: string; value: Row }>,
  source: {} as EdielMessageRow, ack: {} as EdielMessageRow, retainAck: true,
  ownSourceReadings:null as ProdatOwnSourceReadingSdk|null,
}))

vi.mock('@/lib/supabase/service', async () => {
  class Query {
    filters: Array<(row: Row) => boolean> = []
    one = false; exact = false; maximum = Infinity; operation = 'read'; value: Row = {}
    constructor(readonly table: string) {}
    select(columns = '*', options?: { count?: string }) { void columns; this.exact = options?.count === 'exact'; return this }
    eq(key: string, value: unknown) { this.filters.push(row => row[key] === value); return this }
    neq(key: string, value: unknown) { this.filters.push(row => row[key] !== value); return this }
    is(key: string, value: unknown) { this.filters.push(row => (row[key] ?? null) === value); return this }
    not(key: string, op: string, value: unknown) { if (op !== 'is') throw Error(`Undeclared operator ${op}`); this.filters.push(row => (row[key] ?? null) !== value); return this }
    in(key: string, values: unknown[]) { this.filters.push(row => values.includes(row[key])); return this }
    lte(key: string, value: string) { this.filters.push(row => row[key] != null && String(row[key]) <= value); return this }
    gte(key: string, value: string) { this.filters.push(row => row[key] != null && String(row[key]) >= value); return this }
    lt(key: string, value: string) { this.filters.push(row => row[key] != null && String(row[key]) < value); return this }
    gt(key: string, value: string) { this.filters.push(row => row[key] != null && String(row[key]) > value); return this }
    contains(key: string, value: Row) { this.filters.push(row => Object.entries(value).every(([k, v]) => (row[key] as Row | undefined)?.[k] === v)); return this }
    or(expression: string) {
      const alternatives = expression.split(',').map(part => {
        const match = /^([^.]+)\.(eq|is|lt)\.(.*)$/.exec(part)
        if (!match) throw Error(`Undeclared OR ${expression}`)
        const [, key, op, value] = match
        return (row: Row) => op === 'eq' ? String(row[key] ?? '') === value : op === 'is' ? value === 'null' && row[key] == null : row[key] != null && String(row[key]) < value
      })
      this.filters.push(row => alternatives.some(filter => filter(row))); return this
    }
    order() { return this }
    limit(maximum: number) { this.maximum = maximum; return this }
    abortSignal() { return this }
    single() { this.one = true; return this }
    maybeSingle() { this.one = true; return this }
    update(value: Row) { this.operation = 'update'; this.value = value; return this }
    insert(value: Row) { this.operation = 'insert'; this.value = value; return this }
    upsert(value: Row) { this.operation = 'insert'; this.value = value; return this }
    then(onfulfilled: (value: unknown) => unknown, onrejected: (reason: unknown) => unknown) {
      return Promise.resolve().then(() => {
        const all = port.tables[this.table] ?? []
        const selected = all.filter(row => this.filters.every(filter => filter(row)))
        let rows = selected.slice(0, this.maximum)
        if (this.operation !== 'read') {
          if (!['ediel_messages', 'ediel_message_events', 'ediel_processing_runs', 'ediel_decision_traces', 'ediel_sla_timers', 'ediel_inbound_cases', 'ediel_outbox', 'audit_logs'].includes(this.table)) throw Error(`Undeclared write ${this.table}`)
          port.writes.push({ table: this.table, value: structuredClone(this.value) })
          if (this.operation === 'update') for (const row of rows) Object.assign(row, structuredClone(this.value))
          else { rows = [{ id: ownerId(800 + port.writes.length), created_at: new Date().toISOString(), ...structuredClone(this.value) }]; port.tables[this.table] = [...all, ...rows] }
        }
        return { data: structuredClone(this.one ? rows[0] ?? null : rows), error: null, ...(this.exact ? { count: selected.length } : {}) }
      }).then(onfulfilled, onrejected)
    }
  }
  const rpc = (name: string, args: Row) => {
    port.calls.push({ name, args: structuredClone(args) })
    const pending = Promise.resolve().then(async () => {
      if (['ediel_scoped_capability_readiness_v1', 'ediel_record_scoped_capability_evidence_v1'].includes(name)) {
        if (!port.db) throw Error('Finite DB unavailable')
        const entries = Object.entries(args)
        const call = entries.map(([key], index) => `${key}:=$${index + 1}${key === 'p_certification_evidence_ids' ? '::uuid[]' : ''}`).join(',')
        try { return { data: (await port.db.query<{ value: unknown }>(`select public.${name}(${call}) value`, entries.map(([, value]) => value))).rows[0].value, error: null } }
        catch (error) { return { data: null, error } }
      }
      const source = port.source, company = OWNER.company, actor = ownerId(50), hash = (value: unknown) => digest(String(value))
      const originalUNB = { sender: ['12345', '14'], receiver: ['54321', '14'], interchangeReference: 'I', uciReference: 'I', applicationReference: '23-DDQ-PRODAT', testIndicator: '' }
      const technical = { companyId: company, environment: 'production', sourceMessageId: source.id, sourceHash: hash(source.raw_payload), transportEdielId: '54321', originalUNB }
      if (name === 'canonical_tenant_operation_decision') return { data: { allowed: args.p_company_id === company, reason_code: 'finite_active_tenant', company_status: 'active', capability_status: 'active', production_status: 'live', state_version: 1 }, error: null }
      if (name === 'gridex_actor_has_company_permission') return { data: args.p_actor_user_id === actor && args.p_company_id === company && args.p_permission === 'communication.write', error: null }
      if (name === 'ediel_read_technical_source_endpoint_v2') return { data: { ...technical, executionActorUserId: actor, executionPhase: 'prepare', kind: 'technical_endpoint_only', authorizesBusinessEffect: false }, error: null }
      if (name === 'ediel_record_technical_syntax_facet_v2') return { data: { status: 'recorded' }, error: null }
      if (name === 'ediel_capture_technical_syntax_ack_basis_v2' || name === 'ediel_require_technical_syntax_ack_basis_v2') return { data: { ...technical, kind: 'technical_syntax_ack', version: 1, transportActorId: OWNER.actor, observedAt: new Date().toISOString(), syntaxAssessmentId: ownerId(500), syntaxDecision: 'accepted' }, error: null }
      if (name === 'gridex_read_outbound_acks_for_source_v2') return { data: { version: 2, executionActorUserId: actor, executionPhase: args.p_phase, sourceMessageId: source.id, sourcePayloadHash: hash(source.raw_payload), environment: 'production', companyId: company, originals: port.retainAck && args.p_ack_family === 'CONTRL' ? [{ status: 'qualified', message: port.ack, payloadHash: hash(port.ack.raw_payload) }] : [] }, error: null }
      if (name === 'ediel_read_outbound_ack_replay_v1') return { data: port.retainAck ? { version: 1, sourceMessage: structuredClone(source), ackMessage: structuredClone(port.ack) } : null, error: null }
      if (name === 'ediel_require_source_bytes_available_v1') return { data: null, error: null }
      if (name === 'ediel_read_technical_syntax_ack_route_v1') return { data: { kind: 'technical_syntax_ack_route', companyId: company, environment: 'production', sourceMessageId: source.id, sourceHash: hash(source.raw_payload), authorizesBusinessEffect: false,
        route: { id: ownerId(610), company_id: company, is_active: true }, routeRuntime: { route_profile_id: ownerId(611), company_id: company, communication_route_id: ownerId(610), environment: 'production', is_enabled: true },
        senderEdielId: '54321', senderQualifier: '14', senderSubAddress: null, receiverEdielId: '12345', receiverQualifier: '14', receiverSubAddress: null, receiverMessageSubAddress: null,
        applicationReference: '23-DDQ-PRODAT', senderEmail: 'configured@example.invalid', receiverEmail: 'counterparty@example.invalid', mailbox: 'configured@example.invalid', routeKey: 'finite-technical-route', smtpHost: 'smtp.example.invalid', smtpPort: 465 }, error: null }
      if (name === 'ediel_create_outbound_ack_atomic_v1') {
        // The native atomic command is an external declared port; its returned
        // row uses bytes from the REAL preceding builder/validator invocation.
        const draft = args.p_draft as Row
        port.ack = { id: ownerId(601), created_at: new Date().toISOString(), company_id: company, environment: 'production', direction: 'outbound', message_standard: 'edifact', message_family: 'CONTRL', message_code: 'CONTRL', related_message_id: source.id,
          raw_payload: draft.rawPayload, parsed_payload: draft.parsedPayload, status: 'draft', ack_outcome: args.p_outcome, route_profile_id: draft.routeProfileId, communication_route_id: draft.communicationRouteId,
          requires_contrl: draft.requiresContrl, requires_aperak: draft.requiresAperak } as EdielMessageRow
        port.retainAck = true; port.tables.ediel_messages.push(port.ack as unknown as Row)
        return { data: { version: 1, sourceMessage: structuredClone(source), ackMessage: structuredClone(port.ack) }, error: null }
      }
      if (name === 'resolve_canonical_ediel_rule_pack_with_witness_v1') return { data: [ownerRulePack()], error: null }
      if (name === 'gridex_record_prodat_source_validation_v6') {
        const factsHash = (key: string) => args[key] == null ? null : hash(args[key])
        return { data: { version: 6, companyId: company, environment: 'production', sourceMessageId: source.id, sourcePayloadHash: hash(source.raw_payload), factsHash: factsHash('p_facts_text'), sourceDisposition: 'not_established', assessmentId: ownerId(501), objectFactsHash: factsHash('p_object_facts_text'), applicationFactsHash: factsHash('p_application_facts_text'), responseFactsHash: factsHash('p_response_facts_text'), ignoredFieldsHash: factsHash('p_ignored_fields_text'), sourceFunctionFactsHash: factsHash('p_source_function_facts_text') }, error: null }
      }
      if (name === 'ediel_probe_source_rule_pack_capture_v1') { const row = ownerRulePack(); return { data: { status: 'captured', evidence: { rulePackId: row.rule_pack_id, messageProfileId: row.message_profile_id, profileKey: row.profile_key, version: row.original_version, sourceHash: row.source_hash, snapshot: { profileKey: row.profile_key, profileVersionId: row.message_profile_id, version: row.original_version, checksum: row.source_hash, ...row.original_snapshot } } }, error: null } }
      if (name === 'gridex_record_source_object_decisions_v1') return { data: { version: 1, companyId: company, environment: 'production', sourceMessageId: source.id, sourcePayloadHash: hash(source.raw_payload), canonicalAssessmentId: args.p_canonical_assessment_id, factsHash: hash(args.p_facts_text), assessmentId: ownerId(502) }, error: null }
      if (name === 'gridex_witness_source_objects_v1') return { data: { version: 1, companyId: company, environment: 'production', assessmentId: args.p_assessment_id, factsHash: args.p_facts_hash, witnessId: ownerId(503), availableAt: new Date().toISOString() }, error: null }
      if (name === 'ediel_apply_supply_source_v1') return { data: { applied: false, reason: 'finite_native_domain_held', idempotent: false, periods: [], commits: [] }, error: null }
      if (name === 'ediel_read_persisted_technical_contrl_basis_v2') return { data: { version: 2, executionActorUserId: args.p_actor_user_id, executionPhase: args.p_phase, ackMessage: port.ack, technicalSyntaxAckEvidence: { ...technical, kind: 'technical_syntax_ack', version: 1, transportActorId: OWNER.actor, observedAt: new Date().toISOString(), syntaxAssessmentId: ownerId(500), syntaxDecision: 'accepted' } }, error: null }
      throw Error(`Undeclared RPC ${name}`)
    })
    return Object.assign(pending, { abortSignal: () => pending })
  }
  return { supabaseService:(await import('./helpers/prodatOwnSourceReadingAdapter')).prodatOwnSourceReadingAdapter(()=>port.ownSourceReadings,{ rpc, from: (table: string) => new Query(table) }) }
})

import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { assertCompanyCanSendProductionEdiel } from '@/lib/ediel/productionReadiness.part-3'
import { getScopedEdielProductionReadiness, recordScopedEdielProductionEvidence } from '@/lib/ediel/scopedCapabilityReadiness'
import { processInboundEdielMessage } from '@/lib/ediel/flows/inboundProcessing'
import { validateRulebookMessageWithRegistry } from '@/lib/ediel/rulebook/validator'
import { OWNER, ownerId, ownerSourceWithInstallationStatus as ownerSource, ownerRows, ownerRulePack } from './helpers/sourceOwnerFixtures'
import {createProdatOwnSourceReadingSdk,resetProdatOwnSourceReadingSdk,installProdatOwnSourceReadingFixture,type ProdatOwnSourceReadingSdk} from './helpers/prodatOwnSourceReadingFixture'

const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')
const company = OWNER.company, actor = ownerId(50), ruleHash = 'a'.repeat(64), release = 'f'.repeat(40)
const names = {
  initial: 'supabase/migrations/20260930145202_ediel_scoped_capability_readiness.sql',
  currentRules: 'supabase/migrations/20260930154424_ediel_readiness_current_rule_dependencies.sql',
  source: 'supabase/migrations/20260930161907_ediel_readiness_current_source_scope.sql',
  route: 'supabase/migrations/20260930165148_ediel_monotonic_route_security_dependencies.sql',
  market: 'supabase/migrations/20261001040159_ediel_registry_market_source_isolation.sql',
}
const text = (path: string) => readFileSync(resolve(path), 'utf8')
// Execute the existing function bytes. This is loading, never a source-string
// assertion or reimplementation of the production dependency algorithm.
function functionSql(path: string, name: string) {
  const sql = text(path), start = sql.indexOf(`CREATE FUNCTION ${name}(`)
  if (start < 0) throw Error(`Function loader missing ${name}`)
  const end = sql.indexOf('END$$;', start)
  if (end < 0) throw Error(`Function loader missing end ${name}`)
  return sql.slice(start, end + 'END$$;'.length)
}

function outbound(code: 'Z01' | 'Z13'): EdielMessageRow {
  const dgi = code === 'Z13'
  const raw = EdifactEnvelopeCodec.encode({ sender: '54321', receiver: '91101', environment: 'production', acknowledgementRequest: true, interchangeReference: dgi ? 'DGI-I' : 'DDQ-I', applicationReference: dgi ? '23-DGI-PRODAT' : '23-DDQ-PRODAT', messages: [{ messageReference: dgi ? 'DGI-M' : 'DDQ-M', messageTypeToken: 'PRODAT:D:97A:UN:E2SE6A', businessSegments: [`BGM+${code}+DOC+9`, 'CCI++Z13', `CAV+${dgi ? 'S17' : 'Z22'}`] }] })
  return { id: ownerId(dgi ? 102 : 101), company_id: company, environment: 'production', direction: 'outbound', message_standard: 'edifact', message_family: 'PRODAT', message_code: code, raw_payload: raw, rule_pack_checksum: ruleHash,
    parsed_payload: dgi ? { serviceAssignmentId: ownerId(130) } : {}, route_profile_id: ownerId(dgi ? 112 : 111), communication_route_id: ownerId(dgi ? 122 : 121), canonical_rule_pack_id: ownerId(140), rule_profile_version_id: ownerId(dgi ? 152 : 151), customer_id: OWNER.customer, status: 'queued' } as EdielMessageRow
}
const ddq = outbound('Z01'), dgi = outbound('Z13')

async function fixtureDb() {
  const db = new PGlite(); port.db = db
  // Finite row-shape schema only. Native schema/RLS, real assignment and real
  // certification producers are deliberately outside this behavior fixture.
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema extensions; create schema gridex_utilts_binding; create schema gridex_registry_import;
    create function extensions.digest(bytea,text) returns bytea language sql immutable as 'select sha256($1)';
    create table companies(id uuid primary key);
    create table ediel_configuration_snapshots(id uuid);
    create table platform_release_receipts(id uuid,release_sha text,ci_run_id text,deployment_id text,environment text,status text,verified_at timestamptz,recorded_at timestamptz,schema_migration_version text);
    create table ediel_messages(id uuid,company_id uuid,environment text,direction text,message_family text,message_code text,rule_pack_checksum text,raw_payload text,route_profile_id uuid,communication_route_id uuid,canonical_rule_pack_id uuid,rule_profile_version_id uuid,customer_id uuid,status text,parsed_payload jsonb,application_reference text,receiver_ediel_id text,receiver_sub_address text,receiver_email text,transport_type text);
    create table ediel_route_profiles(id uuid,company_id uuid,environment text,is_enabled boolean,is_active boolean,communication_route_id uuid,certificate_id uuid,receiver_certificate_id uuid,sender_ediel_id text,receiver_ediel_id text,sender_sub_address text,sender_subaddress text,receiver_sub_address text,receiver_subaddress text,mailbox_id uuid,transport_profile_id uuid,metadata jsonb default '{}',route_version integer default 1,created_by uuid,updated_by uuid,updated_at timestamptz default now());
    create table communication_routes(id uuid,company_id uuid,is_active boolean,environment_type text,target_email text,endpoint text,counterparty_ediel_id text,auth_config jsonb default '{}');
    create table platform_actor_routes(id uuid,actor_id uuid,environment text,message_family text,application_reference text,subaddress text,communication_type text,communication_address text,party_id text,interchange_party_id text,is_verified boolean,status text,source text,metadata jsonb);
    create table ediel_certificates(id uuid,company_id uuid,certificate_fingerprint text,certificate_valid_from timestamptz,certificate_valid_to timestamptz,status text,encryption_status text);
    create table tenant_ediel_profiles(id uuid,company_id uuid,environment text,market text,is_enabled boolean,valid_from timestamptz,valid_to timestamptz);
    create table tenant_actor_identifiers(id uuid,company_id uuid,environment text,actor_id uuid,identifier_type text,identifier_value text,valid_from timestamptz,valid_to timestamptz);
    create table tenant_actor_roles(id uuid,company_id uuid,environment text,actor_id uuid,role_code text,valid_from timestamptz,valid_to timestamptz);
    create table tenant_counterparty_relations(id uuid,company_id uuid,environment text,counterparty_actor_id uuid,relation_type text,is_enabled boolean,valid_from timestamptz,valid_to timestamptz);
    create table platform_actor_identifiers(id uuid,actor_id uuid,identifier_type text,identifier_value text,valid_from date,valid_to date);
    create table tenant_message_capabilities(id uuid,company_id uuid,environment text,message_family text,message_code text,transaction_subtype text,direction text,is_enabled boolean,valid_from timestamptz,valid_to timestamptz);
    create table ediel_service_assignments(id uuid,company_id uuid,environment text,provider_actor_id uuid,customer_id uuid);
    create table ediel_assignment_permission_links(id uuid,company_id uuid,permission_id uuid,assignment_id uuid);
    create table metering_permissions(id uuid,company_id uuid); create table ediel_data_access_grants(id uuid,company_id uuid,permission_link_id uuid);
    create function ediel_service_assignment_assessment_v1(uuid,uuid) returns jsonb language sql as $$select jsonb_build_object('status',case when $1='${company}' and $2='${ownerId(130)}' then 'authorized' else 'held' end)$$;
    create table ediel_rule_packs(id uuid,family text,market text,status text,source_hash text,guide_version text,guide_revision text,valid_from date,valid_to date);
    create table ediel_message_profiles(id uuid,rule_pack_id uuid,profile_key text,transaction_subtype text,profile jsonb,is_enabled boolean,message_code text,direction text);
    create table ediel_rule_profile_versions(id uuid,company_id uuid,version text,status text,checksum text,source_revision text);
    create table platform_runtime_readiness(id boolean,is_ready boolean);
    create table ediel_certification_evidence(id uuid,company_id uuid,environment text,status text,external_reference text,evidence_document_reference text,approved_by uuid,approved_at timestamptz,tested_at timestamptz,valid_until timestamptz,metadata jsonb,evidence_type text);`)
  const wire = text('supabase/migrations/20260923135706_ediel_utilts_consumption_binding_v1.sql')
  await db.exec(wire.slice(wire.indexOf('CREATE FUNCTION gridex_utilts_binding.wire_tokens_v1'), wire.indexOf('REVOKE ALL ON FUNCTION gridex_utilts_binding.wire_tokens_v1')))
  for (const path of [names.initial, names.currentRules, names.source, names.route]) await db.exec(text(path))
  // The current market wrapper and actual local-route NULL boundary run too;
  // an imported registry route is not synthetically granted by this fixture.
  for (const name of ['gridex_registry_import.dispatch_source_v1', 'gridex_registry_import.require_message_market_v1']) await db.exec(functionSql(names.market, name))
  await db.exec('ALTER FUNCTION gridex_ediel_readiness.capture(uuid,uuid,uuid,text,text,text,text,uuid,text,text) RENAME TO capture_before_registry_markets_v1')
  await db.exec(functionSql(names.market, 'gridex_ediel_readiness.capture'))
  await db.exec(`insert into companies values('${company}'); insert into platform_runtime_readiness values(true,true);
    insert into platform_release_receipts values('${ownerId(190)}','${release}','SYNTHETIC-SC069-CI','SYNTHETIC-SC069-DEPLOYMENT','production','verified','2000-01-01','2000-01-01','fixture-schema');
    insert into ediel_rule_packs values('${ownerId(140)}','PRODAT','electricity','active','${ruleHash}','26.A','3','2000-01-01',null);
    insert into ediel_message_profiles values('${ownerId(151)}','${ownerId(140)}','DDQ-Z01','L','{"reasonForTransaction":"Z22"}',true,'Z01','outbound'),('${ownerId(152)}','${ownerId(140)}','DGI-Z13','V','{"reasonForTransaction":"S17"}',true,'Z13','outbound');
    insert into tenant_ediel_profiles values('${ownerId(160)}','${company}','production','electricity',true,'2000-01-01',null);
    insert into tenant_actor_identifiers values('${ownerId(161)}','${company}','production','${OWNER.actor}','EdielId','54321','2000-01-01',null);
    insert into tenant_actor_roles values('${ownerId(162)}','${company}','production','${OWNER.actor}','electricity_supplier','2000-01-01',null),('${ownerId(163)}','${company}','production','${OWNER.actor}','energy_service_company','2000-01-01',null);
    insert into tenant_message_capabilities values('${ownerId(164)}','${company}','production','PRODAT','Z01','L','outbound',true,'2000-01-01',null),('${ownerId(165)}','${company}','production','PRODAT','Z13','V','outbound',true,'2000-01-01',null);
    insert into ediel_service_assignments values('${ownerId(130)}','${company}','production','${OWNER.actor}','${OWNER.customer}');`)
  for (const message of [ddq, dgi]) {
    await db.query('insert into ediel_messages(id,company_id,environment,direction,message_family,message_code,rule_pack_checksum,raw_payload,route_profile_id,communication_route_id,canonical_rule_pack_id,rule_profile_version_id,customer_id,status,parsed_payload) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)', [message.id, company, 'production', 'outbound', 'PRODAT', message.message_code, ruleHash, message.raw_payload, message.route_profile_id, message.communication_route_id, message.canonical_rule_pack_id, message.rule_profile_version_id, message.customer_id, 'queued', message.parsed_payload])
    await db.query('insert into ediel_route_profiles(id,company_id,environment,is_enabled,is_active,communication_route_id,sender_ediel_id,receiver_ediel_id) values($1,$2,$3,true,true,$4,$5,$6)', [message.route_profile_id, company, 'production', message.communication_route_id, '54321', '91101'])
    await db.query('insert into communication_routes(id,company_id,is_active,environment_type,target_email,endpoint,counterparty_ediel_id) values($1,$2,true,$3,$4,$4,$5)', [message.communication_route_id, company, 'production', 'recipient@example.invalid', '91101'])
  }
  return db
}

async function publish(message: EdielMessageRow, base: number) {
  const current = await getScopedEdielProductionReadiness(message)
  const ids = ['TGT', 'AGT', 'SHADOW_PRODUCTION', 'LIVE_TENANT_INTEGRITY', 'RESTORE_REPLAY'].map((type, index) => ({ type, id: ownerId(base + index) }))
  for (const evidence of ids) await port.db!.query('insert into ediel_certification_evidence values($1,$2,$3,$4,$5,$5,$6,$7,$7,$8,$9,$10)', [evidence.id, company, 'production', 'passed', 'SYNTHETIC SC069 PORT ONLY', actor, '2000-01-01', '2099-12-31', { edielScopedReadiness: { scope: current.scope, dependencyHash: current.dependencyHash, tests: [{ testId: 'SC069-SYNTHETIC-PORT', sourceRevision: 'fixture', evidenceReference: 'fixture', candidateSha: release, result: 'passed', payloadSha256: 'b'.repeat(64) }] } }, evidence.type])
  const evidenceId = await recordScopedEdielProductionEvidence({ message, expectedDependencyHash: current.dependencyHash, certificationEvidenceIds: ids.map(row => row.id), expiresAt: '2099-01-01T00:00:00Z' })
  return { ...current, evidenceId, ids: ids.map(row => row.id) }
}
async function changedDgi() {
  const priorDdq = await publish(ddq, 200), priorDgi = await publish(dgi, 210)
  // Counterfactual finite rule-edition input. Change a REAL source_scope field,
  // not an unused JSON marker: it accepts outbound/both, returns the selected
  // projection and includes its hash in capture. Every other projection stays
  // byte-equivalent and prior source editions remain immutable.
  await port.db!.exec(`with prior as (select input_manifest,catalog from gridex_ediel_readiness.source_editions order by recorded_at desc,source_version limit 1),
    amended as (select input_manifest,jsonb_agg(case when x->>'family'='PRODAT' and x->>'code'='Z13' and x->>'transactionReasonCode'='S17' then x||'{"direction":"both"}'::jsonb else x end order by n) catalog from prior,jsonb_array_elements(prior.catalog) with ordinality item(x,n) group by input_manifest)
    insert into gridex_ediel_readiness.source_editions(source_version,input_manifest,catalog,recorded_at)
    select encode(sha256(convert_to(jsonb_build_object('inputManifest',input_manifest,'catalog',catalog)::text,'UTF8')),'hex'),input_manifest,catalog,clock_timestamp() from amended`)
  return { priorDdq, priorDgi }
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-30T13:00:00Z')); vi.stubEnv('VERCEL_GIT_COMMIT_SHA', release)
  port.calls = []; port.writes = []; port.retainAck = true
  for (const [key, value] of Object.entries({ EDIEL_SMTP_FROM: 'configured@example.invalid', EDIEL_SMTP_HOST: 'smtp.example.invalid', EDIEL_SMTP_PORT: '465', EDIEL_SMTP_USER: 'synthetic', EDIEL_SMTP_PASS: 'synthetic-only' })) vi.stubEnv(key, value)
  const rows = ownerRows()
  port.tables = { ...rows }
  for (const table of ['tenant_ediel_profiles', 'tenant_actor_identifiers', 'tenant_actor_roles']) port.tables[table] = [...rows[table].map(row => ({ ...row, environment: 'production' }))]
  port.tables.tenant_actor_roles.push({ ...port.tables.tenant_actor_roles[0], id: ownerId(163), role_code: 'energy_service_company' })
  port.source = ownerSource('Z12',{readingDeclarations:true,environment:'production',sourceCodes:{installationStatus:'Z12',settlementMethod:'Z32'}})
  port.source.execution_context_snapshot = { receivedProdatContext: { version: 1, contextOrigin: 'database_insert', sourceMessageId: port.source.id, companyId: company, environment: 'production', messageCode: 'Z04', payloadHash: digest(port.source.raw_payload!), sourceReceivedAt: port.source.message_received_at, capturedAt: port.source.message_received_at } }
  port.tables.ediel_messages = [port.source as unknown as Row]
  port.ownSourceReadings=createProdatOwnSourceReadingSdk();resetProdatOwnSourceReadingSdk(port.ownSourceReadings)
  installProdatOwnSourceReadingFixture(port.ownSourceReadings,port.source,'L',{actorUserId:actor,receivedAt:port.source.message_received_at!,mailId:port.source.inbound_email_message_id!,parseId:ownerId(61),receptionId:ownerId(62),legalActorId:OWNER.actor})
  const raw = EdifactEnvelopeCodec.encode({ sender: '54321', receiver: '12345', senderQualifier: '14', receiverQualifier: '14', environment: 'production', applicationReference: '23-DDQ-PRODAT', interchangeReference: 'ACK-I', acknowledgementRequest: false, messages: [{ messageReference: 'ACK-M', messageTypeToken: 'CONTRL:2:2:UN', businessSegments: ['UCI+I+12345:14+54321:14+1'] }] })
  port.ack = { id: ownerId(600), created_at: '2026-09-30T12:01:00Z', company_id: company, environment: 'production', direction: 'outbound', message_standard: 'edifact', message_family: 'CONTRL', message_code: 'CONTRL', related_message_id: port.source.id, raw_payload: raw, parsed_payload: {}, status: 'sent', ack_outcome: 'positive' } as EdielMessageRow
  await fixtureDb()
}, 20000)
afterEach(async () => { await port.db?.close(); port.db = null; vi.useRealTimers(); vi.unstubAllEnvs() })

describe('SC069 actual scoped evidence and continued inbound/ACK consumers', () => {
  it('invalidates only the affected DGI proof and creates a new immutable scope-bound proof while DDQ remains ready', async () => {
    const { priorDdq, priorDgi } = await changedDgi()
    const held = await getScopedEdielProductionReadiness(dgi), unaffected = await getScopedEdielProductionReadiness(ddq)
    expect(priorDgi.dependencies.canonicalProjection).toEqual({ family: 'PRODAT', code: 'Z13', subtype: 'V', transactionReasonCode: 'S17', senderRoles: ['esco'], direction: 'outbound' })
    expect(held.dependencies.canonicalProjection).toEqual({ family: 'PRODAT', code: 'Z13', subtype: 'V', transactionReasonCode: 'S17', senderRoles: ['esco'], direction: 'both' })
    expect(held.dependencies.canonicalProjectionHash).not.toBe(priorDgi.dependencies.canonicalProjectionHash)
    expect(unaffected.dependencies.canonicalProjection).toEqual({ family: 'PRODAT', code: 'Z01', subtype: 'L', transactionReasonCode: 'Z22', senderRoles: ['supplier'], direction: 'outbound' })
    expect(unaffected.dependencies.canonicalProjectionHash).toBe(priorDdq.dependencies.canonicalProjectionHash)
    expect(held).toMatchObject({ ready: false, evidenceId: null, scope: { companyId: company, actorId: OWNER.actor, actorRole: 'energy_service_company', family: 'PRODAT', code: 'Z13', subtype: 'V', assignmentId: ownerId(130) } })
    expect(held.dependencyHash).not.toBe(priorDgi.dependencyHash)
    expect(unaffected).toMatchObject({ ready: true, evidenceId: priorDdq.evidenceId, dependencyHash: priorDdq.dependencyHash, scope: { actorRole: 'electricity_supplier', code: 'Z01' } })
    await expect(assertCompanyCanSendProductionEdiel({ companyId: company, message: dgi })).rejects.toThrow('ediel_scoped_capability_evidence_required')
    await expect(assertCompanyCanSendProductionEdiel({ companyId: company, message: ddq })).resolves.toBeUndefined()
    await expect(recordScopedEdielProductionEvidence({ message: dgi, expectedDependencyHash: priorDgi.dependencyHash, certificationEvidenceIds: priorDgi.ids, expiresAt: '2099-01-01T00:00:00Z' })).rejects.toThrow('ediel_scoped_capability_evidence_required')
    const fresh = await publish(dgi, 220)
    expect(fresh.evidenceId).not.toBe(priorDgi.evidenceId)
    expect(await getScopedEdielProductionReadiness(dgi)).toMatchObject({ ready: true, evidenceId: fresh.evidenceId, dependencyHash: held.dependencyHash })
    await expect(assertCompanyCanSendProductionEdiel({ companyId: company, message: dgi })).resolves.toBeUndefined()
    expect(await getScopedEdielProductionReadiness(ddq)).toMatchObject({ ready: true, evidenceId: priorDdq.evidenceId, dependencyHash: priorDdq.dependencyHash })
    const preserved = (await port.db!.query<{ id: string; dependency_hash: string; scope: Row }>('select id,dependency_hash,scope from gridex_ediel_readiness.evidence order by verified_at')).rows
    expect(preserved).toHaveLength(3)
    expect(preserved).toContainEqual(expect.objectContaining({ id: priorDgi.evidenceId, dependency_hash: priorDgi.dependencyHash }))
    expect(preserved).toContainEqual(expect.objectContaining({ id: fresh.evidenceId, dependency_hash: held.dependencyHash, scope: held.scope }))
  })

  it('a global ready flag, another role proof or a foreign tenant caller never replaces the affected current DGI evidence', async () => {
    const { priorDdq } = await changedDgi()
    expect((await port.db!.query<{ is_ready: boolean }>('select is_ready from platform_runtime_readiness')).rows).toEqual([{ is_ready: true }])
    const held = await getScopedEdielProductionReadiness(dgi)
    await expect(recordScopedEdielProductionEvidence({ message: dgi, expectedDependencyHash: held.dependencyHash, certificationEvidenceIds: priorDdq.ids, expiresAt: '2099-01-01T00:00:00Z' })).rejects.toThrow('ediel_scoped_capability_evidence_required')
    await expect(assertCompanyCanSendProductionEdiel({ companyId: company, message: dgi })).rejects.toThrow('ediel_scoped_capability_evidence_required')
    await expect(assertCompanyCanSendProductionEdiel({ companyId: ownerId(999), message: ddq })).rejects.toThrow('ediel_scoped_capability_evidence_required')
    await expect(port.db!.query('select public.ediel_scoped_capability_readiness_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [ownerId(999), dgi.id, OWNER.actor, 'energy_service_company', 'PRODAT', 'Z13', 'V', ownerId(130), release, ruleHash])).rejects.toThrow('ediel_scoped_capability_evidence_required')
    expect(await getScopedEdielProductionReadiness(dgi)).toMatchObject({ ready: false, evidenceId: null })
  })

  it('the actual inbound coordinator keeps qualified receipt and prescribed CONTRL available during the affected DGI hold', async () => {
    const { priorDdq } = await changedDgi()
    const sourceBefore = structuredClone(port.source), ackBefore = structuredClone(port.ack)
    const result = await processInboundEdielMessage({ actorUserId: actor, edielMessageId: port.source.id })
    expect(result.validation_report).toMatchObject({ syntaxDecision: 'accepted', applicationDecision: 'accepted', functionalDecision: 'accepted' })
    expect(result.raw_payload).toBe(sourceBefore.raw_payload)
    expect(result.execution_context_snapshot).toEqual(sourceBefore.execution_context_snapshot)
    expect(port.ack).toEqual(ackBefore)
    expect(port.tables.ediel_message_events).toContainEqual(expect.objectContaining({ company_id: company, ediel_message_id: port.source.id, event_status: 'success', payload: expect.objectContaining({ applicationDecision: 'accepted' }) }))
    expect(port.tables.ediel_message_events.some(row => (row.payload as Row)?.blockedBy === 'canonical_inbound_ack_guard')).toBe(false)
    expect(port.calls.filter(row => row.name === 'gridex_read_outbound_acks_for_source_v2').length).toBeGreaterThan(0)
    expect(port.calls.some(row => row.name === 'ediel_record_technical_syntax_facet_v2')).toBe(true)
    // Held native business owner has no commit receipt; the test proves safe
    // receipt/ACK continuation, never fabricated supply/customer changes.
    expect(port.calls.some(row => row.name === 'ediel_apply_supply_source_v1')).toBe(true)
    expect(port.writes.every(row => !['customer_supply_periods', 'customers', 'customer_sites'].includes(row.table))).toBe(true)
    await expect(assertCompanyCanSendProductionEdiel({ companyId: company, message: port.ack })).resolves.toBeUndefined()
    const admitted = await validateRulebookMessageWithRegistry({ family: 'CONTRL', code: 'CONTRL', direction: 'outbound', mode: 'send', companyId: company, environment: 'production', rawPayload: port.ack.raw_payload, messageRow: port.ack, executionActorUserId: actor })
    expect(admitted).toMatchObject({ ok: true, blocking: false, fieldRuleSource: 'technical_source', rulePackSnapshot: null })
    expect(await getScopedEdielProductionReadiness(dgi)).toMatchObject({ ready: false, evidenceId: null })
    expect(await getScopedEdielProductionReadiness(ddq)).toMatchObject({ ready: true, evidenceId: priorDdq.evidenceId })
  })

  it('continued prescribed ACK availability still refuses mutated physical source identity at final admission', async () => {
    await changedDgi()
    await expect(assertCompanyCanSendProductionEdiel({ companyId: company, message: port.ack })).resolves.toBeUndefined()
    const altered = { ...port.ack, raw_payload: port.ack.raw_payload!.replace('UCI+I+', 'UCI+FOREIGN+') }
    const validation = await validateRulebookMessageWithRegistry({ family: 'CONTRL', code: 'CONTRL', direction: 'outbound', mode: 'send', companyId: company, environment: 'production', rawPayload: altered.raw_payload, messageRow: altered, executionActorUserId: actor })
    expect(validation.ok).toBe(false)
    expect(await getScopedEdielProductionReadiness(dgi)).toMatchObject({ ready: false })
  })

  it('originates and queues a new physical CONTRL through actual guarded consumers while DGI remains stale', async () => {
    const { priorDdq } = await changedDgi()
    port.retainAck = false
    expect(await getScopedEdielProductionReadiness(dgi)).toMatchObject({ ready: false })
    await processInboundEdielMessage({ actorUserId: actor, edielMessageId: port.source.id })
    expect(port.tables.ediel_message_events.filter(row => (row.payload as Row)?.blockedBy === 'canonical_inbound_ack_guard')).toEqual([])
    expect(port.ack).toMatchObject({ id: ownerId(601), company_id: company, environment: 'production', related_message_id: port.source.id, direction: 'outbound', message_family: 'CONTRL', ack_outcome: 'positive', requires_contrl: false, requires_aperak: false })
    expect(port.tables.ediel_outbox).toEqual([expect.objectContaining({ company_id: company, environment: 'production', ediel_message_id: ownerId(601), source_message_id: port.source.id, message_family: 'CONTRL', status: 'queued', route_profile_id: ownerId(611) })])
    await expect(assertCompanyCanSendProductionEdiel({ companyId: company, message: port.ack })).resolves.toBeUndefined()
    const final = await validateRulebookMessageWithRegistry({ family: 'CONTRL', code: 'CONTRL', direction: 'outbound', mode: 'send', companyId: company, environment: 'production', rawPayload: port.ack.raw_payload, messageRow: port.ack, executionActorUserId: actor })
    expect(final).toMatchObject({ ok: true, blocking: false, fieldRuleSource: 'technical_source', rulePackSnapshot: null })
    const physical = EdifactEnvelopeCodec.decode(port.ack.raw_payload)
    expect(physical).toMatchObject({ sender: '54321', senderQualifier: '14', receiver: '12345', receiverQualifier: '14', acknowledgementRequest: null })
    expect(port.ack.raw_payload).toContain("UCI+I+12345:14+54321:14+1'")
    expect(await getScopedEdielProductionReadiness(dgi)).toMatchObject({ ready: false, evidenceId: null })
    expect(await getScopedEdielProductionReadiness(ddq)).toMatchObject({ ready: true, evidenceId: priorDdq.evidenceId })
  })
})
