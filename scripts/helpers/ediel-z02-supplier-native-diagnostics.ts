import { execFileSync } from 'node:child_process'
import * as positiveStructuredNodeUtil from 'node:util'
import { literal } from './ediel-normal-switch-native-fixture'
import type {
  createZ01SupplierNativeFixture,
  originateZ01SupplierRequest,
  receiveZ01SupplierReply,
} from './ediel-z02-supplier-native-fixture'

type Fixture = Awaited<ReturnType<typeof createZ01SupplierNativeFixture>>
type Original = Awaited<ReturnType<typeof originateZ01SupplierRequest>>
type Received = Awaited<ReturnType<typeof receiveZ01SupplierReply>>
// Observation only: one READ-only public snapshot after acceptedPhysical.
// No source/capability/identity/UUID or arbitrary result text enters the log.
const positiveProjectionStates = ['queued', 'running', 'completed', 'failed', 'cancelled', 'blocked', 'needs_review',
  'draft', 'prepared', 'received', 'parsed', 'validated', 'manual_review', 'waiting_for_z02', 'ready_for_switch',
  'manual_review_required', 'waiting_response', 'delivery_uncertain', 'skipped', 'missing_authorization', 'ready_to_send',
  'z01_prepared', 'route_missing', 'sent_to_grid_owner', 'waiting_for_contrl', 'waiting_for_aperak', 'z02_received',
  'negative_aperak', 'missing_binding_info', 'missing_termination_info', 'rejected', 'exact', 'valid', 'invalid',
  'stale', 'recorded', 'unconfirmed', 'not_requested', 'absent', 'unlisted'] as const
const positiveProjectionReasons = ['z02_atomic_core_finalized', 'z02_processing_enqueue_failed', 'no_matching_customer_info_request',
  'z02_job_invalid_identifiers', 'z02_job_missing_identifiers', 'z02_request_not_found_for_tenant', 'request_site_customer_mismatch',
  'z02_inbound_message_not_found', 'z02_customer_mismatch', 'response_site_mismatch',
  'z02_originating_sent_source_unavailable', 'z02_originating_dispatch_proof_required', 'z02_original_object_reference_mismatch',
  'z02_original_party_namespace_mismatch', 'z02_original_site_snapshot_changed', 'z02_end_user_identity_conflict',
  'z02_required_measure_method_missing', 'z02_frozen_source_unavailable', 'z02_current_canonical_assessment_ambiguous',
  'z02_canonical_source_not_accepted', 'z02_own_application_scope_unavailable', 'z02_verified_customer_identity_mismatch',
  'z02_atomic_apply_invalid_identifiers', 'z02_atomic_message_link_mismatch', 'z02_atomic_metering_point_evidence_missing',
  'z02_atomic_metering_point_not_verified', 'z02_source_grid_area_missing', 'z02_operation_snapshot_missing',
  'z02_snapshot_site_mismatch', 'site_address_changed_after_request', 'site_grid_owner_changed_after_request',
  'site_facility_changed_after_request', 'z02_atomic_core_apply_failed', 'z02_variant_mismatch',
  'cross_site_identifier_conflict', 'duplicate_metering_point', 'facility_identifier_conflict', 'grid_owner_conflict',
  'z02_applied_source_scope_mismatch', 'z02_existing_price_area_conflict', 'z02_grid_area_price_area_unresolved',
  'z02_metering_point_missing', 'z02_object_already_applied_to_other_request', 'z02_originating_object_ambiguous',
  'z02_own_canonical_object_ambiguous', 'z02_own_canonical_object_unavailable', 'z02_request_site_customer_mismatch',
  'z02_selected_point_ambiguous', 'z02_site_not_found', 'z02_source_qualified_point_creation_required',
  'z02_source_reference_or_subtype_mismatch',
  'absent', 'unlisted'] as const
function positiveProjectionData(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object') return undefined
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  return descriptor && 'value' in descriptor ? descriptor.value : undefined
}
function positiveProjectionCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}
function positiveProjectionObject(value: unknown, booleanKeys: readonly string[], stateKeys: readonly string[], reasonKeys: readonly string[]) {
  const result: Record<string, string | boolean | null> = Object.create(null)
  for (const key of booleanKeys) {
    const data = positiveProjectionData(value, key)
    result[key] = typeof data === 'boolean' ? data : null
  }
  for (const [keys, allowlist] of [[stateKeys, positiveProjectionStates], [reasonKeys, positiveProjectionReasons]] as const) {
    for (const key of keys) {
      const data = positiveProjectionData(value, key)
      result[key] = typeof data === 'string' && (allowlist as readonly string[]).includes(data) ? data : 'unlisted'
    }
  }
  return result
}
// Classification only: exact persisted catch strings are reduced in SQL before
// stdout. An opaque catch object does not expose its lost SQLSTATE or cause.
const positiveEnqueueThrowClasses = [
  ['Det inkommande svaret saknar en aktiv requestsnapshot. Svaret måste granskas manuellt innan kunddata kan uppdateras.', 'active_request_snapshot_unavailable'],
  ['Operationssnapshot saknas. Kör den senaste OPS-migrationen innan inkommande svar appliceras.', 'original_snapshot_schema_unavailable'],
  ['Automationstabellen saknas. Kör migrationen för kundautomation först.', 'automation_job_schema_unavailable'],
  ['Operationssnapshot saknas. Kör den senaste OPS-migrationen innan extern kommunikation startas.', 'persisted_operation_snapshot_schema_unavailable'],
  ['[object Object]', 'opaque_object_string'],
] as const
const positiveEnqueueClasses = [...positiveEnqueueThrowClasses.map(([, category]) => category),
  'absent', 'unclassified', 'conflicting_evidence'] as const
function positiveEnqueueShape(value: unknown, keys: readonly string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getOwnPropertyNames(value).length !== keys.length
    || keys.some(key => !Object.getOwnPropertyDescriptor(value, key)
      || !('value' in Object.getOwnPropertyDescriptor(value, key)!))) throw Error('observation_shape_unavailable')
}
function positiveEnqueueFailureProjection(value: unknown) {
  positiveEnqueueShape(value, ['requestCount', 'requestClass', 'eventCount', 'copiesAgree', 'bins'])
  const requestCount = positiveProjectionData(value, 'requestCount')
  const requestClass = positiveProjectionData(value, 'requestClass')
  const eventCount = positiveProjectionCount(positiveProjectionData(value, 'eventCount'))
  const copiesAgree = positiveProjectionData(value, 'copiesAgree')
  if (requestCount !== 1 || typeof requestClass !== 'string'
    || !(positiveEnqueueClasses as readonly string[]).includes(requestClass)
    || eventCount === null || eventCount > 65
    || (eventCount === 0 ? copiesAgree !== null : typeof copiesAgree !== 'boolean')) throw Error('observation_shape_unavailable')
  if (eventCount === 65) return Object.assign(Object.create(null), {
    observed: false, reason: 'observation_unavailable', eventOverflow: true,
  })
  const inputBins = positiveProjectionData(value, 'bins')
  positiveEnqueueShape(inputBins, positiveEnqueueClasses)
  const bins: Record<string, number> = Object.create(null)
  let total = 0
  for (const category of positiveEnqueueClasses) {
    const count = positiveProjectionCount(positiveProjectionData(inputBins, category))
    if (count === null || count > 64) throw Error('observation_shape_unavailable')
    total += count; bins[category] = count
  }
  if (total !== eventCount || copiesAgree === true && bins.conflicting_evidence !== 0
    || copiesAgree === false && bins.conflicting_evidence === 0) throw Error('observation_shape_unavailable')
  const known = (positiveEnqueueThrowClasses as readonly (readonly [string, string])[]).some(([, category]) => category === requestClass)
  const classAgreement = eventCount > 0 && known && copiesAgree === true
    ? bins[requestClass] === eventCount : null
  return Object.assign(Object.create(null), {observed: true, eventCount, eventOverflow: false,
    requestClass, copiesAgree, classAgreement, bins})
}
type Z02ProjectionPhase = 'positive.pre606.public_projection' | 'wrong_grid.before_result_assertion'
  | 'mutation.reprocess.before_application_assertion'
function observeZ02EnqueueFailureProjection(value: unknown,
  phase: Z02ProjectionPhase = 'positive.pre606.public_projection'): void {
  const stage = phase === 'positive.pre606.public_projection' ? 'positive.pre606.enqueue_failure_classification' : phase
  const emit = (observation: unknown) => {
    try { console.info('Z02_NATIVE_ENQUEUE_FAILURE_CLASSIFICATION', JSON.stringify(observation)) } catch { /* Preserve assertion606 even if the logger fails. */ }
  }
  try {
    const result = positiveEnqueueFailureProjection(value)
    emit(Object.assign(Object.create(null), {stage}, result))
  } catch {
    emit(Object.assign(Object.create(null), {stage, observed: false, reason: 'observation_unavailable'}))
  }
}

// Separate finite metadata projection. Missing capability or untrusted shape
// never enters the legacy observer's error, count or string-classification path.
const positiveStructuredSqlStates = ['23502', '23503', '23505', '23514', '42501', '42P01', '42703', 'P0001', '22P02', '42883', 'unknown'] as const
const positiveStructuredPublicLabels = [...positiveEnqueueThrowClasses.slice(0, 4).map(([, category]) => category), 'unknown'] as const
const positiveStructuredEvidenceClasses = ['classified', 'missing_metadata', 'malformed_metadata', 'conflicting_copies'] as const
function positiveStructuredObject(value: unknown): object {
  // Check the trusted namespace before even a descriptor on the new outer key.
  if (typeof positiveStructuredNodeUtil.types?.isProxy !== 'function'
    || value === null || typeof value !== 'object'
    || positiveStructuredNodeUtil.types.isProxy(value) || Array.isArray(value)) throw Error('observation_shape_unavailable')
  return value
}
function positiveStructuredData(value: unknown, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(positiveStructuredObject(value), key)
  if (!descriptor || !('value' in descriptor)) throw Error('observation_shape_unavailable')
  return descriptor.value
}
function positiveStructuredShape(value: unknown, keys: readonly string[]): void {
  const object = positiveStructuredObject(value), names = Reflect.ownKeys(object)
  if (names.length !== keys.length || names.some(key => typeof key !== 'string' || !keys.includes(key))) throw Error('observation_shape_unavailable')
  for (const key of keys) positiveStructuredData(object, key)
}
function positiveStructuredBins(value: unknown, keys: readonly string[]) {
  positiveStructuredShape(value, keys)
  const bins: Record<string, number> = Object.create(null)
  let total = 0
  for (const key of keys) {
    const count = positiveProjectionCount(positiveStructuredData(value, key))
    if (count === null || count > 64) throw Error('observation_shape_unavailable')
    bins[key] = count; total += count
  }
  return {bins, total}
}
function positiveStructuredEnqueueFailureProjection(observation: unknown) {
  const value = positiveStructuredData(observation, 'enqueueFailureClassification')
  positiveStructuredShape(value, ['schemaVersion', 'requestCount', 'eventCount', 'eventOverflow', 'copiesAgree', 'evidenceBins', 'sqlStateBins', 'publicLabelBins'])
  const eventCount = positiveProjectionCount(positiveStructuredData(value, 'eventCount'))
  const copiesAgree = positiveStructuredData(value, 'copiesAgree')
  const eventOverflow = positiveStructuredData(value, 'eventOverflow')
  if (positiveStructuredData(value, 'schemaVersion') !== 1 || positiveStructuredData(value, 'requestCount') !== 1
    || eventCount === null || eventCount > 65 || typeof eventOverflow !== 'boolean'
    || (eventCount === 0 ? copiesAgree !== null : typeof copiesAgree !== 'boolean')) throw Error('observation_shape_unavailable')
  const evidenceInput = positiveStructuredData(value, 'evidenceBins')
  const sqlStateInput = positiveStructuredData(value, 'sqlStateBins')
  const publicLabelInput = positiveStructuredData(value, 'publicLabelBins')
  if (eventCount === 65) {
    if (!eventOverflow || evidenceInput !== null || sqlStateInput !== null || publicLabelInput !== null) throw Error('observation_shape_unavailable')
    return Object.assign(Object.create(null), {observed: false, reason: 'observation_unavailable', eventOverflow: true})
  }
  if (eventOverflow) throw Error('observation_shape_unavailable')
  const evidence = positiveStructuredBins(evidenceInput, positiveStructuredEvidenceClasses)
  const sqlState = positiveStructuredBins(sqlStateInput, positiveStructuredSqlStates)
  const publicLabel = positiveStructuredBins(publicLabelInput, positiveStructuredPublicLabels)
  if (evidence.total !== eventCount || sqlState.total !== evidence.bins.classified || publicLabel.total !== evidence.bins.classified
    || copiesAgree === true && evidence.bins.conflicting_copies !== 0
    || copiesAgree === false && evidence.bins.conflicting_copies === 0) throw Error('observation_shape_unavailable')
  return Object.assign(Object.create(null), {observed: true, schemaVersion: 1, requestCount: 1, eventCount,
    eventOverflow: false, copiesAgree, evidenceBins: evidence.bins, sqlStateBins: sqlState.bins, publicLabelBins: publicLabel.bins})
}
function observeZ02StructuredEnqueueFailureProjection(observation: unknown,
  phase: Z02ProjectionPhase = 'positive.pre606.public_projection'): void {
  const stage = phase === 'positive.pre606.public_projection' ? 'positive.pre606.enqueue_structured_classification' : phase
  const emit = (value: unknown) => {
    try { console.info('Z02_NATIVE_ENQUEUE_STRUCTURED_CLASSIFICATION', JSON.stringify(value)) } catch { /* Preserve the original native oracle. */ }
  }
  try {
    emit(Object.assign(Object.create(null), {stage}, positiveStructuredEnqueueFailureProjection(observation)))
  } catch {
    emit(Object.assign(Object.create(null), {stage, observed: false, reason: 'observation_unavailable'}))
  }
}

// Separate SDK-code evidence accompanies, never replaces, the three legacy labels.
const positiveSdkCodes = [
  '23502', '23503', '23505', '23514', '42501', '42P01', '42703', 'P0001', '22P02', '42883',
  '21000', '22023', 'XX000', 'P0002', 'P0003', '40001', '40P01',
  'PGRST116', 'PGRST200', 'PGRST201', 'PGRST202', 'PGRST203', 'PGRST204', 'PGRST205',
  'unlisted', 'unavailable',
] as const
function positiveSdkEnqueueProjection(value: unknown) {
  positiveStructuredShape(value, ['schemaVersion', 'requestCount', 'eventCount', 'eventOverflow', 'copiesAgree', 'evidenceBins', 'sdkCodeBins'])
  const count = positiveProjectionCount(positiveStructuredData(value, 'eventCount'))
  const copies = positiveStructuredData(value, 'copiesAgree')
  const overflow = positiveStructuredData(value, 'eventOverflow')
  if (positiveStructuredData(value, 'schemaVersion') !== 1 || positiveStructuredData(value, 'requestCount') !== 1
    || count === null || count > 65 || typeof overflow !== 'boolean'
    || (count === 0 ? copies !== null : typeof copies !== 'boolean')) throw Error('observation_shape_unavailable')
  if (count === 65) {
    if (!overflow || positiveStructuredData(value, 'evidenceBins') !== null || positiveStructuredData(value, 'sdkCodeBins') !== null)
      throw Error('observation_shape_unavailable')
    return Object.assign(Object.create(null), {observed: false, reason: 'observation_unavailable', eventOverflow: true})
  }
  if (overflow) throw Error('observation_shape_unavailable')
  const evidence = positiveStructuredBins(positiveStructuredData(value, 'evidenceBins'), positiveStructuredEvidenceClasses)
  const codes = positiveStructuredBins(positiveStructuredData(value, 'sdkCodeBins'), positiveSdkCodes)
  if (evidence.total !== count || codes.total !== evidence.bins.classified
    || copies === true && evidence.bins.conflicting_copies !== 0
    || copies === false && evidence.bins.conflicting_copies === 0) throw Error('observation_shape_unavailable')
  return Object.assign(Object.create(null), {observed: true, schemaVersion: 1, requestCount: 1,
    eventCount: count, eventOverflow: false, copiesAgree: copies, evidenceBins: evidence.bins, sdkCodeBins: codes.bins})
}
function observeZ02SdkEnqueueProjection(f: Fixture, original: Original, received: Pick<Received, 'id'>,
  phase: Z02ProjectionPhase = 'positive.pre606.public_projection', includeDiagnosticEpoch = false): void {
  const stage = phase === 'positive.pre606.public_projection' ? 'positive.pre606.enqueue_sdk_code_classification' : phase
  const emit = (value: unknown) => { try { console.info('Z02_NATIVE_ENQUEUE_SDK_CODE_CLASSIFICATION', JSON.stringify(value)) } catch { /* Never replace a native contract assertion. */ } }
  const emitDiagnostics = (value: unknown) => {
    try { console.info('Z02_NATIVE_ENQUEUE_SDK_SUPPLEMENT_CLASSIFICATION', JSON.stringify(value)) } catch { /* Fixed evidence only. */ }
  }
  try {
    if (process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321') throw Error('owned_local_only')
    const query = `WITH sdk_request AS (
      SELECT r.id FROM public.customer_info_requests r WHERE r.id=${literal(original.requestId)}
        AND r.company_id=${literal(f.companyId)} AND r.customer_id=${literal(f.customerId)}
        AND r.site_id=${literal(f.siteId)} AND r.ediel_message_id=${literal(original.originalZ01.id)}
        AND EXISTS (SELECT 1 FROM public.ediel_messages m WHERE m.id=${literal(received.id)}
          AND m.company_id=${literal(f.companyId)} AND m.direction='inbound' AND m.message_family='PRODAT' AND m.message_code='Z02'
          AND m.customer_id=${literal(f.customerId)} AND m.site_id=${literal(f.siteId)})
    ), sdk_events AS (
      SELECT e.payload,e.event_payload FROM public.ediel_message_events e
      WHERE e.company_id=${literal(f.companyId)} AND e.ediel_message_id=${literal(received.id)}
        AND e.event_type='manual_note' AND e.event_status='error'
        AND e.message='Z02 kunde inte starta canonical verifiering och applicerades inte.'
        AND jsonb_typeof(e.payload)='object' AND e.payload->>'customerInfoRequestId'=${literal(original.requestId)}
        AND EXISTS (SELECT 1 FROM sdk_request)
    ), sdk_metadata AS (
      SELECT payload,event_payload,payload IS NOT DISTINCT FROM event_payload AS copies_agree,
        payload->'enqueueFailureSdkEvidence' AS metadata,
        CASE WHEN jsonb_typeof(payload->'enqueueFailureSdkEvidence')='object' THEN
          (SELECT count(*) FROM jsonb_object_keys(payload->'enqueueFailureSdkEvidence'))=2
          AND (payload->'enqueueFailureSdkEvidence') ?& ARRAY['schemaVersion','sdkCode']::text[]
          AND payload->'enqueueFailureSdkEvidence'->'schemaVersion'='1'::jsonb
          AND jsonb_typeof(payload->'enqueueFailureSdkEvidence'->'sdkCode')='string'
          AND payload->'enqueueFailureSdkEvidence'->>'sdkCode' IN (${positiveSdkCodes.map(literal).join(',')})
          ELSE false END AS metadata_valid FROM sdk_events
    ), sdk_classified AS (
      SELECT copies_agree,metadata->>'sdkCode' AS sdk_code,
        CASE WHEN jsonb_typeof(event_payload) IS DISTINCT FROM 'object'
          OR event_payload->>'customerInfoRequestId' IS DISTINCT FROM ${literal(original.requestId)}
          OR payload IS DISTINCT FROM event_payload THEN 'conflicting_copies'
          WHEN NOT (payload ? 'enqueueFailureSdkEvidence') THEN 'missing_metadata'
          WHEN metadata_valid THEN 'classified' ELSE 'malformed_metadata' END AS category FROM sdk_metadata
    ) SELECT jsonb_build_object('schemaVersion',1,'requestCount',(SELECT count(*) FROM sdk_request),
      'eventCount',least(count(*),65),'eventOverflow',count(*)>=65,'copiesAgree',bool_and(copies_agree),
      'evidenceBins',CASE WHEN count(*)>=65 THEN NULL ELSE jsonb_build_object(${positiveStructuredEvidenceClasses.map(category =>
        `${literal(category)},count(*) FILTER (WHERE category=${literal(category)})`).join(',')}) END,
      'sdkCodeBins',CASE WHEN count(*)>=65 THEN NULL ELSE jsonb_build_object(${positiveSdkCodes.map(code =>
        `${literal(code)},count(*) FILTER (WHERE category='classified' AND sdk_code=${literal(code)})`).join(',')}) END)
      FROM sdk_classified`
    const stdout = execFileSync('psql', ['postgresql://postgres:postgres@127.0.0.1:54322/postgres', '-XAtq', '-v', 'ON_ERROR_STOP=1'],
      { input: includeDiagnosticEpoch ? buildZ02SdkDiagnosticQuery(query) : query, encoding: 'utf8', timeout: 10000, maxBuffer: 2_000_000, stdio: ['pipe', 'pipe', 'pipe'] })
    const value: unknown = JSON.parse(stdout.trim())
    if (includeDiagnosticEpoch) {
      positiveStructuredShape(value, ['legacySdk', 'diagnostics'])
      const legacySdk = positiveSdkEnqueueProjection(positiveStructuredData(value, 'legacySdk'))
      const diagnostics = positiveSdkDiagnosticProjection(positiveStructuredData(value, 'diagnostics'))
      emit(Object.assign(Object.create(null), {stage}, legacySdk))
      emitDiagnostics(Object.assign(Object.create(null), {stage}, diagnostics))
    } else {
      emit(Object.assign(Object.create(null), {stage}, positiveSdkEnqueueProjection(value)))
    }
  } catch {
    emit(Object.assign(Object.create(null), {stage, observed: false, reason: 'observation_unavailable'}))
    if (includeDiagnosticEpoch) emitDiagnostics(Object.assign(Object.create(null), {stage, observed: false, reason: 'observation_unavailable'}))
  }
}

function observeZ02PositiveProjection(f: Fixture, original: Original, received: Pick<Received, 'id'>,
  stage: Z02ProjectionPhase = 'positive.pre606.public_projection'): void {
  const emit = (value: unknown) => { try { console.info('Z02_NATIVE_POSITIVE_PROJECTION', JSON.stringify(value)) } catch { /* Diagnostic failure cannot replace the contract assertion. */ } }
  try {
    const state = (expression: string) => `CASE WHEN ${expression} IS NULL THEN 'absent'
      WHEN ${expression} IN (${positiveProjectionStates.map(literal).join(',')}) THEN ${expression} ELSE 'unlisted' END`
    const reason = (expression: string) => `CASE WHEN ${expression} IS NULL THEN 'absent'
      WHEN ${expression} IN (${positiveProjectionReasons.map(literal).join(',')}) THEN ${expression} ELSE 'unlisted' END`
    const boolean = (expression: string) => `CASE WHEN jsonb_typeof(${expression})='boolean' THEN ${expression}='true'::jsonb ELSE NULL END`
    const enqueueClass = (expression: string) => `CASE WHEN ${expression} IS NULL THEN 'absent'
      ${positiveEnqueueThrowClasses.map(([text, category]) => `WHEN ${expression} = ${literal(text)} THEN ${literal(category)}`).join('\n')}
      ELSE 'unclassified' END`
    const query = `WITH enqueue_request AS (
      SELECT r.blocker_code,r.blocker_reason FROM public.customer_info_requests r
      WHERE r.id=${literal(original.requestId)} AND r.company_id=${literal(f.companyId)}
        AND r.customer_id=${literal(f.customerId)} AND r.site_id=${literal(f.siteId)}
        AND r.ediel_message_id=${literal(original.originalZ01.id)}
        AND EXISTS (SELECT 1 FROM public.ediel_messages m WHERE m.id=${literal(received.id)}
          AND m.company_id=${literal(f.companyId)} AND m.direction='inbound' AND m.message_family='PRODAT' AND m.message_code='Z02'
          AND m.customer_id=${literal(f.customerId)} AND m.site_id=${literal(f.siteId)})
    ), enqueue_events AS (
      SELECT e.payload,e.event_payload FROM public.ediel_message_events e
      WHERE e.company_id=${literal(f.companyId)} AND e.ediel_message_id=${literal(received.id)}
        AND e.event_type='manual_note' AND e.event_status='error'
        AND e.message='Z02 kunde inte starta canonical verifiering och applicerades inte.'
        AND jsonb_typeof(e.payload)='object' AND e.payload->>'customerInfoRequestId'=${literal(original.requestId)}
        AND EXISTS (SELECT 1 FROM enqueue_request)
    ), enqueue_classified AS (
      SELECT payload IS NOT DISTINCT FROM event_payload AS copies_agree,
        CASE WHEN jsonb_typeof(event_payload) IS DISTINCT FROM 'object'
          OR event_payload->>'customerInfoRequestId' IS DISTINCT FROM ${literal(original.requestId)}
          OR payload IS DISTINCT FROM event_payload THEN 'conflicting_evidence'
          WHEN jsonb_typeof(payload->'error') IS DISTINCT FROM 'string' THEN 'unclassified'
          ELSE ${enqueueClass("payload->>'error'")} END AS category FROM enqueue_events
    ), enqueue_structured_metadata AS (
      SELECT payload,event_payload,payload IS NOT DISTINCT FROM event_payload AS copies_agree,
        payload->'enqueueFailureClassification' AS metadata,
        CASE WHEN jsonb_typeof(payload->'enqueueFailureClassification')='object' THEN
          (SELECT count(*) FROM jsonb_object_keys(payload->'enqueueFailureClassification'))=3
          AND (payload->'enqueueFailureClassification') ?& ARRAY['schemaVersion','sqlState','publicLabel']::text[]
          AND payload->'enqueueFailureClassification'->'schemaVersion'='1'::jsonb
          AND jsonb_typeof(payload->'enqueueFailureClassification'->'sqlState')='string'
          AND payload->'enqueueFailureClassification'->>'sqlState' IN (${positiveStructuredSqlStates.map(literal).join(',')})
          AND jsonb_typeof(payload->'enqueueFailureClassification'->'publicLabel')='string'
          AND payload->'enqueueFailureClassification'->>'publicLabel' IN (${positiveStructuredPublicLabels.map(literal).join(',')})
          ELSE false END AS metadata_valid FROM enqueue_events
    ), enqueue_structured AS (
      SELECT copies_agree,metadata->>'sqlState' AS sql_state,metadata->>'publicLabel' AS public_label,
        CASE WHEN jsonb_typeof(event_payload) IS DISTINCT FROM 'object'
          OR event_payload->>'customerInfoRequestId' IS DISTINCT FROM ${literal(original.requestId)}
          OR payload IS DISTINCT FROM event_payload THEN 'conflicting_copies'
          WHEN NOT (payload ? 'enqueueFailureClassification') THEN 'missing_metadata'
          WHEN metadata_valid THEN 'classified' ELSE 'malformed_metadata' END AS category FROM enqueue_structured_metadata
    ) SELECT jsonb_build_object(
      'message', (SELECT jsonb_build_object(
        'originalMatches', m.related_message_id IS NOT DISTINCT FROM ${literal(original.originalZ01.id)}::uuid,
        'pointMatches', m.metering_point_id IS NOT DISTINCT FROM ${literal(f.pointId)}::uuid,
        'customerMatches', m.customer_id IS NOT DISTINCT FROM ${literal(f.customerId)}::uuid,
        'siteMatches', m.site_id IS NOT DISTINCT FROM ${literal(f.siteId)}::uuid,
        'status', ${state('m.status')}, 'processingStatus', ${state('m.processing_status')},
        'assessmentReceipt', ${state("m.validation_report->'receivedSourceValidationEvidence'->>'status'")},
        'atomicProjection', ${boolean("m.parsed_payload->'canonicalCorrelation'->'atomic_core_apply'")})
        FROM public.ediel_messages m WHERE m.id=${literal(received.id)} AND m.company_id=${literal(f.companyId)}),
      'request', (SELECT jsonb_build_object('status', ${state('r.status')}, 'blockerCode', ${reason('r.blocker_code')},
        'originalMatches', r.ediel_message_id IS NOT DISTINCT FROM ${literal(original.originalZ01.id)}::uuid,
        'responseMatches', r.response_ediel_message_id IS NOT DISTINCT FROM ${literal(received.id)}::uuid,
        'pointMatches', r.metering_point_id IS NOT DISTINCT FROM ${literal(f.pointId)}::uuid)
        FROM public.customer_info_requests r WHERE r.id=${literal(original.requestId)} AND r.company_id=${literal(f.companyId)}),
      'jobCount', (SELECT count(*) FROM public.customer_operation_jobs j WHERE j.company_id=${literal(f.companyId)}
        AND j.job_type='apply_inbound_grid_owner_response' AND j.payload->>'ediel_message_id'=${literal(received.id)}),
      'jobs', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'status', ${state('j.status')}, 'reason', ${reason("coalesce(j.result->>'reason_code',j.result->>'reason')")},
        'correlation', ${state("j.result->>'z02_correlation_status'")},
        'payload', ${state("j.result->>'z02_payload_validation_status'")},
        'snapshot', ${state("j.result->>'z02_snapshot_freshness_status'")},
        'atomicApplied', ${boolean("j.result->'z02_atomic_core_applied'")},
        'coreOk', ${boolean("j.result->'z02_atomic_core'->'ok'")},
        'coreCode', ${reason("j.result->'z02_atomic_core'->>'code'")},
        'customerMatches', j.customer_id IS NOT DISTINCT FROM ${literal(f.customerId)}::uuid,
        'siteMatches', j.customer_site_id IS NOT DISTINCT FROM ${literal(f.siteId)}::uuid,
        'requestMatches', j.payload->>'customer_info_request_id' IS NOT DISTINCT FROM ${literal(original.requestId)},
        'originalMatches', j.result->'correlation'->>'originating_z01_message_id' IS NOT DISTINCT FROM ${literal(original.originalZ01.id)},
        'coreSourceMatches', j.result->'z02_atomic_core'->>'messageId' IS NOT DISTINCT FROM ${literal(received.id)},
        'coreRequestMatches', j.result->'z02_atomic_core'->>'requestId' IS NOT DISTINCT FROM ${literal(original.requestId)}
      ) ORDER BY j.created_at,j.id),'[]'::jsonb) FROM (SELECT j.id,j.created_at,j.status,j.result,j.customer_id,j.customer_site_id,j.payload FROM public.customer_operation_jobs j
        WHERE j.company_id=${literal(f.companyId)} AND j.job_type='apply_inbound_grid_owner_response'
          AND j.payload->>'ediel_message_id'=${literal(received.id)} ORDER BY j.created_at,j.id LIMIT 5) j),
      'enqueueFailure', jsonb_build_object(
        'requestCount', (SELECT count(*) FROM enqueue_request),
        'requestClass', coalesce((SELECT ${enqueueClass("CASE WHEN blocker_code='z02_processing_enqueue_failed' THEN blocker_reason END")}
          FROM enqueue_request), 'absent'),
        'eventCount', (SELECT least(count(*),65) FROM enqueue_classified),
        'copiesAgree', (SELECT bool_and(copies_agree) FROM enqueue_classified),
        'bins', (SELECT jsonb_build_object(${positiveEnqueueClasses.map(category =>
          `${literal(category)},least(count(*) FILTER (WHERE category=${literal(category)}),65)`).join(',')}) FROM enqueue_classified)),
      'enqueueFailureClassification', jsonb_build_object(
        'schemaVersion',1,'requestCount',(SELECT count(*) FROM enqueue_request),
        'eventCount',(SELECT least(count(*),65) FROM enqueue_structured),
        'eventOverflow',(SELECT count(*)>=65 FROM enqueue_structured),
        'copiesAgree',(SELECT bool_and(copies_agree) FROM enqueue_structured),
        'evidenceBins',(SELECT CASE WHEN count(*)>=65 THEN NULL ELSE jsonb_build_object(${positiveStructuredEvidenceClasses.map(category =>
          `${literal(category)},count(*) FILTER (WHERE category=${literal(category)})`).join(',')}) END FROM enqueue_structured),
        'sqlStateBins',(SELECT CASE WHEN count(*)>=65 THEN NULL ELSE jsonb_build_object(${positiveStructuredSqlStates.map(code =>
          `${literal(code)},count(*) FILTER (WHERE category='classified' AND sql_state=${literal(code)})`).join(',')}) END FROM enqueue_structured),
        'publicLabelBins',(SELECT CASE WHEN count(*)>=65 THEN NULL ELSE jsonb_build_object(${positiveStructuredPublicLabels.map(label =>
          `${literal(label)},count(*) FILTER (WHERE category='classified' AND public_label=${literal(label)})`).join(',')}) END FROM enqueue_structured)))`
    // Explicit pipes keep psql error text (including SQL identifiers) out of logs.
    if (process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321') throw Error('owned_local_only')
    const stdout = execFileSync('psql', ['postgresql://postgres:postgres@127.0.0.1:54322/postgres', '-XAtq', '-v', 'ON_ERROR_STOP=1'],
      { input: query, encoding: 'utf8', timeout: 10000, maxBuffer: 2_000_000, stdio: ['pipe', 'pipe', 'pipe'] })
    const observation: unknown = JSON.parse(stdout.trim())
    const jobCount = positiveProjectionCount(positiveProjectionData(observation, 'jobCount'))
    const rows = positiveProjectionData(observation, 'jobs')
    const rowCount = Array.isArray(rows) ? positiveProjectionCount(positiveProjectionData(rows, 'length')) : null
    if (jobCount === null || rowCount === null || rowCount !== Math.min(jobCount, 5)) throw Error('observation_shape_unavailable')
    const jobs = []
    for (let i = 0; i < rowCount; i++) jobs.push(positiveProjectionObject(positiveProjectionData(rows, `${i}`),
      ['atomicApplied', 'coreOk', 'customerMatches', 'siteMatches', 'requestMatches', 'originalMatches', 'coreSourceMatches', 'coreRequestMatches'],
      ['status', 'correlation', 'payload', 'snapshot'], ['reason', 'coreCode']))
    const output = Object.assign(Object.create(null), {stage, observed: true, jobCount, jobsTruncated: jobCount > 5,
      message: positiveProjectionObject(positiveProjectionData(observation, 'message'),
        ['originalMatches', 'pointMatches', 'customerMatches', 'siteMatches', 'atomicProjection'], ['status', 'processingStatus', 'assessmentReceipt'], []),
      request: positiveProjectionObject(positiveProjectionData(observation, 'request'),
        ['originalMatches', 'responseMatches', 'pointMatches'], ['status'], ['blockerCode']), jobs})
    emit(output)
    observeZ02EnqueueFailureProjection(positiveProjectionData(observation, 'enqueueFailure'), stage)
    observeZ02StructuredEnqueueFailureProjection(observation, stage)
  } catch {
    emit(Object.assign(Object.create(null), {stage, observed: false, reason: 'observation_unavailable'}))
    observeZ02EnqueueFailureProjection(undefined, stage)
    observeZ02StructuredEnqueueFailureProjection(undefined, stage)
  }
}


// New sibling epoch only. The retained 26 SDK bins and old decoder stay exact.
const positiveSdkSupplementCodes = [
  'empty_sdk_code', '57014', '55P03', 'PGRST000', 'PGRST001', 'PGRST002', '22001',
  'retained_sdk_code', 'other_unlisted', 'unavailable',
] as const
const positiveSdkDiagnosticPorts = [
  'original_snapshot_select', 'job_insert', 'duplicate_job_select', 'snapshot_upsert', 'unavailable',
] as const
function buildZ02SdkDiagnosticQuery(legacyQuery: string): string {
  const marker = ") SELECT jsonb_build_object('schemaVersion',1,'requestCount'"
  const boundary = legacyQuery.indexOf(marker)
  if (boundary < 0 || boundary !== legacyQuery.lastIndexOf(marker)) throw Error('observation_shape_unavailable')
  const ctes = legacyQuery.slice(0, boundary + 1)
  const legacySelect = legacyQuery.slice(boundary + 2)
  return `${ctes}, sdk_diagnostic_metadata AS (
    SELECT payload,event_payload,payload IS NOT DISTINCT FROM event_payload AS copies_agree,
      payload->'enqueueFailureSdkSupplementEvidence' AS sdk_metadata,
      payload->'enqueueFailurePortEvidence' AS port_metadata,
      CASE WHEN jsonb_typeof(payload->'enqueueFailureSdkSupplementEvidence')='object' THEN
        (SELECT count(*) FROM jsonb_object_keys(payload->'enqueueFailureSdkSupplementEvidence'))=2
        AND (payload->'enqueueFailureSdkSupplementEvidence') ?& ARRAY['schemaVersion','sdkCode']::text[]
        AND payload->'enqueueFailureSdkSupplementEvidence'->'schemaVersion'='1'::jsonb
        AND jsonb_typeof(payload->'enqueueFailureSdkSupplementEvidence'->'sdkCode')='string'
        AND payload->'enqueueFailureSdkSupplementEvidence'->>'sdkCode' IN (${positiveSdkSupplementCodes.map(literal).join(',')})
        ELSE false END AS sdk_valid,
      CASE WHEN jsonb_typeof(payload->'enqueueFailurePortEvidence')='object' THEN
        (SELECT count(*) FROM jsonb_object_keys(payload->'enqueueFailurePortEvidence'))=2
        AND (payload->'enqueueFailurePortEvidence') ?& ARRAY['schemaVersion','operationPort']::text[]
        AND payload->'enqueueFailurePortEvidence'->'schemaVersion'='1'::jsonb
        AND jsonb_typeof(payload->'enqueueFailurePortEvidence'->'operationPort')='string'
        AND payload->'enqueueFailurePortEvidence'->>'operationPort' IN (${positiveSdkDiagnosticPorts.map(literal).join(',')})
        ELSE false END AS port_valid FROM sdk_events
  ), sdk_diagnostic_classified AS (
    SELECT copies_agree,sdk_metadata->>'sdkCode' AS sdk_code,port_metadata->>'operationPort' AS operation_port,
      CASE WHEN jsonb_typeof(event_payload) IS DISTINCT FROM 'object'
        OR event_payload->>'customerInfoRequestId' IS DISTINCT FROM payload->>'customerInfoRequestId'
        OR payload IS DISTINCT FROM event_payload THEN 'conflicting_copies'
        WHEN NOT (payload ? 'enqueueFailureSdkSupplementEvidence') THEN 'missing_metadata'
        WHEN sdk_valid THEN 'classified' ELSE 'malformed_metadata' END AS sdk_category,
      CASE WHEN jsonb_typeof(event_payload) IS DISTINCT FROM 'object'
        OR event_payload->>'customerInfoRequestId' IS DISTINCT FROM payload->>'customerInfoRequestId'
        OR payload IS DISTINCT FROM event_payload THEN 'conflicting_copies'
        WHEN NOT (payload ? 'enqueueFailurePortEvidence') THEN 'missing_metadata'
        WHEN port_valid THEN 'classified' ELSE 'malformed_metadata' END AS port_category
      FROM sdk_diagnostic_metadata
  ) SELECT jsonb_build_object('legacySdk',(${legacySelect}),'diagnostics',(
    SELECT jsonb_build_object('schemaVersion',1,'requestCount',(SELECT count(*) FROM sdk_request),
      'eventCount',least(count(*),65),'eventOverflow',count(*)>=65,'copiesAgree',bool_and(copies_agree),
      'sdkEvidenceBins',CASE WHEN count(*)>=65 THEN NULL ELSE jsonb_build_object(${positiveStructuredEvidenceClasses.map(category =>
        `${literal(category)},count(*) FILTER (WHERE sdk_category=${literal(category)})`).join(',')}) END,
      'sdkCodeBins',CASE WHEN count(*)>=65 THEN NULL ELSE jsonb_build_object(${positiveSdkSupplementCodes.map(code =>
        `${literal(code)},count(*) FILTER (WHERE sdk_category='classified' AND sdk_code=${literal(code)})`).join(',')}) END,
      'portEvidenceBins',CASE WHEN count(*)>=65 THEN NULL ELSE jsonb_build_object(${positiveStructuredEvidenceClasses.map(category =>
        `${literal(category)},count(*) FILTER (WHERE port_category=${literal(category)})`).join(',')}) END,
      'operationPortBins',CASE WHEN count(*)>=65 THEN NULL ELSE jsonb_build_object(${positiveSdkDiagnosticPorts.map(port =>
        `${literal(port)},count(*) FILTER (WHERE port_category='classified' AND operation_port=${literal(port)})`).join(',')}) END)
      FROM sdk_diagnostic_classified))`
}
function positiveSdkDiagnosticProjection(value: unknown) {
  positiveStructuredShape(value, ['schemaVersion', 'requestCount', 'eventCount', 'eventOverflow', 'copiesAgree',
    'sdkEvidenceBins', 'sdkCodeBins', 'portEvidenceBins', 'operationPortBins'])
  const count = positiveProjectionCount(positiveStructuredData(value, 'eventCount'))
  const copies = positiveStructuredData(value, 'copiesAgree')
  const overflow = positiveStructuredData(value, 'eventOverflow')
  if (positiveStructuredData(value, 'schemaVersion') !== 1 || positiveStructuredData(value, 'requestCount') !== 1
    || count === null || count > 65 || typeof overflow !== 'boolean'
    || (count === 0 ? copies !== null : typeof copies !== 'boolean')) throw Error('observation_shape_unavailable')
  if (count === 65) {
    if (!overflow || ['sdkEvidenceBins', 'sdkCodeBins', 'portEvidenceBins', 'operationPortBins']
      .some(key => positiveStructuredData(value, key) !== null)) throw Error('observation_shape_unavailable')
    return Object.assign(Object.create(null), {observed: false, reason: 'observation_unavailable', eventOverflow: true})
  }
  if (overflow) throw Error('observation_shape_unavailable')
  const sdkEvidence = positiveStructuredBins(positiveStructuredData(value, 'sdkEvidenceBins'), positiveStructuredEvidenceClasses)
  const codes = positiveStructuredBins(positiveStructuredData(value, 'sdkCodeBins'), positiveSdkSupplementCodes)
  const portEvidence = positiveStructuredBins(positiveStructuredData(value, 'portEvidenceBins'), positiveStructuredEvidenceClasses)
  const ports = positiveStructuredBins(positiveStructuredData(value, 'operationPortBins'), positiveSdkDiagnosticPorts)
  if (sdkEvidence.total !== count || portEvidence.total !== count
    || codes.total !== sdkEvidence.bins.classified || ports.total !== portEvidence.bins.classified
    || copies === true && (sdkEvidence.bins.conflicting_copies !== 0 || portEvidence.bins.conflicting_copies !== 0)
    || copies === false && (sdkEvidence.bins.conflicting_copies === 0 || portEvidence.bins.conflicting_copies === 0))
    throw Error('observation_shape_unavailable')
  return Object.assign(Object.create(null), {observed: true, schemaVersion: 1, requestCount: 1,
    eventCount: count, eventOverflow: false, copiesAgree: copies, sdkEvidenceBins: sdkEvidence.bins,
    sdkCodeBins: codes.bins, portEvidenceBins: portEvidence.bins, operationPortBins: ports.bins})
}

export { observeZ02PositiveProjection, observeZ02SdkEnqueueProjection }


// Test-only transparent callback observation of the actual SDK failure already
// reported by the runtime. Never inspect message/details/hint, await a query,
// change a response/error, persist new authority, or replace the native oracle.
const nativeJobInsertSqlStates = [
  '08000', '08001', '08003', '08004', '08006', '08P01', '0A000', '21000',
  '22001', '22003', '22007', '22008', '22012', '22023', '22P02',
  '23001', '23502', '23503', '23505', '23514', '23P01',
  '25006', '25P02', '40001', '40P01', '42501', '42601', '42701', '42702',
  '42703', '42704', '42804', '42883', '42P01', '42P02', '42P10',
  '53000', '53100', '53200', '53300', '53400', '54000', '54001', '54011',
  '55P03', '57014', '57P01', '57P02', '57P03', 'P0001', 'P0002', 'P0003', 'XX000',
] as const
export function nativeZ02JobInsertSqlState(error: unknown): string {
  try {
    if (typeof positiveStructuredNodeUtil.types?.isProxy !== 'function'
      || error === null || typeof error !== 'object'
      || positiveStructuredNodeUtil.types.isProxy(error) || Array.isArray(error)) return 'unavailable'
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code')
    const code = descriptor && 'value' in descriptor ? descriptor.value : undefined
    return typeof code === 'string' && (nativeJobInsertSqlStates as readonly string[]).includes(code) ? code : 'unavailable'
  } catch { return 'unavailable' }
}
export function createNativeZ02JobInsertProbe(report: (value: {
  schemaVersion: 1; operationPort: 'job_insert'; sqlState: string
}) => void) {
  // One first error per test, shared across all factories within that test.
  let observed = false
  return (original: import('@/lib/onboarding/z02EnqueueFailureClassification').Z02EnqueueDiagnosticPortObserver | undefined):
    import('@/lib/onboarding/z02EnqueueFailureClassification').Z02EnqueueDiagnosticPortObserver | undefined => {
    if (!original) return undefined
    return (port, error) => {
      try { original(port, error) } finally {
        if (!observed && port === 'job_insert') {
          observed = true
          try { report({ schemaVersion: 1, operationPort: 'job_insert', sqlState: nativeZ02JobInsertSqlState(error) }) }
          catch { /* Preserve the original callback/result even if logging fails. */ }
        }
      }
    }
  }
}
