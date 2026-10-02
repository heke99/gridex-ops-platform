import { randomUUID } from 'node:crypto'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'
import { initialCanonicalUtiltsDecision, recordFinalCanonicalUtiltsDecision } from '@/lib/ediel/flows/utiltsCanonicalValidation'
import { readCanonicalPeriodicReasonAuthority, readCanonicalUtiltsIssuerIdentityAuthority, resolveCanonicalRuntimeDecisionWithRegistry } from '@/lib/ediel/core/runtimeDecision'
import { qualifyReceivedUtiltsStructure } from '@/lib/ediel/utilts/qualifyReceivedStructure'
import { captureEdielTechnicalSyntaxAckEvidence, readEdielTechnicalSourceEndpoint, recordEdielTechnicalSyntaxDecision } from '@/lib/ediel/ack/technicalSyntaxAuthority'

type Sql = <T = unknown>(input: string) => T
type Lit = (value: unknown) => string

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
   WITH ns AS (INSERT INTO gridex_utilts_issuer.namespaces(id,environment,registry_actor_key,created_at) SELECT gen_random_uuid(),'test','SYNTHETIC-NATIVE-ISSUER:'||${lit(issuer)},clock_timestamp()-interval '1 day'
     WHERE NOT EXISTS(SELECT FROM gridex_utilts_issuer.namespaces x WHERE x.environment='test' AND x.registry_actor_key='SYNTHETIC-NATIVE-ISSUER:'||${lit(issuer)}) RETURNING id),
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
   INSERT INTO public.tenant_actor_roles(company_id,environment,actor_id,role_code,valid_from) SELECT ${lit(company)},'test',${lit(actor)},${lit(role)},clock_timestamp()
    WHERE NOT EXISTS(SELECT FROM public.tenant_actor_roles WHERE company_id=${lit(company)} AND actor_id=${lit(actor)} AND role_code=${lit(role)} AND valid_to IS NULL);`)
}

/** A real reception carries its mailbox, stored mail and parse result, as
 * production does, so changed-byte retries reach the source-conflict check. */
export function receiveUtiltsRetry(sql: Sql, lit: Lit, input: { companyId: string; actorUserId: string; raw: string; parsed: { senderEdielId?: string | null; receiverEdielId?: string | null; applicationReference?: string | null; interchangeReference?: string | null; messageFamily?: string | null; messageCode?: string | null; rawPayload: string } }): { inboundEmailMessageId: string; parseResultId: string } {
  const box = randomUUID(), mail = randomUUID(), parse = randomUUID(), p = input.parsed
  sql(`INSERT INTO public.ediel_mailboxes(id,company_id,mailbox_name,environment,is_active,is_shared_platform_mailbox) VALUES(${lit(box)},${lit(input.companyId)},'Synthetic UTILTS retry mailbox','test',true,false);
    INSERT INTO public.inbound_email_messages(id,company_id,environment,mailbox_id,internet_message_id,received_at,raw_edifact_payload,body_text,processing_status,match_status)
    VALUES(${lit(mail)},${lit(input.companyId)},'test',${lit(box)},${lit(`${mail}@example.invalid`)},clock_timestamp(),${lit(input.raw)},${lit(input.raw)},'received','not_checked');
    INSERT INTO public.inbound_ediel_parse_results(id,inbound_email_message_id,company_id,raw_payload,sender_ediel_id,receiver_ediel_id,application_reference,interchange_reference,message_family,message_code,parse_status)
    VALUES(${lit(parse)},${lit(mail)},${lit(input.companyId)},${lit(p.rawPayload)},${lit(p.senderEdielId ?? null)},${lit(p.receiverEdielId ?? null)},${lit(p.applicationReference ?? null)},${lit(p.interchangeReference ?? null)},${lit(p.messageFamily ?? null)},${lit(p.messageCode ?? null)},'parsed')`)
  return { inboundEmailMessageId: mail, parseResultId: parse }
}
