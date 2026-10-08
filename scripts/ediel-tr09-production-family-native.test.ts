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
import {resolveOutboundRecipientCertificate} from '@/lib/ediel/security/outboundRecipientCertificate'
import {resolveMailboxPasswordFromSecretReference} from '@/lib/inbound-mail/edielMailboxPoller'
import {runProductionDryRun} from '@/lib/ediel/productionReadiness'
import {literal, nativeSql as sql, seedNormalSwitchNativeFixture, futureNativeSupplyDate} from './helpers/ediel-normal-switch-native-fixture'
import {recordOriginalMailboxNativeReception, seedOriginalMailboxNative} from './helpers/originalMailboxNative'
import {publishSyntheticRecipientTrust} from './helpers/syntheticCertificateTrust'
import {closureFixture} from '../__tests__/helpers/closureWireFixtures'
import {utiltsNativeSourceFixture} from '../__tests__/helpers/utiltsNativeSourceFixture'
import {nativeForeignRowArrayImage, type NativeForeignImage} from './helpers/ediel-tr09-native-foreign-image'

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
  const prospectiveTransport = {receiver: '99001', recipientEmail: 'prodat-recipient@example.invalid',
    routeId: randomUUID(), profileId: randomUUID(), mailboxId: randomUUID(), certificateId: randomUUID(),
    testRouteId: randomUUID(), testRouteProfileId: randomUUID()}
  const fixture = {f, source: source!, ack, evidence, trust, certificateId, routeId, profileId, prospective: prospectiveTransport}
  await configureProspectiveProfiles(fixture)
  await diagnoseProductionPrerequisites(fixture)
  return fixture
}
type Fixture = Awaited<ReturnType<typeof productionContrl>>
const configurationTables = ['ediel_actor_settings', 'canonical_ediel_profile_identities', 'ediel_configuration_snapshots',
    'canonical_command_results', 'canonical_audit_events', 'company_provisioning_jobs', 'ediel_test_runs',
    'actor_test_results', 'ediel_production_readiness_checks', 'ediel_go_live_events', 'ediel_production_state',
    'company_capabilities', 'ediel_certification_evidence', 'tenant_legal_profiles', 'communication_routes', 'ediel_route_profiles', 'ediel_mailboxes', 'ediel_certificates', 'ediel_route_history']
function configurationImage(companyId: string) {
  return sql<Record<string, Json[]>>(`SELECT jsonb_build_object(${configurationTables.map(table =>
    `${literal(table)},${rows(`public.${table}`, `t.company_id=${literal(companyId)}`)}`).join(',')})`)
}
function foreignConfigurationImage(companyId: string) {
  const captured = sql<Record<string, NativeForeignImage>>(`SELECT jsonb_build_object(${configurationTables.map(table =>
    `${literal(table)},${nativeForeignRowArrayImage(rows(`public.${table}`, `t.company_id IS DISTINCT FROM ${literal(companyId)}`))}`).join(',')})`)
  expect(Object.keys(captured).sort()).toEqual([...configurationTables].sort())
  for (const value of Object.values(captured)) {
    expect(Object.keys(value).sort()).toEqual(['rowCount', 'sha256'])
    expect(Number.isInteger(value.rowCount)).toBe(true); expect(value.rowCount).toBeGreaterThanOrEqual(0)
    expect(value.sha256).toMatch(/^[0-9a-f]{64}$/)
  }
  return captured
}
async function configureProspectiveTransport(s: Fixture) {
  // A separate synthetic configuration endpoint, never a licensed market
  // counterparty, passed certification, live transition or provider result.
  const p = s.prospective, smtp = assertEdielSmtpReadiness()
  expect([s.f.sender, s.f.receiver]).not.toContain(p.receiver)
  const contrlInput = {companyId: s.f.companyId, receiverEdielId: s.f.receiver, routeProfileId: s.profileId,
    environment: 'production', certificateEnvironment: 'production', messageFamily: 'CONTRL', businessCode: 'CONTRL',
    smtpTo: 'recipient@example.invalid', ownEdielId: s.f.sender}
  const originalRecipient = s.trust ? await resolveOutboundRecipientCertificate(contrlInput) : null
  // Real protected owner publication is separate from the six configuration
  // INSERTs below; the original recipient registration/materials stay intact.
  const trust = publishSyntheticRecipientTrust({companyId: s.f.companyId, actorUserId: s.f.actorUserId,
    environment: 'production', receiverEdielId: p.receiver, recipientEmail: p.recipientEmail})
  if (s.trust) {
    expect(trust.registrationId).not.toBe(s.trust.registrationId)
    expect(trust.fingerprint).not.toBe(s.trust.fingerprint)
  }
  const prior = before(s), old = configurationImage(s.f.companyId), foreign = foreignConfigurationImage(s.f.companyId)
  const company = () => sql<Json>(`SELECT to_jsonb(c) FROM public.companies c WHERE id=${literal(s.f.companyId)}`)
  const oldCompany = company()
  const supplierProfiles = old.ediel_actor_settings.filter(row => row.is_active === true && (row.role ?? row.actor_role) === 'supplier')
  const profilesFor = (environment: string) => supplierProfiles.filter(row => row.environment === environment)
  expect(profilesFor('test')).toHaveLength(1); expect(profilesFor('production')).toHaveLength(1)
  const testActorProfile = profilesFor('test')[0], productionActorProfile = profilesFor('production')[0]
  expect(testActorProfile.actor_ediel_id).toBe(s.f.sender); expect(productionActorProfile.actor_ediel_id).toBe(s.f.sender)
  sql(`INSERT INTO public.ediel_certificates(id,company_id,certificate_fingerprint,secret_reference,status,environment,
    subject,issuer,serial_number,fingerprint_sha256,public_certificate_pem,valid_from,valid_to,owner_ediel_id,message_family,purpose,usage)
    VALUES(${literal(p.certificateId)},${literal(s.f.companyId)},${literal(trust.leaf.fingerprint256)},'public://synthetic-tr09-prodat','active','production',
      ${literal(trust.leaf.subject)},${literal(trust.leaf.issuer)},${literal(trust.leaf.serialNumber)},${literal(trust.fingerprint)},${literal(trust.leafPem)},
      ${literal(new Date(trust.leaf.validFrom).toISOString())},${literal(new Date(trust.leaf.validTo).toISOString())},${literal(p.receiver)},'PRODAT','encryption','outbound_recipient');
    INSERT INTO public.communication_routes(id,company_id,route_name,route_scope,environment_type,is_active,target_email)
    VALUES(${literal(p.routeId)},${literal(s.f.companyId)},'Synthetic prospective PRODAT endpoint','supplier_switch','production',true,${literal(p.recipientEmail)});
    INSERT INTO public.ediel_mailboxes(id,company_id,environment,mailbox_name,email_address,username,secret_reference,mailbox_type,
      tls_required,smtp_from,is_shared_platform_mailbox)
    VALUES(${literal(p.mailboxId)},${literal(s.f.companyId)},'production','Synthetic own prospective mailbox',${literal(smtp.from)},
      ${literal(process.env.EDIEL_SMTP_USER)},'env:EDIEL_SMTP_PASS','company',true,${literal(smtp.from)},false);
    INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,payload_format,
      sender_ediel_id,receiver_ediel_id,receiver_source,application_reference,is_enabled,is_active,transport_security_mode,encryption_mode,tls_required,
      smtp_to,receiver_email,message_family,mailbox_id,mailbox,smtp_host,smtp_port,receiver_certificate_id,actor_setting_id)
    VALUES(${literal(p.profileId)},${literal(s.f.companyId)},${literal(p.routeId)},'Synthetic prospective PRODAT profile','production','edifact','edifact',
      ${literal(s.f.sender)},${literal(p.receiver)},'fixed_counterparty','23-DDQ-PRODAT',true,true,'required_encrypted','smime',true,
      ${literal(p.recipientEmail)},${literal(p.recipientEmail)},'PRODAT',${literal(p.mailboxId)},${literal(smtp.from)},
      ${literal(smtp.host)},${literal(smtp.port)},${literal(p.certificateId)},${literal(String(productionActorProfile.id))});
    INSERT INTO public.communication_routes(id,company_id,route_name,route_scope,environment_type,is_active,target_email,grid_owner_id)
    VALUES(${literal(p.testRouteId)},${literal(s.f.companyId)},'Synthetic supplier-bound bilateral test endpoint','supplier_switch',
      'bilateral_test',true,'recipient@example.invalid',${literal(s.f.gridId)});
    INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,payload_format,
      sender_ediel_id,receiver_ediel_id,application_reference,is_enabled,is_active,transport_security_mode,encryption_mode,tls_required,
      smtp_to,receiver_email,message_family,business_code,mailbox,smtp_host,smtp_port,actor_setting_id)
    VALUES(${literal(p.testRouteProfileId)},${literal(s.f.companyId)},${literal(p.testRouteId)},'Synthetic supplier-bound test PRODAT profile',
      'test','edifact','edifact',${literal(s.f.sender)},${literal(s.f.receiver)},'23-DDQ-PRODAT',true,true,'unencrypted','none',true,
      'recipient@example.invalid','recipient@example.invalid','PRODAT','Z03',${literal(smtp.from)},${literal(smtp.host)},
      ${literal(smtp.port)},${literal(String(testActorProfile.id))});`)
  const next = configurationImage(s.f.companyId)
  const added = (table: string) => next[table].filter(row => !old[table].some(previous => previous.id === row.id))
  for (const table of configurationTables.filter(table => !['ediel_test_runs', 'actor_test_results',
    'ediel_production_readiness_checks', 'ediel_go_live_events', 'ediel_production_state'].includes(table))) {
    for (const row of old[table]) expect(next[table].find(current => current.id === row.id)).toEqual(row)
  }
  for (const [table, ids] of [
    ['communication_routes', [p.routeId, p.testRouteId]], ['ediel_route_profiles', [p.profileId, p.testRouteProfileId]],
    ['ediel_mailboxes', [p.mailboxId]], ['ediel_certificates', [p.certificateId]],
  ] as const) expect(added(table).map(row => row.id).sort()).toEqual([...ids].sort())
  expect(added('ediel_route_profiles').find(row => row.id === p.profileId)).toMatchObject({actor_setting_id: productionActorProfile.id})
  expect(added('ediel_route_profiles').find(row => row.id === p.testRouteProfileId)).toMatchObject({actor_setting_id: testActorProfile.id,
    environment: 'test', sender_ediel_id: s.f.sender, receiver_ediel_id: s.f.receiver, tls_required: true})
  for (const table of ['ediel_actor_settings', 'canonical_ediel_profile_identities', 'canonical_command_results',
    'canonical_audit_events', 'company_capabilities', 'ediel_certification_evidence', 'tenant_legal_profiles']) expect(next[table]).toEqual(old[table])
  expect(company()).toEqual(oldCompany)
  const mailbox = added('ediel_mailboxes')[0]
  expect(mailbox).toMatchObject({company_id: s.f.companyId, environment: 'production', secret_reference: 'env:EDIEL_SMTP_PASS',
    security_status: 'not_checked', last_polled_at: null, is_shared_platform_mailbox: false, tls_required: true})
  expect(resolveMailboxPasswordFromSecretReference({id: p.mailboxId, environment: 'production', secret_reference: String(mailbox.secret_reference)}))
    .toBe(process.env.EDIEL_SMTP_PASS)
  expect(process.env.EDIEL_SMTP_PASS).toBeTruthy()
  const snapshots = added('ediel_configuration_snapshots')
  expect(snapshots).toHaveLength(4)
  expect(snapshots.map(row => row.reason).sort()).toEqual(['ediel_certificates_changed', 'ediel_mailboxes_changed', 'ediel_route_profiles_changed', 'ediel_route_profiles_changed'])
  for (const snapshot of snapshots) {
    const payload = sql<string>(`SELECT to_jsonb(payload::text) FROM public.ediel_configuration_snapshots WHERE id=${literal(String(snapshot.id))}`)
    expect(snapshot.configuration_hash).toBe(sha(payload))
  }
  const jobs = added('company_provisioning_jobs')
  expect(jobs).toHaveLength(4)
  expect(jobs.map(row => row.idempotency_key).sort()).toEqual(snapshots.map(row => row.id).sort())
  for (const job of jobs) expect(job).toMatchObject({job_key: 'ediel_readiness_revalidate', status: 'pending'})
  const sortedSnapshots = [...snapshots].sort((a, b) => Number(a.snapshot_version) - Number(b.snapshot_version))
  const priorVersion = Math.max(0, ...old.ediel_configuration_snapshots.map(row => Number(row.snapshot_version)))
  expect(sortedSnapshots.map(row => Number(row.snapshot_version))).toEqual([1, 2, 3, 4].map(offset => priorVersion + offset))
  const latest = sortedSnapshots[sortedSnapshots.length - 1]
  expect(latest.reason).toBe('ediel_route_profiles_changed')
  for (const table of ['ediel_test_runs', 'actor_test_results', 'ediel_production_readiness_checks', 'ediel_go_live_events', 'ediel_production_state']) {
    expect(next[table]).toHaveLength(old[table].length)
    for (const previous of old[table]) {
      const current = next[table].find(row => row.id === previous.id)!
      const changed = previous.configuration_snapshot_id !== latest.id
      const applies = changed && (table !== 'ediel_test_runs' || previous.completed_at !== null)
        && (table !== 'ediel_go_live_events' || previous.event_type === 'production_dry_run')
      const expected: Json = table === 'ediel_production_state' ? {...previous, configuration_snapshot_id: latest.id, updated_at: current.updated_at}
        : applies ? {...previous, is_stale: true, stale_reason: 'configuration_changed'} : {...previous}
      if (applies && table === 'ediel_test_runs') expected.stale_at = current.stale_at
      if (applies && table === 'actor_test_results') expected.updated_at = current.updated_at
      for (const key of ['updated_at', 'stale_at']) if (expected[key] !== previous[key]) {
        expect(Number.isFinite(Date.parse(String(expected[key])))).toBe(true)
        expect(Date.parse(String(expected[key]))).toBeLessThanOrEqual(Date.now())
        if (previous[key]) expect(Date.parse(String(expected[key]))).toBeGreaterThanOrEqual(Date.parse(String(previous[key])))
      }
      expect(current).toEqual(expected)
    }
  }
  expect(added('ediel_route_history')).toHaveLength(2)
  for (const route of added('ediel_route_profiles')) {
    const history = added('ediel_route_history').filter(row => row.route_profile_id === route.id)
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({route_profile_id: route.id, company_id: s.f.companyId,
      route_version: route.route_version, snapshot: route, change_reason: 'created'})
  }
  const input = {companyId: s.f.companyId, receiverEdielId: p.receiver, routeProfileId: p.profileId,
    environment: 'production', certificateEnvironment: 'production', messageFamily: 'PRODAT', businessCode: 'Z03',
    smtpTo: p.recipientEmail, ownEdielId: s.f.sender}
  const recipient = await resolveOutboundRecipientCertificate(input)
  expect(recipient).toMatchObject({id: p.certificateId, fingerprintSha256: trust.fingerprint,
    trustEvidence: {verified: true, registrationId: trust.registrationId}})
  expect(recipient.recipientCertificates.map(row => row.id)).toEqual([p.certificateId])
  await expect(resolveOutboundRecipientCertificate({...input, companyId: randomUUID()})).rejects.toThrow('route saknas i aktuell tenant')
  await expect(resolveOutboundRecipientCertificate({...input, receiverEdielId: s.f.receiver})).rejects.toThrow('receiver_certificate_owner_mismatch')
  await expect(resolveOutboundRecipientCertificate({...input, messageFamily: 'CONTRL', businessCode: 'CONTRL'}))
    .rejects.toThrow('receiver_certificate_message_family_mismatch')
  if (originalRecipient) {
    const current = await resolveOutboundRecipientCertificate(contrlInput)
    expect(current).toMatchObject({id: originalRecipient.id, fingerprintSha256: originalRecipient.fingerprintSha256,
      trustEvidence: {verified: true, registrationId: originalRecipient.trustEvidence.registrationId}})
    expect(current.recipientCertificates.map(row => row.id)).toEqual(originalRecipient.recipientCertificates.map(row => row.id))
  }
  expect(configurationImage(s.f.companyId)).toEqual(next); expect(foreignConfigurationImage(s.f.companyId)).toEqual(foreign)
  preserved(s, prior, true)
  console.info('TR09 prospective transport configuration', {status: 'PASS', configurationInserts: 6, protectedTrustPublications: 1,
    snapshots: 4, revalidationJobs: 4, routeHistory: 2, originalContrlPreserved: true, certificationSupplied: false, liveTransition: false})
}
async function configureProspectiveProfiles(s: Fixture) {
  await configureProspectiveTransport(s)
  const image = () => configurationImage(s.f.companyId)
  const foreignImage = () => foreignConfigurationImage(s.f.companyId)
  const company = () => sql<Json>(`SELECT to_jsonb(c) FROM public.companies c WHERE id=${literal(s.f.companyId)}`)
  const prior = before(s), oldCompany = company(), old = image(), foreign = foreignImage()
  const profiles = old.ediel_actor_settings.filter(p => p.is_active === true && (p.role ?? p.actor_role) === 'supplier')
  expect(profiles).toHaveLength(2)
  const testProfile = profiles.find(p => p.environment === 'test'), productionProfile = profiles.find(p => p.environment === 'production')
  expect(testProfile?.actor_ediel_id).toBe(s.f.sender); expect(productionProfile?.actor_ediel_id).toBe(s.f.sender)
  const idempotencyKey = `TR09-profile-${randomUUID()}`, mailbox = assertEdielSmtpReadiness().from
  const command = {company_id: s.f.companyId, actor_user_id: s.f.actorUserId, idempotency_key: idempotencyKey,
    actor_role: 'supplier', ediel_id: s.f.sender, test_profile_id: testProfile!.id, production_profile_id: productionProfile!.id,
    test_ediel_id: s.f.sender, production_ediel_id: s.f.sender,
    test_actor_name: testProfile!.actor_name, production_actor_name: productionProfile!.actor_name,
    test_application_reference: '23-DDQ-PRODAT', production_application_reference: '23-DDQ-PRODAT',
    test_mailbox: mailbox, production_mailbox: mailbox, smtp_from_email: mailbox,
    test_counterparty_ediel_id: s.f.receiver, production_counterparty_ediel_id: s.prospective.receiver,
    test_primary_route_id: s.prospective.testRouteProfileId, production_primary_route_id: s.prospective.profileId,
    brp_ediel_id: s.f.brpEdielId, brp_name: 'Synthetic BRP',
    technical_contact_name: 'Declared TR09 configuration contact', technical_contact_email: mailbox}
  await withOwnSnapshotPermission(s, async () => {
    const first = await supabaseService.rpc('canonical_save_ediel_actor_profile', {p_command: command})
    if (first.error) {
      console.info('TR09 actual public profile configuration', {status: 'FAIL', errorCode: first.error.code})
      throw first.error
    }
    const result = first.data as Json, nextCompany = company(), next = image()
    expect(result).toMatchObject({changed: true, company_id: s.f.companyId, actor_role: 'supplier'})
    expect(nextCompany).toEqual({...oldCompany, actor_role: 'supplier', market_role: 'supplier', ediel_id: s.f.sender,
      test_ediel_id: s.f.sender, production_ediel_id: s.f.sender,
      test_application_reference: command.test_application_reference, production_application_reference: command.production_application_reference,
      test_mailbox: mailbox, production_mailbox: mailbox,
      test_counterparty_ediel_id: s.f.receiver, production_counterparty_ediel_id: s.prospective.receiver,
      ediel_primary_test_route_profile_id: s.prospective.testRouteProfileId, ediel_primary_production_route_profile_id: s.prospective.profileId,
      brp_ediel_id: s.f.brpEdielId, brp_name: 'Synthetic BRP',
      technical_contact_name: command.technical_contact_name, technical_contact_email: mailbox,
      updated_at: nextCompany.updated_at})
    const assertTime = (value: unknown, priorValue?: unknown) => {
      expect(typeof value).toBe('string')
      expect(Number.isFinite(Date.parse(String(value)))).toBe(true)
      expect(Date.parse(String(value))).toBeLessThanOrEqual(Date.now())
      if (priorValue) expect(Date.parse(String(value))).toBeGreaterThanOrEqual(Date.parse(String(priorValue)))
    }
    assertTime(nextCompany.updated_at, oldCompany.updated_at)
    for (const table of ['company_capabilities', 'ediel_certification_evidence', 'tenant_legal_profiles',
      'communication_routes', 'ediel_route_profiles', 'ediel_mailboxes', 'ediel_certificates', 'ediel_route_history']) expect(next[table]).toEqual(old[table])
    const added = (table: string) => next[table].filter(row => !old[table].some(previous => previous.id === row.id))
    for (const table of ['ediel_configuration_snapshots', 'canonical_command_results', 'canonical_audit_events', 'company_provisioning_jobs']) {
      for (const row of old[table]) expect(next[table].find(current => current.id === row.id)).toEqual(row)
    }
    const snapshots = added('ediel_configuration_snapshots')
    expect(snapshots).toHaveLength(2)
    const snapshotIds = snapshots.map(row => row.id)
    expect(snapshotIds).toContain(result.configuration_snapshot_id)
    for (const snapshot of snapshots) {
      const payload = sql<string>(`SELECT to_jsonb(payload::text) FROM public.ediel_configuration_snapshots WHERE id=${literal(String(snapshot.id))}`)
      expect(snapshot.configuration_hash).toBe(sha(payload))
    }
    expect(snapshots.find(row => row.id === result.configuration_snapshot_id)?.configuration_hash).toBe(result.configuration_hash)
    const jobs = added('company_provisioning_jobs').filter(row => row.job_key === 'ediel_readiness_revalidate')
    expect(added('company_provisioning_jobs')).toHaveLength(2)
    expect(jobs).toHaveLength(2)
    expect(jobs.map(row => row.idempotency_key).sort()).toEqual([...snapshotIds].sort())
    for (const job of jobs) expect(job.status).toBe('pending')
    expect(added('canonical_command_results')).toHaveLength(1)
    expect(added('canonical_command_results')[0]).toMatchObject({command_type: 'ediel.actor_profile.save', idempotency_key: idempotencyKey,
      actor_user_id: s.f.actorUserId, result_payload: result})
    expect(added('canonical_audit_events')).toHaveLength(1)
    expect(added('canonical_audit_events')[0]).toMatchObject({event_type: 'EDIEL_ACTOR_PROFILE_UPDATED', actor_user_id: s.f.actorUserId})
    expect(next.canonical_ediel_profile_identities.filter(row => row.actor_role === 'supplier').map(row => row.profile_id).sort())
      .toEqual([testProfile!.id, productionProfile!.id].sort())
    expect(next.ediel_actor_settings).toHaveLength(old.ediel_actor_settings.length)
    for (const previous of old.ediel_actor_settings) {
      const profile = next.ediel_actor_settings.find(p => p.id === previous.id)!
      if (!profiles.some(p => p.id === previous.id)) {expect(profile).toEqual(previous); continue}
      expect(profile).toEqual({...previous, actor_name: previous.actor_name, legal_name: previous.actor_name,
        sender_name: oldCompany.name, actor_role: 'supplier', role: 'supplier', actor_ediel_id: s.f.sender, ediel_id: s.f.sender,
        is_active: true, default_application_reference: '23-DDQ-PRODAT', application_reference: '23-DDQ-PRODAT',
        mailbox, default_test_flag: previous.environment === 'production' ? 0 : 1,
        smtp_from_email: mailbox, smtp_reply_to_email: mailbox, brp_name: 'Synthetic BRP', brp_ediel_id: s.f.brpEdielId,
        brp_status: 'missing', esett_status: 'missing', updated_by: s.f.actorUserId, updated_at: profile.updated_at})
      assertTime(profile.updated_at, previous.updated_at)
    }
    expect(next.ediel_production_state).toHaveLength(old.ediel_production_state.length)
    for (const state of old.ediel_production_state) {
      const current = next.ediel_production_state.find(row => row.id === state.id)!
      expect(current).toEqual({...state, configuration_snapshot_id: result.configuration_snapshot_id, updated_at: current.updated_at})
      assertTime(current.updated_at, state.updated_at)
    }
    for (const table of ['ediel_test_runs', 'actor_test_results', 'ediel_production_readiness_checks', 'ediel_go_live_events']) {
      expect(next[table]).toHaveLength(old[table].length)
      for (const previous of old[table]) {
        const current = next[table].find(row => row.id === previous.id)!, changed = previous.configuration_snapshot_id !== result.configuration_snapshot_id
        const applies = changed && (table !== 'ediel_test_runs' || previous.completed_at !== null)
          && (table !== 'ediel_go_live_events' || previous.event_type === 'production_dry_run')
        const expected = applies ? {...previous, is_stale: true, stale_reason: 'configuration_changed'} : previous
        if (applies && table === 'ediel_test_runs') {expected.stale_at = current.stale_at; assertTime(current.stale_at)}
        if (applies && table === 'actor_test_results') {expected.updated_at = current.updated_at; assertTime(current.updated_at, previous.updated_at)}
        expect(current).toEqual(expected)
      }
    }
    expect(foreignImage()).toEqual(foreign)
    preserved(s, prior, true)
    const replay = await supabaseService.rpc('canonical_save_ediel_actor_profile', {p_command: command})
    expect(replay.error).toBeNull(); expect(replay.data).toEqual(first.data)
    expect(company()).toEqual(nextCompany); expect(image()).toEqual(next); expect(foreignImage()).toEqual(foreign)
    console.info('TR09 actual public profile configuration', {status: 'PASS', profiles: 2, snapshots: snapshots.length,
      revalidationJobs: jobs.length, replayEffects: 0, certificationSupplied: false, liveTransition: false})
  })
}
async function diagnoseProductionPrerequisites(s: Fixture) {
  // Exercise the supported evaluator, never attest certification, transition
  // LIVE or substitute a system actor. Diagnosis precedes transport oracles.
  const prior = before(s)
  const admission = () => sql<Json>(`SELECT jsonb_build_object(
    'company', (SELECT to_jsonb(c) FROM public.companies c WHERE c.id=${literal(s.f.companyId)}),
    'capabilities', ${rows('public.company_capabilities', `t.company_id=${literal(s.f.companyId)}`)},
    'production', ${rows('public.ediel_production_state', `t.company_id=${literal(s.f.companyId)}`)},
    'certification', ${rows('public.ediel_certification_evidence', `t.company_id=${literal(s.f.companyId)}`)})`)
  const authority = admission()
  const configBefore = configurationImage(s.f.companyId), foreignBefore = foreignConfigurationImage(s.f.companyId)
  const goLive = await supabaseService.rpc('gridex_company_go_live_readiness', {p_company_id: s.f.companyId})
  expect(goLive.error).toBeNull()
  const readinessResult = goLive.data as Json
  expect(readinessResult).toMatchObject({has_production_route: true, has_test_route: true, status: 'blocked',
    evidence_ready: false, prodat_passed: 0, prodat_total: 6, utilts_passed: 0, utilts_total: 5})
  expect(readinessResult.blockers).not.toContain('Supplier-bunden PRODAT-produktionsroute saknas')
  expect(readinessResult.blockers).not.toContain('Supplier-bunden test-route saknas')
  expect((authority.company as Json).esett_status).toBe('missing')
  expect(admission()).toEqual(authority)
  expect(configurationImage(s.f.companyId)).toEqual(configBefore)
  expect(foreignConfigurationImage(s.f.companyId)).toEqual(foreignBefore)
  preserved(s, prior, true)
  console.info('TR09 actual supplier-bound route diagnostic', {status: 'PASS', hasProductionRoute: true, hasTestRoute: true,
    readinessStatus: readinessResult.status, evidenceReady: readinessResult.evidence_ready,
    prodatPassed: readinessResult.prodat_passed, prodatTotal: readinessResult.prodat_total,
    utiltsPassed: readinessResult.utilts_passed, utiltsTotal: readinessResult.utilts_total, readEffects: 0})
  const attempt = async (stage: string) => {
    try {
      const result = await runProductionDryRun(s.f.companyId, s.f.actorUserId, s.ack)
      console.info('TR09 actual readiness diagnostic', {stage,
        status: result.success ? 'READY_INPUTS' : 'BLOCKED', dryRunStatus: result.status,
        blockers: result.blockingIssues.map(issue => issue.code), wouldSend: result.previewMetadata.wouldSend})
      expect(result.previewMetadata).toMatchObject({productionProdatRouteProfileId: s.prospective.profileId,
        productionMailboxId: s.prospective.mailboxId, wouldSend: false})
      for (const code of ['production_smime_missing', 'production_route_receiver_invalid', 'mailbox_secret_reference_missing']) {
        expect(result.blockingIssues.map(issue => issue.code)).not.toContain(code)
      }
      expect(result.blockingIssues.map(issue => issue.code)).toContain('external_certification_and_pilot_missing')
      if (result.blockingIssues.some(issue => issue.code === 'canonical_required_tests_unavailable')) {
        const {error} = await supabaseService.rpc('gridex_company_go_live_readiness', {p_company_id: s.f.companyId})
        // Report the real read failure without exposing query arguments,
        // credentials or promoting an unavailable result to passed tests.
        console.info('TR09 actual canonical actor-test diagnostic', {stage,
          status: error ? 'DIAGNOSTIC_FAIL' : 'READ',
          errorCode: error?.code.match(/^[A-Z0-9]{5,12}$/)?.[0] ?? null,
          missingIdentifier: error?.message.match(/(?:column|relation|function)\s+"?([A-Za-z_][A-Za-z0-9_.]*)/)?.[1] ?? null})
      }
      return null
    } catch (error) {
      if (error instanceof Error && error.name === 'AssertionError') throw error
      console.info('TR09 actual readiness diagnostic', {stage, status: 'DIAGNOSTIC_FAIL',
        errorCode: errorMessage(error).match(/^[A-Za-z0-9_]+/)?.[0] ?? 'unclassified', wouldSend: 'NOT_REACHED'})
      return errorMessage(error)
    }
  }
  try {
    if (await attempt('original_actor') === 'actor_not_authorized_for_configuration_snapshot') {
      await withOwnSnapshotPermission(s, () => attempt('prospective_own_profile_write'))
    }
  } finally {
    // Partial snapshots/readiness journals may exist after an actual failure.
    // They may not manufacture business effects or production admission.
    expect(admission()).toEqual(authority)
    preserved(s, prior, true)
  }
  const readiness = sql<Json>(`SELECT public.canonical_company_readiness(${literal(s.f.companyId)},NULL,
    (SELECT id FROM public.ediel_production_readiness_checks WHERE company_id=${literal(s.f.companyId)} ORDER BY checked_at DESC,id LIMIT 1),
    (SELECT id FROM public.ediel_go_live_events WHERE company_id=${literal(s.f.companyId)} AND event_type='production_dry_run' ORDER BY created_at DESC,id LIMIT 1),'live')`)
  const evidence = sql<Json>(`SELECT public.canonical_ediel_production_evidence_readiness(${literal(s.f.companyId)})`)
  console.info('TR09 actual canonical prerequisites', {ready: readiness.ready,
    blockers: readiness.blockers, evidenceReady: evidence.ready, missingEvidence: evidence.missing})
}
async function withOwnSnapshotPermission(s: Fixture, action: () => Promise<unknown>) {
  // A prospective fixture permission is neither a production decision nor a
  // passed attestation. Restore the entire original grant image, even on error.
  const permissionState = () => sql<Json>(`SELECT jsonb_build_object(${[
    'public.permissions', 'public.roles', 'public.role_permissions', 'public.user_roles',
    'public.user_permissions', 'public.admin_users', 'public.company_memberships',
  ].map(table => `${literal(table)},${rows(table, 'true')}`).join(',')})`)
  const pristine = permissionState()
  const roles = sql<Array<{id: string; key: string}>>(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'key',r.key)),'[]')
    FROM public.roles r JOIN public.user_roles u ON u.role_id=r.id
    WHERE u.user_id=${literal(s.f.actorUserId)} AND u.company_id=${literal(s.f.companyId)}
      AND u.status='active' AND u.is_active AND r.is_active AND NOT r.is_system_role
      AND r.scope='company' AND r.key='native_actor_'||r.id::text`)
  expect(roles).toHaveLength(1)
  const role = roles[0]
  expect(sql(`SELECT to_jsonb(count(*)) FROM public.user_roles WHERE role_id=${literal(role.id)} OR role=${literal(role.key)}`)).toBe(1)
  const catalog = sql<Array<{id: string; is_active: boolean}>>(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'is_active',is_active)),'[]')
    FROM public.permissions WHERE key='ediel.profile.write'`)
  expect(catalog.length).toBeLessThanOrEqual(1)
  if (catalog.length) expect(catalog[0].is_active).toBe(true)
  const permissionId = catalog[0]?.id ?? randomUUID(), grantId = randomUUID()
  try {
    // Atomically create only our missing reference and our one role grant.
    sql(`BEGIN;
      ${catalog.length ? '' : `INSERT INTO public.permissions(id,key,name,description,category,is_active)
        VALUES(${literal(permissionId)},'ediel.profile.write','Native snapshot permission','Prospective disposable TR09 diagnostic input','native_fixture',true);`}
      INSERT INTO public.role_permissions(id,role_id,role_key,permission_id,permission_key,effect)
        VALUES(${literal(grantId)},${literal(role.id)},${literal(role.key)},${literal(permissionId)},'ediel.profile.write','allow');
      COMMIT;`)
    expect(sql(`SELECT to_jsonb(public.canonical_actor_is_authorized(${literal(s.f.companyId)},${literal(s.f.actorUserId)},'ediel.profile.write',false))`)).toBe(true)
    await action()
  } finally {
    sql(`BEGIN;
      DELETE FROM public.role_permissions WHERE id=${literal(grantId)} AND role_id=${literal(role.id)} AND permission_id=${literal(permissionId)};
      ${catalog.length ? '' : `DELETE FROM public.permissions WHERE id=${literal(permissionId)} AND key='ediel.profile.write';`}
      COMMIT;`)
    expect(permissionState()).toEqual(pristine)
  }
}
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
