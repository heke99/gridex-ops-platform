// Native prospective catalog component only. Both whole Z02 contracts remain
// unapproved until own Z01, public ingress, atomic effects, ACK and replay run.
// No finite registry/SQL port and no admission, snapshot or accepted fact seed.
import { describe, expect, it } from 'vitest'
import { resolveSupplierDataBirthProfile } from '@/lib/inbound-mail/supplierDataBirthProfile'
import { supabaseService } from '@/lib/supabase/service'
import { raw, line, characteristic, type Parts } from '../__tests__/fixtures/prodat-register'
import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import * as positiveStructuredNodeUtil from 'node:util'
import { afterEach, beforeEach, vi } from 'vitest'
import { getEdielMessageById } from '@/lib/ediel/db'
import { processCustomerOperationJobs } from '@/lib/customer-operations/automation'
import { processInboundEdielMessage } from '@/lib/ediel/flows/inboundProcessing'
import { resolveCanonicalRuntimeDecisionWithRegistry } from '@/lib/ediel/core/runtimeDecision'
import { validateRulebookMessageWithRegistry } from '@/lib/ediel/rulebook/validator'
import { validateCanonicalPolicyFields } from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import { tokenizeEdifact, segmentComposite, segmentElementCount } from '@/lib/ediel/core/edifactTokenizer'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { prodatNowDate203 } from '@/lib/ediel/prodat/render/dates'
import { originalAckPartyIdentities } from '@/lib/ediel/core/originalAckPartyIdentities'
import { listBusinessAckMessagesForSource } from '@/lib/ediel/inbound/businessAckMessages'
import { sendOutboxItem } from '@/lib/ediel/outbox/sendOutboxItem'
import { edielSmtpConfig } from '@/lib/ediel/mailReadiness'
import { matchOutboundRequestForInbound, matchMeteringPointForInbound } from '@/lib/inbound-mail/inboundMatcher'
import { resolveInboundTenantFromIdentifiers, inboundLegalReceiverEdielId } from '@/lib/ediel/tenant/resolveInboundTenant'
import { resolveCanonicalTenantEdielIdentityWithEvidence } from '@/lib/ediel/tenant/tenantEdielIdentity'
import { requireRegistryDispatchSource } from '@/lib/actor-registry/registryMarketSource'
import { createInboundEdielMessage } from '@/lib/inbound-mail/inboundStatusUpdater'
import { nativeSql as sql, literal } from './helpers/ediel-normal-switch-native-fixture'
import { seedOriginalMailboxNative } from './helpers/originalMailboxNative'
import { createZ01SupplierNativeFixture, originateZ01SupplierRequest, receiveZ01SupplierReply,
  ensureZ01SupplierKnownWrongGridArea } from './helpers/ediel-z02-supplier-native-fixture'
import { fetchReceivedZ02EndUserAddressContext, redeemReceivedZ02EndUserAddressContext } from '@/lib/ediel/prodat/receivedZ02EndUserAddressContext'
import { externalZ02Reply, type ExternalZ02Overrides, type Z02OmittableField } from './helpers/ediel-z02-supplier-native-wire'

const receivedAt = '2026-10-06T12:00:00.000Z'
const object = (number: string, point: string, reason: string): Parts[] => [
  line(number, point, undefined, '9'), ...characteristic('Z13', reason),
]
const wire = (reason: string, multiple = false) => raw([
  ...object('1', '735123456789012345', reason),
  ...(multiple ? object('2', '735123456789012346', reason) : []),
], 'Z02')

describe('native Z02 prospective catalog evidence (not whole acceptance)', () => {
  it.each(['Z22', 'Z23'])('pins real current %s catalog witnesses without replacing admission', async reason => {
    const result = await resolveSupplierDataBirthProfile({ rawPayload: wire(reason, true), receivedAt })
    expect(result).not.toBeNull()
    if (!result) throw new Error('native_z02_catalog_birth_missing')
    expect(Object.keys(result).sort()).toEqual([
      'canonical_rule_pack_id', 'rule_pack_checksum', 'rule_pack_snapshot',
      'rule_profile_key', 'rule_profile_version', 'rule_profile_version_id',
    ])
    const actual = await supabaseService.rpc('resolve_canonical_ediel_rule_pack_with_witness_v1', {
      p_market: 'electricity', p_family: 'PRODAT', p_message_code: 'Z02',
      p_transaction_subtype: reason === 'Z22' ? 'L' : 'LK', p_direction: 'inbound',
      p_business_date: '2026-10-06',
    })
    if (actual.error) throw actual.error
    const witnesses = Array.isArray(actual.data) ? actual.data : actual.data ? [actual.data] : []
    expect(witnesses).toHaveLength(1)
    const witness = witnesses[0] as Record<string, unknown>
    expect(result).toEqual({ canonical_rule_pack_id: witness.rule_pack_id,
      rule_profile_key: witness.profile_key, rule_profile_version_id: witness.message_profile_id,
      rule_profile_version: witness.original_version, rule_pack_checksum: witness.source_hash,
      rule_pack_snapshot: { ...(witness.original_snapshot as Record<string, unknown>),
        profileKey: witness.profile_key, profileVersionId: witness.message_profile_id,
        version: witness.original_version, checksum: witness.source_hash },
    })
    const [profile, pack] = await Promise.all([
      supabaseService.from('ediel_message_profiles').select('id,rule_pack_id,profile_key,message_code,is_enabled')
        .eq('id', result.rule_profile_version_id).single(),
      supabaseService.from('ediel_rule_packs').select('id,source_hash,guide_version,guide_revision')
        .eq('id', result.canonical_rule_pack_id).single(),
    ])
    if (profile.error) throw profile.error
    if (pack.error) throw pack.error
    expect(profile.data).toMatchObject({ id: result.rule_profile_version_id,
      rule_pack_id: result.canonical_rule_pack_id, profile_key: result.rule_profile_key,
      message_code: 'Z02', is_enabled: true })
    expect(pack.data).toMatchObject({ id: result.canonical_rule_pack_id, source_hash: result.rule_pack_checksum })
    expect(result.rule_profile_version).toBe(`${pack.data.guide_version}:r${pack.data.guide_revision}`)
    expect(result.rule_pack_snapshot).toMatchObject({
      profileKey: result.rule_profile_key, profileVersionId: result.rule_profile_version_id,
      version: result.rule_profile_version, checksum: result.rule_pack_checksum,
      rulePack: { id: result.canonical_rule_pack_id },
      messageProfile: { id: result.rule_profile_version_id },
    })
    expect(result.rule_pack_snapshot.guideSources.length).toBeGreaterThan(0)
  })

  it('refuses mixed physical subtype rather than borrowing another object', async () => {
    const rawPayload = raw([...object('1', '735123456789012345', 'Z22'),
      ...object('2', '735123456789012346', 'Z23')], 'Z02')
    expect(await resolveSupplierDataBirthProfile({ rawPayload, receivedAt })).toBeNull()
  })

  it('refuses Z02 register repetition even when both reasons agree', async () => {
    const rawPayload = raw([
      line('1', '735123456789012345', '1', '9'), ...characteristic('Z13', 'Z22'),
      line('2', '735123456789012345', '2', '9'), ...characteristic('Z13', 'Z22'),
    ], 'Z02')
    expect(await resolveSupplierDataBirthProfile({ rawPayload, receivedAt })).toBeNull()
  })

  it('refuses foreign application reference as physical input', async () => {
    expect(await resolveSupplierDataBirthProfile({
      rawPayload: wire('Z22').replace('23-DDQ-PRODAT', '23-DDQ-OTHER'), receivedAt,
    })).toBeNull()
  })
})

// Whole-contract PROPOSALS: real prospective signed-source declarations are
// GIVEN, SMTP/counterparty bytes are synthetic external ports. Every catalog,
// reception, assessment, atomic application, worker and ACK consumer stays real.
// No private accepted facts, fabricated assessments or readiness flags. A failed
// genuine Z01 producer stops the case: its Z02 and later assertions are NOT REACHED.
const smtp = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: smtp.send }) } }))
beforeEach(() => {
  vi.stubEnv('EDIEL_SHARED_MAILBOX_ADDRESS', 'synthetic@example.invalid')
  vi.stubEnv('EDIEL_APP_DKIM_ENABLED', 'false')
  vi.stubEnv('EMAIL_PROVIDER', 'resend'); vi.stubEnv('EDIEL_EMAIL_PROVIDER', 'strato')
  vi.stubEnv('EDIEL_SMTP_FROM', 'synthetic@example.invalid'); vi.stubEnv('EDIEL_SMTP_USER', 'synthetic@example.invalid')
  vi.stubEnv('EDIEL_SMTP_PASS', 'synthetic-only')
  vi.stubEnv('GRIDEX_CUSTOMER_DATA_EDIEL_ENVIRONMENT', 'test')
  smtp.send.mockReset()
})
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })
const provider = (email: string) => smtp.send.mockImplementation(async () => ({ accepted: [email], rejected: [],
  messageId: `<synthetic-${randomUUID()}@example.invalid>`, response: '250 explicitly synthetic SMTP acceptance' }))
type Fixture = Awaited<ReturnType<typeof createZ01SupplierNativeFixture>>
type Original = Awaited<ReturnType<typeof originateZ01SupplierRequest>>
type Received = Awaited<ReturnType<typeof receiveZ01SupplierReply>>
type Row = Record<string, unknown>
const hash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')
const refs = () => ({ interchangeReference: randomUUID().replaceAll('-', '').slice(0, 14),
  messageReference: randomUUID().replaceAll('-', '').slice(0, 14) })
const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
// Diagnostic-only: one original operation, fixed stage, no private source facts.
type ObservedZ02NativeStage =
  | 'control.namespace.identity'
  | 'control.namespace.registry'
  | 'control.mail.birth'
  | 'control.message.initial-read'
  | 'control.runtime.initial'
  | 'control.message.source-read'
  | 'control.address.fetch'
  | 'negative.mail.birth'
  | 'negative.message.read'
  | 'negative.source-basis.rpc'
  | 'negative.address.fetch'
  | 'negative.runtime.initial'
  | 'negative.inbound.process'
  | 'negative.business-ack.list'
  | 'control.message.reread'
  | 'control.address.reread'
  | 'control.runtime.reread'
  | 'control.registry.reread'

async function observeZ02NativeOperation<T>(observedStage: ObservedZ02NativeStage, operation: () => PromiseLike<T>): Promise<T> {
  try { return await operation() }
  catch (error) {
    try {
      const code = error && typeof error === 'object' ? Object.getOwnPropertyDescriptor(error, 'code')?.value : undefined
      const message = error && typeof error === 'object' ? Object.getOwnPropertyDescriptor(error, 'message')?.value : undefined
      console.error('Z02_NATIVE_OPERATION_FAILURE', JSON.stringify({
        observedStage,
        ...(typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? { sqlstate: code } : {}),
        historicalRulePackBasisUnavailable: message === 'ediel_historical_rule_pack_basis_unavailable',
      }))
    } finally { throw error }
  }
}
async function sent(variant: 'L' | 'LK') {
  const f = await createZ01SupplierNativeFixture(variant, provider)
  vi.stubEnv('GRIDEX_AUTOMATION_USER_ID', f.actorUserId)
  const original = await originateZ01SupplierRequest(f)
  expect(original.sendResult.status).toBe('sent')
  expect(original.originalZ01).toMatchObject({ company_id: f.companyId, direction: 'outbound', environment: 'test',
    message_family: 'PRODAT', message_code: 'Z01', immutable_payload_hash: hash(original.originalZ01.raw_payload!) })
  expect(original.wire).toMatchObject({ subtype: variant, reason: variant === 'L' ? 'Z22' : 'Z23',
    point: f.external, identityAgency: '9', customerIdentity: f.customerIdentity, gridAreaCode: f.gridAreaCode })
  expect(original.wire.envelope.applicationReference).toBe('23-DDQ-PRODAT')
  expect(sql<number>(`SELECT to_jsonb(count(*)) FROM gridex_ediel_transport.attempts
    WHERE company_id=${literal(f.companyId)} AND message_id=${literal(original.originalZ01.id)}
    AND classification='accepted' AND binding->>'originalHash'=${literal(hash(original.originalZ01.raw_payload!))}`)).toBe(1)
  return { f, original }
}
function reply(f: Fixture, original: Original, overrides: ExternalZ02Overrides = {}, omitFields: readonly Z02OmittableField[] = [],
  references: ReturnType<typeof refs> & { documentReference?: string; documentMinute?: string; createdAt?: Date } = refs()) {
  return externalZ02Reply({ source: { rawPayload: original.originalZ01.raw_payload! }, ...references,
    documentReference: references.documentReference ?? `Z02-${randomUUID().slice(0, 8)}`,
    documentMinute: references.documentMinute ?? prodatNowDate203(), measurementMethod: 'Z04',
    customerAddress: f.customerAddress, installationAddress: f.installationAddress, overrides, omitFields })
}
function frozen(id: string) {
  return sql(`SELECT jsonb_build_object('id',m.id,'raw',m.raw_payload,'hash',m.immutable_payload_hash,
    'renderedAt',m.immutable_rendered_at,'direction',m.direction,'company',m.company_id,'environment',m.environment,
    'receipt',m.message_received_at,'canonical',jsonb_build_object('canonical_rule_pack_id',m.canonical_rule_pack_id,
      'rule_profile_key',m.rule_profile_key,'rule_profile_version_id',m.rule_profile_version_id,'rule_profile_version',m.rule_profile_version,
      'rule_pack_checksum',m.rule_pack_checksum,'rule_pack_snapshot',m.rule_pack_snapshot),
    'executionContext',m.execution_context_snapshot,
    'inboundContext',(SELECT to_jsonb(r) FROM gridex_ediel_inbound_context.receipts r WHERE r.source_message_id=m.id),
    'sourceRules',(SELECT to_jsonb(r) FROM gridex_ediel_source_rules.receipts r WHERE r.source_message_id=m.id),
    'source',(SELECT to_jsonb(s) FROM gridex_received_sources.sources s WHERE s.source_message_id=m.id))
    FROM public.ediel_messages m WHERE m.id=${literal(id)}`)
}
function request(f: Fixture, original: Original) {
  return sql<Row>(`SELECT to_jsonb(r) FROM public.customer_info_requests r
    WHERE id=${literal(original.requestId)} AND company_id=${literal(f.companyId)}`)
}
function applications(f: Fixture, original: Original) {
  return sql<Row[]>(`SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.source_message_id),'[]')
    FROM gridex_received_sources.z02_core_applications a WHERE company_id=${literal(f.companyId)} AND request_id=${literal(original.requestId)}`)
}
function supply(f: Fixture) {
  return sql(`SELECT jsonb_build_object(
    'periods',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]') FROM public.customer_supply_periods p WHERE company_id=${literal(f.companyId)}),
    'contracts',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'status',status,'startsAt',starts_at) ORDER BY id),'[]') FROM public.customer_contracts WHERE company_id=${literal(f.companyId)}),
    'customers',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'activatedAt',activated_at) ORDER BY id),'[]') FROM public.customers WHERE company_id=${literal(f.companyId)}),
    'confirmations',(SELECT count(*) FROM public.supplier_switch_requests WHERE company_id=${literal(f.companyId)}
      AND (confirmed_start_date IS NOT NULL OR status IN ('confirmed','active'))))`)
}
function protectedEffects(f: Fixture, original: Original) {
  // Operational rejection/status/audit may be recorded. Verified business
  // payload, linked source, customer/site/point rows and permission/supply facts
  // cannot be replaced by a refused Z02.
  return sql(`SELECT jsonb_build_object(
    'customers',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY id),'[]') FROM public.customers r WHERE company_id=${literal(f.companyId)}),
    'sites',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY id),'[]') FROM public.customer_sites r WHERE company_id=${literal(f.companyId)}),
    'points',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY id),'[]') FROM public.metering_points r WHERE company_id=${literal(f.companyId)}),
    'permissions',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY id),'[]') FROM public.metering_permissions r WHERE company_id=${literal(f.companyId)}),
    'verifiedRequests',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'company',company_id,'customer',customer_id,'site',site_id,
      'point',metering_point_id,'original',ediel_message_id,'response',response_ediel_message_id,'verified',verified_payload) ORDER BY id),'[]')
      FROM public.customer_info_requests WHERE company_id=${literal(f.companyId)}),
    'dataResponses',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'response',response_payload) ORDER BY id),'[]')
      FROM public.grid_owner_data_requests WHERE company_id=${literal(f.companyId)}),
    'applications',${literal(applications(f, original))}::jsonb,'supply',${literal(supply(f))}::jsonb)`)
}
function assertRefusedEffects(f: Fixture, original: Original, before: unknown, sealed: unknown) {
  expect(protectedEffects(f, original)).toEqual(before)
  expect(applications(f, original)).toEqual([])
  expect(request(f, original).response_ediel_message_id).toBeNull()
  expect(frozen(original.originalZ01.id)).toEqual(sealed)
}
async function validateIncoming(f: Fixture, rawPayload: string) {
  return validateRulebookMessageWithRegistry({ family: 'PRODAT', code: 'Z02', rawPayload, companyId: f.companyId,
    direction: 'inbound', environment: 'test', mode: 'parse' })
}
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
function observeZ02EnqueueFailureProjection(value: unknown): void {
  const stage = 'positive.pre606.enqueue_failure_classification'
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
function observeZ02StructuredEnqueueFailureProjection(observation: unknown): void {
  const stage = 'positive.pre606.enqueue_structured_classification'
  const emit = (value: unknown) => {
    try { console.info('Z02_NATIVE_ENQUEUE_STRUCTURED_CLASSIFICATION', JSON.stringify(value)) } catch { /* Preserve the original native oracle. */ }
  }
  try {
    emit(Object.assign(Object.create(null), {stage}, positiveStructuredEnqueueFailureProjection(observation)))
  } catch {
    emit(Object.assign(Object.create(null), {stage, observed: false, reason: 'observation_unavailable'}))
  }
}

function observeZ02PositiveProjection(f: Fixture, original: Original, received: Received): void {
  const stage = 'positive.pre606.public_projection'
  const emit = (value: unknown) => { try { console.info('Z02_NATIVE_POSITIVE_PROJECTION', JSON.stringify(value)) } catch { /* Diagnostic failure cannot replace assertion606. */ } }
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
    observeZ02EnqueueFailureProjection(positiveProjectionData(observation, 'enqueueFailure'))
    observeZ02StructuredEnqueueFailureProjection(observation)
  } catch {
    emit(Object.assign(Object.create(null), {stage, observed: false, reason: 'observation_unavailable'}))
    observeZ02EnqueueFailureProjection(undefined)
    observeZ02StructuredEnqueueFailureProjection(undefined)
  }
}

async function acceptedPhysical(f: Fixture, received: Received) {
  const decision = await resolveCanonicalRuntimeDecisionWithRegistry(received.message, { actorUserId: f.actorUserId })
  const actual = JSON.stringify({ report: received.message.validation_report, decision,
    responseJobs: received.inboundResponseJobsAfter, result: received.inboundResponseResult })
  expect(received.message.validation_report, actual).toMatchObject({ syntaxDecision: 'accepted', applicationDecision: 'accepted', functionalDecision: 'accepted' })
  expect(decision.syntaxDecision, actual).toBe('accepted')
  expect(decision.applicationDecision, actual).toBe('accepted')
  expect(decision.functionalDecision, actual).toBe('accepted')
  expect(decision.issues.filter(i => i.severity === 'error'), actual).toEqual([])
  expect(received.message).toMatchObject({ company_id: f.companyId, direction: 'inbound', environment: 'test',
    message_family: 'PRODAT', message_code: 'Z02', immutable_payload_hash: hash(received.message.raw_payload!) })
  return decision
}
/** A thin composition of existing public mail/parser/match/reception ports.
 * Staging is required for first-call actor/environment negatives, which the
 * unchanged all-in-one fixture consumer cannot expose. No source is private-seeded.
 * A null birth is retained with the actual SQL warning; arbitrary throws fail.
 */
async function stage(f: Fixture, rawPayload: string, environment: 'test' | 'production' = 'test') {
  const mailbox = await seedOriginalMailboxNative(sql, literal, { companyId: f.companyId, environment, raw: rawPayload,
    smtpFrom: edielSmtpConfig().from, senderEmail: 'recipient@example.invalid' })
  const parsed = mailbox.parsed
  const [match, pointMatch] = await Promise.all([
    matchOutboundRequestForInbound({ companyId: f.companyId, parsed, inboundEmailMessageId: mailbox.inboundEmailMessageId, parseResultId: mailbox.parseResultId }),
    matchMeteringPointForInbound({ companyId: f.companyId, parsed, inboundEmailMessageId: mailbox.inboundEmailMessageId, parseResultId: mailbox.parseResultId }),
  ])
  const tenant = await resolveInboundTenantFromIdentifiers({ mailboxCompanyId: f.companyId, mailboxId: mailbox.mailboxId,
    environment, senderEdielId: parsed.senderEdielId, senderSubaddress: parsed.senderSubAddress,
    receiverEdielId: parsed.receiverEdielId, receiverSubaddress: parsed.receiverSubAddress,
    marketActorEdielId: inboundLegalReceiverEdielId(rawPayload, parsed.receiverEdielId), applicationReference: parsed.applicationReference,
    messageFamily: parsed.messageFamily, messageCode: parsed.messageCode, referenceCandidates: Object.values(parsed.references).flat() })
  const warn = vi.spyOn(console, 'warn')
  try {
    const id = await createInboundEdielMessage({ companyId: f.companyId, actorUserId: f.actorUserId, environment,
      inboundEmailMessageId: mailbox.inboundEmailMessageId, parseResultId: mailbox.parseResultId, parsed,
      outboundMatch: match, meteringPointMatch: pointMatch, tenantResolution: tenant })
    const birthErrors = warn.mock.calls.filter(c => c[0] === '[inbound-mail] Kunde inte skapa/uppdatera inbound ediel_message').map(c => record(c[1]))
    return { id, mailbox, match, pointMatch, tenant, birthErrors }
  } finally { warn.mockRestore() }
}
async function actualNamespaceBaseline(f: Fixture, original: Original, rawPayload: string) {
  const supplier = await observeZ02NativeOperation('control.namespace.identity', () => resolveCanonicalTenantEdielIdentityWithEvidence({ companyId: f.companyId, environment: 'test', requireExactCounts: true }))
  expect(supplier.identity).toMatchObject({ companyId: f.companyId, environment: 'test',
    legalEdielId: original.wire.parties.legalSender.id, transportEdielId: original.wire.envelope.sender })
  expect(supplier.identity.roleCodes).toContain('electricity_supplier')
  const dso = await observeZ02NativeOperation('control.namespace.registry', () => requireRegistryDispatchSource({ companyId: f.companyId, communicationRouteId: f.z01RouteId,
    routeProfileId: f.z01RouteProfileId, environment: 'test', messageFamily: 'PRODAT', applicationReference: '23-DDQ-PRODAT' }))
  expect(dso).toMatchObject({ status: 'source_qualified', market: 'EL', legalEdielId: original.wire.parties.legalReceiver.id,
    wire: { environment: 'test', interchangePartyId: original.wire.envelope.receiver } })
  expect(dso.roles).toContain('grid_owner')
  const baseline = await observeZ02NativeOperation('control.mail.birth', () => stage(f, rawPayload))
  expect(baseline.tenant).toMatchObject({ status: 'resolved', companyId: f.companyId })
  expect(baseline.id, JSON.stringify(baseline)).not.toBeNull()
  expect(baseline.birthErrors).toEqual([])
  const row = await observeZ02NativeOperation('control.message.initial-read', () => getEdielMessageById(baseline.id!))
  expect(row).not.toBeNull()
  const decision = await observeZ02NativeOperation('control.runtime.initial', () => resolveCanonicalRuntimeDecisionWithRegistry(row!, { actorUserId: f.actorUserId }))
  expect([decision.syntaxDecision, decision.applicationDecision, decision.functionalDecision], JSON.stringify(decision)).toEqual(['accepted', 'accepted', 'accepted'])
  expect(sql<Row>(`SELECT to_jsonb(r) FROM gridex_ediel_inbound_context.receipts r WHERE source_message_id=${literal(baseline.id)}`))
    .toMatchObject({ status: 'ready', reason: null, company_id: f.companyId, environment: 'test', payload_sha256: hash(rawPayload) })
  // This genuine source is staged but never business-applied. Its ready legal
  // context does not seed an accepted assessment or authorize another message.
  return { supplier, dso, baseline }
}
/** The real fresh READ and current namespaces qualify the control before and
 * after a negative; NULL alone never establishes its physical cause. */
async function sourceControl(f: Fixture, original: Original, rawPayload: string) {
  const namespace = await actualNamespaceBaseline(f, original, rawPayload)
  const row = (await observeZ02NativeOperation('control.message.source-read', () => getEdielMessageById(namespace.baseline.id!)))!
  const context = await observeZ02NativeOperation('control.address.fetch', () => fetchReceivedZ02EndUserAddressContext({ message: row, actorUserId: f.actorUserId }))
  expect(context).toBeDefined()
  const facts = redeemReceivedZ02EndUserAddressContext({ message: row, context: context! })
  expect(facts).toEqual([expect.objectContaining({ meteringPointId: f.external, identityAgency: original.wire.identityAgency,
    availability: 'available', endUser: f.customerIdentity, source: { kind: 'received_z01', companyId: f.companyId, originalMessageId: original.originalZ01.id,
      originalPayloadHash: hash(original.originalZ01.raw_payload!), requestId: original.requestId, snapshotId: original.snapshot!.id } })])
  return { ...namespace, row, facts, rawPayload, bytes: frozen(row.id), originalBytes: frozen(original.originalZ01.id) }
}
async function rereadControl(f: Fixture, original: Original, control: Awaited<ReturnType<typeof sourceControl>>) {
  const row = (await observeZ02NativeOperation('control.message.reread', () => getEdielMessageById(control.row.id)))!
  const context = await observeZ02NativeOperation('control.address.reread', () => fetchReceivedZ02EndUserAddressContext({ message: row, actorUserId: f.actorUserId }))
  expect(context).toBeDefined()
  expect(redeemReceivedZ02EndUserAddressContext({ message: row, context: context! })).toEqual(control.facts)
  const decision = await observeZ02NativeOperation('control.runtime.reread', () => resolveCanonicalRuntimeDecisionWithRegistry(row, { actorUserId: f.actorUserId }))
  expect([decision.syntaxDecision, decision.applicationDecision, decision.functionalDecision], JSON.stringify(decision)).toEqual(['accepted','accepted','accepted'])
  expect(frozen(row.id)).toEqual(control.bytes); expect(frozen(original.originalZ01.id)).toEqual(control.originalBytes)
  expect(await observeZ02NativeOperation('control.registry.reread', () => requireRegistryDispatchSource({ companyId: f.companyId, communicationRouteId: f.z01RouteId,
    routeProfileId: f.z01RouteProfileId, environment: 'test', messageFamily: 'PRODAT', applicationReference: '23-DDQ-PRODAT' }))).toEqual(control.dso)
}
async function unavailableSource(f: Fixture, original: Original, id: string, rawPayload: string,
  control: Awaited<ReturnType<typeof sourceControl>>, before: unknown, sealed: unknown,
  otherEffects?: { fixture: Fixture; before: unknown }) {
  expect(id).not.toBe(control.row.id)
  const row = (await observeZ02NativeOperation('negative.message.read', () => getEdielMessageById(id)))!
  expect(row).toMatchObject({ id, company_id: f.companyId, direction: 'inbound', environment: 'test',
    message_family: 'PRODAT', message_code: 'Z02', raw_payload: rawPayload, immutable_payload_hash: hash(rawPayload) })
  const receivedBytes = record(frozen(id))
  const source = sql<Row>(`SELECT to_jsonb(s) FROM gridex_received_sources.sources s WHERE source_message_id=${literal(id)}`)
  expect(source).toMatchObject({ source_message_id: id, company_id: f.companyId, environment: 'test',
    raw_payload: rawPayload, payload_hash: hash(rawPayload) })
  const actualRead = await observeZ02NativeOperation('negative.source-basis.rpc', () => supabaseService.rpc('gridex_ediel_received_z02_address_source_basis_v1', {
    p_source_message_id: id, p_actor_user_id: f.actorUserId }))
  expect(actualRead.error).toBeNull(); expect(actualRead.data).toBeNull()
  expect(await observeZ02NativeOperation('negative.address.fetch', () => fetchReceivedZ02EndUserAddressContext({ message: row, actorUserId: f.actorUserId }))).toBeUndefined()
  const decision = await observeZ02NativeOperation('negative.runtime.initial', () => resolveCanonicalRuntimeDecisionWithRegistry(row, { actorUserId: f.actorUserId }))
  expect(decision.syntaxDecision, JSON.stringify(decision)).toBe('accepted')
  expect(decision.applicationDecision, JSON.stringify(decision)).toBe('manual_review')
  expect(decision.functionalDecision).toBe('manual_review')
  expect(decision.issues).toEqual(expect.arrayContaining([expect.objectContaining({
    code: 'RECEIVED_Z02_END_USER_ADDRESS_SOURCE_UNAVAILABLE', description: 'received_z02_end_user_address_source_unavailable' })]))
  expect(decision.issues.some(i => i.prodatDiagnostic?.kind === 'field' && i.prodatDiagnostic.fieldNumber === '229')).toBe(false)
  expect(decision.responsePlan.filter(p => p.family === 'APERAK')).toEqual([])
  const processed = await observeZ02NativeOperation('negative.inbound.process', () => processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: id }))
  expect(processed.validation_report).toMatchObject({ applicationDecision: 'manual_review', functionalDecision: 'manual_review',
    canonicalRuntime: { issues: expect.arrayContaining([expect.objectContaining({ code: 'RECEIVED_Z02_END_USER_ADDRESS_SOURCE_UNAVAILABLE' })]) } })
  expect(sql(`SELECT to_jsonb(s) FROM gridex_received_sources.sources s WHERE source_message_id=${literal(id)}`)).toEqual(source)
  const after = record(frozen(id))
  for (const key of ['id','raw','hash','receipt','direction','company','environment','canonical','executionContext','inboundContext','source'])
    expect(after[key], key).toEqual(receivedBytes[key])
  expect(sql<number>(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.validation_assessments
    WHERE source_message_id=${literal(id)} AND facts_text::jsonb->>'applicationDecision'='accepted'`)).toBe(0)
  // Complete the existing protected-effect and fresh-control checks before
  // the mandatory ACK reader; a guarded read still fails this native case.
  assertRefusedEffects(f, original, before, sealed)
  if (otherEffects) expect(protectedEffects(otherEffects.fixture, original)).toEqual(otherEffects.before)
  await rereadControl(f, original, control)
  assertRefusedEffects(f, original, before, sealed)
  if (otherEffects) expect(protectedEffects(otherEffects.fixture, original)).toEqual(otherEffects.before)
  expect((await observeZ02NativeOperation('negative.business-ack.list', () => listBusinessAckMessagesForSource({ companyId: f.companyId, sourceMessageId: id,
    actorUserId: f.actorUserId, environment: 'test' }))).filter(a => a.message_family === 'APERAK')).toEqual([])
  await rereadControl(f, original, control)
}
/** Independent physical observer: only fresh control references and the exact
 * selected correlation/namespace tuple can differ. Captured clocks are shared. */
function physicalFacet(controlRaw: string, negativeRaw: string, facet: string) {
  const decode = (rawPayload: string) => {
    const t = tokenizeEdifact(rawPayload)
    const result = t.segments.map(s => Array.from({ length: segmentElementCount(s, t.una) + 1 }, (_, i) => segmentComposite(s, i, t.una)))
    for (const segment of result) {
      const tag = segment[0][0]
      if (tag === 'UNB') segment[5] = ['SOURCE_REFERENCE']
      if (tag === 'UNH') segment[1] = ['SOURCE_REFERENCE']
      if (tag === 'BGM') segment[2] = ['SOURCE_REFERENCE']
      if (tag === 'UNT' || tag === 'UNZ') segment[2] = ['SOURCE_REFERENCE']
    }
    return result
  }
  const expected = decode(controlRaw), actual = decode(negativeRaw)
  const own = (rows: typeof expected, tag: string, qualifier?: string) => {
    const matches = rows.filter(s => s[0][0] === tag && (!qualifier || s[1][0] === qualifier))
    expect(matches).toHaveLength(1); return matches[0]
  }
  const change = (tag: string, element: number, component: number | null, qualifier?: string) => {
    const a = own(expected, tag, qualifier), b = own(actual, tag, qualifier)
    if (component === null) { expect(b[element]).not.toEqual(a[element]); a[element] = b[element] }
    else { expect(b[element][component]).not.toBe(a[element][component]); a[element][component] = b[element][component] }
  }
  if (facet === 'LI') change('RFF', 1, 1, 'LI')
  else if (facet === 'agency') { change('LIN', 3, 3); change('NAD', 2, 2, 'IT') }
  else if (facet === 'point') { change('LIN', 3, 0); change('NAD', 2, 0, 'IT') }
  else if (facet === 'subtype') {
    const reason = (rows: typeof expected) => { const i = rows.findIndex(s => s[0][0] === 'CCI' && s[2][0] === 'Z13'); expect(i).toBeGreaterThan(-1); expect(rows[i+1][0]).toEqual(['CAV']); return rows[i+1] }
    const a = reason(expected), b = reason(actual); expect(b[1][0]).not.toBe(a[1][0]); a[1][0] = b[1][0]
  } else if (facet === 'issuer') { change('NAD', 2, null, 'FR'); change('UNB', 2, null) }
  else if (facet === 'legalSender' || facet === 'legalReceiver') change('NAD', 2, 0, facet === 'legalSender' ? 'FR' : 'DO')
  else if (facet === 'transportSender' || facet === 'transportReceiver') change('UNB', facet === 'transportSender' ? 2 : 3, 0)
  else throw Error(`native_physical_facet_unknown:${facet}`)
  expect(actual).toEqual(expected)
}
function refusalObservation(f: Fixture, original: Original, id: string) {
  return sql<Row>(`SELECT jsonb_build_object('report',m.validation_report,'processing',m.processing_status,
    'jobs',(SELECT coalesce(jsonb_agg(to_jsonb(j) ORDER BY id),'[]') FROM public.customer_operation_jobs j
      WHERE company_id=${literal(f.companyId)} AND payload->>'ediel_message_id'=${literal(id)}),
    'events',(SELECT coalesce(jsonb_agg(jsonb_build_object('type',event_type,'payload',payload,'message',message) ORDER BY created_at,id),'[]')
      FROM public.ediel_message_events WHERE ediel_message_id=m.id),
    'requestEvents',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY created_at,id),'[]') FROM public.customer_info_request_events e
      WHERE company_id=${literal(f.companyId)} AND customer_info_request_id=${literal(original.requestId)}))
    FROM public.ediel_messages m WHERE m.id=${literal(id)} AND m.company_id=${literal(f.companyId)}`)
}
async function physicalReplies(f: Fixture, original: Original, received: Received) {
  const acks = await listBusinessAckMessagesForSource({ companyId: f.companyId, sourceMessageId: received.id,
    actorUserId: f.actorUserId, environment: 'test' })
  expect(acks.map(a => a.message_family).sort()).toEqual(['APERAK', 'CONTRL'])
  const sourceWire = tokenizeEdifact(received.message.raw_payload!), sourceEnvelope = EdifactEnvelopeCodec.decode(received.message.raw_payload!)
  const sourceParties = originalAckPartyIdentities({ rawPayload: received.message.raw_payload!, expectedFamily: 'PRODAT' })
  const own = (tag: string, position: number, qualifier?: string) => sourceWire.segments.find(s => s.tag === tag
    && (!qualifier || segmentComposite(s, position, sourceWire.una)[0] === qualifier))!
  const sourceUnh = segmentComposite(own('UNH', 1), 1, sourceWire.una)[0]
  const sourceBgm = segmentComposite(own('BGM', 1), 2, sourceWire.una)[0]
  for (const ack of acks) {
    expect(ack).toMatchObject({ direction: 'outbound', environment: 'test', related_message_id: received.id,
      ack_outcome: 'positive', immutable_payload_hash: hash(ack.raw_payload!) })
    const wire = tokenizeEdifact(ack.raw_payload!), envelope = EdifactEnvelopeCodec.decode(ack.raw_payload!)
    expect(envelope.sender).toBe(sourceEnvelope.receiver); expect(envelope.receiver).toBe(sourceEnvelope.sender)
    expect(envelope.applicationReference).toBe('23-DDQ-PRODAT'); expect(envelope.environment).toBe('test')
    if (ack.message_family === 'CONTRL') {
      const uci = wire.segments.filter(s => s.tag === 'UCI'), ucm = wire.segments.filter(s => s.tag === 'UCM')
      expect(uci).toHaveLength(1)
      expect(segmentComposite(uci[0], 1, wire.una)[0]).toBe(sourceEnvelope.interchangeReference!.slice(0, 14))
      expect(segmentComposite(uci[0], 2, wire.una)).toEqual(segmentComposite(own('UNB', 1), 2, sourceWire.una))
      expect(segmentComposite(uci[0], 3, wire.una)).toEqual(segmentComposite(own('UNB', 1), 3, sourceWire.una))
      // T §2.1 interchange acceptance is action1. UCM is optional for this
      // positive whole-interchange response; every supplied UCM still binds own UNH.
      expect(segmentComposite(uci[0], 4, wire.una)[0]).toBe('1')
      for (const segment of ucm) {
        expect(segmentComposite(segment, 1, wire.una)[0]).toBe(sourceUnh)
        expect(segmentComposite(segment, 3, wire.una)[0]).toBe('1')
      }
    } else {
      const parties = (role: string) => wire.segments.filter(s => s.tag === 'NAD' && segmentComposite(s, 1, wire.una)[0] === role)
      expect(parties('FR')).toHaveLength(1); expect(parties('DO')).toHaveLength(1)
      expect(segmentComposite(parties('FR')[0], 2, wire.una)).toEqual(sourceParties.legalReceiver.identityComponents)
      expect(segmentComposite(parties('DO')[0], 2, wire.una)).toEqual(sourceParties.legalSender.identityComponents)
      const reference = (qualifier: string) => wire.segments.filter(s => s.tag === 'RFF' && segmentComposite(s, 1, wire.una)[0] === qualifier)
      for (const [qualifier, value] of [['ACW', sourceBgm], ['LI', original.wire.lineReference], ['Z07', f.external]]) {
        expect(reference(qualifier)).toHaveLength(1)
        expect(segmentComposite(reference(qualifier)[0], 1, wire.una)).toEqual([qualifier, value])
      }
      expect(wire.segments.filter(s => s.tag === 'ERC').map(s => segmentComposite(s, 1, wire.una))).toEqual([['100', '', '260']])
    }
    const outboxes = sql<{ id: string }[]>(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',id) ORDER BY id),'[]')
      FROM public.ediel_outbox WHERE company_id=${literal(f.companyId)} AND ediel_message_id=${literal(ack.id)}`)
    expect(outboxes).toHaveLength(1)
    const bytes = frozen(ack.id), count = smtp.send.mock.calls.length
    const sentAck = await sendOutboxItem({ actorUserId: f.actorUserId, outboxItemId: outboxes[0].id, smtpMimeMode: 'nodemailer-attachment' })
    expect(sentAck.status, JSON.stringify(sentAck)).toBe('sent')
    expect(smtp.send.mock.calls.length).toBe(count + 1)
    expect(sql<number>(`SELECT to_jsonb(count(*)) FROM gridex_ediel_transport.attempts WHERE company_id=${literal(f.companyId)}
      AND message_id=${literal(ack.id)} AND classification='accepted' AND binding->>'originalHash'=${literal(hash(ack.raw_payload!))}`)).toBe(1)
    expect(frozen(ack.id)).toEqual(bytes)
  }
  return acks
}
async function physicalMissingAddressAck(f: Fixture, original: Original, id: string, rawPayload: string) {
  const acks = await listBusinessAckMessagesForSource({ companyId: f.companyId, sourceMessageId: id,
    actorUserId: f.actorUserId, environment: 'test', ackFamily: 'APERAK' })
  expect(acks).toHaveLength(1)
  const ack = acks[0]
  expect(ack).toMatchObject({ company_id: f.companyId, environment: 'test', direction: 'outbound', message_family: 'APERAK',
    related_message_id: id, ack_outcome: 'negative', immutable_payload_hash: hash(ack.raw_payload!) })
  expect(ack.raw_payload).toBeTruthy()
  const bytes = frozen(ack.id), source = tokenizeEdifact(rawPayload), wire = tokenizeEdifact(ack.raw_payload!)
  const parties = originalAckPartyIdentities({ rawPayload, expectedFamily: 'PRODAT' })
  const sourceEnvelope = EdifactEnvelopeCodec.decode(rawPayload), envelope = EdifactEnvelopeCodec.decode(ack.raw_payload!)
  expect(envelope.sender).toBe(sourceEnvelope.receiver); expect(envelope.receiver).toBe(sourceEnvelope.sender)
  expect(envelope.environment).toBe('test'); expect(envelope.applicationReference).toBe('23-DDQ-PRODAT')
  const own = (tag: string, qualifier?: string) => wire.segments.filter(s => s.tag === tag && (!qualifier || segmentComposite(s, 1, wire.una)[0] === qualifier))
  for (const [role, tuple] of [['FR', parties.legalReceiver.identityComponents], ['DO', parties.legalSender.identityComponents]] as const) {
    expect(own('NAD', role)).toHaveLength(1); expect(segmentComposite(own('NAD', role)[0], 2, wire.una)).toEqual(tuple)
  }
  const bgm = source.segments.filter(s => s.tag === 'BGM'); expect(bgm).toHaveLength(1)
  for (const [qualifier, value] of [['ACW', segmentComposite(bgm[0], 2, source.una)[0]], ['Z07', f.external], ['LI', original.wire.lineReference]]) {
    expect(own('RFF', qualifier)).toHaveLength(1); expect(segmentComposite(own('RFF', qualifier)[0], 1, wire.una)).toEqual([qualifier, value])
  }
  expect(own('ERC').map(s => segmentComposite(s, 1, wire.una))).toEqual([['41','','260']])
  expect(own('FTX', 'AAO')).toHaveLength(1)
  expect(segmentComposite(own('FTX', 'AAO')[0], 3, wire.una)).toEqual(['229','','260'])
  expect(frozen(ack.id)).toEqual(bytes)
}
function durableReplay(f: Fixture, original: Original) {
  return sql(`SELECT jsonb_build_object('business',${literal(protectedEffects(f, original))}::jsonb,
    'messageAuthority',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id,
      'canonical_rule_pack_id',m.canonical_rule_pack_id,'rule_profile_key',m.rule_profile_key,
      'rule_profile_version_id',m.rule_profile_version_id,'rule_profile_version',m.rule_profile_version,
      'rule_pack_checksum',m.rule_pack_checksum,'rule_pack_snapshot',m.rule_pack_snapshot,
      'execution_context_snapshot',m.execution_context_snapshot) ORDER BY m.id),'[]') FROM public.ediel_messages m WHERE m.company_id=${literal(f.companyId)}),
    'inboundContexts',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY source_message_id),'[]') FROM gridex_ediel_inbound_context.receipts r WHERE company_id=${literal(f.companyId)}),
    'sourceRules',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY source_message_id),'[]') FROM gridex_ediel_source_rules.receipts r WHERE company_id=${literal(f.companyId)}),
    'requestSnapshots',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY id),'[]') FROM public.customer_operation_request_snapshots r WHERE company_id=${literal(f.companyId)}),
    'jobs',(SELECT coalesce(jsonb_agg(to_jsonb(j) ORDER BY id),'[]') FROM public.customer_operation_jobs j WHERE company_id=${literal(f.companyId)}),
    'outbox',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY id),'[]') FROM public.ediel_outbox o WHERE company_id=${literal(f.companyId)}),
    'acks',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'family',message_family,'related',related_message_id,'raw',raw_payload,'hash',immutable_payload_hash) ORDER BY id),'[]')
      FROM public.ediel_messages WHERE company_id=${literal(f.companyId)} AND direction='outbound' AND message_family IN ('CONTRL','APERAK')),
    'attempts',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY id),'[]') FROM gridex_ediel_transport.attempts a WHERE company_id=${literal(f.companyId)}))`)
}
async function executeSeparateReadiness(f: Fixture, received: Received) {
  expect(received.inboundResponseJob, JSON.stringify(received.inboundResponseJobsAfter)).not.toBeNull()
  expect(received.inboundResponseJob).toMatchObject({ status: 'completed' })
  const response = record(received.inboundResponseResult), jobId = response.supplier_switch_job_id
  expect(response.reason).toBe('z02_atomic_core_finalized')
  expect(typeof jobId).toBe('string')
  const read = () => sql<Row>(`SELECT to_jsonb(j) FROM public.customer_operation_jobs j WHERE id=${literal(jobId)} AND company_id=${literal(f.companyId)}`)
  let job = read()
  // A readiness decision can lawfully block/schedule a separate Z03. It must
  // actually execute and retain that decision, not merely enqueue a job.
  if (Number(job.attempts) === 0) {
    const worker = await processCustomerOperationJobs({ workerId: `z02-readiness-${received.id}`, limit: 100 })
    expect(worker.errors, JSON.stringify(worker)).toEqual([])
    job = read()
  }
  expect(job).toMatchObject({ id: jobId, company_id: f.companyId, customer_id: f.customerId, customer_site_id: f.siteId,
    job_type: 'start_supplier_switch', last_error: null })
  expect(Number(job.attempts)).toBeGreaterThan(0)
  expect(['completed', 'needs_review', 'blocked', 'queued']).toContain(job.status)
  const result = record(job.result)
  expect(Object.keys(result).length, JSON.stringify(job)).toBeGreaterThan(0)
  if (job.status === 'queued') expect(result.reason).toBe('supplier_switch_send_window_not_open')
  if (job.status === 'needs_review') {
    expect(Array.isArray(result.blockers)).toBe(true)
    if (result.readiness) expect(result).toHaveProperty('grid_owner_verification')
    else {
      expect(result).toHaveProperty('preflight')
      expect(typeof result.reason_code).toBe('string')
    }
  }
  if (job.status === 'blocked') expect(typeof result.reason_code).toBe('string')
  return job
}

// Frozen Z02 R22; "23-DDQ-PRODAT" is the application reference, not R23.
// Field229 is dependent; UD and IT are independently mandatory parents.
const required: readonly Z02OmittableField[] = ['311', '312', '202', '203', '313', '205', '206', '207', '208',
  '314', '209', '217', '223', '260', '226', '227', '228', '231', '232', '316', '233', '234']
const invalidCompound = new Set(['209', '227', '233'])
function physicalOmission(complete: string, omitted: string, field: Z02OmittableField) {
  const a = tokenizeEdifact(complete), b = tokenizeEdifact(omitted)
  const decode = (wire: typeof a) => wire.segments.filter(s => s.tag !== 'UNT').map(s =>
    Array.from({ length: segmentElementCount(s, wire.una) + 1 }, (_, i) => segmentComposite(s, i, wire.una)))
  // Observe physical segments independently of the counterparty builder and
  // policy's expected values. Only counts may change with removed segments.
  const expected = decode(a), actual = decode(b)
  const one = (tag: string, qualifier?: string) => {
    const candidates = expected.filter(s => s[0][0] === tag && (!qualifier || s[1][0] === qualifier))
    expect(candidates).toHaveLength(1); return candidates[0]
  }
  let remove: string[][][] = []
  if (field === '311') one('UNB')[7] = ['']
  else if (field === '312') one('UNH')[2] = one('UNH')[2].slice(0, 4)
  else if (['202', '203', '313'].includes(field)) one('BGM')[field === '202' ? 1 : field === '203' ? 2 : 4] = ['']
  else if (['205', '206'].includes(field)) remove = [one('DTM', field === '205' ? '137' : 'ZZZ')]
  else if (['207', '208'].includes(field)) remove = [one('NAD', field === '207' ? 'FR' : 'DO')]
  else if (field === '314') one('LIN')[1] = ['']
  else if (field === '209') one('LIN')[3][0] = ''
  else if (['217', '223'].includes(field)) {
    const descriptor = field === '217' ? 'Z04' : 'Z13'
    const candidates = expected.filter(s => s[0][0] === 'CCI' && s[2][0] === descriptor)
    expect(candidates).toHaveLength(1)
    const index = expected.indexOf(candidates[0]); expect(expected[index + 1][0][0]).toBe('CAV')
    remove = [expected[index], expected[index + 1]]
  } else if (['226', '260'].includes(field)) remove = [one('RFF', field === '226' ? 'LI' : 'Z05')]
  else if (field === 'END_USER_GROUP' || field === 'INSTALLATION_GROUP') remove = [one('NAD', field === 'END_USER_GROUP' ? 'UD' : 'IT')]
  else if (field === '227' || field === '233') one('NAD', field === '227' ? 'UD' : 'IT')[2][2] = ''
  else if (field === '234') one('NAD', 'IT')[5] = ['']
  else {
    const slots: Partial<Record<Z02OmittableField, number>> = { '228': 4, '229': 5, '231': 8, '232': 6, '316': 9 }
    const slot = slots[field]; expect(slot).toBeDefined(); one('NAD', 'UD')[slot!] = ['']
  }
  expect(b.una).toEqual(a.una)
  expect(actual).toEqual(expected.filter(s => !remove.includes(s)))
}

describe.each(['L', 'LK'] as const)('native whole SUPPLIER Z02%s proposals', variant => {
  it('applies genuine own Z02 before any incoming ACK, executes separate Z03 readiness, replies physically and replays without supply activation', async () => {
    const { f, original } = await sent(variant), nonActivation = supply(f), originalBytes = frozen(original.originalZ01.id)
    const permissions = sql(`SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]') FROM public.metering_permissions p WHERE company_id=${literal(f.companyId)}`)
    const dataBefore = sql<Row>(`SELECT to_jsonb(d) FROM public.grid_owner_data_requests d
      WHERE id=${literal(original.request.grid_owner_data_request_id)} AND company_id=${literal(f.companyId)}`)
    expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.ediel_ack_chains
      WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(original.originalZ01.id)}`)).toBe(0)
    expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.ediel_messages
      WHERE company_id=${literal(f.companyId)} AND direction='inbound' AND message_family IN ('CONTRL','APERAK')`)).toBe(0)
    const rawPayload = reply(f, original), validation = await validateIncoming(f, rawPayload)
    expect(validation.ok, JSON.stringify(validation.issues)).toBe(true)
    const received = await receiveZ01SupplierReply(f, rawPayload)
    await acceptedPhysical(f, received)
    observeZ02PositiveProjection(f, original, received)
    expect(received.message).toMatchObject({ related_message_id: original.originalZ01.id, customer_id: f.customerId,
      site_id: f.siteId, metering_point_id: f.pointId })
    const applied = applications(f, original)
    expect(applied).toHaveLength(1)
    expect(applied[0]).toMatchObject({ source_message_id: received.id, company_id: f.companyId, environment: 'test',
      source_payload_hash: hash(rawPayload), originating_z01_message_id: original.originalZ01.id, request_id: original.requestId,
      customer_id: f.customerId, site_id: f.siteId, object_id: f.external, identity_agency: original.wire.identityAgency, metering_point_id: f.pointId })
    expect(applied[0].canonical_assessment_id).toMatch(/^[a-f0-9-]{36}$/)
    expect(applied[0].result).toMatchObject({ ok: true, requestId: original.requestId, messageId: received.id,
      customerId: f.customerId, customerSiteId: f.siteId, meteringPointRecordId: f.pointId,
      meteringPointExternalId: f.external, facilityId: f.external, gridAreaCode: f.gridAreaCode, atomicCoreApply: true })
    const assessment = sql<Row>(`SELECT to_jsonb(a) FROM gridex_received_sources.validation_assessments a
      WHERE id=${literal(applied[0].canonical_assessment_id)}`)
    expect(assessment).toMatchObject({ source_message_id: received.id, company_id: f.companyId, environment: 'test', source_payload_hash: hash(rawPayload) })
    expect(JSON.parse(String(assessment.facts_text))).toMatchObject({ syntaxDecision: 'accepted', applicationDecision: 'accepted', functionalDecision: 'accepted' })
    const transport = sql<Row>(`SELECT to_jsonb(a) FROM gridex_ediel_transport.attempts a WHERE id=${literal(applied[0].originating_transport_attempt_id)}`)
    expect(transport).toMatchObject({ message_id: original.originalZ01.id, company_id: f.companyId, environment: 'test', classification: 'accepted',
      binding: { originalHash: hash(original.originalZ01.raw_payload!) } })
    expect(Date.parse(String(transport.observed_at))).toBeLessThanOrEqual(Date.parse(String(received.message.message_received_at)))
    const afterRequest = request(f, original), prior = record(original.request.verified_payload)
    expect(afterRequest).toMatchObject({ status: 'ready_for_switch', response_ediel_message_id: received.id,
      metering_point_id: f.pointId, route_resolution_status: 'z02_market_verified' })
    const verified = record(afterRequest.verified_payload)
    expect(verified).toEqual({ ...prior, z02: verified.z02 })
    expect(verified.z02).toMatchObject({ message_id: received.id, metering_point_id: f.external, facility_id: f.external,
      grid_area_code: f.gridAreaCode, verification_level: 'market_verified', atomic_core_apply: true })
    const dataAfter = sql<Row>(`SELECT to_jsonb(d) FROM public.grid_owner_data_requests d
      WHERE id=${literal(dataBefore.id)} AND company_id=${literal(f.companyId)}`)
    expect(dataAfter.status).toBe('received')
    expect(dataAfter.response_payload).toMatchObject({ ...record(dataBefore.response_payload), z02_message_id: received.id,
      metering_point_id: f.external, facility_id: f.external, grid_area_code: f.gridAreaCode, atomic_core_apply: true })
    expect(sql(`SELECT to_jsonb(s) FROM public.customer_operation_request_snapshots s WHERE id=${literal(original.snapshot!.id)}`)).toEqual(original.snapshot)
    const site = sql<Row>(`SELECT to_jsonb(s) FROM public.customer_sites s WHERE id=${literal(f.siteId)} AND company_id=${literal(f.companyId)}`)
    expect(site).toMatchObject({ customer_id: f.customerId, facility_id: f.external, grid_area_code: f.gridAreaCode,
      facility_data_status: 'verified', data_quality_status: 'verified', metadata: { facility_provenance: {
        sourceType: 'ediel_inbound', sourceMessageId: received.id, customerInfoRequestId: original.requestId,
        operationId: original.operationId, verificationLevel: 'market_verified' } } })
    const point = sql<Row>(`SELECT to_jsonb(p) FROM public.metering_points p WHERE id=${literal(f.pointId)} AND company_id=${literal(f.companyId)}`)
    expect(point).toMatchObject({ customer_id: f.customerId, site_id: f.siteId, metering_point_id: f.external, grid_area_code: f.gridAreaCode,
      status: 'active', verification_status: 'verified', data_quality_status: 'verified',
      metadata: { z02_market_verified: true, z02_message_id: received.id, customer_info_request_id: original.requestId } })
    // Active metering identity is not an active supply period or contract.
    expect(supply(f)).toEqual(nonActivation)
    await executeSeparateReadiness(f, received)
    expect(supply(f)).toEqual(nonActivation)
    const acks = await physicalReplies(f, original, received)
    const beforeReplay = durableReplay(f, original), receivedBytes = frozen(received.id), sends = smtp.send.mock.calls.length
    await processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: received.id })
    expect(durableReplay(f, original)).toEqual(beforeReplay)
    expect((await listBusinessAckMessagesForSource({ companyId: f.companyId, sourceMessageId: received.id,
      actorUserId: f.actorUserId, environment: 'test' })).map(a => a.id).sort()).toEqual(acks.map(a => a.id).sort())
    expect(smtp.send.mock.calls.length).toBe(sends)
    expect(frozen(received.id)).toEqual(receivedBytes); expect(frozen(original.originalZ01.id)).toEqual(originalBytes)
    expect(supply(f)).toEqual(nonActivation)
    expect(sql(`SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]') FROM public.metering_permissions p WHERE company_id=${literal(f.companyId)}`)).toEqual(permissions)
    const concurrent = await Promise.allSettled([1, 2].map(() => processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: received.id })))
    const diagnostics = { outcomes: concurrent.map(o => o.status === 'fulfilled' ? { status: o.status, id: o.value.id }
      : { status: o.status, reason: o.reason instanceof Error ? o.reason.message : o.reason }),
    inboundCases: sql(`SELECT coalesce(jsonb_agg(id ORDER BY id),'[]') FROM public.ediel_inbound_cases
      WHERE company_id=${literal(f.companyId)} AND ediel_message_id=${literal(received.id)}`),
    applications: applications(f, original) }
    console.info('Z02_NATIVE_CONCURRENT_REPLAY', JSON.stringify(diagnostics))
    expect(concurrent.filter(o => o.status === 'rejected'), JSON.stringify(diagnostics)).toEqual([])
    expect(diagnostics.inboundCases).toHaveLength(1)
    expect(durableReplay(f, original)).toEqual(beforeReplay)
    expect((await listBusinessAckMessagesForSource({ companyId: f.companyId, sourceMessageId: received.id,
      actorUserId: f.actorUserId, environment: 'test' })).map(a => a.id).sort()).toEqual(acks.map(a => a.id).sort())
    expect(smtp.send.mock.calls.length).toBe(sends)
    expect(frozen(received.id)).toEqual(receivedBytes); expect(frozen(original.originalZ01.id)).toEqual(originalBytes)
  })

  it.each([...required, '229', 'END_USER_GROUP', 'INSTALLATION_GROUP'] as const)(
    'actual physical omission %s cannot replace verified customer/site/point, permission or supply facts', async field => {
      const { f, original } = await sent(variant), references = { ...refs(), documentReference: `Z02-${randomUUID().slice(0, 8)}`, documentMinute: prodatNowDate203(), createdAt: new Date() }
      const complete = reply(f, original, {}, [], references), negative = reply(f, original, {}, [field], references)
      // One captured reference/date tuple: only the selected field and the
      // mechanical UNT count can change, including across a wall-clock minute.
      const rawPayload = negative
      physicalOmission(complete, rawPayload, field)
      const baseline = await validateIncoming(f, complete)
      expect(baseline.ok, JSON.stringify(baseline.issues)).toBe(true)
      expect(baseline.canonicalPolicy).toBeDefined()
      // The real registry-selected positive policy is retained only for this
      // before-persistence field consumer; it cannot admit the malformed mail.
      const tokens = tokenizeEdifact(rawPayload)
      const target = field === 'END_USER_GROUP' ? '227' : field === 'INSTALLATION_GROUP' ? '233' : field
      const kind = invalidCompound.has(field) ? 'invalid' : 'missing'
      if (field !== '229') {
        const issues = validateCanonicalPolicyFields({ policy: baseline.canonicalPolicy!, rawPayload,
          rawSegments: tokens.segments.map(s => s.raw), una: tokens.una })
        expect(issues.some(i => i.blocking && i.prodatDiagnostic?.kind === 'field'
          && i.prodatDiagnostic.fieldNumber === target && i.prodatDiagnostic.errorKind === kind), JSON.stringify(issues)).toBe(true)
      } else {
        // D229 is conditioned by the actually accepted own Z01 C059, not a
        // fixture address or a detached policy. A fresh complete reply proves
        // this real source can qualify even when its incoming address changes.
        const originalTokens = tokenizeEdifact(original.originalZ01.raw_payload!)
        const originalUd = originalTokens.segments.filter(s => s.tag === 'NAD' && segmentComposite(s, 1, originalTokens.una)[0] === 'UD')
        expect(originalUd).toHaveLength(1)
        expect(segmentComposite(originalUd[0], 5, originalTokens.una).some(v => v.trim() && v.trim() !== '.')).toBe(true)
        const controlRaw = reply({ ...f, customerAddress: { ...f.customerAddress, street: 'Synthetic changed reply street' } }, original)
        const control = await stage(f, controlRaw)
        expect(control.id, JSON.stringify(control)).not.toBeNull()
        expect(control.birthErrors).toEqual([])
        const controlRow = (await getEdielMessageById(control.id!))!
        expect(controlRow).not.toBeNull()
        const context = await fetchReceivedZ02EndUserAddressContext({ message: controlRow, actorUserId: f.actorUserId })
        expect(context).toBeDefined()
        const facts = redeemReceivedZ02EndUserAddressContext({ message: controlRow, context: context!, policy: baseline.canonicalPolicy! })
        expect(facts).toEqual([expect.objectContaining({ meteringPointId: f.external, identityAgency: original.wire.identityAgency,
          endUser: f.customerIdentity, availability: 'available', source: { kind: 'received_z01', companyId: f.companyId,
            originalMessageId: original.originalZ01.id, originalPayloadHash: hash(original.originalZ01.raw_payload!),
            requestId: original.requestId, snapshotId: original.snapshot!.id } })])
        const controlTokens = tokenizeEdifact(controlRaw)
        const controlUd = controlTokens.segments.filter(s => s.tag === 'NAD' && segmentComposite(s, 1, controlTokens.una)[0] === 'UD')
        expect(controlUd).toHaveLength(1)
        expect(segmentComposite(controlUd[0], 5, controlTokens.una)[0]).toBe('Synthetic changed reply street')
        expect(segmentComposite(controlUd[0], 5, controlTokens.una)).not.toEqual(segmentComposite(originalUd[0], 5, originalTokens.una))
        expect(validateCanonicalPolicyFields({ policy: baseline.canonicalPolicy!, sourceMessage: controlRow,
          receivedZ02EndUserAddressContext: context, rawPayload: controlRaw,
          rawSegments: controlTokens.segments.map(s => s.raw), una: controlTokens.una }).filter(i => i.blocking)).toEqual([])
        const controlDecision = await resolveCanonicalRuntimeDecisionWithRegistry(controlRow, { actorUserId: f.actorUserId })
        expect([controlDecision.syntaxDecision, controlDecision.applicationDecision, controlDecision.functionalDecision], JSON.stringify(controlDecision))
          .toEqual(['accepted', 'accepted', 'accepted'])
      }
      const before = protectedEffects(f, original), sealed = frozen(original.originalZ01.id), staged = await stage(f, rawPayload)
      if (field === '229') {
        expect(staged.id, JSON.stringify(staged)).not.toBeNull()
        expect(staged.birthErrors).toEqual([])
        const row = (await getEdielMessageById(staged.id!))!
        expect(row).not.toBeNull()
        const context = await fetchReceivedZ02EndUserAddressContext({ message: row, actorUserId: f.actorUserId })
        expect(context).toBeDefined()
        const facts = redeemReceivedZ02EndUserAddressContext({ message: row, context: context!, policy: baseline.canonicalPolicy! })
        expect(facts).toEqual([expect.objectContaining({ meteringPointId: f.external, identityAgency: original.wire.identityAgency,
          endUser: f.customerIdentity, availability: 'available', source: { kind: 'received_z01', companyId: f.companyId,
            originalMessageId: original.originalZ01.id, originalPayloadHash: hash(original.originalZ01.raw_payload!),
            requestId: original.requestId, snapshotId: original.snapshot!.id } })])
        const issues = validateCanonicalPolicyFields({ policy: baseline.canonicalPolicy!, sourceMessage: row,
          receivedZ02EndUserAddressContext: context, rawPayload, rawSegments: tokens.segments.map(s => s.raw), una: tokens.una })
        expect(issues).toEqual(expect.arrayContaining([expect.objectContaining({ blocking: true,
          code: 'PRODAT_RECEIVED_Z02_END_USER_ADDRESS_MISSING', fieldPath: 'NAD+UD/C059/3042[1..3]',
          prodatDiagnostic: expect.objectContaining({ kind: 'field', fieldNumber: '229', errorKind: 'missing',
            sourceRule: 'PRODAT26A:Z02/229:received-original-availability', occurrence: expect.objectContaining({
              objectId: f.external, identityAgency: original.wire.identityAgency, lineItemReference: original.wire.lineReference,
              ownReferences: expect.objectContaining({ customerId: { kind: 'present', value: f.customerIdentity.id } }) }) }) })]))
      }
      if (staged.id) {
        await processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: staged.id })
        const decision = await resolveCanonicalRuntimeDecisionWithRegistry((await getEdielMessageById(staged.id))!, { actorUserId: f.actorUserId })
        expect(decision.issues.some(i => i.severity === 'error' && i.prodatDiagnostic?.kind === 'field'
          && i.prodatDiagnostic.fieldNumber === target && i.prodatDiagnostic.errorKind === kind), JSON.stringify(decision.issues)).toBe(true)
        if (field === '229') {
          expect(decision.applicationDecision, JSON.stringify(decision)).toBe('rejected')
          expect(decision.responsePlan).toEqual(expect.arrayContaining([expect.objectContaining({ family: 'APERAK', outcome: 'negative',
            applicationErrors: expect.arrayContaining([expect.objectContaining({ fieldCode: '229', ercCode: '41',
              referenceNumber: f.external, lineItemReference: original.wire.lineReference })]) })]))
          expect(decision.responsePlan.filter(p => p.family === 'APERAK' && p.outcome === 'positive')).toEqual([])
          await physicalMissingAddressAck(f, original, staged.id, rawPayload)
        }
      } else {
        // Only header identity/guide selection may stop before an original.
        // An unrelated SQL/schema/authority failure never proves a field case.
        expect(['202', '223', '311', '312', '207', '208']).toContain(field)
        expect(staged.birthErrors).toHaveLength(1)
        expect(String(staged.birthErrors[0].message)).toMatch(/^(canonical_inbound_rule_profile_resolution_failed:PRODAT:|ediel_inbound_legal_context_required$|prodat_subtype_unknown:missing$)/)
      }
      assertRefusedEffects(f, original, before, sealed)
      const unt = tokens.segments.find(s => s.tag === 'UNT')!, unh = tokens.segments.find(s => s.tag === 'UNH')!, unz = tokens.segments.find(s => s.tag === 'UNZ')!
      expect(segmentComposite(unt, 1, tokens.una)).toEqual([String(unt.index - unh.index + 1)])
      expect(segmentComposite(unz, 1, tokens.una)).toEqual(['1'])
    })

  it.each([
    ['LI', { lineReference: 'UNRELATED-OWN-Z01-LI' }, 'z02_original_object_reference_mismatch|z02_line_item_reference_mismatch'],
    ['customer', { customerIdentity: { id: '199001010017', qualifier: 'SE2', agency: '260' } }, 'z02_end_user_identity_conflict'],
    ['agency', { identityAgency: '89' }, 'z02_original_object_reference_mismatch'],
    ['subtype', { reason: variant === 'L' ? 'Z23' : 'Z22' }, 'z02_source_reference_or_subtype_mismatch|z02_variant_mismatch'],
  ] as const)('a complete but wrong %s cannot borrow the own sent source', async (facet, overrides, cause) => {
    const { f, original } = await sent(variant)
    if (facet === 'customer') {
      const before = protectedEffects(f, original), sealed = frozen(original.originalZ01.id)
      const rawPayload = reply(f, original, overrides), wire = tokenizeEdifact(rawPayload)
      const endUsers = wire.segments.filter(s => s.tag === 'NAD' && segmentComposite(s, 1, wire.una)[0] === 'UD')
      expect(endUsers).toHaveLength(1)
      expect(segmentComposite(endUsers[0], 2, wire.una)).toEqual(['199001010017', 'SE2', '260'])
      expect(segmentComposite(endUsers[0], 2, wire.una)[0]).not.toBe(f.customerIdentity.id)
      const received = await receiveZ01SupplierReply(f, rawPayload)
      await acceptedPhysical(f, received)
      const jobs = sql<Row[]>(`SELECT coalesce(jsonb_agg(to_jsonb(j) ORDER BY id),'[]') FROM public.customer_operation_jobs j
        WHERE company_id=${literal(f.companyId)} AND job_type='apply_inbound_grid_owner_response'
          AND payload->>'ediel_message_id'=${literal(received.id)}`)
      expect(jobs).toHaveLength(1)
      const job = jobs[0], result = record(job.result), payloadGate = record(result.z02_payload_validation)
      expect(job).toMatchObject({ company_id: f.companyId, customer_id: f.customerId, customer_site_id: f.siteId,
        job_type: 'apply_inbound_grid_owner_response', status: 'needs_review',
        payload: { ediel_message_id: received.id, customer_info_request_id: original.requestId } })
      expect(result).toMatchObject({ reason: cause, reason_code: cause, z02_correlation_status: 'exact' })
      expect(payloadGate).toMatchObject({ gate: 'gridex_gate_inbound_z02_required_payload',
        inbound_message_id: received.id, customer_info_request_id: original.requestId,
        line_item_id: original.wire.point, line_reference: original.wire.lineReference, grid_area: original.wire.gridAreaCode,
        measure_method: 'Z04', reason_for_transaction: variant === 'L' ? 'Z22' : 'Z23',
        end_user_id: '199001010017', end_user_qualifier: 'SE2', installation_id: original.wire.point })
      expect(result.z02_payload_validation_status).not.toBe('valid')
      expect(result.z02_atomic_core_applied).not.toBe(true)
      expect(record(result.z02_atomic_core).ok).not.toBe(true)
      expect(request(f, original)).toMatchObject({ id: original.requestId, company_id: f.companyId,
        customer_id: f.customerId, site_id: f.siteId, status: 'manual_review_required', blocker_code: cause })
      assertRefusedEffects(f, original, before, sealed)
      return
    }
    const frame = { createdAt: new Date(), documentMinute: prodatNowDate203() }
    const complete = reply(f, original, {}, [], { ...refs(), ...frame })
    const rawPayload = reply(f, original, overrides, [], { ...refs(), ...frame })
    physicalFacet(complete, rawPayload, facet)
    const control = await sourceControl(f, original, complete)
    const before = protectedEffects(f, original), sealed = frozen(original.originalZ01.id), staged = await observeZ02NativeOperation('negative.mail.birth', () => stage(f, rawPayload))
    expect(staged.id, JSON.stringify(staged)).not.toBeNull(); expect(staged.birthErrors).toEqual([])
    await unavailableSource(f, original, staged.id!, rawPayload, control, before, sealed)
    const observation = refusalObservation(f, original, staged.id!)
    console.info('Z02_NATIVE_REFUSAL', JSON.stringify({ facet, company: f.companyId, original: original.originalZ01.id, received: staged.id, observation }))
    // The current normal kernel holds at the earlier protected source guard.
    // Its downstream onboarding no-match note is NOT REACHED and is not a
    // contractual prerequisite for refusing this exact wrong physical LI.
    assertRefusedEffects(f, original, before, sealed)
  })
  it('a different genuinely existing object cannot change either company', async () => {
    const { f, original } = await sent(variant), other = await createZ01SupplierNativeFixture(variant, provider)
    expect(other.external).not.toBe(f.external)
    const frame = { createdAt: new Date(), documentMinute: prodatNowDate203() }
    const complete = reply(f, original, {}, [], { ...refs(), ...frame })
    const rawPayload = reply(f, original, { point: other.external }, [], { ...refs(), ...frame })
    physicalFacet(complete, rawPayload, 'point')
    const control = await sourceControl(f, original, complete)
    const before = protectedEffects(f, original), otherBefore = protectedEffects(other, original), sealed = frozen(original.originalZ01.id)
    const staged = await observeZ02NativeOperation('negative.mail.birth', () => stage(f, rawPayload))
    expect(staged.id, JSON.stringify(staged)).not.toBeNull(); expect(staged.birthErrors).toEqual([])
    await unavailableSource(f, original, staged.id!, rawPayload, control, before, sealed, { fixture: other, before: otherBefore })
    assertRefusedEffects(f, original, before, sealed)
    expect(protectedEffects(other, original)).toEqual(otherBefore)
  })
  it('a known different grid area in the same price area cannot replace the original grid', async () => {
    const { f, original } = await sent(variant), other = await ensureZ01SupplierKnownWrongGridArea(f)
    expect(other.after).toEqual(other.before); expect(other.gridAreaCode).not.toBe(f.gridAreaCode)
    const before = protectedEffects(f, original), sealed = frozen(original.originalZ01.id)
    const received = await receiveZ01SupplierReply(f, reply(f, original, { gridAreaCode: other.gridAreaCode }))
    await acceptedPhysical(f, received)
    assertRefusedEffects(f, original, before, sealed)
    const result = record(received.inboundResponseResult), core = record(result.z02_atomic_core)
    // No source contract prescribes an invented grid-area error code. Require
    // the real intended consumer's rejected core and target grid facts instead.
    expect(result).toMatchObject({ z02_correlation_status: 'exact', z02_payload_validation_status: 'valid',
      z02_snapshot_freshness_status: 'valid', z02_atomic_core_applied: false })
    expect(core.ok).toBe(false)
    expect(typeof core.code).toBe('string')
    expect(String(core.code)).toMatch(/grid_area/)
    expect(JSON.stringify({ core, observation: refusalObservation(f, original, received.id) })).toContain(other.gridAreaCode)
  })
  it.each(['legalSender', 'legalReceiver', 'transportSender', 'transportReceiver'] as const)(
    'a wrong physical %s cannot borrow the source namespace', async facet => {
      const { f, original } = await sent(variant), before = protectedEffects(f, original), sealed = frozen(original.originalZ01.id)
      const frame = { createdAt: new Date(), documentMinute: prodatNowDate203() }
      const complete = reply(f, original, {}, [], { ...refs(), ...frame })
      const changed = reply(f, original, { [facet]: '99999' }, [], { ...refs(), ...frame })
      physicalFacet(complete, changed, facet)
      const control = await sourceControl(f, original, complete)
      const staged = await observeZ02NativeOperation('negative.mail.birth', () => stage(f, changed))
      if (facet === 'legalSender' || facet === 'transportSender') {
        expect(staged.id, JSON.stringify(staged)).not.toBeNull(); expect(staged.birthErrors).toEqual([])
      }
      if (staged.id) {
        if (facet === 'legalReceiver' || facet === 'transportReceiver') {
          await processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: staged.id })
          expect(sql<Row>(`SELECT to_jsonb(r) FROM gridex_ediel_inbound_context.receipts r WHERE source_message_id=${literal(staged.id)}`))
            .toMatchObject({ status: 'held', reason: 'ediel_inbound_legal_context_required' })
        } else await unavailableSource(f, original, staged.id, changed, control, before, sealed)
      } else {
        expect(staged.birthErrors).toHaveLength(1)
        expect(staged.birthErrors[0]).toMatchObject({ code: 'P0001', message: 'ediel_inbound_legal_context_required' })
      }
      if (facet === 'legalReceiver' || facet === 'transportReceiver') expect(staged.tenant).toMatchObject({ status: 'unresolved', companyId: null })
      await rereadControl(f, original, control)
      assertRefusedEffects(f, original, before, sealed)
    })
  it('current supplier recipient role is required before fresh Z02, even with the correct original identity', async () => {
    const { f, original } = await sent(variant), rawPayload = reply(f, original)
    expect((await validateIncoming(f, rawPayload)).ok).toBe(true)
    const baseline = await actualNamespaceBaseline(f, original, reply(f, original))
    const baselineOriginal = frozen(baseline.baseline.id!)
    expect(sql<number>(`WITH changed AS (UPDATE public.tenant_actor_roles SET valid_to=clock_timestamp()
      WHERE company_id=${literal(f.companyId)} AND environment='test' AND actor_id=${literal(f.actorUserId)}
      AND role_code='electricity_supplier' AND (valid_to IS NULL OR valid_to>clock_timestamp()) RETURNING actor_id) SELECT to_jsonb(count(*)) FROM changed`)).toBe(1)
    await expect(resolveCanonicalTenantEdielIdentityWithEvidence({ companyId: f.companyId, environment: 'test', requireExactCounts: true }))
      .rejects.toThrow(`tenant_market_roles_missing:${f.companyId}:test`)
    expect(baseline.supplier.identity.legalEdielId).toBe(original.wire.parties.legalSender.id)
    const before = protectedEffects(f, original), sealed = frozen(original.originalZ01.id), staged = await stage(f, rawPayload)
    expect(staged.tenant).toMatchObject({ status: 'unresolved', companyId: null })
    if (staged.id) {
      expect(staged.id).not.toBe(baseline.baseline.id)
      expect(sql<Row>(`SELECT to_jsonb(r) FROM gridex_ediel_inbound_context.receipts r WHERE source_message_id=${literal(staged.id)}`))
        .toMatchObject({ status: 'held', reason: 'ediel_inbound_legal_context_required' })
      await processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: staged.id })
    }
    else expect(staged.birthErrors[0]).toMatchObject({ code: 'P0001', message: 'ediel_inbound_legal_context_required' })
    expect(frozen(baseline.baseline.id!)).toEqual(baselineOriginal)
    assertRefusedEffects(f, original, before, sealed)
  })
  it('a genuinely known SUPPLIER issuer cannot borrow the DSO sender namespace of the own Z01', async () => {
    const { f, original } = await sent(variant), frame = { createdAt: new Date(), documentMinute: prodatNowDate203() }
    const complete = reply(f, original, {}, [], { ...refs(), ...frame })
    const baseline = await sourceControl(f, original, complete)
    expect(baseline.supplier.identity.legalEdielId).not.toBe(baseline.dso.legalEdielId)
    const candidate = reply(f, original, { legalSender: baseline.supplier.identity.legalEdielId,
      transportSender: baseline.supplier.identity.transportEdielId }, [], { ...refs(), ...frame })
    const tokens = tokenizeEdifact(candidate), envelope = EdifactEnvelopeCodec.decode(candidate)
    const unh = tokens.segments.find(s => s.tag === 'UNH')!
    // Use the wrong issuer's genuine technical qualifier/subaddress too. The
    // DSO tuple cannot be borrowed to manufacture a known SUPPLIER identity.
    const rawPayload = EdifactEnvelopeCodec.encode({ sender: baseline.supplier.identity.transportEdielId, receiver: envelope.receiver!,
      senderQualifier: original.wire.envelope.senderQualifier, senderSubAddress: original.wire.envelope.senderSubAddress,
      receiverQualifier: envelope.receiverQualifier, receiverSubAddress: envelope.receiverSubAddress,
      applicationReference: envelope.applicationReference, environment: 'test', acknowledgementRequest: true, createdAt: frame.createdAt,
      interchangeReference: envelope.interchangeReference!, messages: [{ messageReference: segmentComposite(unh, 1, tokens.una)[0],
        messageTypeToken: segmentComposite(unh, 2, tokens.una).join(':'),
        businessSegments: tokens.segments.filter(s => !['UNB','UNH','UNT','UNZ'].includes(s.tag)).map(s => s.raw) }] })
    const issuer = originalAckPartyIdentities({ rawPayload, expectedFamily: 'PRODAT' }).legalSender
    expect(issuer.id).toBe(baseline.supplier.identity.legalEdielId)
    expect(issuer.identityComponents).toEqual(original.wire.parties.legalSender.identityComponents)
    expect(issuer.country).toBe(original.wire.parties.legalSender.country)
    const issuerWire = tokenizeEdifact(rawPayload), originalWire = tokenizeEdifact(original.originalZ01.raw_payload!)
    expect(segmentComposite(issuerWire.segments.find(s => s.tag === 'UNB'), 2, issuerWire.una))
      .toEqual(segmentComposite(originalWire.segments.find(s => s.tag === 'UNB'), 2, originalWire.una))
    physicalFacet(complete, rawPayload, 'issuer')
    const before = protectedEffects(f, original), sealed = frozen(original.originalZ01.id)
    const staged = await observeZ02NativeOperation('negative.mail.birth', () => stage(f, rawPayload))
    expect(staged.tenant).toMatchObject({ status: 'resolved', companyId: f.companyId })
    expect(staged.id, JSON.stringify(staged)).not.toBeNull()
    expect(staged.birthErrors).toEqual([])
    await unavailableSource(f, original, staged.id!, rawPayload, baseline, before, sealed)
    expect(await requireRegistryDispatchSource({ companyId: f.companyId, communicationRouteId: f.z01RouteId,
      routeProfileId: f.z01RouteProfileId, environment: 'test', messageFamily: 'PRODAT', applicationReference: '23-DDQ-PRODAT' })).toEqual(baseline.dso)
    assertRefusedEffects(f, original, before, sealed)
  })
  it('a genuine foreign actor cannot perform the first processing of the own received Z02', async () => {
    const { f, original } = await sent(variant), other = await createZ01SupplierNativeFixture(variant, provider)
    const staged = await stage(f, reply(f, original))
    expect(staged.id, JSON.stringify(staged)).not.toBeNull()
    const before = protectedEffects(f, original), foreignBefore = protectedEffects(other, original), sealed = frozen(original.originalZ01.id)
    await expect(processInboundEdielMessage({ actorUserId: other.actorUserId, edielMessageId: staged.id! }))
      .rejects.toThrow(/ediel_tenant_actor_forbidden|company_permission_required|company_membership/)
    assertRefusedEffects(f, original, before, sealed)
    expect(protectedEffects(other, original)).toEqual(foreignBefore)
  })
  it('test source and route cannot authorize the same physical Z02 through a production mailbox', async () => {
    const { f, original } = await sent(variant), rawPayload = reply(f, original)
    expect(EdifactEnvelopeCodec.decode(rawPayload).environment).toBe('test')
    const before = protectedEffects(f, original), sealed = frozen(original.originalZ01.id), staged = await stage(f, rawPayload, 'production')
    expect(staged.tenant).toMatchObject({ status: 'unresolved', companyId: null })
    if (staged.id) {
      await processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: staged.id })
      expect(JSON.stringify(refusalObservation(f, original, staged.id))).toMatch(/environment|routing_unresolved|unresolved/)
    } else {
      expect(staged.birthErrors).toHaveLength(1)
      expect(String(staged.birthErrors[0].message)).toMatch(/^(ediel_inbound_legal_context_required|ediel_inbound_.*environment.*)$/)
    }
    assertRefusedEffects(f, original, before, sealed)
  })
  it('received raw bytes and direction reject mutation before the first business consumer', async () => {
    const { f, original } = await sent(variant), rawPayload = reply(f, original), staged = await stage(f, rawPayload)
    expect(staged.id, JSON.stringify(staged)).not.toBeNull()
    const sealed = frozen(staged.id!), originalBytes = frozen(original.originalZ01.id), before = protectedEffects(f, original)
    const changed = rawPayload.replace('BGM+Z02', 'BGM+Z04')
    expect(changed).not.toBe(rawPayload)
    const rawMutation = await supabaseService.from('ediel_messages').update({ raw_payload: changed }).eq('id', staged.id!)
    expect(rawMutation.error).toMatchObject({ code: '23514', message: 'immutable_ediel_payload_cannot_change' })
    const directionMutation = await supabaseService.from('ediel_messages').update({ direction: 'outbound' }).eq('id', staged.id!)
    expect(directionMutation.error).toMatchObject({ code: '23514', message: 'immutable_ediel_received_context_cannot_change' })
    expect(frozen(staged.id!)).toEqual(sealed)
    assertRefusedEffects(f, original, before, originalBytes)
    // The authentic source remains processable after both refused mutations.
    await processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: staged.id! })
    expect(applications(f, original)).toHaveLength(1)
    expect(frozen(staged.id!)).toEqual(sealed)
  })
  it('the actual incoming consumer refuses the genuine outgoing original without customer or supply execution', async () => {
    const { f, original } = await sent(variant), before = protectedEffects(f, original), sealed = frozen(original.originalZ01.id)
    const returned = await processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: original.originalZ01.id })
    expect(returned).toMatchObject({ id: original.originalZ01.id, direction: 'outbound', message_code: 'Z01' })
    expect(sql<Row[]>(`SELECT coalesce(jsonb_agg(jsonb_build_object('type',event_type,'status',event_status) ORDER BY created_at,id),'[]')
      FROM public.ediel_message_events WHERE ediel_message_id=${literal(original.originalZ01.id)}`))
      .toContainEqual({ type: 'manual_note', status: 'warning' })
    assertRefusedEffects(f, original, before, sealed)
  })
})
