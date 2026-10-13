// Bounded observations and genuine public producers for disposable Z01 inputs.
// The inherited issuer competence is synthetic GIVEN, never external approval.
import {createHash, randomUUID} from 'node:crypto'
import {expect} from 'vitest'
import {queueCustomerInfoRequestForDispatch} from '@/lib/onboarding/infoRequests'
import {archiveNetworkRegistrySource, readNetworkRegistrySourceArtifact, readNetworkRegistrySourceBytes,
  reviewNetworkRegistrySource} from '@/lib/ediel/production/networkRegistrySource'
import {attachNetworkRegistrySourceFixture} from './ediel-network-registry-native-fixture'
import {nativeSql as sql, literal, normalSwitchNetworkRegistry} from './ediel-normal-switch-native-fixture'
import type {Z01SupplierNativeFixture} from './ediel-z02-supplier-native-fixture'

type Row = Record<string, unknown>
type Scope = Pick<Z01SupplierNativeFixture, 'companyId' | 'actorUserId' | 'customerId' | 'siteId' | 'pointId' | 'gridId' | 'external' | 'gridAreaCode'>
type Graph = {observedAt: string; requests: Row[]; dataRequests: Row[]; outbounds: Row[]; intents: Row[]; messages: Row[]; outbox: Row[]; constraints: Row[]}
const record = (value: unknown): Row => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('z01_observation_object_required')
  return value as Row
}
const projection = (alias: string, keys: string[]) => `jsonb_build_object(${keys.map(key => `${literal(key)},to_jsonb(${alias})->${literal(key)}`).join(',')})`
const rows = (alias: string, keys: string[]) => `(SELECT coalesce(jsonb_agg(${projection(alias, keys)} ORDER BY id),'[]') FROM ${alias})`

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
  let retry: {attempted: boolean; code: string | null; message: string | null; result?: {status: string; requestId: string}} =
    {attempted: false, code: null, message: null}
  if (failedQueuedWorker && before.requests.length === 1 && typeof before.requests[0].id === 'string') {
    retry = {...retry, attempted: true}
    try {
      const result = await queueCustomerInfoRequestForDispatch({companyId: f.companyId, actorUserId: f.actorUserId,
        requestId: before.requests[0].id})
      retry.result = {status: String(result.status), requestId: before.requests[0].id}
    } catch (error) {
      const value = error && typeof error === 'object' ? record(error) : {}
      retry.code = typeof value.code === 'string' ? value.code.slice(0, 80) : null
      retry.message = typeof value.message === 'string' ? value.message.slice(0, 1000)
        : typeof error === 'string' ? error.slice(0, 1000) : 'z01_public_dispatch_retry_failed'
    }
  }
  return {before, retry, after: observeZ01DispatchGraph(f, operationId)}
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
