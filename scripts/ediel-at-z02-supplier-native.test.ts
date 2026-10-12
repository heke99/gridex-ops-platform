// Native prospective catalog component only. Both whole Z02 contracts remain
// unapproved until own Z01, public ingress, atomic effects, ACK and replay run.
// No finite registry/SQL port and no admission, snapshot or accepted fact seed.
import { describe, expect, it } from 'vitest'
import { resolveSupplierDataBirthProfile } from '@/lib/inbound-mail/supplierDataBirthProfile'
import { supabaseService } from '@/lib/supabase/service'
import { raw, line, characteristic, type Parts } from '../__tests__/fixtures/prodat-register'
import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, vi } from 'vitest'
import { getEdielMessageById } from '@/lib/ediel/db'
import { processCustomerOperationJobs } from '@/lib/customer-operations/automation'
import { processInboundEdielMessage } from '@/lib/ediel/flows/inboundProcessing'
import { resolveCanonicalRuntimeDecisionWithRegistry } from '@/lib/ediel/core/runtimeDecision'
import { EdielExecutionFailure } from '@/lib/ediel/core/failureDisposition'
import { validateRulebookMessageWithRegistry } from '@/lib/ediel/rulebook/validator'
import { validateCanonicalPolicyFields } from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import { tokenizeEdifact, segmentComposite, segmentElementCount, segmentSourceSpan, segmentOriginalRaw } from '@/lib/ediel/core/edifactTokenizer'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { parseCanonicalEdielPayload } from '@/lib/ediel/core/canonicalMessage'
import { prodatRegisterGroups } from '@/lib/ediel/prodat/prodatRegisterGroups'
import { prodatRegisterFieldState } from '@/lib/ediel/prodat/prodatRegisterFields'
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
import * as nativeBase from './helpers/ediel-normal-switch-native-fixture'
import * as nativeNetworkIssuer from './helpers/ediel-network-registry-native-fixture'
import * as networkSourceOwners from '@/lib/ediel/production/networkRegistrySource'
import * as requestedMethodOwner from '@/lib/ediel/production/contractRequestedMethodSource'
import * as z02DiagnosticRuntime from '@/lib/onboarding/z02EnqueueFailureClassification'
import { createNativeZ02JobInsertProbe, nativeZ02JobInsertSqlState, observeZ02PositiveProjection, observeZ02SdkEnqueueProjection } from './helpers/ediel-z02-supplier-native-diagnostics'
import { withZ01SupplierCurrentNetworkPrefix, createZ01SupplierNativeFixture, originateZ01SupplierRequest, receiveZ01SupplierReply,
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
  // Transparent observation only: no SDK/query/result/error replacement.
  const originalFactory = z02DiagnosticRuntime.z02EnqueueDiagnosticPortObserver
  const probe = createNativeZ02JobInsertProbe(value => console.info('Z02_NATIVE_JOB_INSERT_SQLSTATE', JSON.stringify(value)))
  vi.spyOn(z02DiagnosticRuntime, 'z02EnqueueDiagnosticPortObserver')
    .mockImplementation(input => probe(originalFactory(input)))
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
async function stage(f: Fixture, rawPayload: string, environment: 'test' | 'production' = 'test',
  beforeBirth?: (ingress: { mailbox: Awaited<ReturnType<typeof seedOriginalMailboxNative>>;
    tenant: Awaited<ReturnType<typeof resolveInboundTenantFromIdentifiers>>;
    match: Awaited<ReturnType<typeof matchOutboundRequestForInbound>>;
    pointMatch: Awaited<ReturnType<typeof matchMeteringPointForInbound>> }) => Promise<void>) {
  // The prospective public raw INSERT must run in an actual service session.
  // Keep the shared input/parser helper and all custody triggers unchanged.
  const mailbox = await seedOriginalMailboxNative(
    <T = unknown>(statement: string): T => sql<T>(`BEGIN;\nSET LOCAL ROLE service_role;\n${statement}\nCOMMIT;`),
    literal, { companyId: f.companyId, environment, raw: rawPayload,
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
  // Read-only observation for the explicit current312 oracle. The actual
  // public producer and its throws remain unchanged for every case.
  if (beforeBirth) await beforeBirth({ mailbox, tenant, match, pointMatch })
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
function assertUnattributedMailboxConflict(f: Fixture, staged: Awaited<ReturnType<typeof stage>>, environment: 'test' | 'production' = 'test') {
  expect(staged.tenant).toMatchObject({ status: 'ambiguous', companyId: null, source: null, confidence: 0 })
  expect(staged.tenant.candidateCompanyIds).toEqual([])
  expect(staged.tenant.reasons).toEqual(['Juridisk mottagare, teknisk transportidentitet och tenantkontext är inte entydigt verifierade; inga lokala objektfel skapas.'])
  expect(staged.tenant.evidence.filter(evidence => evidence.source === 'verified_legal_identity')).toEqual([])
  expect(sql<Row>(`SELECT to_jsonb(m) FROM public.ediel_mailboxes m WHERE id=${literal(staged.mailbox.mailboxId)}`))
    .toMatchObject({ company_id: f.companyId, environment })
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
/** Independent tokenizer and original-text observer: only BGM4343/field313 changes.
 * One captured reply tuple keeps original/correlation/clock/transport bytes identical. */
function physicalAperakRequest(abRaw: string, naRaw: string) {
  const ab = tokenizeEdifact(abRaw), na = tokenizeEdifact(naRaw)
  const expected = ab.segments.map(s => Array.from({ length: segmentElementCount(s, ab.una) + 1 }, (_, i) => segmentComposite(s, i, ab.una)))
  const actual = na.segments.map(s => Array.from({ length: segmentElementCount(s, na.una) + 1 }, (_, i) => segmentComposite(s, i, na.una)))
  const abBgm = ab.segments.filter(s => s.tag === 'BGM'), naBgm = na.segments.filter(s => s.tag === 'BGM')
  expect(abBgm).toHaveLength(1); expect(naBgm).toHaveLength(1)
  expect(abBgm[0].index).toBe(naBgm[0].index)
  expect(segmentElementCount(abBgm[0], ab.una)).toBe(4)
  expect(segmentElementCount(naBgm[0], na.una)).toBe(4)
  expect(segmentComposite(abBgm[0], 4, ab.una)).toEqual(['AB'])
  expect(segmentComposite(naBgm[0], 4, na.una)).toEqual(['NA'])
  expected[abBgm[0].index][4] = ['NA']
  expect(na.una).toEqual(ab.una); expect(actual).toEqual(expected)
  const span = segmentSourceSpan(abBgm[0]), originalText = segmentOriginalRaw(abBgm[0])
  expect(span).not.toBeNull(); expect(originalText).not.toBeNull()
  expect(span!.unit).toBe('utf16_code_unit')
  expect(originalText!.endsWith('AB')).toBe(true)
  expect(abRaw.slice(span!.startOffset, span!.endOffset)).toBe(originalText)
  expect(naRaw).toBe(abRaw.slice(0, span!.startOffset) + originalText!.slice(0, -2) + 'NA' + abRaw.slice(span!.endOffset))
}
async function physicalMissingNameAck(f: Fixture, original: Original, id: string, rawPayload: string) {
  const sourceBytes = frozen(id)
  const sourceRow = (await getEdielMessageById(id))!
  expect(sourceRow).not.toBeNull()
  expect(sourceRow).toMatchObject({ id, company_id: f.companyId, environment: 'test', direction: 'inbound',
    raw_payload: rawPayload, immutable_payload_hash: hash(rawPayload) })
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
  expect(own('UNH')).toHaveLength(1)
  expect(segmentComposite(own('UNH')[0], 2, wire.una)).toEqual(['APERAK','D','96A','UN','E2SE6A'])
  expect(own('BGM')).toHaveLength(1)
  expect(segmentComposite(own('BGM')[0], 3, wire.una)).toEqual(['34'])
  expect(own('ERC').map(s => segmentComposite(s, 1, wire.una))).toEqual([['41','','260']])
  expect(own('FTX', 'AAO')).toHaveLength(1)
  expect(segmentComposite(own('FTX', 'AAO')[0], 3, wire.una)).toEqual(['228','','260'])
  expect(frozen(ack.id)).toEqual(bytes)
  const all = await listBusinessAckMessagesForSource({ companyId: f.companyId, sourceMessageId: id,
    actorUserId: f.actorUserId, environment: 'test' })
  expect(all.map(a => a.message_family).sort()).toEqual(['APERAK', 'CONTRL'])
  expect(all.filter(a => a.message_family === 'APERAK').map(a => a.id)).toEqual([ack.id])
  const technical = all.filter(a => a.message_family === 'CONTRL')
  expect(technical).toHaveLength(1)
  expect(technical[0]).toMatchObject({ company_id: f.companyId, environment: 'test', direction: 'outbound',
    message_family: 'CONTRL', related_message_id: id, ack_outcome: 'positive', immutable_payload_hash: hash(technical[0].raw_payload!) })
  expect(technical[0].raw_payload).toBeTruthy()
  const technicalBytes = frozen(technical[0].id), control = tokenizeEdifact(technical[0].raw_payload!)
  const controlEnvelope = EdifactEnvelopeCodec.decode(technical[0].raw_payload!)
  expect(controlEnvelope.sender).toBe(sourceEnvelope.receiver); expect(controlEnvelope.receiver).toBe(sourceEnvelope.sender)
  expect(controlEnvelope.environment).toBe('test'); expect(controlEnvelope.applicationReference).toBe('23-DDQ-PRODAT')
  const sourceUnb = source.segments.filter(s => s.tag === 'UNB'), sourceUnh = source.segments.filter(s => s.tag === 'UNH')
  expect(sourceUnb).toHaveLength(1); expect(sourceUnh).toHaveLength(1)
  const uci = control.segments.filter(s => s.tag === 'UCI'), ucm = control.segments.filter(s => s.tag === 'UCM')
  expect(uci).toHaveLength(1)
  expect(segmentComposite(uci[0], 1, control.una)).toEqual([sourceEnvelope.interchangeReference!.slice(0, 14)])
  expect(segmentComposite(uci[0], 2, control.una)).toEqual(segmentComposite(sourceUnb[0], 2, source.una))
  expect(segmentComposite(uci[0], 3, control.una)).toEqual(segmentComposite(sourceUnb[0], 3, source.una))
  expect(segmentComposite(uci[0], 4, control.una)).toEqual(['1'])
  for (const message of ucm) {
    expect(segmentComposite(message, 1, control.una)).toEqual(segmentComposite(sourceUnh[0], 1, source.una))
    expect(segmentComposite(message, 3, control.una)).toEqual(['1'])
  }
  expect(frozen(technical[0].id)).toEqual(technicalBytes)
  expect(frozen(id)).toEqual(sourceBytes)
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

// Oracle epoch map: original PR658/87778063 native SHA256
// f7fcc4be1ccce6c86a572fd61b0dbfa971d4d3c750a494c13b009ad89e219b4c.
// Its 5+42+42 logical cases remain. Missing312 uses the current early-refusal
// oracle below after e641348f removed the old null-version return. Physical
// 209/314 use their separately qualified structural/profile birth refusal.
// Historical later effects are not claimed executed; every early refusal
// requires its own real control, source cause and complete preserved effects.
const preBirthAuthorityTables = [
  'gridex_received_sources.sources', 'gridex_received_sources.validation_assessments',
  'gridex_received_sources.z02_core_applications', 'gridex_received_sources.prodat_response_facets',
  'gridex_received_sources.prodat_application_facets', 'gridex_received_sources.prodat_source_function_facets',
  'gridex_received_sources.prodat_ignored_field_facets', 'gridex_received_sources.prodat_object_validation_facets',
  'gridex_received_sources.object_assessments', 'gridex_ediel_inbound_context.receipts',
  'gridex_ediel_source_rules.receipts', 'gridex_ediel_inbound_receptions.receptions',
  'gridex_ediel_inbound_receptions.response_requests', 'gridex_ediel_ack_guide.established_prodat_acks',
  'gridex_ediel_ack_guide.outbound_prodat_scopes', 'gridex_ediel_ack_guide.source_bindings',
  'gridex_ediel_ack_guide.prodat_response_owner_bindings', 'gridex_ediel_ack_guide.prodat_structural_response_bindings',
  'gridex_ediel_outbound_owner.witnesses', 'gridex_ediel_outbound_owner.consumptions',
  'gridex_ediel_ack_replay.creation_receipts', 'gridex_business_expectations.bindings',
  'gridex_ediel_transport.attempts', 'gridex_ediel_transport.reservations',
  'gridex_ediel_technical_ack.sources', 'gridex_ediel_technical_ack.syntax_facets', 'gridex_ediel_technical_ack.replies',
  'gridex_unattributed_intake.technical_births', 'gridex_unattributed_intake.physical_claims',
  'public.ediel_messages', 'public.ediel_message_events', 'public.ediel_inbound_cases',
  'public.ediel_outbox', 'public.ediel_ack_chains', 'public.ediel_business_expectations',
  'public.customer_operation_jobs', 'public.customer_operation_request_snapshots',
  'public.customer_info_requests', 'public.customer_info_request_events', 'public.grid_owner_data_requests',
  'public.outbound_requests', 'public.customers', 'public.customer_sites', 'public.metering_points',
  'public.metering_permissions', 'public.customer_contracts', 'public.customer_supply_periods',
  'public.supplier_switch_requests',
] as const
const stageIngressTables = [
  'public.ediel_mailboxes', 'public.inbound_email_messages', 'public.inbound_ediel_parse_results',
  'public.inbound_ediel_match_attempts', 'gridex_unattributed_intake.raw_births',
  'gridex_unattributed_intake.parse_births', 'gridex_ediel_inbound_receptions.technical_mailbox_births',
  'public.inbound_email_attachments', 'gridex_unattributed_intake.attachment_births',
] as const
const stageConfigurationTables = [
  'public.ediel_configuration_snapshots', 'public.company_provisioning_jobs', 'public.ediel_test_runs',
  'public.actor_test_results', 'public.ediel_production_readiness_checks',
  'public.ediel_go_live_events', 'public.ediel_production_state',
] as const
// Complete rows, including foreign/NULL owners and empty-table markers. COPY
// streams directly into a private file; there is no count/digest/truncation or
// raised shared SQL buffer. Only this isolated native producer may write here.
function copyCompleteRows(path: string, tables: readonly string[], excludeNewIngress?: Awaited<ReturnType<typeof seedOriginalMailboxNative>>) {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321') throw new Error('owned_local_only')
  const exclusions: Record<string, string> = excludeNewIngress ? {
    'public.ediel_mailboxes': `r.id IS DISTINCT FROM ${literal(excludeNewIngress.mailboxId)}::uuid`,
    'public.inbound_email_messages': `r.id IS DISTINCT FROM ${literal(excludeNewIngress.inboundEmailMessageId)}::uuid`,
    'public.inbound_ediel_parse_results': `r.id IS DISTINCT FROM ${literal(excludeNewIngress.parseResultId)}::uuid`,
    'public.inbound_ediel_match_attempts': `r.inbound_email_message_id IS DISTINCT FROM ${literal(excludeNewIngress.inboundEmailMessageId)}::uuid`,
    'gridex_unattributed_intake.raw_births': `r.inbound_email_message_id IS DISTINCT FROM ${literal(excludeNewIngress.inboundEmailMessageId)}::uuid`,
    'gridex_unattributed_intake.parse_births': `r.parse_result_id IS DISTINCT FROM ${literal(excludeNewIngress.parseResultId)}::uuid`,
    'gridex_ediel_inbound_receptions.technical_mailbox_births': `r.inbound_email_message_id IS DISTINCT FROM ${literal(excludeNewIngress.inboundEmailMessageId)}::uuid`,
  } : {}
  const statements = tables.map(table => {
    if (!/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/.test(table)) throw new Error('native312_table_identifier_invalid')
    return `COPY (SELECT ${literal(table)}) TO STDOUT;
      COPY (SELECT to_jsonb(r)::text FROM ${table} r ${exclusions[table] ? `WHERE ${exclusions[table]}` : ''}
        ORDER BY to_jsonb(r)::text COLLATE "C") TO STDOUT;`
  }).join('\n')
  const fd = openSync(path, 'wx', 0o600)
  try {
    execFileSync('psql', ['postgresql://postgres:postgres@127.0.0.1:54322/postgres', '-XAtq', '-v', 'ON_ERROR_STOP=1'],
      { input: `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL TIME ZONE 'UTC';\n${statements}\nCOMMIT;`,
        stdio: ['pipe', fd, 'pipe'], timeout: 10000 })
  } finally { closeSync(fd) }
}
function unchangedCompleteRows(before: string, after: string, scope: string) {
  expect(readFileSync(after).equals(readFileSync(before)), scope).toBe(true)
}
async function currentMissingGuideRefusal(f: Fixture, original: Original, complete: string, omitted: string) {
  const full = tokenizeEdifact(complete), missing = tokenizeEdifact(omitted)
  expect(segmentComposite(full.segments.find(s => s.tag === 'UNH')!, 2, full.una)).toEqual(['PRODAT', 'D', '97A', 'UN', 'E2SE6A'])
  expect(segmentComposite(missing.segments.find(s => s.tag === 'UNH')!, 2, missing.una)).toEqual(['PRODAT', 'D', '97A', 'UN'])
  expect(parseCanonicalEdielPayload({ rawPayload: omitted, direction: 'inbound', standardHint: 'edifact' }).version).toBeNull()
  physicalOmission(complete, omitted, '312')
  // Distinct envelope IDs prevent the public positive control becoming the
  // malformed reply's duplicate. The exact complete twin is never persisted;
  // its real birth witness is read at the actual negative mail's receipt clock.
  const control = await sourceControl(f, original, reply(f, original))
  const directory = mkdtempSync(join(tmpdir(), 'ediel-z02-current312-'))
  const path = (name: string) => join(directory, name)
  let observed = false
  try {
    copyCompleteRows(path('authority-before'), preBirthAuthorityTables)
    copyCompleteRows(path('ingress-before'), stageIngressTables)
    const sends = smtp.send.mock.calls.length
    await expect(stage(f, omitted, 'test', async ({ mailbox, tenant, match, pointMatch }) => {
      expect(observed).toBe(false)
      expect(tenant).toMatchObject({ status: 'resolved', companyId: f.companyId })
      expect(mailbox.parsed.rawPayload).toBe(omitted)
      expect(mailbox.sourcePayloadHash).toBe(hash(omitted))
      const retained = sql<Row>(`SELECT jsonb_build_object('mail',to_jsonb(m),'mailbox',to_jsonb(b),'parse',to_jsonb(p),
        'rawBirth',to_jsonb(r),'technicalMailboxBirth',to_jsonb(t),'parseBirth',to_jsonb(pb),
        'actualRawHash',gridex_unattributed_intake.raw_hash_v1(m),'actualParseHash',gridex_unattributed_intake.parse_hash_v1(p),
        'actualAttachmentSet',gridex_unattributed_intake.attachment_set_v1(m.id),'actualSelection',gridex_unattributed_intake.selection_v1(p))
        FROM public.inbound_email_messages m JOIN public.ediel_mailboxes b ON b.id=m.mailbox_id
        JOIN public.inbound_ediel_parse_results p ON p.id=${literal(mailbox.parseResultId)} AND p.inbound_email_message_id=m.id
        LEFT JOIN gridex_unattributed_intake.raw_births r ON r.inbound_email_message_id=m.id
        LEFT JOIN gridex_ediel_inbound_receptions.technical_mailbox_births t ON t.inbound_email_message_id=m.id
        LEFT JOIN gridex_unattributed_intake.parse_births pb ON pb.parse_result_id=p.id
        WHERE m.id=${literal(mailbox.inboundEmailMessageId)}`)
      expect(retained).toBeDefined()
      expect(retained.mail).toMatchObject({ id: mailbox.inboundEmailMessageId, company_id: f.companyId,
        mailbox_id: mailbox.mailboxId, environment: 'test', raw_edifact_payload: omitted, body_text: omitted, has_attachments: false })
      expect(retained.mailbox).toMatchObject({ id: mailbox.mailboxId, company_id: f.companyId,
        environment: 'test', is_active: true, is_shared_platform_mailbox: false, email_address: edielSmtpConfig().from })
      expect(retained.parse).toMatchObject({ id: mailbox.parseResultId, inbound_email_message_id: mailbox.inboundEmailMessageId,
        company_id: f.companyId, raw_payload: omitted, message_family: 'PRODAT', message_code: 'Z02' })
      const attempts = sql<Row[]>(`SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY id),'[]')
        FROM public.inbound_ediel_match_attempts a WHERE inbound_email_message_id=${literal(mailbox.inboundEmailMessageId)}`)
      expect(attempts).toHaveLength(2)
      const outboundAttemptType = match.entityType === 'ediel_message' ? 'outbound_ediel_message' : 'outbound_request'
      for (const [type, result] of [[outboundAttemptType, match], ['metering_point', pointMatch]] as const) {
        const own = attempts.filter(a => a.match_type === type)
        expect(own).toHaveLength(1)
        expect(own[0]).toMatchObject({ company_id: f.companyId, inbound_email_message_id: mailbox.inboundEmailMessageId,
          parse_result_id: mailbox.parseResultId, match_status: result.status,
          matched_entity_type: result.entityType, matched_entity_id: result.entityId,
          reasons: result.reasons, candidates: result.candidates })
        expect(Number(own[0].confidence)).toBe(result.confidence)
      }
      expect(retained.rawBirth).toMatchObject({ inbound_email_message_id: mailbox.inboundEmailMessageId, snapshot_hash: retained.actualRawHash })
      expect(retained.technicalMailboxBirth).toMatchObject({ inbound_email_message_id: mailbox.inboundEmailMessageId,
        raw_snapshot_hash: retained.actualRawHash, mailbox_id: mailbox.mailboxId, environment: 'test',
        mailbox_company_id: f.companyId, mailbox_shared: false, smtp_address: edielSmtpConfig().from,
        observed_at: record(retained.rawBirth).observed_at })
      expect(retained.actualSelection).toBe(false)
      expect(retained.parseBirth).toMatchObject({ parse_result_id: mailbox.parseResultId,
        inbound_email_message_id: mailbox.inboundEmailMessageId, snapshot_hash: retained.actualParseHash,
        attachment_set_hash: retained.actualAttachmentSet, selection_qualified: false })
      const birth = await resolveSupplierDataBirthProfile({ rawPayload: complete, receivedAt: String(record(retained.mail).received_at) })
      expect(birth).not.toBeNull()
      for (const key of ['canonical_rule_pack_id', 'rule_profile_key', 'rule_profile_version_id', 'rule_profile_version', 'rule_pack_checksum', 'rule_pack_snapshot'] as const) {
        expect(birth![key]).toEqual(control.row[key])
      }
      copyCompleteRows(path('authority-staged'), preBirthAuthorityTables)
      unchangedCompleteRows(path('authority-before'), path('authority-staged'), '312 staging preserves all existing authority/business rows')
      copyCompleteRows(path('old-ingress-staged'), stageIngressTables, mailbox)
      unchangedCompleteRows(path('ingress-before'), path('old-ingress-staged'), '312 staging adds only its declared retained ingress')
      // Mailbox configuration bookkeeping is an actual declared stage effect.
      // Freeze its complete rows here; do not call it unchanged before stage.
      copyCompleteRows(path('birth-boundary-before'), [...preBirthAuthorityTables, ...stageIngressTables, ...stageConfigurationTables])
      observed = true
    })).rejects.toThrow(/^supplier_data_birth_association_mismatch$/)
    expect(observed, '312 must qualify actual retained ingress and exact complete-twin witness first').toBe(true)
    copyCompleteRows(path('birth-boundary-after'), [...preBirthAuthorityTables, ...stageIngressTables, ...stageConfigurationTables])
    unchangedCompleteRows(path('birth-boundary-before'), path('birth-boundary-after'), '312 creates no source/reception/assessment/business/ACK authority or retained-input mutation')
    expect(smtp.send.mock.calls.length).toBe(sends)
    await rereadControl(f, original, control)
  } finally { rmSync(directory, { recursive: true, force: true }) }
}

async function currentMalformedObjectBirthRefusal(f: Fixture, original: Original, complete: string, omitted: string, field: '209' | '314') {
  physicalOmission(complete, omitted, field)
  const full = tokenizeEdifact(complete), missing = tokenizeEdifact(omitted)
  expect(segmentComposite(missing.segments.find(s => s.tag === 'UNH')!, 2, missing.una))
    .toEqual(segmentComposite(full.segments.find(s => s.tag === 'UNH')!, 2, full.una))
  expect(parseCanonicalEdielPayload({ rawPayload: omitted, direction: 'inbound', standardHint: 'edifact' }).version).toBe('E2SE6A')
  const groups = prodatRegisterGroups(missing.segments, missing.una, 'Z02')
  expect(groups.groups).toHaveLength(1)
  if (field === '314') {
    expect(groups.problems).toEqual([expect.objectContaining({ fieldNumber: '314', reason: 'global_sequence_must_increment_from_one' })])
  } else {
    const identity = prodatRegisterFieldState('209', groups.groups[0].segments, missing.una)
    expect(!identity?.present || identity.malformed).toBe(true)
    expect(groups.problems).toEqual([])
  }
  // Distinct envelope IDs prevent the public positive control becoming the
  // malformed reply's duplicate. The exact complete twin is never persisted;
  // its real birth witness is read at the actual negative mail's receipt clock.
  const control = await sourceControl(f, original, reply(f, original))
  const directory = mkdtempSync(join(tmpdir(), 'ediel-z02-current-object-birth-'))
  const path = (name: string) => join(directory, name)
  let observed = false
  let expectedBirthMessage: string | undefined
  try {
    copyCompleteRows(path('authority-before'), preBirthAuthorityTables)
    copyCompleteRows(path('ingress-before'), stageIngressTables)
    const sends = smtp.send.mock.calls.length
    const staged = await stage(f, omitted, 'test', async ({ mailbox, tenant, match, pointMatch }) => {
      expect(observed).toBe(false)
      expect(tenant).toMatchObject({ status: 'resolved', companyId: f.companyId })
      expect(mailbox.parsed.rawPayload).toBe(omitted)
      expect(mailbox.sourcePayloadHash).toBe(hash(omitted))
      const retained = sql<Row>(`SELECT jsonb_build_object('mail',to_jsonb(m),'mailbox',to_jsonb(b),'parse',to_jsonb(p),
        'rawBirth',to_jsonb(r),'technicalMailboxBirth',to_jsonb(t),'parseBirth',to_jsonb(pb),
        'actualRawHash',gridex_unattributed_intake.raw_hash_v1(m),'actualParseHash',gridex_unattributed_intake.parse_hash_v1(p),
        'actualAttachmentSet',gridex_unattributed_intake.attachment_set_v1(m.id),'actualSelection',gridex_unattributed_intake.selection_v1(p))
        FROM public.inbound_email_messages m JOIN public.ediel_mailboxes b ON b.id=m.mailbox_id
        JOIN public.inbound_ediel_parse_results p ON p.id=${literal(mailbox.parseResultId)} AND p.inbound_email_message_id=m.id
        LEFT JOIN gridex_unattributed_intake.raw_births r ON r.inbound_email_message_id=m.id
        LEFT JOIN gridex_ediel_inbound_receptions.technical_mailbox_births t ON t.inbound_email_message_id=m.id
        LEFT JOIN gridex_unattributed_intake.parse_births pb ON pb.parse_result_id=p.id
        WHERE m.id=${literal(mailbox.inboundEmailMessageId)}`)
      expect(retained).toBeDefined()
      expect(retained.mail).toMatchObject({ id: mailbox.inboundEmailMessageId, company_id: f.companyId,
        mailbox_id: mailbox.mailboxId, environment: 'test', raw_edifact_payload: omitted, body_text: omitted, has_attachments: false })
      expect(retained.mailbox).toMatchObject({ id: mailbox.mailboxId, company_id: f.companyId,
        environment: 'test', is_active: true, is_shared_platform_mailbox: false, email_address: edielSmtpConfig().from })
      expect(retained.parse).toMatchObject({ id: mailbox.parseResultId, inbound_email_message_id: mailbox.inboundEmailMessageId,
        company_id: f.companyId, raw_payload: omitted, message_family: 'PRODAT', message_code: 'Z02' })
      const attempts = sql<Row[]>(`SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY id),'[]')
        FROM public.inbound_ediel_match_attempts a WHERE inbound_email_message_id=${literal(mailbox.inboundEmailMessageId)}`)
      expect(attempts).toHaveLength(2)
      const outboundAttemptType = match.entityType === 'ediel_message' ? 'outbound_ediel_message' : 'outbound_request'
      for (const [type, result] of [[outboundAttemptType, match], ['metering_point', pointMatch]] as const) {
        const own = attempts.filter(a => a.match_type === type)
        expect(own).toHaveLength(1)
        expect(own[0]).toMatchObject({ company_id: f.companyId, inbound_email_message_id: mailbox.inboundEmailMessageId,
          parse_result_id: mailbox.parseResultId, match_status: result.status,
          matched_entity_type: result.entityType, matched_entity_id: result.entityId,
          reasons: result.reasons, candidates: result.candidates })
        expect(Number(own[0].confidence)).toBe(result.confidence)
      }
      expect(retained.rawBirth).toMatchObject({ inbound_email_message_id: mailbox.inboundEmailMessageId, snapshot_hash: retained.actualRawHash })
      expect(retained.technicalMailboxBirth).toMatchObject({ inbound_email_message_id: mailbox.inboundEmailMessageId,
        raw_snapshot_hash: retained.actualRawHash, mailbox_id: mailbox.mailboxId, environment: 'test',
        mailbox_company_id: f.companyId, mailbox_shared: false, smtp_address: edielSmtpConfig().from,
        observed_at: record(retained.rawBirth).observed_at })
      expect(typeof retained.actualSelection).toBe('boolean')
      expect(retained.parseBirth).toMatchObject({ parse_result_id: mailbox.parseResultId,
        inbound_email_message_id: mailbox.inboundEmailMessageId, snapshot_hash: retained.actualParseHash,
        attachment_set_hash: retained.actualAttachmentSet, selection_qualified: retained.actualSelection })
      const birth = await resolveSupplierDataBirthProfile({ rawPayload: complete, receivedAt: String(record(retained.mail).received_at) })
      expect(birth).not.toBeNull()
      for (const key of ['canonical_rule_pack_id', 'rule_profile_key', 'rule_profile_version_id', 'rule_profile_version', 'rule_pack_checksum', 'rule_pack_snapshot'] as const) {
        expect(birth![key]).toEqual(control.row[key])
      }
      const actualClock = String(record(retained.mail).received_at)
      expect(await resolveSupplierDataBirthProfile({ rawPayload: omitted, receivedAt: actualClock })).toBeNull()
      // Both genuine subtype witnesses identify the exact fallback composition;
      // neither is an admission or a fabricated malformed-message profile.
      const other = await resolveSupplierDataBirthProfile({ rawPayload: reply(f, original, {
        reason: original.wire.reason === 'Z22' ? 'Z23' : 'Z22',
      }), receivedAt: actualClock })
      expect(other).not.toBeNull()
      expect(other!.rule_profile_version_id).not.toBe(birth!.rule_profile_version_id)
      const fallback = sql<Row>(`SELECT jsonb_build_object('effectiveDate',m.received_at::date,'profiles',
        (SELECT jsonb_agg(jsonb_build_object('profile',to_jsonb(mp),'pack',to_jsonb(rp)) ORDER BY mp.id)
          FROM public.ediel_message_profiles mp JOIN public.ediel_rule_packs rp ON rp.id=mp.rule_pack_id
          WHERE mp.is_enabled=true AND mp.profile->>'family'='PRODAT' AND mp.message_code='Z02'
            AND mp.direction IN ('inbound','both') AND rp.status IN ('active','future')
            AND rp.valid_from<=m.received_at::date AND (rp.valid_to IS NULL OR rp.valid_to>=m.received_at::date)))
        FROM public.inbound_email_messages m WHERE m.id=${literal(mailbox.inboundEmailMessageId)}`)
      expect(typeof fallback.effectiveDate).toBe('string')
      expect(String(fallback.effectiveDate)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      const profiles = fallback.profiles as Row[]
      expect(profiles).toHaveLength(2)
      expect(profiles.map(row => record(row.profile).id).sort())
        .toEqual([birth!.rule_profile_version_id, other!.rule_profile_version_id].sort())
      for (const witness of [birth!, other!]) {
        const entry = profiles.find(row => record(row.profile).id === witness.rule_profile_version_id)!
        expect(entry.profile).toMatchObject({ id: witness.rule_profile_version_id, rule_pack_id: witness.canonical_rule_pack_id,
          profile_key: witness.rule_profile_key, message_code: 'Z02', is_enabled: true, profile: { family: 'PRODAT' } })
        expect(entry.pack).toMatchObject({ id: witness.canonical_rule_pack_id, source_hash: witness.rule_pack_checksum })
        expect(`${record(entry.pack).guide_version}:r${record(entry.pack).guide_revision}`).toBe(witness.rule_profile_version)
      }
      expectedBirthMessage = `canonical_inbound_rule_profile_resolution_failed:PRODAT:Z02:${fallback.effectiveDate}:2`
      copyCompleteRows(path('authority-staged'), preBirthAuthorityTables)
      unchangedCompleteRows(path('authority-before'), path('authority-staged'), '209/314 staging preserves all existing authority/business rows')
      copyCompleteRows(path('old-ingress-staged'), stageIngressTables, mailbox)
      unchangedCompleteRows(path('ingress-before'), path('old-ingress-staged'), '209/314 staging adds only its declared retained ingress')
      // Mailbox configuration bookkeeping is an actual declared stage effect.
      // Freeze its complete rows here; do not call it unchanged before stage.
      copyCompleteRows(path('birth-boundary-before'), [...preBirthAuthorityTables, ...stageIngressTables, ...stageConfigurationTables])
      observed = true
    })
    expect(staged.id).toBeNull()
    expect(staged.birthErrors).toHaveLength(1)
    expect(expectedBirthMessage).toBeDefined()
    expect(staged.birthErrors[0]).toMatchObject({ code: '23514', message: expectedBirthMessage })
    expect(observed, '209/314 must qualify actual retained ingress, structural cause and exact current profiles first').toBe(true)
    copyCompleteRows(path('birth-boundary-after'), [...preBirthAuthorityTables, ...stageIngressTables, ...stageConfigurationTables])
    unchangedCompleteRows(path('birth-boundary-before'), path('birth-boundary-after'), '209/314 creates no source/reception/assessment/business/ACK authority or retained-input mutation')
    expect(smtp.send.mock.calls.length).toBe(sends)
    await rereadControl(f, original, control)
  } finally { rmSync(directory, { recursive: true, force: true }) }
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
    observeZ02SdkEnqueueProjection(f, original, received, 'positive.pre606.public_projection', true)
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

  it('accepts genuine own Z02 with field313 NA, executes separate Z03 readiness, replies physically and replays without supply activation', async () => {
    const { f, original } = await sent(variant), nonActivation = supply(f), originalBytes = frozen(original.originalZ01.id)
    const permissions = sql(`SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]') FROM public.metering_permissions p WHERE company_id=${literal(f.companyId)}`)
    const dataBefore = sql<Row>(`SELECT to_jsonb(d) FROM public.grid_owner_data_requests d
      WHERE id=${literal(original.request.grid_owner_data_request_id)} AND company_id=${literal(f.companyId)}`)
    expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.ediel_ack_chains
      WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(original.originalZ01.id)}`)).toBe(0)
    expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.ediel_messages
      WHERE company_id=${literal(f.companyId)} AND direction='inbound' AND message_family IN ('CONTRL','APERAK')`)).toBe(0)
    const references = { ...refs(), documentReference: `Z02-${randomUUID().slice(0, 8)}`, documentMinute: prodatNowDate203(), createdAt: new Date() }
    const abControl = reply(f, original, {}, [], references)
    const rawPayload = reply(f, original, { aperakRequest: 'NA' }, [], references)
    physicalAperakRequest(abControl, rawPayload)
    expect(frozen(original.originalZ01.id)).toEqual(originalBytes)
    const validation = await validateIncoming(f, rawPayload)
    expect(validation.ok, JSON.stringify(validation.issues)).toBe(true)
    const received = await receiveZ01SupplierReply(f, rawPayload)
    await acceptedPhysical(f, received)
    observeZ02PositiveProjection(f, original, received)
    observeZ02SdkEnqueueProjection(f, original, received, 'positive.pre606.public_projection', true)
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
      const before = protectedEffects(f, original), sealed = frozen(original.originalZ01.id)
      if (field === '312') {
        await currentMissingGuideRefusal(f, original, complete, rawPayload)
      } else if (field === '209' || field === '314') {
        await currentMalformedObjectBirthRefusal(f, original, complete, rawPayload, field)
      } else {
        const staged = await stage(f, rawPayload)
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
          if (field === '228') {
            expect(staged.birthErrors).toEqual([])
            expect(decision.syntaxDecision, JSON.stringify(decision)).toBe('accepted')
            expect(decision.applicationDecision, JSON.stringify(decision)).toBe('rejected')
            expect(decision.responsePlan).toEqual(expect.arrayContaining([expect.objectContaining({ family: 'APERAK', outcome: 'negative',
              applicationErrors: expect.arrayContaining([expect.objectContaining({ fieldCode: '228', ercCode: '41',
                referenceNumber: f.external, lineItemReference: original.wire.lineReference })]) })]))
            expect(decision.responsePlan.filter(p => p.family === 'APERAK' && p.outcome === 'positive')).toEqual([])
            await physicalMissingNameAck(f, original, staged.id, rawPayload)
          }
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
          expect(['202', '223', '311', '207', '208']).toContain(field)
          expect(staged.birthErrors).toHaveLength(1)
          expect(String(staged.birthErrors[0].message)).toMatch(/^(canonical_inbound_rule_profile_resolution_failed:PRODAT:|ediel_inbound_legal_context_required$|prodat_subtype_unknown:missing$)/)
        }
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
    observeZ02PositiveProjection(f, original, received, 'wrong_grid.before_result_assertion')
    observeZ02SdkEnqueueProjection(f, original, received, 'wrong_grid.before_result_assertion', true)
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
      if (facet === 'legalReceiver' || facet === 'transportReceiver') assertUnattributedMailboxConflict(f, staged)
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
    assertUnattributedMailboxConflict(f, staged)
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
    const incomingBytes = frozen(staged.id!), ownDelivery = durableReplay(f, original), foreignDelivery = durableReplay(other, original)
    const sends = smtp.send.mock.calls.length
    const refused = processInboundEdielMessage({ actorUserId: other.actorUserId, edielMessageId: staged.id! })
    await expect(refused).rejects.toBeInstanceOf(EdielExecutionFailure)
    await expect(refused).rejects.toMatchObject({ message: 'ediel_inbound_execution_actor_forbidden',
      disposition: { kind: 'security_quarantine', code: 'EDIEL_INBOUND_EXECUTION_ACTOR_FORBIDDEN' } })
    assertRefusedEffects(f, original, before, sealed)
    expect(protectedEffects(other, original)).toEqual(foreignBefore)
    expect(durableReplay(f, original)).toEqual(ownDelivery)
    expect(durableReplay(other, original)).toEqual(foreignDelivery)
    expect(frozen(staged.id!)).toEqual(incomingBytes)
    expect(smtp.send.mock.calls.length).toBe(sends)
  })
  it('test source and route cannot authorize the same physical Z02 through a production mailbox', async () => {
    const { f, original } = await sent(variant), rawPayload = reply(f, original)
    expect(EdifactEnvelopeCodec.decode(rawPayload).environment).toBe('test')
    const before = protectedEffects(f, original), sealed = frozen(original.originalZ01.id), staged = await stage(f, rawPayload, 'production')
    assertUnattributedMailboxConflict(f, staged, 'production')
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
    observeZ02PositiveProjection(f, original, { id: staged.id! }, 'mutation.reprocess.before_application_assertion')
    observeZ02SdkEnqueueProjection(f, original, { id: staged.id! }, 'mutation.reprocess.before_application_assertion', true)
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


// These declared modeled controls qualify only the read-only callback probe.
// They do not contribute whole-contract or native business acceptance credit.
describe('native diagnostic callback probe controls', () => {
  it.each(['42702', '42804', '23503', 'P0001'])('projects only exact public SQLSTATE %s', code => {
    expect(nativeZ02JobInsertSqlState({ code, message: 'private', details: 'private', hint: 'private' })).toBe(code)
  })
  it('rejects unknown, inherited, accessor, array and proxy code without touching traps', () => {
    const touch = vi.fn(() => { throw Error('private') })
    const inputs = [undefined, null, { code: 'private' }, Object.create({ code: '42702' }),
      Object.defineProperty({}, 'code', { get: touch }), ['42702'],
      new Proxy({}, { get: touch, ownKeys: touch, getOwnPropertyDescriptor: touch, getPrototypeOf: touch })]
    for (const error of inputs) expect(nativeZ02JobInsertSqlState(error)).toBe('unavailable')
    expect(touch).not.toHaveBeenCalled()
  })
  it('preserves absent original observation authority', () => {
    const report = vi.fn()
    expect(createNativeZ02JobInsertProbe(report)(undefined)).toBeUndefined()
    expect(report).not.toHaveBeenCalled()
  })
  it('delegates every original callback with exact error identity and reports first job_insert only', () => {
    const report = vi.fn(), original = vi.fn()
    const probe = createNativeZ02JobInsertProbe(report), first = { code: '42702', details: 'private' }
    const callback = probe(original)!
    callback('snapshot_upsert', { code: '23503' })
    callback('job_insert', first)
    callback('job_insert', { code: '42501' })
    probe(original)!('job_insert', { code: '23514' })
    expect(original).toHaveBeenCalledTimes(4)
    expect(original.mock.calls[1]![1]).toBe(first)
    expect(report.mock.calls).toEqual([[{ schemaVersion: 1, operationPort: 'job_insert', sqlState: '42702' }]])
    expect(first).toEqual({ code: '42702', details: 'private' })
  })
  it('preserves original callback exception identity', () => {
    const originalError = { code: 'private' }, report = vi.fn()
    const callback = createNativeZ02JobInsertProbe(report)(() => { throw originalError })!
    try { callback('job_insert', { code: '42702' }); expect.fail('must throw original') }
    catch (error) { expect(error).toBe(originalError) }
    expect(report).toHaveBeenCalledTimes(1)
  })
  it('keeps logger failures from changing the original callback', () => {
    const original = vi.fn(), error = { code: '42804' }
    const callback = createNativeZ02JobInsertProbe(() => { throw Error('private logger') })(original)!
    expect(() => callback('job_insert', error)).not.toThrow()
    expect(original.mock.calls[0]![1]).toBe(error)
  })
  it('qualifies the installed probe on the actual scoped runtime factory', async () => {
    const input = {}, error = { code: '42702' }, original = vi.fn(), log = vi.spyOn(console, 'info').mockImplementation(() => {})
    await z02DiagnosticRuntime.withZ02EnqueueDiagnosticPortWitness(input, async () => {
      const callback = z02DiagnosticRuntime.z02EnqueueDiagnosticPortObserver(input)!
      callback('job_insert', error)
    }, original)
    expect(original.mock.calls).toEqual([['job_insert', error]])
    expect(log.mock.calls).toEqual([['Z02_NATIVE_JOB_INSERT_SQLSTATE', JSON.stringify({ schemaVersion: 1, operationPort: 'job_insert', sqlState: '42702' })]])
    expect(z02DiagnosticRuntime.z02EnqueueDiagnosticPortObserver(input)).toBeUndefined()
  })
})


// Declared finite owner ports: component controls only, never native credit.
describe('same-cohort network prefix component controls', () => {
  const f = { companyId: 'own-company', actorUserId: 'own-actor', contractId: 'own-contract',
    marketActorId: 'own-network', receiver: 'own-ediel' }
  function ports() {
    const old = { artifactId: 'old', sourceHash: 'old-source', claimsHash: 'old-claims' }
    const next = { status: 'archived' as const, artifactId: 'next', sourceHash: 'next-source', claimsHash: 'next-claims', missing: [] }
    const method = { status: 'authorized', declarationId: 'same-declaration' }
    const issuer = { networkActorId: f.marketActorId, uploader: { id: 'own-uploader' }, reviewer: { id: 'own-reviewer' },
      clause: { locator: 'synthetic', quote: 'synthetic' }, pdf: vi.fn(() => Buffer.from('%PDF-synthetic')),
      submission: vi.fn(() => ({ environment: 'test', source: { version: '2' } })) }
    vi.spyOn(nativeBase, 'normalSwitchNetworkRegistry').mockReturnValue({ artifact: old, reviewerId: issuer.reviewer.id })
    vi.spyOn(nativeNetworkIssuer, 'attachNetworkRegistrySourceFixture').mockResolvedValue(issuer as never)
    const sql = vi.spyOn(nativeBase, 'nativeSql').mockReturnValue('same immutable contract/PDF/declaration/old-origin bytes')
    const methodRead = vi.spyOn(requestedMethodOwner, 'readContractRequestedMethodSource')
      .mockResolvedValueOnce(method as never)
      .mockResolvedValueOnce({ status: 'held', missing: ['ai_bi_network_registry_current_source_unqualified'] })
      .mockResolvedValue(method as never)
    const read = vi.spyOn(networkSourceOwners, 'readNetworkRegistrySourceArtifact')
      .mockResolvedValueOnce({ ...old, status: 'authorized' } as never)
      .mockResolvedValueOnce({ ...old, status: 'held' } as never)
      .mockResolvedValueOnce({ ...next, status: 'authorized', sourceVersion: '2', networkActorId: f.marketActorId, networkEdielId: f.receiver } as never)
      .mockResolvedValueOnce({ ...old, status: 'held' } as never)
    const archive = vi.spyOn(networkSourceOwners, 'archiveNetworkRegistrySource').mockResolvedValue(next)
    const review = vi.spyOn(networkSourceOwners, 'reviewNetworkRegistrySource').mockResolvedValue({ status: 'authorized', artifactId: next.artifactId, registryVersionId: 'next-version' })
    const operation = vi.fn(async () => ({ source: { actorId: f.marketActorId, legalEdielId: f.receiver } }))
    return { old, next, method, issuer, sql, methodRead, read, archive, review, operation }
  }
  it('uses the same cohort and independent reviewer, preserving source snapshots and import result', async () => {
    const p = ports(), imported = await p.operation()
    p.operation.mockClear(); p.operation.mockResolvedValue(imported)
    const actual = await withZ01SupplierCurrentNetworkPrefix(f, p.operation)
    expect(actual.registry).toBe(imported)
    expect(actual.networkRegistrySource).toEqual({ artifact: p.next, reviewerId: 'own-reviewer' })
    expect(p.operation).toHaveBeenCalledTimes(1)
    expect(p.archive.mock.calls[0]![0]).toMatchObject({ companyId: f.companyId, actorUserId: 'own-uploader', source: { version: '2' } })
    expect(p.review.mock.calls[0]![0]).toMatchObject({ companyId: f.companyId, actorUserId: 'own-reviewer', artifactId: 'next', sourceHash: 'next-source', claimsHash: 'next-claims', decision: 'approve' })
    expect(p.methodRead.mock.calls).toEqual(Array(3).fill([{ companyId: f.companyId, contractId: f.contractId, actorUserId: f.actorUserId, environment: 'test' }]))
    expect(p.sql).toHaveBeenCalledTimes(2)
    expect(p.sql.mock.calls[0]![0]).toBe(p.sql.mock.calls[1]![0])
    expect(nativeBase.normalSwitchNetworkRegistry(f.companyId)!.artifact).toBe(p.old)
  })
  it('stops before import when prior authority is unavailable', async () => {
    const p = ports(); p.read.mockReset().mockResolvedValue({ ...p.old, status: 'held' } as never)
    await expect(withZ01SupplierCurrentNetworkPrefix(f, p.operation)).rejects.toThrow()
    expect(p.operation).not.toHaveBeenCalled(); expect(p.archive).not.toHaveBeenCalled()
  })
  it('propagates the original import error without creating a replacement source', async () => {
    const p = ports(), original = { code: 'original-import-error' }; p.operation.mockRejectedValue(original)
    await expect(withZ01SupplierCurrentNetworkPrefix(f, p.operation)).rejects.toBe(original)
    expect(p.archive).not.toHaveBeenCalled(); expect(p.review).not.toHaveBeenCalled()
  })
  it('rejects a different imported network before archive', async () => {
    const p = ports(); p.operation.mockResolvedValue({ source: { actorId: 'foreign-network', legalEdielId: f.receiver } })
    await expect(withZ01SupplierCurrentNetworkPrefix(f, p.operation)).rejects.toThrow()
    expect(p.archive).not.toHaveBeenCalled()
  })
  it('requires a separate reviewer before any replacement archive', async () => {
    const p = ports(); p.issuer.reviewer.id = p.issuer.uploader.id
    await expect(withZ01SupplierCurrentNetworkPrefix(f, p.operation)).rejects.toThrow()
    expect(p.archive).not.toHaveBeenCalled(); expect(p.review).not.toHaveBeenCalled()
  })
  it('rejects changed signed-source snapshots after the replacement review', async () => {
    const p = ports(); p.sql.mockReturnValueOnce('immutable old bytes').mockReturnValueOnce('changed protected bytes')
    await expect(withZ01SupplierCurrentNetworkPrefix(f, p.operation)).rejects.toThrow()
    expect(p.review).toHaveBeenCalledTimes(1)
  })
})
