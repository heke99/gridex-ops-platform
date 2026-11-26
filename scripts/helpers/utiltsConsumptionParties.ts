import { createHash, randomUUID } from 'node:crypto'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'
import { initialCanonicalUtiltsDecision, recordFinalCanonicalUtiltsDecision } from '@/lib/ediel/flows/utiltsCanonicalValidation'
import { readCanonicalPeriodicReasonAuthority, readCanonicalUtiltsIssuerIdentityAuthority, resolveCanonicalRuntimeDecisionWithRegistry } from '@/lib/ediel/core/runtimeDecision'
import { qualifyReceivedUtiltsStructure } from '@/lib/ediel/utilts/qualifyReceivedStructure'
import { captureEdielTechnicalSyntaxAckEvidence, readEdielTechnicalSourceEndpoint, recordEdielTechnicalSyntaxDecision } from '@/lib/ediel/ack/technicalSyntaxAuthority'
import { edielSmtpConfig } from '@/lib/ediel/mailReadiness'
import { prepareEdielOutboundOwnerWitness } from '@/lib/ediel/core/outboundOwnerWitness'
import { storeMailboxFetchMessage } from '@/lib/inbound-mail/edielMailboxPoller.part-2'
import type { EdielMailboxRow } from '@/lib/inbound-mail/edielMailboxPoller.part-1'

type Sql = <T = unknown>(input: string) => T
type Lit = (value: unknown) => string

/** Store a synthetic E73 original through the same rule-pack witness the
 * sent-period reader requires. The accepted journal row is local test data,
 * with no SMTP call. */
export async function seedSentE73ForUtiltsConsumption(sql: Sql, lit: Lit, ids: {
  company: string; actor: string; request: string; customer: string; site: string; point: string;
  grid: string; ediel: string; issuer: string;
}) {
  const id = randomUUID()
  const reference = `E73${id.replaceAll('-', '').slice(0, 16)}`
  const interchange = id.replaceAll('-', '').slice(0, 14)
  const raw = [
    "UNA:+.? '",
    `UNB+UNOC:3+${ids.ediel}:ZZ+${ids.issuer}:ZZ+260630:2100+${interchange}++23-DDQ-E66-T+++1+1'`,
    "UNH+1+UTILTS:D:02B:UN:E5SE5A'", `BGM+E73::260+${reference}+9+AB'`,
    "DTM+137:202606302100:203'", "DTM+735:?+0100:406'", "MKS+23+E02::260'", `RFF+TN:${reference}'`,
    `NAD+MS+${ids.ediel}:SVK:260'`, `NAD+MR+${ids.issuer}:SVK:260'`, `IDE+24+${reference}'`,
    "LOC+172+735999260731000007::9'", "LOC+239+TES:SVK:260'", "LIN+++8716867000030:::9'",
    "DTM+324:202607010000202607010015:719'", "DTM+597:202606302100:203'", "STS+7++E73::260'",
    "FTX+AAO+++Request missing E66'", "FTX+ZZZ+++Consumption'", "RFF+E66'", "UNT+19+1'", `UNZ+1+${interchange}'`,
  ].join('')
  const registry = sql<{
    rule_pack_id: string; message_profile_id: string; profile_key: string;
    original_version: string; original_snapshot: { rulePack: { source_hash: string } };
  }>(`SELECT basis FROM public.resolve_canonical_ediel_rule_pack_with_witness_v1(
    'electricity','UTILTS','E73','','outbound',(clock_timestamp() AT TIME ZONE 'Europe/Stockholm')::date) AS basis`)
  const pack = registry.original_snapshot.rulePack
  const owner = await prepareEdielOutboundOwnerWitness({ companyId: ids.company, actorUserId: ids.actor, environment: 'test', rawPayload: raw,
    rulePackEvidence: { rulePackId: registry.rule_pack_id, messageProfileId: registry.message_profile_id,
      profileKey: registry.profile_key, version: registry.original_version, sourceHash: pack.source_hash,
      snapshot: registry.original_snapshot } })
  const evidence = owner.evidence
  const recipient = 'synthetic-e73@example.invalid'
  const route = randomUUID()
  const routeProfile = randomUUID()
  sql(`BEGIN;
    INSERT INTO public.tenant_message_capabilities(company_id,environment,message_family,message_code,direction,is_enabled,bilateral)
    VALUES(${lit(ids.company)},'test','UTILTS','E73','outbound',true,true);
    INSERT INTO public.communication_routes(id,company_id,route_name,route_scope,grid_owner_id,environment_type,is_active,target_email)
    VALUES(${lit(route)},${lit(ids.company)},'Synthetic E73 route','meter_values',${lit(ids.grid)},'bilateral_test',true,${lit(recipient)});
    INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,
      sender_ediel_id,receiver_ediel_id,application_reference,is_enabled,is_active,payload_format,transport_security_mode,smtp_to,receiver_email)
    VALUES(${lit(routeProfile)},${lit(ids.company)},${lit(route)},'Synthetic E73 profile','test','edifact',${lit(ids.ediel)},${lit(ids.issuer)},
      '23-DDQ-E66-T',true,true,'edifact','unencrypted',${lit(recipient)},${lit(recipient)});
    INSERT INTO public.ediel_messages(id,company_id,customer_id,site_id,metering_point_id,grid_owner_id,grid_owner_data_request_id,
      environment,direction,message_standard,message_family,message_code,status,raw_payload,parsed_payload,created_by,application_reference,
      sender_ediel_id,receiver_ediel_id,interchange_reference,transaction_reference,external_reference,canonical_rule_pack_id,
      rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot,
      execution_context_snapshot,immutable_payload_hash,immutable_rendered_at,communication_route_id,route_profile_id,source_operation_id)
    VALUES(${lit(id)},${lit(ids.company)},${lit(ids.customer)},${lit(ids.site)},${lit(ids.point)},${lit(ids.grid)},${lit(ids.request)},
      'test','outbound','edifact','UTILTS','E73','prepared',${lit(raw)},
      ${lit({ requestedMessageCode: 'E66', resolution: 'PT15M', bilateralCapabilityVerified: true })},${lit(ids.actor)},'23-DDQ-E66-T',
      ${lit(ids.ediel)},${lit(ids.issuer)},${lit(interchange)},${lit(reference)},${lit(reference)},${lit(evidence.rulePackId)},
      ${lit(evidence.profileKey)},${lit(evidence.messageProfileId)},${lit(evidence.version)},${lit(evidence.sourceHash)},${lit(evidence.snapshot)},
      ${lit({ outboundOwnerWitnessId: owner.witnessId })},encode(sha256(convert_to(${lit(raw)},'UTF8')),'hex'),clock_timestamp(),
      ${lit(route)},${lit(routeProfile)},${lit(ids.request)});
    INSERT INTO gridex_ediel_transport.attempts(id,message_id,company_id,environment,actor_user_id,owner,binding,created_at,entered_at,
      observed_at,classification,provider_result)
    SELECT gen_random_uuid(),m.id,m.company_id,m.environment,${lit(ids.actor)},'{}',
      jsonb_build_object('originalHash',m.immutable_payload_hash,'to',${lit(recipient)}),clock_timestamp(),clock_timestamp(),
      clock_timestamp(),'accepted',${lit({ accepted: [recipient], rejected: [] })}
    FROM public.ediel_messages m WHERE m.id=${lit(id)};
    UPDATE public.ediel_messages SET status='sent',message_sent_at=clock_timestamp() WHERE id=${lit(id)};
    UPDATE public.grid_owner_data_requests SET status='sent',external_reference=${lit(reference)} WHERE id=${lit(ids.request)};
    COMMIT;`)
  return reference
}

/** Fixture-owned UTILTS parties: a unique receiver supplier identity and a unique
 * grid-owner issuer with its own synthetic approved issuer/transport-mandate
 * version, so legal attribution and issuer namespaces never collide across tests. */
export function seedUtiltsConsumptionParties(sql: Sql, lit: Lit, actor: string): { ediel: string; issuer: string } {
  // The receiver is this company's own registered supplier identity. Inbound
  // legal attribution requires it to be globally unique in the environment.
  const ediel = sql<string>(`BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('native_utilts_consumption_receiver',0));
   SELECT to_jsonb(min(n)::text) FROM generate_series(70000,79999) n WHERE NOT EXISTS(SELECT FROM public.tenant_actor_identifiers i WHERE i.identifier_type='EdielId' AND i.identifier_value=n::text);
   COMMIT;`)
  // The grid-owner issuer is likewise unique per fixture and carries its own
  // synthetic approved issuer/transport-mandate registry version, so issuer
  // namespaces and document-reference histories never collide across tests.
  const issuer = sql<string>(`BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('native_utilts_consumption_issuer',0));
   SELECT to_jsonb(min(n)::text) FROM generate_series(80000,89999) n WHERE NOT EXISTS(SELECT FROM gridex_utilts_issuer.namespaces x WHERE x.registry_actor_key='SYNTHETIC-NATIVE-ISSUER:'||n::text);
   COMMIT;`)
  registerUtiltsIssuer(sql, lit, issuer, actor)
  return { ediel, issuer }
}

/** Synthetic approved issuer and transport mandate for one grid-owner issuer
 * identity. Idempotent: an issuer registered by an earlier fixture is reused. */
export function registerUtiltsIssuer(sql: Sql, lit: Lit, issuer: string, actor: string) {
  sql(`BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('native_utilts_issuer_registration',0));
   WITH ns AS (INSERT INTO gridex_utilts_issuer.namespaces(id,environment,registry_actor_key,created_at) SELECT gen_random_uuid(),e,'SYNTHETIC-NATIVE-ISSUER:'||${lit(issuer)},clock_timestamp()-interval '1 day'
     FROM unnest(ARRAY['test','production']) e WHERE NOT EXISTS(SELECT FROM gridex_utilts_issuer.namespaces x WHERE x.environment=e AND x.registry_actor_key='SYNTHETIC-NATIVE-ISSUER:'||${lit(issuer)}) RETURNING id),
   iv AS (INSERT INTO gridex_utilts_issuer.issuer_versions(id,namespace_id,legal_identity,registry_version,registry_original_uri,registry_original_bytes,registry_sha256,legal_decision_ref,legal_decision_version,legal_decision_bytes,legal_decision_sha256,valid_from,approved_at,approved_by)
    SELECT gen_random_uuid(),ns.id,jsonb_build_array(${lit(issuer)},'SVK','260'),'SYNTHETIC-1','synthetic://native/issuer/'||${lit(issuer)},convert_to('SYNTHETIC native issuer '||${lit(issuer)},'UTF8'),encode(sha256(convert_to('SYNTHETIC native issuer '||${lit(issuer)},'UTF8')),'hex'),
     'SYNTHETIC-DECISION','1',convert_to('SYNTHETIC native decision','UTF8'),encode(sha256(convert_to('SYNTHETIC native decision','UTF8')),'hex'),clock_timestamp()-interval '1 day',clock_timestamp()-interval '1 day',${lit(actor)} FROM ns RETURNING id)
   INSERT INTO gridex_utilts_issuer.transport_mandate_versions(id,issuer_version_id,transport_sender,mandate_ref,mandate_version,mandate_original_uri,mandate_original_bytes,mandate_sha256,valid_from,approved_at,approved_by)
    SELECT gen_random_uuid(),iv.id,jsonb_build_array(${lit(issuer)},'ZZ'),'SYNTHETIC-MANDATE','1','synthetic://native/mandate/'||${lit(issuer)},convert_to('SYNTHETIC native mandate','UTF8'),encode(sha256(convert_to('SYNTHETIC native mandate','UTF8')),'hex'),clock_timestamp()-interval '1 day',clock_timestamp()-interval '1 day',${lit(actor)} FROM iv;
   COMMIT;`)
}

/** Reviewed history-coverage ground bound to the source's actual issuer admission. */
export function seedUtiltsIssuerHistoryGround(sql: Sql, lit: Lit, sourceId: string, actor: string) {
// Synthetic reviewed history-coverage ground: the fixture issuer is fresh,
  // so its complete prior issuance history is exactly the identifiers this
  // namespace already observed. Bound to the actual admission; genuine reuse
  // of a 203/505 reference is still reported as a collision by the reader.
  sql(`INSERT INTO gridex_utilts_issuer.source_absence_grounds(source_message_id,source_payload_hash,namespace_id,issuer_version_id,mandate_version_id,namespace_epoch,scope,identifiers_scope,
    registry_version,registry_original_uri,registry_original_bytes,registry_sha256,deletion_history_version,deletion_history_original_uri,deletion_history_bytes,deletion_history_sha256,
    retention_decision_ref,retention_decision_version,retention_decision_bytes,retention_decision_sha256,normalized_issued_identifiers,approval_ref,approval_version,approval_bytes,approval_sha256,approved_at,approved_by)
   SELECT a.source_message_id,a.source_payload_hash,a.namespace_id,a.issuer_version_id,a.mandate_version_id,a.namespace_epoch,'over_time_all_issuer_applications','other_prior_issued_originals',
    'SYNTHETIC-1','synthetic://native/registry',convert_to('SYNTHETIC registry','UTF8'),encode(sha256(convert_to('SYNTHETIC registry','UTF8')),'hex'),
    'SYNTHETIC-1','synthetic://native/deletions',convert_to('SYNTHETIC deletions','UTF8'),encode(sha256(convert_to('SYNTHETIC deletions','UTF8')),'hex'),
    'SYNTHETIC-RETENTION','1',convert_to('SYNTHETIC retention','UTF8'),encode(sha256(convert_to('SYNTHETIC retention','UTF8')),'hex'),
    coalesce((SELECT jsonb_agg(jsonb_build_object('field',o.field_number,'reference',o.physical_reference,'originalIssuanceReference',o.source_message_id::text,
      'originalSourceSha256',pa.source_payload_hash,'originEvidenceSha256',pa.source_payload_hash) ORDER BY o.source_message_id,o.field_number,o.physical_reference)
     FROM gridex_utilts_issuer.observed_identifiers o JOIN gridex_utilts_issuer.source_admissions pa ON pa.source_message_id=o.source_message_id
     WHERE o.namespace_id=a.namespace_id AND o.source_message_id<>a.source_message_id),'[]'::jsonb),
    'SYNTHETIC-APPROVAL','1',convert_to('SYNTHETIC approval','UTF8'),encode(sha256(convert_to('SYNTHETIC approval','UTF8')),'hex'),clock_timestamp(),${lit(actor)}
   FROM gridex_utilts_issuer.source_admissions a WHERE a.source_message_id=${lit(sourceId)} AND a.namespace_id IS NOT NULL;`)
}

/** Production order (utiltsDataRequest.part-2): structurally qualify the source,
 * record it as the canonical final decision, and return that same runtime. */
export async function recordUtiltsFinalRuntime(source: EdielMessageRow) {
  const initialDecision = await initialCanonicalUtiltsDecision(source), canonicalPolicy = initialDecision.policy
  const periodicReasonAuthority = readCanonicalPeriodicReasonAuthority({ decision: initialDecision, message: source }) ?? undefined
  const issuerIdentityAuthority = readCanonicalUtiltsIssuerIdentityAuthority({ decision: initialDecision, message: source }) ?? undefined
  const structural = await qualifyReceivedUtiltsStructure({ message: source, canonicalPolicy, issuerIdentityAuthority, periodicReasonAuthority,
    runtime: runUtiltsRuntimeForMessage(source, { canonicalPolicy, issuerIdentityAuthority, periodicReasonAuthority }) })
  await recordFinalCanonicalUtiltsDecision({ original: source, validated: source, initialDecision, runtime: structural.runtime })
  return structural.runtime
}

/** Reception (inboundProcessing): the technical syntax decision is recorded and
 * its CONTRL basis captured before any business owner runs. */
export async function recordUtiltsTechnicalReception(source: EdielMessageRow, actorUserId: string) {
  const decision = await resolveCanonicalRuntimeDecisionWithRegistry(source)
  const endpoint = await readEdielTechnicalSourceEndpoint(source.id, { actorUserId, phase: 'prepare' })
  if (!endpoint) return
  await recordEdielTechnicalSyntaxDecision({ companyId: endpoint.companyId, sourceMessageId: source.id, sourceHash: endpoint.sourceHash,
    syntaxDecision: decision.syntaxDecision === 'accepted' ? 'accepted' : 'rejected',
    reasonCodes: decision.syntaxDecision === 'accepted' ? [] : decision.issues.filter(issue => issue.severity === 'error').map(issue => issue.code),
    execution: { actorUserId, phase: 'prepare' } })
  await captureEdielTechnicalSyntaxAckEvidence(endpoint.companyId, source.id, { actorUserId, phase: 'prepare' })
}

/** The receiving company holds exactly the catalog receiver role this message
 * is addressed to when it arrives (source-edition receiverRoles). */
export function setUtiltsReceiverRole(sql: Sql, lit: Lit, company: string, actor: string, code: string) {
  const role = ({ E30: 'grid_owner', E73: 'grid_owner', S01: 'grid_owner', E72: 'metering_collector', S06: 'imbalance_settlement_responsible' } as Record<string, string>)[code] ?? 'electricity_supplier'
  sql(`UPDATE public.tenant_actor_roles SET valid_to=clock_timestamp() WHERE company_id=${lit(company)} AND actor_id=${lit(actor)} AND role_code<>${lit(role)} AND valid_to IS NULL;
   INSERT INTO public.tenant_actor_roles(company_id,environment,actor_id,role_code,valid_from) SELECT ${lit(company)},e,${lit(actor)},${lit(role)},clock_timestamp()
    FROM unnest(ARRAY['test','production']) e WHERE EXISTS(SELECT FROM public.tenant_ediel_profiles p WHERE p.company_id=${lit(company)} AND p.environment=e)
     AND NOT EXISTS(SELECT FROM public.tenant_actor_roles WHERE company_id=${lit(company)} AND environment=e AND actor_id=${lit(actor)} AND role_code=${lit(role)} AND valid_to IS NULL);`)
}

/** A real reception carries its mailbox, stored mail and parse result, as
 * production does, so changed-byte retries reach the source-conflict check. */
export function receiveUtiltsRetry(sql: Sql, lit: Lit, input: { companyId: string; actorUserId: string; raw: string; parsed: { senderEdielId?: string | null; receiverEdielId?: string | null; applicationReference?: string | null; interchangeReference?: string | null; messageFamily?: string | null; messageCode?: string | null; rawPayload: string } }): { inboundEmailMessageId: string; parseResultId: string } {
  const box = randomUUID(), mail = randomUUID(), parse = randomUUID(), p = input.parsed
  sql(`INSERT INTO public.ediel_mailboxes(id,company_id,mailbox_name,email_address,environment,is_active,is_shared_platform_mailbox) VALUES(${lit(box)},${lit(input.companyId)},'Synthetic UTILTS retry mailbox',${lit(edielSmtpConfig().from || 'synthetic-utilts-retry@example.invalid')},'test',true,false);
    INSERT INTO public.inbound_email_messages(id,company_id,environment,mailbox_id,internet_message_id,received_at,raw_edifact_payload,body_text,processing_status,match_status)
    VALUES(${lit(mail)},${lit(input.companyId)},'test',${lit(box)},${lit(`${mail}@example.invalid`)},clock_timestamp(),${lit(input.raw)},${lit(input.raw)},'received','not_checked');
    INSERT INTO public.inbound_ediel_parse_results(id,inbound_email_message_id,company_id,raw_payload,sender_ediel_id,receiver_ediel_id,application_reference,interchange_reference,message_family,message_code,parse_status)
    VALUES(${lit(parse)},${lit(mail)},${lit(input.companyId)},${lit(p.rawPayload)},${lit(p.senderEdielId ?? null)},${lit(p.receiverEdielId ?? null)},${lit(p.applicationReference ?? null)},${lit(p.interchangeReference ?? null)},${lit(p.messageFamily ?? null)},${lit(p.messageCode ?? null)},'parsed')`)
  return { inboundEmailMessageId: mail, parseResultId: parse }
}

/** Feed synthetic retained bytes into the ordinary verified IMAP owner. There
 * is no IMAP connection. The real owner stores the stable clock and intake job. */
export async function receiveObservedUtilts(sql: Sql, lit: Lit, input: Parameters<typeof receiveUtiltsRetry>[2] & { receivedAt: string }) {
  const box = randomUUID()
  const recipient = edielSmtpConfig().from || 'synthetic-utilts-reception@example.invalid'
  const mailbox = sql<EdielMailboxRow>(`INSERT INTO public.ediel_mailboxes(id,company_id,mailbox_name,email_address,environment,is_active,is_shared_platform_mailbox)
    VALUES(${lit(box)},${lit(input.companyId)},'Synthetic UTILTS observed mailbox',${lit(recipient)},'test',true,false);
    SELECT to_jsonb(b) FROM public.ediel_mailboxes b WHERE id=${lit(box)};`)
  const source = Buffer.from([
    'From: synthetic-issuer@example.invalid', `To: ${recipient}`, `Message-ID: <${box}@example.invalid>`,
    'Content-Type: text/plain; charset=UTF-8', '', input.raw,
  ].join('\r\n'))
  const retained = await storeMailboxFetchMessage({
    mailbox, actorUserId: input.actorUserId, message: { uid: 1, internalDate: new Date(input.receivedAt), source },
    transport: { accountScope: createHash('sha256').update(box).digest('hex'), folder: 'INBOX', uidValidity: 1 },
  })
  if (retained.deduped) throw Error('native_observed_utilts_transport_was_not_new')
  const parse = randomUUID(), p = input.parsed
  sql(`INSERT INTO public.inbound_ediel_parse_results(id,inbound_email_message_id,company_id,raw_payload,sender_ediel_id,receiver_ediel_id,
    application_reference,interchange_reference,message_family,message_code,parse_status)
    VALUES(${lit(parse)},${lit(retained.id)},${lit(input.companyId)},${lit(p.rawPayload)},${lit(p.senderEdielId ?? null)},
      ${lit(p.receiverEdielId ?? null)},${lit(p.applicationReference ?? null)},${lit(p.interchangeReference ?? null)},
      ${lit(p.messageFamily ?? null)},${lit(p.messageCode ?? null)},'parsed');`)
  return { inboundEmailMessageId: retained.id, parseResultId: parse }
}
