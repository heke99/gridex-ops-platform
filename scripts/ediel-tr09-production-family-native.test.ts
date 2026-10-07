// Prospective TR-09 production-family native baseline; no approval tag.
// Actual production mailbox/syntax/CONTRL owners and receiver PKI are called.
// Synthetic tenant, transport configuration and certificate-register inputs do
// not attest external production certification. No ready/live/approved evidence
// is planted. Global production admission remains an independent strict gate.
// Nodemailer is the sole injected external I/O port; no SMTP network is used.
import {createHash, randomUUID} from 'node:crypto'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {supabaseService} from '@/lib/supabase/service'
import {getEdielMessageById} from '@/lib/ediel/db'
import {buildContrlDraft} from '@/lib/ediel/ack'
import {createCanonicalAckMessage} from '@/lib/ediel/core/kernel'
import {resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
import {captureEdielTechnicalSyntaxAckEvidence, recordEdielTechnicalSyntaxDecision} from '@/lib/ediel/ack/technicalSyntaxAuthority'
import {assertEdielSmtpReadiness} from '@/lib/ediel/mailReadiness'
import {sendEdielMessageViaSmtp} from '@/lib/ediel/transport'
import {extractSmimeDer} from '@/lib/ediel/transport/smimeTransportArchive'
import {inspectCmsRecipientCertificateSet} from '@/lib/ediel/transport/cmsRecipientSet'
import {resolveEdielCertificateTrustAuthority} from '@/lib/ediel/security/certificateTrust'
import {literal, nativeSql as sql, seedNormalSwitchNativeFixture, futureNativeSupplyDate} from './helpers/ediel-normal-switch-native-fixture'
import {recordOriginalMailboxNativeReception, seedOriginalMailboxNative} from './helpers/originalMailboxNative'
import {publishSyntheticRecipientTrust} from './helpers/syntheticCertificateTrust'
import {closureFixture} from '../__tests__/helpers/closureWireFixtures'
import {utiltsNativeSourceFixture} from '../__tests__/helpers/utiltsNativeSourceFixture'

const provider = vi.hoisted(() => ({send: vi.fn(), options: vi.fn()}))
vi.mock('nodemailer', () => ({default: {createTransport: (options: unknown) => {
  provider.options(options)
  return {sendMail: (input: unknown) => provider.send(input)}
}}}))
const sha = (input: string | Buffer) => createHash('sha256').update(input).digest('hex')
const rpc = supabaseService.rpc.bind(supabaseService) as unknown as
  (name: string, args: Record<string, unknown>) => PromiseLike<{data: unknown; error: unknown}>
type Json = Record<string, unknown>
const targetHold = 'transport_exception_actual_approved_plaintext_source_required'
let prepareRequests = 0
let observedPrepareInput: Json | null = null
function capturePrepareInput(input: Json) {
  expect(observedPrepareInput).toBeNull()
  observedPrepareInput = structuredClone(input)
}
const errorMessage = (error: unknown) => error instanceof Error ? error.message :
  typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : String(error)

beforeEach(() => {
  provider.send.mockReset(); provider.options.mockReset()
  provider.send.mockImplementation(async () => {throw new Error('TR09_production_native_unexpected_provider_entry')})
  prepareRequests = 0
  observedPrepareInput = null
  vi.spyOn(supabaseService, 'rpc').mockImplementation(((name: string, args: Record<string, unknown>) => {
    const input = args.p_input as Json | undefined
    if (name === 'gridex_ediel_transport_attempt_v1' && input?.action === 'prepare') {
      prepareRequests++
      capturePrepareInput(input)
    }
    return rpc(name, args)
  }) as typeof supabaseService.rpc)
  for (const [key, value] of Object.entries({EDIEL_SHARED_MAILBOX_ADDRESS: 'synthetic@example.invalid',
    EDIEL_APP_DKIM_ENABLED: 'false', EMAIL_PROVIDER: 'resend', EDIEL_EMAIL_PROVIDER: 'strato',
    EDIEL_SMTP_FROM: 'synthetic@example.invalid', EDIEL_SMTP_HOST: 'smtp.example.invalid',
    EDIEL_SMTP_PORT: '465', EDIEL_SMTP_USER: 'synthetic@example.invalid', EDIEL_SMTP_PASS: 'synthetic-only'})) vi.stubEnv(key, value)
})
afterEach(() => {vi.restoreAllMocks(); vi.unstubAllEnvs()})

async function productionContrl(encrypted: boolean) {
  // The unchanged normal fixture supplies its own legitimate customer/contract
  // graph. Its test original is deferred, never relabelled as production.
  const f = await seedNormalSwitchNativeFixture({deferOriginal: true, requestedStartDate: futureNativeSupplyDate()})
  const sourceId = randomUUID(), routeId = randomUUID(), profileId = randomUUID(), certificateId = randomUUID()
  const smtp = assertEdielSmtpReadiness(), recipientEmail = 'recipient@example.invalid'
  // A separate prospective public production transport endpoint. This is not
  // a legal market identity, certification result or production-live approval.
  sql(`INSERT INTO public.tenant_actor_identifiers(company_id,environment,actor_id,identifier_type,identifier_value,valid_from)
    VALUES(${literal(f.companyId)},'production',${literal(f.actorUserId)},'EdielId',${literal(f.sender)},clock_timestamp()-interval '1 day');`)
  const trust = encrypted ? publishSyntheticRecipientTrust({companyId: f.companyId, actorUserId: f.actorUserId,
    environment: 'production', receiverEdielId: f.receiver, recipientEmail}) : null
  if (trust) sql(`INSERT INTO public.ediel_certificates(id,company_id,certificate_fingerprint,secret_reference,status,environment,
    subject,issuer,serial_number,fingerprint_sha256,public_certificate_pem,valid_from,valid_to,owner_ediel_id,message_family,message_type,purpose,usage)
    VALUES(${literal(certificateId)},${literal(f.companyId)},${literal(trust.leaf.fingerprint256)},'public://synthetic-tr09-production','active','production',
    ${literal(trust.leaf.subject)},${literal(trust.leaf.issuer)},${literal(trust.leaf.serialNumber)},${literal(trust.fingerprint)},${literal(trust.leafPem)},
    ${literal(new Date(trust.leaf.validFrom).toISOString())},${literal(new Date(trust.leaf.validTo).toISOString())},${literal(f.receiver)},'CONTRL','CONTRL','encryption','outbound_recipient');`)
  sql(`INSERT INTO public.communication_routes(id,company_id,route_name,route_scope,environment_type,is_active,target_email)
    VALUES(${literal(routeId)},${literal(f.companyId)},'Synthetic production technical reply','ediel_ack','production',true,${literal(recipientEmail)});
    INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,payload_format,
      sender_ediel_id,receiver_ediel_id,application_reference,is_enabled,is_active,transport_security_mode,encryption_mode,tls_required,
      smtp_to,receiver_email,message_family,business_code,mailbox,smtp_host,smtp_port,receiver_certificate_id)
    VALUES(${literal(profileId)},${literal(f.companyId)},${literal(routeId)},'Synthetic production CONTRL profile','production','edifact','edifact',
      ${literal(f.sender)},${literal(f.receiver)},'23-DDQ-PRODAT',true,true,${literal(encrypted ? 'required_encrypted' : 'unencrypted')},
      ${literal(encrypted ? 'smime' : 'none')},true,${literal(recipientEmail)},${literal(recipientEmail)},'CONTRL','CONTRL',
      ${literal(smtp.from)},${literal(smtp.host)},${literal(smtp.port)},${literal(trust ? certificateId : null)});`)
  const prospective = closureFixture({reason: 'Z24', document: `D${sourceId.replaceAll('-', '').slice(0, 13)}`}).wire
    .replaceAll('12345:14', `${f.receiver}:14`).replaceAll('12345:160:SVK', `${f.receiver}:160:SVK`)
    .replaceAll('54321:14', `${f.sender}:14`).replaceAll('54321:160:SVK', `${f.sender}:160:SVK`)
    // The bare fixture reference I also occurs in NAD IT. Give just UNB/UNZ
    // an own reference before the existing strict source-input helper parses.
    .replace(/\+I(\+\+23-DDQ-PRODAT)/, `+X${sourceId.replaceAll('-', '').slice(0, 12)}$1`)
    .replace(/UNZ\+1\+I'/, `UNZ+1+X${sourceId.replaceAll('-', '').slice(0, 12)}'`)
  const wire = utiltsNativeSourceFixture(prospective, sourceId).raw
  const mail = await seedOriginalMailboxNative(sql, literal, {companyId: f.companyId, environment: 'production', raw: wire, smtpFrom: smtp.from})
  sql(`INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,parsed_payload,
    message_received_at,application_reference,sender_ediel_id,receiver_ediel_id,interchange_reference,inbound_email_message_id,mailbox_message_id,
    canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)
    SELECT ${literal(sourceId)},${literal(f.companyId)},'production','inbound','edifact','PRODAT','Z05','received',${literal(wire)},'{}',clock_timestamp(),
      '23-DDQ-PRODAT',${literal(f.receiver)},${literal(f.sender)},${literal(mail.parsed.interchangeReference)},${literal(mail.inboundEmailMessageId)},
      ${literal(mail.inboundEmailMessageId)},pack.id,profile.profile_key,profile.id,pack.guide_version||':r'||pack.guide_revision,pack.source_hash,profile.profile
    FROM public.ediel_message_profiles profile JOIN public.ediel_rule_packs pack ON pack.id=profile.rule_pack_id
    WHERE profile.profile_key='PRODAT:Z05:C:26.A:r3' AND profile.is_enabled;`)
  await recordOriginalMailboxNativeReception({...mail, companyId: f.companyId, sourceMessageId: sourceId, actorUserId: f.actorUserId})
  const source = await getEdielMessageById(sourceId, {companyId: f.companyId})
  expect(source).not.toBeNull()
  const decision = await resolveCanonicalRuntimeDecisionWithRegistry(source!)
  expect(decision.syntaxDecision).toBe('accepted')
  if (decision.syntaxDecision !== 'accepted') throw new Error('native_actual_production_syntax_not_accepted')
  await recordEdielTechnicalSyntaxDecision({companyId: f.companyId, sourceMessageId: sourceId, sourceHash: sha(wire),
    syntaxDecision: decision.syntaxDecision, reasonCodes: [], execution: {actorUserId: f.actorUserId, phase: 'prepare'}})
  const evidence = await captureEdielTechnicalSyntaxAckEvidence(f.companyId, sourceId, {actorUserId: f.actorUserId, phase: 'prepare'})
  expect(evidence).toMatchObject({environment: 'production', sourceMessageId: sourceId, sourceHash: sha(wire)})
  const ack = await createCanonicalAckMessage({actorUserId: f.actorUserId, sourceMessage: source!, ackFamily: 'CONTRL', outcome: 'positive',
    draft: buildContrlDraft({actorUserId: f.actorUserId, sourceMessage: source!, outcome: 'positive'})})
  expect(ack).toMatchObject({company_id: f.companyId, environment: 'production', direction: 'outbound', message_family: 'CONTRL',
    related_message_id: sourceId, communication_route_id: routeId, sender_ediel_id: f.sender, receiver_ediel_id: f.receiver})
  expect(ack.raw_payload).toBeTruthy()
  expect(sql(`SELECT to_jsonb(s.environment='production' AND s.status='ready' AND s.payload_sha256=${literal(sha(wire))}
    AND s.evidence#>>'{originalUNB,testIndicator}'='' AND r.environment='production' AND r.payload_sha256=s.payload_sha256
    AND r.evidence=${literal(evidence)}::jsonb) FROM gridex_ediel_technical_ack.sources s
    JOIN gridex_ediel_technical_ack.replies r USING(source_message_id) WHERE s.source_message_id=${literal(sourceId)}`)).toBe(true)
  return {f, source: source!, ack, evidence, trust, certificateId, routeId, profileId}
}
type Fixture = Awaited<ReturnType<typeof productionContrl>>
const rows = (table: string, predicate: string) => `(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]') FROM ${table} t WHERE ${predicate})`
function graph(s: Fixture) {
  const company = `t.company_id=${literal(s.f.companyId)}`
  const tables = ['public.customers', 'public.customer_sites', 'public.metering_points', 'public.customer_contracts', 'public.supplier_switch_requests',
    'public.customer_supply_periods', 'public.ediel_outbox', 'gridex_received_sources.supply_object_effect_receipts',
    'gridex_received_sources.supply_object_partitions', 'gridex_received_sources.supply_source_transitions',
    'gridex_ediel_technical_ack.sources', 'gridex_ediel_technical_ack.syntax_facets', 'gridex_ediel_technical_ack.replies']
  return sql<Json>(`SELECT jsonb_build_object(${tables.map(table => `${literal(table)},${rows(table, company)}`).join(',')})`)
}
const messages = (s: Fixture) => sql<Json[]>(`SELECT ${rows('public.ediel_messages', `t.company_id=${literal(s.f.companyId)}`)}`)
const archives = (s: Fixture) => sql<Array<Json & {id: string}>>(`SELECT ${rows('public.ediel_message_payloads', `t.company_id=${literal(s.f.companyId)}`)}`)
const original = (s: Fixture) => sql<{raw: string; hash: string; rendered: string | null}>(`SELECT jsonb_build_object('raw',raw_payload,'hash',immutable_payload_hash,'rendered',immutable_rendered_at)
  FROM public.ediel_messages WHERE id=${literal(s.ack.id)} AND company_id=${literal(s.f.companyId)}`)
const effects = (s: Fixture) => sql(`SELECT jsonb_build_object(
  'attempts',(SELECT count(*) FROM gridex_ediel_transport.attempts WHERE company_id=${literal(s.f.companyId)}),
  'reservations',(SELECT count(*) FROM gridex_ediel_transport.reservations WHERE message_id IN(SELECT id FROM public.ediel_messages WHERE company_id=${literal(s.f.companyId)})),
  'entries',(SELECT count(*) FROM gridex_ediel_transport.attempts WHERE company_id=${literal(s.f.companyId)} AND entered_at IS NOT NULL),
  'dispatchAttempts',(SELECT count(*) FROM gridex_outbound_dispatch.attempts WHERE company_id=${literal(s.f.companyId)}),
  'dispatchEntries',(SELECT count(*) FROM gridex_outbound_dispatch.events WHERE company_id=${literal(s.f.companyId)} AND kind='provider_call_entered'),
  'approvals',(SELECT count(*) FROM gridex_transport_exception.approvals WHERE company_id=${literal(s.f.companyId)}),
  'operations',(SELECT count(*) FROM gridex_transport_exception.operations WHERE company_id=${literal(s.f.companyId)}),
  'exceptionEvents',(SELECT count(*) FROM gridex_transport_exception.events WHERE company_id=${literal(s.f.companyId)}),
  'alarms',(SELECT count(*) FROM gridex_transport_exception.alarms WHERE company_id=${literal(s.f.companyId)}))`)
const zeroEffects = {attempts: 0, reservations: 0, entries: 0, dispatchAttempts: 0, dispatchEntries: 0,
  approvals: 0, operations: 0, exceptionEvents: 0, alarms: 0}
function before(s: Fixture) {
  expect(effects(s)).toEqual(zeroEffects)
  expect(original(s)).toMatchObject({raw: s.ack.raw_payload, hash: sha(s.ack.raw_payload!)})
  expect(original(s).rendered).not.toBeNull()
  return {graph: graph(s), messages: messages(s), archives: archives(s), original: original(s)}
}
function preserved(s: Fixture, prior: ReturnType<typeof before>, refusal: boolean) {
  expect(graph(s)).toEqual(prior.graph)
  expect(original(s)).toEqual(prior.original)
  const currentMessages = messages(s)
  for (const row of prior.messages.filter(row => row.id !== s.ack.id)) expect(currentMessages.find(candidate => candidate.id === row.id)).toEqual(row)
  if (refusal) {expect(messages(s)).toEqual(prior.messages); expect(effects(s)).toEqual(zeroEffects); expect(provider.send).not.toHaveBeenCalled()}
  // Public sender preparation may add real payload/MIME archives and manual
  // diagnostic events. Every existing archive and every original stays exact.
  const current = archives(s)
  for (const row of prior.archives) expect(current.find(candidate => candidate.id === row.id)).toEqual(row)
}
async function observedSend(s: Fixture, mimeMode?: string) {
  try {return {result: await sendEdielMessageViaSmtp(s.ack, {actorUserId: s.f.actorUserId, smtpMimeMode: mimeMode}), error: null}}
  catch (error) {return {result: null, error}}
}
async function assertEncryptedPreparationArchive(s: Fixture, prior: ReturnType<typeof before>, label: string) {
  // The actual sender archives these bytes before its private prepare RPC.
  // This preparation proof supplies no activation or provider acceptance.
  expect(prepareRequests).toBe(1)
  expect(observedPrepareInput).toMatchObject({companyId: s.f.companyId, environment: 'production',
    messageId: s.ack.id, actorUserId: s.f.actorUserId, action: 'prepare'})
  const binding = observedPrepareInput!.binding as Json
  expect(binding).toMatchObject({mode: 'raw', mimeMode: 'ediel-smime-enveloped',
    originalHash: sha(s.ack.raw_payload!), technicalSyntaxAckEvidence: s.evidence, sourceRulePackEvidence: null})
  expect(typeof binding.rawBase64).toBe('string')
  const previousIds = new Set(prior.archives.map(row => row.id))
  const fresh = archives(s).filter(row => !previousIds.has(row.id) && row.ediel_message_id === s.ack.id && row.payload_kind === 'smime_enveloped')
  expect(fresh).toHaveLength(1)
  const snapshot = fresh[0], metadata = snapshot.metadata as Json
  expect(snapshot).toMatchObject({id: binding.mimePayloadSnapshotId, company_id: s.f.companyId,
    ediel_message_id: s.ack.id, payload_kind: 'smime_enveloped', raw_payload: null, raw_payload_hash: null,
    encryption_mode: 'smime', certificate_fingerprint: s.trust!.fingerprint, certificate_fingerprint_sha256: s.trust!.fingerprint})
  const expectedPath = `transport/${s.f.companyId}/${s.ack.id}/${binding.mimeSha256}.eml`
  expect(binding.mimeArchiveRef).toBe(`storage://ediel-files/${expectedPath}`)
  expect(snapshot.encrypted_payload_ref).toBe(binding.mimeArchiveRef)
  const downloaded = await supabaseService.storage.from('ediel-files').download(expectedPath)
  expect(downloaded.error).toBeNull(); expect(downloaded.data).not.toBeNull()
  const raw = Buffer.from(await downloaded.data!.arrayBuffer()), der = extractSmimeDer(raw)
  expect(raw).toEqual(Buffer.from(binding.rawBase64 as string, 'base64'))
  expect(sha(raw)).toBe(binding.mimeSha256)
  expect(raw.length).toBe(binding.mimeLength)
  const headers = raw.toString('ascii').split(/\r?\n\r?\n/, 1)[0].replace(/\r?\n[ \t]+/g, ' ')
  const messageIds = headers.split(/\r?\n/).filter(line => /^message-id:/i.test(line))
  expect(messageIds).toHaveLength(1)
  const rfcMessageId = messageIds[0].slice('message-id:'.length).trim()
  expect(rfcMessageId).toMatch(/^<[^\s<>]+>$/)
  expect(rfcMessageId).toBe(binding.rfcMessageId)
  expect(metadata).toMatchObject({mimeMode: 'ediel-smime-enveloped', archive_bucket: 'ediel-files',
    archive_path: expectedPath, archive_verified: true, archived_mime_sha256: sha(raw), archived_mime_bytes: raw.length,
    archived_rfc_message_id: rfcMessageId, archived_encrypted_payload_sha256: sha(der),
    encryptedPayloadSha256: sha(der), encryptedPayloadLength: der.length,
    expected_receiver_certificate_id: s.certificateId, expected_receiver_certificate_fingerprint: s.trust!.fingerprint,
    cmsExpectedReceiverPresent: true})
  const authority = await resolveEdielCertificateTrustAuthority({companyId: s.f.companyId,
    environment: 'production', receiverEdielId: s.f.receiver})
  expect(authority).toMatchObject({companyId: s.f.companyId, environment: 'production', receiverEdielId: s.f.receiver,
    registrationId: s.trust!.registrationId, recipientFingerprints: [s.trust!.fingerprint]})
  expect(typeof authority!.registerVersion).toBe('string'); expect(authority!.registerVersion).not.toBe('')
  expect(metadata.sourceRecipientTrustEvidence).toMatchObject({verified: true,
    registrationId: s.trust!.registrationId, registerVersion: authority!.registerVersion, leafFingerprint: s.trust!.fingerprint})
  expect(sql(`SELECT to_jsonb(c.company_id=${literal(s.f.companyId)}::uuid AND c.environment='production'
    AND c.owner_ediel_id=${literal(s.f.receiver)} AND c.fingerprint_sha256=${literal(s.trust!.fingerprint)}
    AND c.public_certificate_pem=${literal(s.trust!.leafPem)}) FROM public.ediel_certificates c WHERE c.id=${literal(s.certificateId)}`)).toBe(true)
  expect(inspectCmsRecipientCertificateSet({encryptedDer: der, recipientCertificatePems: [s.trust!.leafPem]}))
    .toMatchObject({expectedReceiverPresent: true, recipientCount: 1})
  expect(raw.includes(Buffer.from(s.ack.raw_payload!, 'latin1'))).toBe(false)
  console.info('TR09 production archive preparation', {case: label, archivePhase: 'PASS',
    privatePrepareObserved: true, intendedRecipientCount: 1, providerCalls: provider.send.mock.calls.length})
}
function reach(s: Fixture, label: string, error: unknown) {
  // No raw MIME, wire, customer rows, credentials or authority payloads logged.
  const gate = sql<Json>(`SELECT to_jsonb(d) FROM public.canonical_tenant_operation_decision(${literal(s.f.companyId)},'ediel.production.send') d`)
  console.info('TR09 production native boundary', {case: label, prepareRequests, providerCalls: provider.send.mock.calls.length,
    errorCode: error === null ? null : errorMessage(error).match(/^[A-Za-z0-9_]+/)?.[0] ?? 'unclassified', productionOperation: gate,
    newMimeArchives: archives(s).filter(row => row.payload_kind === 'raw_mime' || row.payload_kind === 'smime_enveloped').length})
}

it('production-born CONTRL default plaintext has no approved source and cannot enter SMTP', async () => {
  const s = await productionContrl(false), prior = before(s)
  const actual = await observedSend(s)
  reach(s, 'default-plaintext', actual.error)
  preserved(s, prior, true)
  expect(actual.result).toBeNull()
  expect(errorMessage(actual.error)).toBe(targetHold)
})

for (const mode of ['nodemailer-attachment', 'ediel-singlepart-base64', 'ediel-singlepart-lines', 'ediel-singlepart-compact']) {
  it(`production-born CONTRL refuses plaintext override ${mode} with a genuine encrypted route`, async () => {
    const s = await productionContrl(true), prior = before(s)
    const actual = await observedSend(s, mode)
    reach(s, mode, actual.error)
    preserved(s, prior, true)
    expect(actual.result).toBeNull()
    expect(errorMessage(actual.error)).toBe(targetHold)
  })
}

it('production-born CONTRL actual public prepare rejects an adversarial plaintext binding before private stage effects', async () => {
  const s = await productionContrl(true), prior = before(s)
  const preparation: {input: Json | null; prior: ReturnType<typeof before> | null} = {input: null, prior: null}
  vi.spyOn(supabaseService, 'rpc').mockImplementation(((name: string, args: Record<string, unknown>) => {
    const input = args.p_input as Json | undefined
    if (name === 'gridex_ediel_transport_attempt_v1' && input?.action === 'prepare') {
      prepareRequests++
      capturePrepareInput(input)
      preparation.input = structuredClone(input)
      preparation.prior = before(s)
      // Forward the real request. Alter only the adversarial caller MIME
      // marker; no owner receipt, decision, archived bytes or result is forged.
      return rpc(name, {...args, p_input: {...input, binding: {...input.binding as Json, mimeMode: 'ediel-singlepart-base64'}}})
    }
    return rpc(name, args)
  }) as typeof supabaseService.rpc)
  const actual = await observedSend(s, 'ediel-smime-enveloped')
  reach(s, 'actual-prepare-adversarial-binding', actual.error)
  preserved(s, prior, true)
  if (preparation.prior) {preserved(s, preparation.prior, true); expect(archives(s)).toEqual(preparation.prior.archives)}
  expect(preparation.input).not.toBeNull()
  expect(preparation.input?.binding).toMatchObject({mimeMode: 'ediel-smime-enveloped', technicalSyntaxAckEvidence: s.evidence})
  await assertEncryptedPreparationArchive(s, prior, 'actual-prepare-adversarial-binding')
  expect(actual.result).toBeNull()
  expect(errorMessage(actual.error)).toBe(targetHold)
})

for (const mode of [undefined, 'ediel-smime-enveloped']) {
  it(`production-born CONTRL genuine receiver S/MIME ${mode ?? 'default'} observes once and retries without SMTP`, async () => {
    const s = await productionContrl(true), prior = before(s)
    provider.send.mockImplementation(async (input: {raw?: Buffer}) => {
      expect(Buffer.isBuffer(input.raw)).toBe(true)
      expect(inspectCmsRecipientCertificateSet({encryptedDer: extractSmimeDer(input.raw!), recipientCertificatePems: [s.trust!.leafPem]}))
        .toMatchObject({expectedReceiverPresent: true, recipientCount: 1})
      expect(input.raw!.includes(Buffer.from(s.ack.raw_payload!, 'latin1'))).toBe(false)
      const binding = sql<Json>(`SELECT binding FROM gridex_ediel_transport.attempts WHERE message_id=${literal(s.ack.id)} AND entered_at IS NOT NULL`)
      expect(binding).toMatchObject({mimeMode: 'ediel-smime-enveloped', technicalSyntaxAckEvidence: s.evidence, sourceRulePackEvidence: null,
        originalHash: sha(s.ack.raw_payload!), mimeSha256: sha(input.raw!)})
      const reference = String(binding.mimeArchiveRef)
      expect(reference.startsWith('storage://ediel-files/')).toBe(true)
      const archived = await supabaseService.storage.from('ediel-files').download(reference.slice('storage://ediel-files/'.length))
      expect(archived.error).toBeNull(); expect(archived.data).not.toBeNull()
      expect(Buffer.from(await archived.data!.arrayBuffer())).toEqual(input.raw)
      return {accepted: [s.ack.receiver_email], rejected: [], messageId: `synthetic-production-${s.ack.id}`, response: '250 synthetic accepted'}
    })
    const actual = await observedSend(s, mode)
    reach(s, `smime-${mode ?? 'default'}`, actual.error)
    preserved(s, prior, actual.error !== null)
    await assertEncryptedPreparationArchive(s, prior, `smime-${mode ?? 'default'}`)
    // Keep the positive oracle strict when an earlier genuine production gate
    // blocks entry. Later certificate/receipt/retry proof is then NOT_REACHED.
    expect(actual.error).toBeNull()
    expect(actual.result).toMatchObject({accepted: [s.ack.receiver_email], rejected: [], messageId: `synthetic-production-${s.ack.id}`})
    expect(provider.send).toHaveBeenCalledTimes(1)
    expect(provider.options).toHaveBeenLastCalledWith(expect.objectContaining({requireTLS: true, tls: {rejectUnauthorized: true, minVersion: 'TLSv1.2'}}))
    expect(effects(s)).toEqual({...zeroEffects, attempts: 1, reservations: 1, entries: 1})
    const sent = await getEdielMessageById(s.ack.id, {companyId: s.f.companyId})
    expect(sent).toMatchObject({status: 'sent', was_smime_encrypted: true, expected_receiver_certificate_id: s.certificateId, cms_expected_receiver_present: true})
    const acceptedState = sql(`SELECT to_jsonb(a) FROM gridex_ediel_transport.attempts a WHERE message_id=${literal(s.ack.id)}`)
    const retry = await sendEdielMessageViaSmtp(sent!, {actorUserId: s.f.actorUserId, smtpMimeMode: mode})
    expect(retry).toEqual(actual.result)
    expect(provider.send).toHaveBeenCalledTimes(1)
    expect(sql(`SELECT to_jsonb(a) FROM gridex_ediel_transport.attempts a WHERE message_id=${literal(s.ack.id)}`)).toEqual(acceptedState)
    preserved(s, prior, false)
  })
}
