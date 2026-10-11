// masterplan: P-08, AT-P-08
// Native clean-replay proof of the P-08 production-contract chain: a signed
// production-contract original is archived and independently reviewed through
// the installed intake RPCs, the supplier Z09 is rendered by the actual
// production-contract producer, and the grid owner's APERAK is received through
// the actual inbound mail path. Issuer competence, BRP declaration and signed
// agreement are explicit SYNTHETIC fixture boundaries, never authentic market or
// legal evidence. The component policy tests remain the wire-matrix authority.
import { createHash, createHmac, randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { createProductionReceiptNativeFixture } from './helpers/ediel-z04d-production-native-fixture'
import { nativeSql as sql, literal } from './helpers/ediel-normal-switch-native-fixture'
import { createBilateralSourceOperator } from './helpers/ediel-bilateral-customer-native-fixture'
import { supabaseService } from '@/lib/supabase/service'
import { prepareAndQueueProductionContractZ09 } from '@/lib/ediel/flows/prodatProductionContract'
import { assertEdielSmtpReadiness } from '@/lib/ediel/mailReadiness'
import { sendEdielMessageViaSmtp } from '@/lib/ediel/transport'
import { getEdielMessageById } from '@/lib/ediel/db'
import { seedOriginalMailboxNative } from './helpers/originalMailboxNative'
import { matchOutboundRequestForInbound } from '@/lib/inbound-mail/inboundMatcher'
import { createInboundEdielMessage } from '@/lib/inbound-mail/inboundStatusUpdater'
import { resolveCanonicalRuntimeDecisionWithRegistry } from '@/lib/ediel/core/runtimeDecision'
import { recordReceivedSourceValidation } from '@/lib/ediel/core/receivedSourceValidationLedger'
import { processInboundAckMessage } from '@/lib/ediel/flows/inboundAckProcessing'
import { renderContrl2Ediel2 } from '@/lib/ediel/contrlEngine'
import { renderAperakEdiel } from '@/lib/ediel/aperakEngine'
import { PRODAT_APERAK_APPLICATION_TEXTS } from '@/lib/ediel/prodat/prodatAperakText'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import type { EdielMessageRow } from '@/lib/ediel/types'

const smtp = vi.hoisted(() => ({ provider: vi.fn() }))
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: smtp.provider }) } }))
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); smtp.provider.mockReset() })

const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')
const intakePermissions = ['communication.read', 'communication.write', 'customers.read', 'customers.write', 'contracts.read', 'contracts.write', 'metering.read', 'metering.write']

function externalTransport() {
  for (const [key, value] of Object.entries({ EDIEL_SHARED_MAILBOX_ADDRESS: 'synthetic@example.invalid', EDIEL_APP_DKIM_ENABLED: 'false',
    EDIEL_SMTP_FROM: 'synthetic@example.invalid', EDIEL_SMTP_USER: 'synthetic@example.invalid', EDIEL_SMTP_PASS: 'synthetic-only', EDIEL_EMAIL_PROVIDER: 'strato' })) vi.stubEnv(key, value)
  return (email: string) => smtp.provider.mockResolvedValue({ accepted: [email], rejected: [], messageId: `synthetic-P08-${randomUUID()}`, response: '250 synthetic accepted' })
}

type Fixture = Awaited<ReturnType<typeof createProductionReceiptNativeFixture>>

/** Signed BRP declaration for the production contract through the installed
 * archive and independent review RPCs (same mechanism as the consumption one). */
async function productionBrpDeclaration(f: Fixture) {
  const ground = sql<string[]>(`SELECT coalesce(jsonb_agg(id),'[]') FROM gridex_brp_changes.registry_grounds
    WHERE company_id=${literal(f.companyId)} AND environment='test' AND dso_ediel_id=${literal(f.receiver)}
    AND brp_ediel_id=${literal(f.brpEdielId)} AND grid_area_code=${literal(f.gridAreaCode)}`)
  expect(ground).toHaveLength(1)
  const agreementHash = sql<string>(`SELECT to_jsonb(document_sha256) FROM public.customer_contracts WHERE id=${literal(f.productionContractId)}`)
  const document = sql<{ bucket: string; path: string }>(`SELECT jsonb_build_object('bucket',storage_bucket,'path',storage_path)
    FROM public.customer_contract_documents WHERE company_id=${literal(f.companyId)} AND customer_contract_id=${literal(f.productionContractId)}
     AND document_type='signed_contract_pdf' AND document_sha256=${literal(agreementHash)} ORDER BY id LIMIT 1`)
  const stored = await supabaseService.storage.from(document.bucket).download(document.path)
  expect(stored.error).toBeNull()
  const pdf = Buffer.from(await stored.data!.arrayBuffer())
  expect(hash(pdf)).toBe(agreementHash)
  const uploader = await createBilateralSourceOperator(f.companyId, ['communication.read', 'communication.write', 'customers.read', 'customers.write', 'contracts.read', 'contracts.write'])
  const reviewer = await createBilateralSourceOperator(f.companyId, ['communication.read', 'communication.write', 'customers.read', 'customers.write', 'contracts.read', 'contracts.write', 'ediel.source.review'])
  const selector = { environment: 'test' as const, contractId: f.productionContractId, registryGroundId: ground[0], identityAgency: '9' as const }
  const scope = await uploader.client.rpc('ediel_signed_brp_declaration_scope_v1', { p_company_id: f.companyId, p_actor_user_id: uploader.id, p_selector: { ...selector, agreementHash } })
  expect(scope.error, JSON.stringify(scope.error)).toBeNull()
  expect(scope.data, JSON.stringify(scope.data)).toMatchObject({ status: 'scope_available' })
  const key = randomUUID(), representation = randomUUID(), secret = Buffer.from('SYNTHETIC P08 BRP issuer key ' + key)
  const legal = 'SYNTHETIC P08 BRP DECLARATION ISSUER ONLY', representationLegal = 'SYNTHETIC P08 BRP DECLARATION REPRESENTATION ONLY'
  sql(`INSERT INTO gridex_brp_declaration_intake.issuer_keys(id,company_id,environment,issuer_code,legal_source_reference,legal_source_sha256,signing_key,valid_from,valid_to)
    VALUES(${literal(key)},${literal(f.companyId)},'test','SYNTHETIC',${literal(legal)},${literal(hash(legal))},decode(${literal(secret.toString('hex'))},'hex'),'2020-01-01','2099-01-01');
   INSERT INTO gridex_brp_declaration_intake.issuer_representations(id,company_id,environment,issuer_key_id,legal_actor_id,purpose,legal_source_reference,legal_source_sha256,valid_from,valid_to)
    VALUES(${literal(representation)},${literal(f.companyId)},'test',${literal(key)},${literal((scope.data as { claims: { legalActorId: string } }).claims.legalActorId)},'signed_contract_brp_declaration',${literal(representationLegal)},${literal(hash(representationLegal))},'2020-01-01','2099-01-01')`)
  const source = Buffer.from('SYNTHETIC signed P08 production BRP declaration ' + f.productionContractId), sourceReference = 'SYNTHETIC-P08-brp-' + f.productionContractId
  const payload = Buffer.from(JSON.stringify({ format: 'ediel_signed_brp_declaration_receipt_v1', purpose: 'signed_contract_brp_declaration', companyId: f.companyId, environment: 'test',
    issuerCode: 'SYNTHETIC', receiptId: randomUUID(), issuerLegalReference: legal, representationLegalReference: representationLegal,
    claimsHash: (scope.data as { claimsHash: string }).claimsHash, agreementHash, sourceHash: hash(source), sourceReference, sourceVersion: '1',
    issuedAt: new Date(Date.now() - 60000).toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString() }))
  const archived = await uploader.client.rpc('ediel_archive_signed_brp_declaration_v1', { p_company_id: f.companyId, p_actor_user_id: uploader.id, p_submission: { ...selector,
    agreementBase64: pdf.toString('base64'), sourceBase64: source.toString('base64'), sourceReference, sourceVersion: '1',
    issuerReceipt: { keyId: key, representationId: representation, payloadBase64: payload.toString('base64'), signatureHex: createHmac('sha256', secret).update(payload).digest('hex') } } })
  expect(archived.error, JSON.stringify(archived.error)).toBeNull()
  expect(archived.data).toMatchObject({ status: 'archived', issuerQualified: true })
  const a = archived.data as { artifactId: string; agreementHash: string; sourceHash: string; claimsHash: string }
  const reviewed = await reviewer.client.rpc('ediel_review_signed_brp_declaration_v1', { p_company_id: f.companyId, p_actor_user_id: reviewer.id, p_artifact_id: a.artifactId,
    p_review: { agreementHash: a.agreementHash, sourceHash: a.sourceHash, claimsHash: a.claimsHash, decision: 'approve', reason: 'SYNTHETIC separate P08 BRP review',
      clause: { locator: 'page1 synthetic', quote: 'SYNTHETIC balance responsible party declaration' } } })
  expect(reviewed.error, JSON.stringify(reviewed.error)).toBeNull()
  expect(reviewed.data).toMatchObject({ status: 'authorized' })
  return { pdf, uploader, reviewer }
}

/** Production-contract event original: archive by one actor, independent review
 * by another, through the installed contract-intake RPCs. */
async function productionContractEvent(f: Fixture, pdf: Buffer, claims: { eventKind: 'signed' | 'ceased'; boundaryAt: string; startEventId: string | null }, n: string) {
  const uploader = await createBilateralSourceOperator(f.companyId, intakePermissions)
  const reviewer = await createBilateralSourceOperator(f.companyId, [...intakePermissions, 'ediel.source.review'])
  const scope = await uploader.client.rpc('ediel_contract_intake_scope_v1', { p_company_id: f.companyId, p_actor_user_id: uploader.id, p_contract_id: f.productionContractId, p_environment: 'test', p_kind: 'production_contract_event' })
  expect(scope.error, JSON.stringify(scope.error)).toBeNull()
  const nativeScope = scope.data as Record<string, unknown> & { legalActorId: string }
  const key = randomUUID(), representation = randomUUID(), secret = Buffer.from('SYNTHETIC P08 contract issuer ' + key)
  sql(`INSERT INTO gridex_contract_source_intake.issuer_keys(id,company_id,environment,issuer_code,legal_authority_reference,legal_authority_source_hash,signing_key,valid_from,valid_to)
    VALUES(${literal(key)},${literal(f.companyId)},'test','SYNTHETIC issuer','SYNTHETIC legal authority',${literal('b'.repeat(64))},decode(${literal(secret.toString('hex'))},'hex'),'2020-01-01','2099-01-01');
   INSERT INTO gridex_contract_source_intake.representations(id,company_id,environment,issuer_key_id,legal_actor_id,kind,legal_representation_reference,legal_authority_source_hash,valid_from,valid_to)
    VALUES(${literal(representation)},${literal(f.companyId)},'test',${literal(key)},${literal(nativeScope.legalActorId)},'production_contract_event','SYNTHETIC representation',${literal('c'.repeat(64))},'2020-01-01','2099-01-01')`)
  const packet = { agreementHash: hash(pdf), claims: { sourceReference: 'SYNTHETIC P08 original ' + n, sourceVersion: '1', contractReference: 'SYNTHETIC P08 production contract', ...claims },
    expiresAt: '2090-01-01', format: 'ediel_contract_original_source_v1', issuedAt: new Date(Date.now() - 1000).toISOString(), issuerCode: 'SYNTHETIC issuer',
    legalAuthorityReference: 'SYNTHETIC legal authority', nativeScope, purpose: 'signed_production_contract_event', receiptId: 'SYNTHETIC P08 receipt ' + n + randomUUID(),
    representationReference: 'SYNTHETIC representation' }
  const bytes = Buffer.from(JSON.stringify(packet))
  const archived = await uploader.client.rpc('ediel_archive_contract_original_source_v1', { p_company_id: f.companyId, p_actor_user_id: uploader.id, p_contract_id: f.productionContractId,
    p_environment: 'test', p_kind: 'production_contract_event', p_submission: { agreementBase64: pdf.toString('base64'), sourceBase64: bytes.toString('base64'),
      issuerKeyId: key, representationId: representation, signatureHex: createHmac('sha256', secret).update(bytes).digest('hex') } })
  expect(archived.error, JSON.stringify(archived.error)).toBeNull()
  expect(archived.data, JSON.stringify(archived.data)).toMatchObject({ status: 'archived' })
  const a = archived.data as { artifactId: string; sourceHash: string; agreementHash: string; claimsHash: string }
  const reviewed = await reviewer.client.rpc('ediel_review_contract_original_source_v1', { p_company_id: f.companyId, p_actor_user_id: reviewer.id, p_artifact_id: a.artifactId,
    p_review: { sourceHash: a.sourceHash, agreementHash: a.agreementHash, claimsHash: a.claimsHash, decision: 'approve', reason: 'SYNTHETIC independent P08 review' } })
  expect(reviewed.error, JSON.stringify(reviewed.error)).toBeNull()
  expect(reviewed.data, JSON.stringify(reviewed.data)).toMatchObject({ status: 'authorized' })
  return (reviewed.data as { sourceId: string }).sourceId
}

/** The supplier's own customer_masterdata route to the same grid owner, created
 * like the fixture's other declared bilateral test routes. */
function masterdataRoute(f: Fixture) {
  const route = randomUUID(), profile = randomUUID(), smtp = assertEdielSmtpReadiness()
  sql(`INSERT INTO public.communication_routes(id,company_id,route_name,route_scope,grid_owner_id,environment_type,is_active,target_email)
    VALUES(${literal(route)},${literal(f.companyId)},'Synthetic P08 production contract route','customer_masterdata',${literal(f.gridId)},'bilateral_test',true,'recipient@example.invalid');
   INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,payload_format,sender_ediel_id,receiver_ediel_id,application_reference,is_enabled,is_active,transport_security_mode,mailbox,smtp_host,smtp_port,smtp_to,receiver_email)
    VALUES(${literal(profile)},${literal(f.companyId)},${literal(route)},'Synthetic P08 production contract profile','test','edifact','edifact',${literal(f.sender)},${literal(f.receiver)},'23-DDQ-PRODAT',true,true,'unencrypted',${literal(smtp.from)},${literal(smtp.host)},${smtp.port},'recipient@example.invalid','recipient@example.invalid');`)
  return { route, profile }
}

function externalAck(original: EdielMessageRow, family: 'CONTRL' | 'APERAK', outcome: 'positive' | 'negative' = 'positive') {
  const e = EdifactEnvelopeCodec.decode(original.raw_payload!)
  const segments = family === 'CONTRL' ? renderContrl2Ediel2({ source: { rawPayload: original.raw_payload }, outcome: 'positive' }).segments
    : renderAperakEdiel({ source: { id: original.id, messageFamily: 'PRODAT', messageCode: 'Z09', rawPayload: original.raw_payload }, refs: {}, externalReference: randomUUID(), transactionReference: randomUUID(), outcome,
      // The grid owner's P-APERAK for both contract dates on the one object: ERC 40, field 109.
      applicationErrors: outcome === 'negative' ? [{ ercCode: '40', fieldCode: '109', text: PRODAT_APERAK_APPLICATION_TEXTS['109'],
        referenceQualifier: 'Z07', referenceNumber: /LIN\+1\+\+([0-9]+):::9'/.exec(original.raw_payload!)![1], lineItemReference: /RFF\+LI:([^']+)'/.exec(original.raw_payload!)![1] }] : null }).segments
  return EdifactEnvelopeCodec.encode({ sender: e.receiver!, receiver: e.sender!, senderQualifier: e.receiverQualifier, receiverQualifier: e.senderQualifier, senderSubAddress: e.receiverSubAddress,
    receiverSubAddress: e.senderSubAddress, applicationReference: e.applicationReference, acknowledgementRequest: false, environment: 'test', interchangeReference: randomUUID().replaceAll('-', '').slice(0, 14),
    messages: [{ messageReference: randomUUID().replaceAll('-', '').slice(0, 14), messageTypeToken: family === 'CONTRL' ? 'CONTRL:2:2:UN:EDIEL2' : 'APERAK:D:96A:UN:E2SE6A', businessSegments: segments }] })
}

async function intake(f: Fixture, original: EdielMessageRow, raw: string) {
  const mail = await seedOriginalMailboxNative(sql, literal, { companyId: f.companyId, environment: 'test', raw, smtpFrom: 'synthetic@example.invalid' })
  const outboundMatch = await matchOutboundRequestForInbound({ companyId: f.companyId, parsed: mail.parsed, inboundEmailMessageId: mail.inboundEmailMessageId, parseResultId: mail.parseResultId })
  const id = await createInboundEdielMessage({ companyId: f.companyId, actorUserId: f.actorUserId, environment: 'test', inboundEmailMessageId: mail.inboundEmailMessageId,
    parseResultId: mail.parseResultId, parsed: mail.parsed, outboundMatch })
  expect(id).toBeTruthy()
  const message = (await getEdielMessageById(id!))!
  const decision = await resolveCanonicalRuntimeDecisionWithRegistry(message)
  expect(await recordReceivedSourceValidation({ original: message, validated: message, resolvedCompanyId: f.companyId, decision })).toMatchObject({ status: 'recorded' })
  return { message, decision }
}

type Event = { eventId: string; original: EdielMessageRow }
const confirmations = (eventId: string) => sql<{ event: string; company: string; environment: string; message: string }[]>(`SELECT coalesce(jsonb_agg(jsonb_build_object(
  'event',event_id,'company',company_id,'environment',environment,'message',message_id) ORDER BY message_id),'[]') FROM gridex_received_sources.production_contract_confirmations WHERE event_id=${literal(eventId)}`)
const ledger = (eventId: string) => sql(`SELECT jsonb_build_object('event',(SELECT to_jsonb(e) FROM gridex_received_sources.production_contract_events e WHERE id=${literal(eventId)}),
  'origin',(SELECT to_jsonb(o) FROM gridex_received_sources.production_contract_origins o WHERE event_id=${literal(eventId)}),
  'revocations',(SELECT count(*) FROM gridex_received_sources.production_contract_revocations WHERE event_id=${literal(eventId)}))`)
const contractDates = (raw: string) => [...raw.matchAll(/DTM\+(92|93|157):([0-9]{12}):203'/g)].map(m => `${m[1]}:${m[2]}`)
// Etc/GMT-1 is POSIX for fixed UTC+1, the product's fixed market minute convention.
const marketMinute = (iso: string) => sql<string>(`SELECT to_jsonb(to_char(${literal(iso)}::timestamptz AT TIME ZONE 'Etc/GMT-1','YYYYMMDDHH24MI'))`)

/** Render through the actual producer, assert the one-object Z09D wire and its
 * immutable origin binding, then send through the actual SMTP owner. */
async function sentZ09(f: Fixture, route: string, eventId: string, kind: 'signed' | 'ceased', boundaryAt: string): Promise<Event> {
  const queued = await prepareAndQueueProductionContractZ09({ companyId: f.companyId, eventId, actorUserId: f.actorUserId, preferredRouteId: route })
  expect(queued, JSON.stringify(queued)).toMatchObject({ status: 'queued' })
  if (queued.status !== 'queued') throw new Error('p08_queued_required')
  const raw = queued.message.raw_payload!
  // P-08: exactly one of 210 (DTM+92) or 211 (DTM+93) and never 216 (DTM+157) instead.
  expect(contractDates(raw)).toEqual([`${kind === 'signed' ? '92' : '93'}:${marketMinute(boundaryAt)}`])
  expect(raw).not.toMatch(/DTM\+157:/); expect(raw).not.toMatch(kind === 'signed' ? /DTM\+93:/ : /DTM\+92:/)
  expect(raw).toMatch(/BGM\+Z09\+/); expect(raw).toContain("CAV+Z70'"); expect(raw).toContain(`LIN+1++${f.productionExternal}:::9'`)
  expect(raw).toContain(`NAD+Z02+${f.brpEdielId}:160:SVK'`)
  expect(queued.message).toMatchObject({ direction: 'outbound', message_family: 'PRODAT', message_code: 'Z09', source_operation_id: eventId, company_id: f.companyId, environment: 'test' })
  expect(sql(`SELECT jsonb_build_object('message',message_id,'hash',payload_hash) FROM gridex_received_sources.production_contract_origins WHERE event_id=${literal(eventId)}`))
    .toEqual({ message: queued.message.id, hash: hash(raw) })
  smtp.provider.mockResolvedValue({ accepted: ['recipient@example.invalid'], rejected: [], messageId: randomUUID(), response: '250 synthetic accepted' })
  await sendEdielMessageViaSmtp(queued.message, { actorUserId: f.actorUserId })
  const original = (await getEdielMessageById(queued.message.id))!
  expect(original.message_sent_at).toBeTruthy(); expect(original.raw_payload).toBe(raw)
  expect(confirmations(eventId)).toEqual([])
  return { eventId, original }
}

async function acknowledge(f: Fixture, sent: Event, family: 'CONTRL' | 'APERAK', outcome: 'positive' | 'negative' = 'positive') {
  const { message, decision } = await intake(f, sent.original, externalAck(sent.original, family, outcome))
  expect([decision.syntaxDecision, decision.applicationDecision, decision.functionalDecision], JSON.stringify(decision.issues)).toEqual(['accepted', 'accepted', 'accepted'])
  const processed = await processInboundAckMessage({ actorUserId: f.actorUserId, message })
  expect(processed).toMatchObject({ outcome, sourceMessage: { id: sent.original.id } })
  return { message, processed }
}

/** The ACK gate actually fired: the authority answered the original and recorded its APERAK outcome. */
function appliedAperak(original: string, outcome: 'positive' | 'negative') {
  expect(sql(`SELECT jsonb_build_object('aperak',(SELECT aperak_status FROM public.ediel_messages WHERE id=${literal(original)}),
    'outcomes',(SELECT coalesce(jsonb_agg(outcome ORDER BY outcome),'[]') FROM gridex_ack_authority.scope_outcomes WHERE source_message_id=${literal(original)} AND ack_family='APERAK'),
    'correlations',(SELECT count(*) FROM gridex_ack_authority.source_correlations WHERE source_message_id=${literal(original)} AND ack_family='APERAK'),
    'chains',(SELECT count(*) FROM public.ediel_ack_chains WHERE source_message_id=${literal(original)} AND ack_family='APERAK'))`))
    .toEqual({ aperak: 'received', outcomes: [outcome], correlations: 1, chains: 1 })
}

async function signedChain() {
  const f = await createProductionReceiptNativeFixture(externalTransport())
  const route = masterdataRoute(f).route
  const { pdf } = await productionBrpDeclaration(f)
  const boundaryAt = new Date(`${f.requestedStartDate}T00:00:00+01:00`).toISOString()
  const eventId = await productionContractEvent(f, pdf, { eventKind: 'signed', boundaryAt, startEventId: null }, 'signed')
  return { f, route, pdf, boundaryAt, sent: await sentZ09(f, route, eventId, 'signed', boundaryAt) }
}

it('P-08 signed: DTM+92 Z09D, CONTRL alone confirms nothing, the positive APERAK confirms exactly its own event once', async () => {
  const { f, sent } = await signedChain()
  const before = ledger(sent.eventId)
  await acknowledge(f, sent, 'CONTRL')
  expect((await getEdielMessageById(sent.original.id))!).toMatchObject({ contrl_status: 'received', aperak_status: 'pending' })
  expect(confirmations(sent.eventId)).toEqual([])
  const { message } = await acknowledge(f, sent, 'APERAK')
  expect((await getEdielMessageById(sent.original.id))!).toMatchObject({ aperak_status: 'received', raw_payload: sent.original.raw_payload })
  const confirmed = [{ event: sent.eventId, company: f.companyId, environment: 'test', message: sent.original.id }]
  expect(confirmations(sent.eventId)).toEqual(confirmed)
  appliedAperak(sent.original.id, 'positive')
  // No existing period, origin or event row is changed by the confirmation.
  expect(ledger(sent.eventId)).toEqual(before)
  // Idempotent replay of the same committed APERAK keeps exactly one confirmation.
  expect(await processInboundAckMessage({ actorUserId: f.actorUserId, message })).toMatchObject({ outcome: 'positive', sourceMessage: { id: sent.original.id } })
  expect(confirmations(sent.eventId)).toEqual(confirmed)
  appliedAperak(sent.original.id, 'positive')
  // Insert-only ledger: no role can change, delete or truncate it, and no API role can write or read it.
  expect(() => sql(`DELETE FROM gridex_received_sources.production_contract_confirmations WHERE event_id=${literal(sent.eventId)}`)).toThrow(/immutable/)
  expect(() => sql(`UPDATE gridex_received_sources.production_contract_confirmations SET environment='production' WHERE event_id=${literal(sent.eventId)}`)).toThrow(/immutable/)
  expect(sql(`SELECT jsonb_agg(jsonb_build_object('role',r,'insert',has_table_privilege(r,'gridex_received_sources.production_contract_confirmations','INSERT'),
    'select',has_table_privilege(r,'gridex_received_sources.production_contract_confirmations','SELECT'),
    'change',has_table_privilege(r,'gridex_received_sources.production_contract_confirmations','UPDATE,DELETE,TRUNCATE')) ORDER BY r) FROM unnest(ARRAY['anon','authenticated','service_role']) r`))
    .toEqual(['anon', 'authenticated', 'service_role'].map(role => ({ role, insert: false, select: false, change: false })))
  expect(confirmations(sent.eventId)).toEqual(confirmed)
}, 600_000)

it('P-08 negative APERAK 40/109 on the own Z09D confirms nothing and leaves the ledger unchanged', async () => {
  const { f, sent } = await signedChain()
  const before = ledger(sent.eventId)
  await acknowledge(f, sent, 'CONTRL')
  await acknowledge(f, sent, 'APERAK', 'negative')
  appliedAperak(sent.original.id, 'negative')
  expect(confirmations(sent.eventId)).toEqual([])
  expect(ledger(sent.eventId)).toEqual(before)
}, 600_000)

it('P-08 a revoked production-contract event is never confirmed by a later positive APERAK', async () => {
  const { f, sent } = await signedChain()
  // No product revocation writer exists; this is the declared SYNTHETIC
  // revocation source row the trigger reads (owner-only private ledger).
  const revocation = Buffer.from('SYNTHETIC P08 production contract revocation ' + sent.eventId)
  sql(`INSERT INTO gridex_received_sources.production_contract_revocations(event_id,revoked_at,source_reference,source_sha256,actor_user_id)
    VALUES(${literal(sent.eventId)},clock_timestamp(),'SYNTHETIC P08 revocation',${literal(hash(revocation))},${literal(f.actorUserId)})`)
  await acknowledge(f, sent, 'CONTRL')
  await acknowledge(f, sent, 'APERAK')
  appliedAperak(sent.original.id, 'positive')
  expect(confirmations(sent.eventId)).toEqual([])
}, 600_000)

it('P-08 ceased: after the confirmed start, the ceased event renders DTM+93 and only its own APERAK confirms it', async () => {
  const { f, route, pdf, boundaryAt, sent } = await signedChain()
  await acknowledge(f, sent, 'CONTRL'); await acknowledge(f, sent, 'APERAK')
  expect(confirmations(sent.eventId)).toHaveLength(1)
  const endAt = new Date(Date.parse(boundaryAt) + 31 * 86400000).toISOString()
  const ceasedId = await productionContractEvent(f, pdf, { eventKind: 'ceased', boundaryAt: endAt, startEventId: sent.eventId }, 'ceased')
  const ceased = await sentZ09(f, route, ceasedId, 'ceased', endAt)
  expect(confirmations(ceasedId)).toEqual([])
  await acknowledge(f, ceased, 'CONTRL'); await acknowledge(f, ceased, 'APERAK')
  expect(confirmations(ceasedId)).toEqual([{ event: ceasedId, company: f.companyId, environment: 'test', message: ceased.original.id }])
  expect(confirmations(sent.eventId)).toEqual([{ event: sent.eventId, company: f.companyId, environment: 'test', message: sent.original.id }])
}, 900_000)

it('P-08 tenant isolation: an own positive APERAK confirms only its own tenant event; a second tenant event stays unconfirmed', async () => {
  const a = await signedChain(), b = await signedChain()
  expect(b.f.companyId).not.toBe(a.f.companyId)
  await acknowledge(a.f, a.sent, 'CONTRL'); await acknowledge(a.f, a.sent, 'APERAK')
  appliedAperak(a.sent.original.id, 'positive')
  expect(confirmations(a.sent.eventId)).toEqual([{ event: a.sent.eventId, company: a.f.companyId, environment: 'test', message: a.sent.original.id }])
  expect(confirmations(b.sent.eventId)).toEqual([])
  expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.production_contract_confirmations WHERE company_id=${literal(b.f.companyId)}`)).toBe(0)
}, 900_000)
