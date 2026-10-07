// Bounded observations and genuine public producers for disposable Z01 inputs.
// The inherited issuer competence is synthetic GIVEN, never external approval.
import {createHash, randomUUID} from 'node:crypto'
import {expect} from 'vitest'
import {queueCustomerInfoRequestForDispatch} from '@/lib/onboarding/infoRequests'
import {requireEdielSourceRulePackEvidence} from '@/lib/ediel/core/sourceRulePackEvidence'
import {verifyAuthorizationScopeCoverage} from '@/lib/legal/authorizationChain'
import {archiveNetworkRegistrySource, readNetworkRegistrySourceArtifact, readNetworkRegistrySourceBytes,
  reviewNetworkRegistrySource} from '@/lib/ediel/production/networkRegistrySource'
import {attachNetworkRegistrySourceFixture} from './ediel-network-registry-native-fixture'
import {nativeSql as sql, literal, normalSwitchNetworkRegistry} from './ediel-normal-switch-native-fixture'
import type {Z01SupplierNativeFixture} from './ediel-z01-info-request-native-fixture'

type Row = Record<string, unknown>
type Scope = Pick<Z01SupplierNativeFixture, 'companyId' | 'actorUserId' | 'customerId' | 'siteId' | 'pointId' | 'gridId' | 'external' | 'gridAreaCode'
  | 'authorizationDocumentId' | 'powerOfAttorneyId' | 'contractId'>
type Graph = {observedAt: string; requests: Row[]; dataRequests: Row[]; outbounds: Row[]; intents: Row[]; messages: Row[]; outbox: Row[]; constraints: Row[]}
const record = (value: unknown): Row => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('z01_observation_object_required')
  return value as Row
}
const projection = (alias: string, keys: string[]) => `jsonb_build_object(${keys.map(key => `${literal(key)},to_jsonb(${alias})->${literal(key)}`).join(',')})`
const rows = (alias: string, keys: string[]) => `(SELECT coalesce(jsonb_agg(${projection(alias, keys)} ORDER BY id),'[]') FROM ${alias})`
const signedScopeObservation = (alias: string) => `jsonb_build_object('signedScopeSnapshotType',jsonb_typeof(${alias}.signed_scope_snapshot),
  'signedScopeSnapshotHash',encode(sha256(convert_to(coalesce(${alias}.signed_scope_snapshot,'null')::text,'UTF8')),'hex'),
  'signedScopeSnapshotKeys',(SELECT coalesce(jsonb_agg(key ORDER BY key),'[]') FROM jsonb_object_keys(
    CASE WHEN jsonb_typeof(${alias}.signed_scope_snapshot)='object' THEN ${alias}.signed_scope_snapshot ELSE '{}' END) key),
  'signedScopeFlags',jsonb_build_object(${['grid_owner_data', 'supplier_switch', 'facility_information_lookup', 'current_supplier_contract', 'metering_data']
    .map(scope => `${literal(scope)},CASE WHEN jsonb_typeof(${alias}.signed_scope_snapshot)='array' THEN ${alias}.signed_scope_snapshot ? ${literal(scope)} ELSE false END`).join(',')}))`
function boundedError(error: unknown) {
  const value = error && typeof error === 'object' ? record(error) : {}
  const cause = value.cause && typeof value.cause === 'object' ? record(value.cause) : {}
  const stderr = typeof value.stderr === 'string' ? value.stderr : Buffer.isBuffer(value.stderr) ? value.stderr.toString('utf8') : null
  const sqlMessage = stderr?.split('\n').find(line => line.startsWith('ERROR:'))
  return {code: typeof value.code === 'string' ? value.code.slice(0, 80) : typeof cause.code === 'string' ? cause.code.slice(0, 80) : null,
    message: stderr !== null ? (sqlMessage ?? 'z01_observation_sql_failed').slice(0, 1000) : typeof value.message === 'string' ? value.message.slice(0, 1000)
      : typeof error === 'string' ? error.slice(0, 1000) : 'z01_observation_failed'}
}

/** Full rows stay inside PostgreSQL. Digests cover every field, including raw
 * wire and public audit rows, without exporting those values. */
export function observeZ01PublicState(f: Scope) {
  const tables = ['customers', 'customer_sites', 'metering_points', 'customer_contracts', 'customer_supply_periods',
    'supplier_switch_requests', 'customer_info_requests', 'grid_owner_data_requests', 'outbound_requests', 'ediel_message_intents',
    'ediel_messages', 'ediel_outbox', 'authorization_scopes', 'customer_authorization_documents', 'powers_of_attorney',
    'power_of_attorney_scopes', 'customer_info_request_events', 'customer_operation_events', 'customer_operation_jobs',
    'customer_operation_request_snapshots', 'ediel_business_expectations', 'audit_logs']
  return sql<Record<string, {count: number; sha256: string}>>(`SELECT jsonb_build_object(${tables.map(table => `${literal(table)},
    (SELECT jsonb_build_object('count',count(*),'sha256',encode(sha256(convert_to(
      coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]')::text,'UTF8')),'hex')) FROM public.${table} t
      WHERE company_id=${literal(f.companyId)})`).join(',')})`)
}

/** All grants and all sites for the own customer are retained. This is lineage
 * evidence, not an eligibility decision or an alternate authority fallback. */
export function observeZ01AuthorizationLineage(f: Scope) {
  const common = ['id', 'company_id', 'customer_id', 'site_id', 'metering_point_id', 'status', 'created_at', 'updated_at']
  return sql<Row>(`WITH
    s AS (SELECT * FROM public.authorization_scopes WHERE company_id=${literal(f.companyId)} AND customer_id=${literal(f.customerId)}),
    d AS (SELECT * FROM public.customer_authorization_documents WHERE company_id=${literal(f.companyId)} AND customer_id=${literal(f.customerId)}),
    p AS (SELECT * FROM public.powers_of_attorney WHERE company_id=${literal(f.companyId)} AND customer_id=${literal(f.customerId)}),
    c AS (SELECT * FROM public.customer_contracts WHERE company_id=${literal(f.companyId)} AND customer_id=${literal(f.customerId)}),
    q AS (SELECT * FROM public.power_of_attorney_scopes WHERE company_id=${literal(f.companyId)} AND customer_id=${literal(f.customerId)})
    SELECT jsonb_build_object('observedAt',clock_timestamp(),'databaseDate',current_date,
      'selected',jsonb_build_object('companyId',${literal(f.companyId)},'customerId',${literal(f.customerId)},'siteId',${literal(f.siteId)},
        'authorizationDocumentId',${literal(f.authorizationDocumentId)},'powerOfAttorneyId',${literal(f.powerOfAttorneyId)},'contractId',${literal(f.contractId)}),
      'scopes',(SELECT coalesce(jsonb_agg(${projection('s', [...common, 'authorization_document_id', 'scope_type', 'revoked_at',
        'valid_from', 'valid_to', 'covers_grid_owner_data', 'covers_current_supplier_contract', 'covers_metering_data',
        'legal_snapshot_id'])}||${signedScopeObservation('s')}||jsonb_build_object('powerOfAttorneyId',s.metadata->'powerOfAttorneyId',
          'source',s.metadata->'source','updatedFrom',s.metadata->'updatedFrom') ORDER BY id),'[]') FROM s),
      'documents',${rows('d', [...common, 'document_type', 'power_of_attorney_id', 'customer_contract_id', 'replaced_document_id',
        'signed_at', 'accepted_at', 'approved_at', 'archived_at', 'revoked_at', 'valid_from', 'valid_to', 'expires_at'])},
      'powersOfAttorney',(SELECT coalesce(jsonb_agg(${projection('p', [...common, 'customer_site_id', 'document_id', 'customer_contract_id', 'contract_id', 'scope', 'source',
        'revoked_at', 'valid_from', 'valid_to', 'valid_until', 'expires_at', 'signed_at', 'accepted_at', 'legal_snapshot_id'])}||${signedScopeObservation('p')} ORDER BY id),'[]') FROM p),
      'contracts',${rows('c', [...common, 'signed_at', 'signed_version', 'starts_at', 'ends_at', 'requested_start_date',
        'document_sha256', 'signature_snapshot_sha256', 'contract_publication_version_id', 'legal_bundle_version_id'])},
      'powerOfAttorneyScopes',${rows('q', [...common, 'power_of_attorney_id', 'customer_contract_id', 'scope_type', 'is_active', 'valid_from', 'valid_to'])})`)
}

/** The actual public table is probed in nested exception subtransactions. Even
 * an accepted UPDATE is rolled back by the sentinel; the outer transaction
 * also rolls back all temporary results. No error DETAIL is selected. */
export function probeZ01CustomerInfoStatuses(f: Scope, operationId: string, requestId: string) {
  if (![f.companyId, f.customerId, f.siteId, operationId, requestId].every(value => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value))) {
    throw Error('z01_status_probe_uuid_scope_required')
  }
  const graphBefore = observeZ01DispatchGraph(f, operationId), publicBefore = observeZ01PublicState(f)
  const results = sql<Array<{status: string; accepted: boolean; sqlstate: string | null; constraint: string | null; message: string | null; affectedRows: number}>>(`BEGIN;
    CREATE TEMP TABLE z01_status_probe_results(status text,accepted boolean,sqlstate text,constraint_name text,message text,affected_rows integer) ON COMMIT DROP;
    DO $z01_probe$ DECLARE next_status text; accepted boolean; error_code text; error_constraint text; error_message text; affected integer;
    BEGIN
      PERFORM id FROM public.customer_info_requests WHERE id=${literal(requestId)} AND company_id=${literal(f.companyId)}
        AND customer_id=${literal(f.customerId)} AND site_id=${literal(f.siteId)} AND operation_id=${literal(operationId)} FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'z01_status_probe_own_request_required'; END IF;
      FOREACH next_status IN ARRAY ARRAY['z01_prepared','route_missing','missing_authorization'] LOOP
        accepted:=false; error_code:=NULL; error_constraint:=NULL; error_message:=NULL; affected:=0;
        BEGIN
          UPDATE public.customer_info_requests SET status=next_status WHERE id=${literal(requestId)} AND company_id=${literal(f.companyId)}
            AND customer_id=${literal(f.customerId)} AND site_id=${literal(f.siteId)} AND operation_id=${literal(operationId)};
          GET DIAGNOSTICS affected=ROW_COUNT;
          IF affected<>1 THEN RAISE EXCEPTION 'z01_status_probe_single_own_row_required'; END IF;
          RAISE EXCEPTION USING ERRCODE='ZQ001',MESSAGE='z01_status_probe_accepted_rollback';
        EXCEPTION WHEN SQLSTATE 'ZQ001' THEN
          GET STACKED DIAGNOSTICS error_code=RETURNED_SQLSTATE,error_message=MESSAGE_TEXT;
          IF affected=1 AND error_message='z01_status_probe_accepted_rollback' THEN
            accepted:=true; error_code:=NULL; error_message:=NULL;
          END IF;
          WHEN OTHERS THEN GET STACKED DIAGNOSTICS error_code=RETURNED_SQLSTATE,error_constraint=CONSTRAINT_NAME,error_message=MESSAGE_TEXT;
        END;
        INSERT INTO pg_temp.z01_status_probe_results VALUES(next_status,accepted,error_code,error_constraint,left(error_message,1000),affected);
      END LOOP;
    END $z01_probe$;
    SELECT jsonb_agg(jsonb_build_object('status',status,'accepted',accepted,'sqlstate',sqlstate,
      'constraint',nullif(constraint_name,''),'message',message,'affectedRows',affected_rows) ORDER BY status) FROM pg_temp.z01_status_probe_results;
    ROLLBACK;`)
  const graphAfter = observeZ01DispatchGraph(f, operationId), publicAfter = observeZ01PublicState(f)
  const {observedAt: beforeTime, ...beforeRows} = graphBefore, {observedAt: afterTime, ...afterRows} = graphAfter
  const noPersistedMutation = JSON.stringify(beforeRows) === JSON.stringify(afterRows) && JSON.stringify(publicBefore) === JSON.stringify(publicAfter)
  if (!noPersistedMutation) throw Error('z01_status_probe_persisted_mutation')
  return {results, noPersistedMutation, graphBefore, graphAfter, publicBefore, publicAfter, beforeTime, afterTime}
}

/** The read port requires the original's receipt. It never captures, chooses a
 * current pack, changes an original or grants permission to send. */
export async function observeZ01OriginalRulePackEvidence(f: Scope, graph: Graph) {
  const originals = []
  for (const message of graph.messages.filter(row => row.direction === 'outbound' && row.message_family === 'PRODAT' && row.message_code === 'Z01')) {
    if (typeof message.id !== 'string') throw Error('z01_original_observation_id_required')
    const original = sql<Row>(`SELECT ${projection('m', ['id', 'company_id', 'intent_id', 'status', 'canonical_rule_pack_id', 'rule_profile_key',
      'rule_profile_version_id', 'rule_profile_version', 'rule_pack_checksum', 'immutable_payload_hash', 'immutable_rendered_at', 'message_sent_at'])}
      ||jsonb_build_object('rulePackSnapshotKeys',(SELECT coalesce(jsonb_agg(key ORDER BY key),'[]') FROM jsonb_object_keys(
        CASE WHEN jsonb_typeof(rule_pack_snapshot)='object' THEN rule_pack_snapshot ELSE '{}' END) key),
        'rulePackSnapshotHash',encode(sha256(convert_to(coalesce(rule_pack_snapshot,'{}')::text,'UTF8')),'hex'),
        'rulePackSnapshotBytes',octet_length(coalesce(rule_pack_snapshot,'{}')::text),
        'outboundOwnerWitnessPresent',nullif(execution_context_snapshot->>'outboundOwnerWitnessId','') IS NOT NULL)
      FROM public.ediel_messages m WHERE id=${literal(message.id)} AND company_id=${literal(f.companyId)}`)
    let required
    try {
      const evidence = await requireEdielSourceRulePackEvidence(f.companyId, message.id)
      required = {ok: true, rulePackId: evidence.rulePackId, messageProfileId: evidence.messageProfileId,
        profileKey: evidence.profileKey, version: evidence.version, sourceHash: evidence.sourceHash,
        snapshotKeys: Object.keys(evidence.snapshot).sort(), snapshotHash: createHash('sha256').update(JSON.stringify(evidence.snapshot)).digest('hex')}
    } catch (error) {required = {ok: false, ...boundedError(error)}}
    originals.push({original, required})
  }
  return originals
}

/** SELECT only; the graph does not infer absence from a missing CIR link. Raw
 * wire, payloads, issuer material and database error details are not exported. */
export function observeZ01DispatchGraph(f: Scope, operationId: string): Graph {
  const company = literal(f.companyId), operation = literal(operationId)
  const common = ['id', 'company_id', 'customer_id', 'operation_id', 'status', 'created_at', 'updated_at']
  return sql<Graph>(`WITH
    r AS (SELECT * FROM public.customer_info_requests WHERE company_id=${company} AND operation_id=${operation}
      AND customer_id=${literal(f.customerId)} AND site_id=${literal(f.siteId)}),
    d AS (SELECT * FROM public.grid_owner_data_requests WHERE company_id=${company}
      AND (operation_id=${operation} OR id IN(SELECT grid_owner_data_request_id FROM r))),
    o AS (SELECT * FROM public.outbound_requests WHERE company_id=${company}
      AND (operation_id=${operation} OR (source_type='grid_owner_data_request' AND source_id IN(SELECT id FROM d)))),
    i AS (SELECT * FROM public.ediel_message_intents WHERE company_id=${company}
      AND (operation_id=${operation} OR customer_info_request_id IN(SELECT id FROM r) OR outbound_request_id IN(SELECT id FROM o))),
    m AS (SELECT * FROM public.ediel_messages WHERE company_id=${company} AND (source_operation_id=${operation}
      OR grid_owner_data_request_id IN(SELECT id FROM d) OR outbound_request_id IN(SELECT id FROM o) OR intent_id IN(SELECT id FROM i))),
    b AS (SELECT * FROM public.ediel_outbox WHERE company_id=${company} AND ediel_message_id IN(SELECT id FROM m))
    SELECT jsonb_build_object('observedAt',clock_timestamp(),
      'requests',${rows('r', [...common, 'site_id', 'grid_owner_data_request_id', 'outbound_request_id', 'ediel_message_id',
        'route_resolution_status', 'blocker_code', 'transaction_reference', 'correlation_reference'])},
      'dataRequests',${rows('d', [...common, 'site_id', 'metering_point_id', 'grid_owner_id', 'readiness_status', 'external_reference', 'automation_key'])},
      'outbounds',${rows('o', [...common, 'site_id', 'source_type', 'source_id', 'communication_route_id', 'channel_type', 'external_reference'])},
      'intents',${rows('i', [...common, 'customer_info_request_id', 'outbound_request_id', 'ediel_message_id', 'communication_route_id',
        'route_profile_id', 'validation_status', 'render_status', 'outbox_status'])},
      'messages',${rows('m', [...common, 'direction', 'message_family', 'message_code', 'source_operation_id', 'grid_owner_data_request_id',
        'outbound_request_id', 'intent_id', 'communication_route_id', 'route_profile_id', 'immutable_payload_hash'])},
      'outbox',${rows('b', ['id', 'company_id', 'ediel_message_id', 'intent_id', 'status', 'route_profile_id', 'created_at', 'queued_at', 'sent_at', 'attempts'])},
      'constraints',(SELECT coalesce(jsonb_agg(jsonb_build_object('table',conrelid::regclass::text,
        'name',conname,'definition',pg_get_constraintdef(oid)) ORDER BY conrelid,conname),'[]') FROM pg_constraint
        WHERE contype='c' AND conrelid IN('public.customer_info_requests'::regclass,'public.grid_owner_data_requests'::regclass,
          'public.outbound_requests'::regclass,'public.ediel_message_intents'::regclass,'public.ediel_messages'::regclass,'public.ediel_outbox'::regclass)))`)
}

/** This one real retry is diagnostic. The caller must still throw its original
 * worker failure; no result here certifies worker completion or native PASS. */
export async function diagnoseZ01FailedWorker(f: Scope, operationId: string, failedQueuedWorker: boolean) {
  const before = observeZ01DispatchGraph(f, operationId)
  const authorizationBefore = observeZ01AuthorizationLineage(f)
  const originalRulePack = await observeZ01OriginalRulePackEvidence(f, before)
  let statusProbe: Awaited<ReturnType<typeof probeZ01CustomerInfoStatuses>> | {error: ReturnType<typeof boundedError>} | null = null
  let exactSiteCoverage: Awaited<ReturnType<typeof verifyAuthorizationScopeCoverage>> | {error: ReturnType<typeof boundedError>}
  try {exactSiteCoverage = await verifyAuthorizationScopeCoverage({companyId: f.companyId, customerId: f.customerId, siteId: f.siteId,
    powerOfAttorneyId: f.powerOfAttorneyId, required: ['grid_owner_data'], healFromPowerOfAttorney: false})}
  catch (error) {exactSiteCoverage = {error: boundedError(error)}}
  let retry: {attempted: boolean; code: string | null; message: string | null; result?: {status: string; requestId: string}} =
    {attempted: false, code: null, message: null}
  if (failedQueuedWorker && before.requests.length === 1 && typeof before.requests[0].id === 'string') {
    try {statusProbe = probeZ01CustomerInfoStatuses(f, operationId, before.requests[0].id)}
    catch (error) {statusProbe = {error: boundedError(error)}}
    retry = {...retry, attempted: true}
    try {
      const result = await queueCustomerInfoRequestForDispatch({companyId: f.companyId, actorUserId: f.actorUserId,
        requestId: before.requests[0].id})
      retry.result = {status: String(result.status), requestId: before.requests[0].id}
    } catch (error) {
      retry = {...retry, ...boundedError(error)}
    }
  }
  return {before, statusProbe, originalRulePack, authorizationBefore, exactSiteCoverage, retry,
    after: observeZ01DispatchGraph(f, operationId), authorizationAfter: observeZ01AuthorizationLineage(f)}
}

function ownRow(value: unknown, id: string, companyId: string): Row {
  if (!Array.isArray(value)) throw Error('z01_observation_rows_required')
  const rows: Row[] = value.map(record)
  expect(new Set(rows.map(row => row.id)).size).toBe(rows.length)
  const own = rows.filter(row => row.id === id)
  expect(own).toHaveLength(1)
  expect(own[0].company_id).toBe(companyId)
  return own[0]
}

/** Only the already observed grid-owner preparation is allowed. Every other
 * decoded field and every other row, including activation, remains exact. */
export function assertZ01RolePreparationOnly(f: Scope, before: unknown, after: unknown,
  window: {startedAt: string; finishedAt: string}): void {
  const prior = record(before), current = record(after)
  expect(Object.keys(prior).sort()).toEqual(['activation', 'customers', 'points', 'sites'])
  expect(Object.keys(current).sort()).toEqual(Object.keys(prior).sort())
  const siteBefore = ownRow(prior.sites, f.siteId, f.companyId), siteAfter = ownRow(current.sites, f.siteId, f.companyId)
  const customerBefore = ownRow(prior.customers, f.customerId, f.companyId), customerAfter = ownRow(current.customers, f.customerId, f.companyId)
  const point = ownRow(prior.points, f.pointId, f.companyId)
  expect(siteBefore).toMatchObject({customer_id: f.customerId, facility_id: f.external, grid_owner_id: f.gridId, grid_area_code: f.gridAreaCode})
  expect(point).toMatchObject({customer_id: f.customerId, site_id: f.siteId, metering_point_id: f.external, grid_owner_id: f.gridId})
  expect(siteBefore.data_quality_status).toBe('incomplete')
  expect(siteAfter).toMatchObject({data_quality_status: 'complete', resolution_confidence: 1, resolution_status: 'facility_verified'})
  const started = Date.parse(window.startedAt), finished = Date.parse(window.finishedAt)
  expect(Number.isFinite(started) && Number.isFinite(finished) && started <= finished).toBe(true)
  const fresh = (value: unknown, previous: unknown) => {
    expect(typeof value).toBe('string')
    const at = Date.parse(String(value)), old = Date.parse(String(previous))
    expect(Number.isFinite(at) && at >= started && at <= finished && (!Number.isFinite(old) || at >= old)).toBe(true)
  }
  fresh(siteAfter.updated_at, siteBefore.updated_at)
  fresh(customerAfter.updated_at, customerBefore.updated_at)
  const summaryBefore = record(customerBefore.process_summary), summaryAfter = record(customerAfter.process_summary)
  fresh(summaryAfter.refreshed_at, summaryBefore.refreshed_at)
  expect(summaryAfter).toEqual({...summaryBefore, refreshed_at: summaryAfter.refreshed_at})
  expect(siteAfter).toEqual({...siteBefore, data_quality_status: 'complete', resolution_confidence: 1,
    resolution_status: 'facility_verified', updated_at: siteAfter.updated_at})
  expect(customerAfter).toEqual({...customerBefore, process_summary: summaryAfter, updated_at: customerAfter.updated_at})
  expect(current).toEqual({...prior,
    sites: (prior.sites as Row[]).map(row => row.id === f.siteId ? siteAfter : row),
    customers: (prior.customers as Row[]).map(row => row.id === f.customerId ? customerAfter : row)})
}

function networkIssuerRows(f: Scope) {
  return sql<{keys: Row[]; representations: Row[]}>(`SELECT jsonb_build_object('keys',
    (SELECT coalesce(jsonb_agg((to_jsonb(k)-'receipt_signing_key')||jsonb_build_object('signingKeyHash',
      encode(sha256(receipt_signing_key),'hex')) ORDER BY id),'[]') FROM gridex_network_registry_sources.issuer_keys k WHERE company_id=${literal(f.companyId)}),
    'representations',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY id),'[]') FROM gridex_network_registry_sources.representations r
      WHERE company_id=${literal(f.companyId)}))`)
}

/** The existing cached synthetic issuer signs a new current-claims original;
 * the actual archive and separate review create its successor. No issuer row,
 * prior original or approval is patched. Call only for the optional LK input. */
export async function prepareZ01OptionalLkNetworkSuccessor(f: Z01SupplierNativeFixture) {
  expect(f.variant).toBe('LK')
  const prior = normalSwitchNetworkRegistry(f.companyId)
  if (!prior) throw Error('z01_existing_network_registry_fixture_required')
  const issuerBefore = networkIssuerRows(f)
  expect(issuerBefore.keys).toHaveLength(1); expect(issuerBefore.representations).toHaveLength(1)
  // The base already called attach for this company. Reject missing persisted
  // inputs before invoking its cached closure, then require no attach mutation.
  const registry = await attachNetworkRegistrySourceFixture(f)
  expect(networkIssuerRows(f)).toEqual(issuerBefore)
  expect(registry.reviewer.id).toBe(prior.reviewerId)
  expect(registry.uploader.id).not.toBe(registry.reviewer.id)
  expect(issuerBefore.keys[0]).toMatchObject({id: registry.keyId, company_id: f.companyId, environment: 'test', network_actor_id: f.marketActorId})
  expect(issuerBefore.representations[0]).toMatchObject({id: registry.representationId, company_id: f.companyId,
    environment: 'test', issuer_key_id: registry.keyId, network_actor_id: f.marketActorId})
  const priorScope = {companyId: f.companyId, actorUserId: registry.uploader.id, artifactId: prior.artifact.artifactId}
  const priorReadBefore = await readNetworkRegistrySourceArtifact(priorScope)
  expect(priorReadBefore).toMatchObject({...prior.artifact, networkActorId: f.marketActorId, networkEdielId: f.receiver,
    status: 'held', missing: ['current_network_registry_authority_missing_or_revoked']})
  const priorBytesBefore = await readNetworkRegistrySourceBytes(priorScope)
  const suffix = randomUUID(), bytes = registry.pdf(`optional LK current registry ${suffix}`)
  const artifact = await archiveNetworkRegistrySource({...registry.submission(`SYNTHETIC optional LK successor ${suffix}`, bytes),
    companyId: f.companyId, actorUserId: registry.uploader.id})
  expect(artifact.missing).toEqual([])
  expect(artifact.artifactId).not.toBe(prior.artifact.artifactId)
  const review = await reviewNetworkRegistrySource({...artifact, companyId: f.companyId, actorUserId: registry.reviewer.id,
    decision: 'approve', reason: 'SYNTHETIC separate review of current optional LK network original', clause: registry.clause})
  expect(review.status).toBe('authorized')
  const current = await readNetworkRegistrySourceArtifact({...priorScope, artifactId: artifact.artifactId})
  expect(current).toMatchObject({status: 'authorized', networkActorId: f.marketActorId, networkEdielId: f.receiver,
    sourceHash: createHash('sha256').update(bytes).digest('hex'), claimsHash: artifact.claimsHash})
  expect(current.claimsHash).not.toBe(prior.artifact.claimsHash)
  const priorReadAfter = await readNetworkRegistrySourceArtifact(priorScope), priorBytesAfter = await readNetworkRegistrySourceBytes(priorScope)
  expect(priorReadAfter).toEqual(priorReadBefore)
  expect(priorBytesAfter).toEqual(priorBytesBefore)
  const issuerAfter = networkIssuerRows(f)
  expect(issuerAfter).toEqual(issuerBefore)
  return {prior, priorReadBefore, priorReadAfter, issuerBefore, issuerAfter, artifact, review, current}
}
