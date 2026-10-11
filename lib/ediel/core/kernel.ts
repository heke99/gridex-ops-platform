import {supabaseService} from '@/lib/supabase/service'
import { assertOutboundActorIdentity, buildOutboundExecutionContext } from '@/lib/ediel/core/outboundExecutionContext'
import type { CreateEdielMessageInput, EdielMessageRow } from '@/lib/ediel/types'
import { persistAtomicOutboundAck } from '@/lib/ediel/core/atomicAckPersistence'
import { readProtectedOutboundAckReplay } from '@/lib/ediel/core/ackPolicy'
import type { CanonicalRouteRequestType } from '@/lib/ediel/core/routeRegistry'
import { resolveCanonicalOutboundVersion } from '@/lib/ediel/core/versionRegistry'
import {
  buildCanonicalAckReferences,
  buildCanonicalOutboundReferences,
} from '@/lib/ediel/core/referenceRegistry'
import {
  findOutboundEdielMessageDuplicate,
} from '@/lib/ediel/core/dedupe'
import { validateRulebookMessageWithRegistry } from '@/lib/ediel/rulebook/validator'
import { assertPolicyDirection } from '@/lib/ediel/rulebook/canonicalRulePackRegistry'
import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {readPhysicalAckSourceCorrelation} from '@/lib/ediel/ack/sourceCorrelation'
import {isListedProdatDocumentCode,prodatDocumentValue} from '@/lib/ediel/prodat/prodatDocumentFields'
import { prepareEdielOutboundOwnerWitness } from '@/lib/ediel/core/outboundOwnerWitness'
import type { EdielSourceRulePackEvidence } from '@/lib/ediel/core/sourceRulePackEvidence'
import type { RegistryRulePackSnapshot } from '@/lib/ediel/rulebook/fieldRuleRegistry'
import { readSourceBoundOutboundAckRulePackEvidence, type SourceQualifiedOutboundAck } from '@/lib/ediel/core/ackSourceRulePackEvidence'
import { assertUtiltsPositiveAckSourceAuthority } from '@/lib/ediel/utilts/positiveAckAuthority'
import type { ExpectedContext } from '@/lib/ediel/prodat/prodatReportingPermissionContext'
import type { ProdatDateEventRow, ProdatDateEventValidationContext } from '@/lib/ediel/prodat/prodatDateEventAuthority'
import {qualifyBilateralProdatOutboundDraft,requiresBilateralProdatOutboundOwner,createAtomicBilateralProdatOriginal} from '@/lib/ediel/production/bilateralProdatOutboundDraft'
import type {RequestedChangeBasis} from '@/lib/ediel/production/requestedChangeSource'
import type {DeathStatusValidationContext} from '@/lib/ediel/prodat/prodatDeathStatusAuthority'
import type {CustomerMasterdataValidationContext} from '@/lib/ediel/production/customerMasterdataSource'
import { readSourceQualifiedNegativeFixtureDraft, sourceQualifiedNegativeFixtureMatchesDraft, prepareSourceQualifiedNegativeFixtureWitness, type SourceQualifiedNegativeFixture } from '@/lib/ediel/testing/negativeFixtureAuthority'
import { readSourceQualifiedPositiveFixtureDraft, sourceQualifiedPositiveFixtureMatchesDraft, prepareSourceQualifiedPositiveFixtureWitness, type SourceQualifiedPositiveFixture } from '@/lib/ediel/testing/positiveFixtureAuthority'
import {assertEdielTenantActor} from '@/lib/ediel/services/authorization'
import {createHash} from 'node:crypto'
import {readEdielTechnicalSourceEndpoint,requireEdielTechnicalSyntaxAckEvidence} from '@/lib/ediel/ack/technicalSyntaxAuthority'
import {readTechnicalSyntaxAckRoute} from '@/lib/ediel/ack/technicalSyntaxRoute'
import {observeAssignedProdatHeaderNegativeField} from '@/lib/inbound-mail/prodatAssignedHeaderRejectionIntake'
import {readProdatCommonHeaderRejectionEvidence,commonHeaderReplyApplicationReference} from '@/lib/ediel/ack/prodatCommonHeaderRejectionAuthority'
import {readProdatCommonHeaderNegativeAckRoute} from '@/lib/ediel/ack/prodatCommonHeaderNegativeAckRoute'
import {qualifyAiListProspectiveOriginal} from '@/lib/ediel/aiListOrigination'
import {prepareCustomerLifeEventCertificationDraftContext,prepareCustomerEventTestOriginal,isQualifiedCustomerEventTestOriginal} from '@/lib/ediel/production/lifeEventCertificationSource'
import {isQualifiedDeathStatusContext} from '@/lib/ediel/prodat/prodatDeathStatusAuthority'
import {validateEdifactEnvelope} from '@/lib/ediel/core/edifactValidation'
import {assertFreshBusinessRegistryRouteSource} from '@/lib/ediel/core/routeRegistry'
import {
  createCanonicalOutboundMessage as createLegacyCanonicalOutboundMessage,
  resolveCanonicalOutboundContext,
} from './kernelLegacy'

export {
  resolveCanonicalOutboundContext,
  resolveCanonicalInboundActor,
  resolveOutboundMessageVersion,
  resolveInboundAcceptedVersions,
  registerInboundCanonicalMessage,
  buildCanonicalReferencesForOutbound,
} from './kernelLegacy'

function ensureActorUserId(value?: string | null) {
  return value && value.trim() ? value.trim() : 'system'
}

function isPostgresUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { code?: unknown; message?: unknown }
  return (
    candidate.code === '23505' ||
    (typeof candidate.message === 'string' &&
      candidate.message.includes('duplicate key value violates unique constraint'))
  )
}

function postgresErrorMessage(error: unknown): string {
  if (!error || typeof error !== 'object') return ''
  const candidate = error as { message?: unknown; details?: unknown }
  return [candidate.message, candidate.details]
    .filter((item): item is string => typeof item === 'string')
    .join(' ')
}

function isLegacyAckPerSourceConstraint(error: unknown): boolean {
  return postgresErrorMessage(error).includes('uq_ediel_messages_outbound_ack_per_source')
}

function sequenceString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function sourceOperationIdFromDraft(draft: CreateEdielMessageInput): string | null {
  return sequenceString(draft.sourceOperationId)
    ?? sequenceString(draft.parsedPayload?.operation_id)
    ?? sequenceString(draft.parsedPayload?.operationId)
}

function assertScopedOutboundDuplicate(existing: EdielMessageRow, draft: CreateEdielMessageInput,
  companyId: string, environment: string, outboundRequestId?: string | null) {
  const operationId=sourceOperationIdFromDraft(draft)
  if(existing.company_id!==companyId || existing.environment!==environment || existing.direction!=='outbound'
    || existing.message_family!==draft.messageFamily || existing.message_code!==String(draft.messageCode)
    || operationId && existing.source_operation_id!==operationId
    || outboundRequestId && existing.outbound_request_id!==outboundRequestId)
    throw new Error('canonical_outbound_existing_operation_scope_conflict')
  if(existing.raw_payload!==draft.rawPayload)throw new Error('canonical_outbound_existing_operation_wire_conflict')
}

function originalValidationEvidence(snapshot: RegistryRulePackSnapshot): EdielSourceRulePackEvidence {
  const witness = snapshot.originalWitness
  const rulePack = witness?.rulePack as Record<string, unknown> | undefined
  const profile = witness?.messageProfile as Record<string, unknown> | undefined
  if (!rulePack || typeof rulePack.id !== 'string' || !profile || profile.id !== snapshot.profileVersionId || profile.profile_key !== snapshot.profileKey
      || rulePack.source_hash !== snapshot.checksum || `${rulePack.guide_version}:r${rulePack.guide_revision}` !== snapshot.version) throw new Error('canonical_outbound_original_rule_witness_required')
  return {rulePackId: rulePack.id, messageProfileId: snapshot.profileVersionId, profileKey: snapshot.profileKey,
    version: snapshot.version, sourceHash: snapshot.checksum, snapshot: { ...witness, profileKey: snapshot.profileKey,
      profileVersionId: snapshot.profileVersionId, version: snapshot.version, checksum: snapshot.checksum }}
}

async function assertOutboundPreparationActor(input:{companyId:string;actorUserId:string;
  negativeFixture:SourceQualifiedNegativeFixture|null;positiveFixture:SourceQualifiedPositiveFixture|null}) {
  await assertEdielTenantActor(input.negativeFixture || input.positiveFixture
    ? {companyId:input.companyId,actorUserId:input.actorUserId,permissionAnyOf:['communication.write','ediel_testing.write']}
    : {companyId:input.companyId,actorUserId:input.actorUserId,permission:'communication.write'})
}

/** An exact registered test original is independent of its diagnostic result.
 * Read its current classification after the prior-original branch, before the
 * same national validator. Ordinary business intents retain their own source. */
async function prepareDraftCustomerEventContext(input:{draft:CreateEdielMessageInput;actorUserId:string;
  negativeFixture:SourceQualifiedNegativeFixture|null;positiveFixture:SourceQualifiedPositiveFixture|null;
  context?:DeathStatusValidationContext}):Promise<DeathStatusValidationContext|undefined>{
  const {draft}=input,fixture=input.negativeFixture??input.positiveFixture
  if(!fixture||draft.messageFamily!=='PRODAT'||draft.messageCode!=='Z09'||!validateEdifactEnvelope(draft.rawPayload).ok)return input.context
  if(draft.companyId!==fixture.companyId||draft.environment!=='test'||!draft.rawPayload)
    throw Error('canonical_customer_event_actual_test_route_required')
  const original=await prepareCustomerEventTestOriginal({companyId:fixture.companyId,actorUserId:input.actorUserId,runId:fixture.runId,stepNo:fixture.stepNo})
  if(original===undefined)return input.context
  if(!isQualifiedCustomerEventTestOriginal(original))throw Error(`canonical_customer_event_independent_classification_held:${original.missing.join(',')}`)
  if(original.basis.fixtureRegistrationId!==fixture.registrationId||original.rawPayload!==draft.rawPayload
    ||!draft.communicationRouteId)throw Error('canonical_customer_event_actual_test_route_required')
  const context=await prepareCustomerLifeEventCertificationDraftContext({companyId:fixture.companyId,actorUserId:input.actorUserId,
    rawPayload:draft.rawPayload,runId:fixture.runId,stepNo:fixture.stepNo,intentId:draft.intentId??null,routeId:draft.communicationRouteId})
  if(context===undefined)throw Error('canonical_customer_event_independent_classification_held:actual_preparation_basis_missing')
  if(!isQualifiedDeathStatusContext(context))throw Error(`canonical_customer_event_independent_classification_held:${context.missing.join(',')}`)
  if(context.direction!=='outbound'||!context.certification||context.certification.fixtureRegistrationId!==fixture.registrationId
    ||context.certification.runId!==fixture.runId||context.certification.expectedOutcome!==fixture.expectedOutcome
    ||JSON.stringify([...context.certification.expectedDiagnosticCodes].sort())!==JSON.stringify([...fixture.expectedDiagnosticCodes].sort()))
    throw Error('canonical_customer_event_fixture_source_mismatch')
  return context
}

async function assertFreshDraftRegistryDispatch(draft:CreateEdielMessageInput){
  if(!['PRODAT','UTILTS','AI'].includes(draft.messageFamily)||!draft.communicationRouteId||!draft.routeProfileId)return
  if(!draft.companyId||!['test','production'].includes(draft.environment??''))throw Error('canonical_outbound_registry_scope_required')
  const {readRegistryDispatchSource}=await import('@/lib/actor-registry/registryMarketSource')
  const source=await readRegistryDispatchSource({companyId:draft.companyId,communicationRouteId:draft.communicationRouteId,
    routeProfileId:draft.routeProfileId,environment:draft.environment as 'test'|'production',messageFamily:draft.messageFamily,
    applicationReference:draft.applicationReference??null})
  if(source&&(source.wire.interchangePartyId!==draft.receiverEdielId||source.wire.address!==draft.receiverEmail
    ||source.wire.subaddress!==(draft.receiverSubAddress??null)))throw Error('canonical_outbound_registry_dispatch_mismatch')
}

/** Prospective test originals are private, byte-bound capabilities. The same
 * native token is consumed alongside the ordinary canonical original seal. */
async function prepareDraftFixtureWitnesses(input:{actorUserId:string;rawPayload:string;
  negativeFixture:SourceQualifiedNegativeFixture|null;positiveFixture:SourceQualifiedPositiveFixture|null}) {
  if(input.negativeFixture && input.positiveFixture)throw new Error('canonical_outbound_fixture_outcome_ambiguous')
  if(input.negativeFixture){
    const prepared=await prepareSourceQualifiedNegativeFixtureWitness({qualification:input.negativeFixture,actorUserId:input.actorUserId,rawPayload:input.rawPayload})
    return {sourceQualifiedNegativeFixtureWitnessId:prepared.witnessId}
  }
  if(input.positiveFixture){
    const prepared=await prepareSourceQualifiedPositiveFixtureWitness({qualification:input.positiveFixture,actorUserId:input.actorUserId,rawPayload:input.rawPayload})
    return {sourceQualifiedPositiveFixtureWitnessId:prepared.witnessId}
  }
  return {}
}

function isTechnicalListDraft(draft:CreateEdielMessageInput):boolean {
  return draft.messageStandard==='ai_list' || ['AI_LIST','BI_LIST'].includes(draft.messageFamily)
}

/** The technical list shares the public gateway and immutable send journal,
 * while its original is owned by the private list source receipt. It has no
 * EDIFACT rule pack, application envelope or business ACK references. */
async function prepareTechnicalListDraft(draft:CreateEdielMessageInput,actorUserId:string):Promise<CreateEdielMessageInput> {
  if(draft.messageStandard!=='ai_list' || draft.messageFamily!=='AI_LIST' || draft.messageCode!=='AI')
    throw new Error('ai_list_outbound_technical_scope_required')
  const forbidden: (keyof CreateEdielMessageInput)[]=['applicationReference','interchangeReference','externalReference',
    'correlationReference','transactionReference','originalMessageId','originalTransactionId','originalMessageCode',
    'relatedMessageId','switchRequestId','gridOwnerDataRequestId','outboundRequestId','partnerExportId',
    'canonicalRulePackId','ruleProfileKey','ruleProfileVersionId','ruleProfileVersion','rulePackChecksum']
  if(forbidden.some(key=>draft[key]!==null && draft[key]!==undefined && draft[key]!=='')
    || draft.rulePackSnapshot && Object.keys(draft.rulePackSnapshot).length>0
    || draft.executionContextSnapshot && Object.keys(draft.executionContextSnapshot).length>0)
    throw new Error('ai_list_edifact_or_foreign_link_forbidden')
  const qualifiedDraft={...draft,actorUserId}
  await qualifyAiListProspectiveOriginal({draft:qualifiedDraft,actorUserId})
  return {...qualifiedDraft,canonicalRulePackId:null,ruleProfileKey:null,ruleProfileVersionId:null,
    ruleProfileVersion:null,rulePackChecksum:null,rulePackSnapshot:null,executionContextSnapshot:null,
    requiresContrl:false,requiresAperak:false,contrlStatus:'not_required',aperakStatus:'not_required',utiltsErrStatus:'not_required'}
}

/** Direct consumers, including FileEngine, use the same actual validation and
 * one-use original witness as rendered drafts. A supplied snapshot/token is
 * never sufficient to bypass this public boundary. */
export async function createCanonicalOutboundMessage(params: Parameters<typeof createLegacyCanonicalOutboundMessage>[0] & {
  reportingContext?:ExpectedContext;dateEventContext?:ProdatDateEventValidationContext;deathStatusContext?:DeathStatusValidationContext;customerMasterdataContext?:CustomerMasterdataValidationContext;requestedChangeBasis?:RequestedChangeBasis
}) {
  const draft=params.baseInput,actorUserId=ensureActorUserId(params.actorUserId)
  if(!draft.companyId || draft.direction!=='outbound' || !draft.rawPayload || !['test','production'].includes(draft.environment ?? '')) throw new Error('canonical_outbound_owner_scope_required')
  const negativeFixture=readSourceQualifiedNegativeFixtureDraft(draft),positiveFixture=readSourceQualifiedPositiveFixtureDraft(draft)
  await assertOutboundPreparationActor({companyId:draft.companyId,actorUserId,negativeFixture,positiveFixture})
  const roleActor=await assertOutboundActorIdentity(draft)
  const duplicate=params.duplicateCheck ? await findOutboundEdielMessageDuplicate({
    ...params.duplicateCheck,requestType:params.requestType,companyId:draft.companyId,environment:draft.environment,
    sourceOperationId:sourceOperationIdFromDraft(draft),messageFamily:draft.messageFamily,messageCode:String(draft.messageCode),messageVersion:null,
  }) : null
  if(duplicate) {
    assertScopedOutboundDuplicate(duplicate,draft,draft.companyId,draft.environment!,params.duplicateCheck?.outboundRequestId)
    if(requiresBilateralProdatOutboundOwner(draft))return createAtomicBilateralProdatOriginal(draft,actorUserId)
    return duplicate
  }
  if(isTechnicalListDraft(draft)) {
    const baseInput=await prepareTechnicalListDraft(draft,actorUserId)
    return createLegacyCanonicalOutboundMessage({...params,actorUserId,baseInput,
      duplicateCheck:params.duplicateCheck?{...params.duplicateCheck,messageFamily:draft.messageFamily,
        messageCode:String(draft.messageCode),messageVersion:null}:undefined})
  }
  const deathStatusContext=await prepareDraftCustomerEventContext({draft,actorUserId,negativeFixture,positiveFixture,context:params.deathStatusContext})
  const snapshot=await assertOutboundDraftAllowedByCanonicalPolicy({draft,actorUserId,messageVersion:draft.messageVersion,
    negativeFixture,positiveFixture,reportingContext:params.reportingContext,dateEventContext:params.dateEventContext,deathStatusContext,customerMasterdataContext:params.customerMasterdataContext,requestedChangeBasis:params.requestedChangeBasis})
  await assertFreshDraftRegistryDispatch(draft)
  const evidence=originalValidationEvidence(snapshot)
  if(draft.canonicalRulePackId && draft.canonicalRulePackId!==evidence.rulePackId)throw new Error('canonical_outbound_selected_rule_pack_mismatch')
  if(requiresBilateralProdatOutboundOwner(draft)&&(negativeFixture||positiveFixture))throw Error('bilateral_prodat_outbound_fixture_original_owner_required')
  const fixtureWitnesses=await prepareDraftFixtureWitnesses({actorUserId,rawPayload:draft.rawPayload,negativeFixture,positiveFixture})
  const sealed=requiresBilateralProdatOutboundOwner(draft)?{witnessId:undefined,evidence}:await prepareEdielOutboundOwnerWitness({companyId:draft.companyId,actorUserId,
    environment:draft.environment as 'test'|'production',rawPayload:draft.rawPayload,rulePackEvidence:evidence,...fixtureWitnesses})
  const executionContext=roleActor?buildOutboundExecutionContext({draft:{...draft,sourceOperationId:sourceOperationIdFromDraft(draft)},actor:roleActor,rulePackId:sealed.evidence.rulePackId}):null
  return createLegacyCanonicalOutboundMessage({...params,actorUserId,duplicateCheck:params.duplicateCheck
    ? {...params.duplicateCheck,messageFamily:draft.messageFamily,messageCode:String(draft.messageCode),messageVersion:null}:undefined,
    baseInput:{...draft,canonicalRulePackId:sealed.evidence.rulePackId,
    executionContextSnapshot:{outboundOwnerWitnessId:sealed.witnessId,...fixtureWitnesses,...(executionContext?{executionContext}:{})},ruleProfileKey:sealed.evidence.profileKey,
    ruleProfileVersionId:sealed.evidence.messageProfileId,ruleProfileVersion:sealed.evidence.version,rulePackChecksum:sealed.evidence.sourceHash,
    rulePackSnapshot:{...snapshot,...sealed.evidence.snapshot}}})
}

const FINAL_CANONICAL_ACK_STATUSES = new Set(['sent', 'acknowledged', 'validated'])

function isFinalCanonicalAckStatus(value: unknown): boolean {
  return FINAL_CANONICAL_ACK_STATUSES.has(String(value ?? '').toLowerCase())
}

async function assertOutboundDraftAllowedByCanonicalPolicy(params: {
  draft: CreateEdielMessageInput
  actorUserId?:string
  messageVersion?: string | null
  reportingContext?: ExpectedContext
  dateEventContext?: ProdatDateEventValidationContext
  deathStatusContext?: DeathStatusValidationContext
  customerMasterdataContext?: CustomerMasterdataValidationContext
  negativeFixture?: SourceQualifiedNegativeFixture | null
  positiveFixture?: SourceQualifiedPositiveFixture | null
  ackSourceQualification?: SourceQualifiedOutboundAck
  requestedChangeBasis?:RequestedChangeBasis
}) {
  if (!params.draft.rawPayload) throw new Error('outbound_ediel_raw_payload_required')
  const bilateralDraftQualification=await qualifyBilateralProdatOutboundDraft({draft:params.draft,actorUserId:ensureActorUserId(params.actorUserId)})

  const dateEventRow: ProdatDateEventRow = { company_id: params.draft.companyId ?? null, environment: params.draft.environment ?? 'test',
    direction: 'outbound', message_code: params.draft.messageCode, sender_ediel_id: params.draft.senderEdielId ?? null,
    receiver_ediel_id: params.draft.receiverEdielId ?? null, sender_sub_address: params.draft.senderSubAddress ?? null,
    receiver_sub_address: params.draft.receiverSubAddress ?? null, application_reference: params.draft.applicationReference ?? null,
    transport_type: params.draft.transportType ?? 'smtp', receiver_email: params.draft.receiverEmail ?? null,
    communication_route_id: params.draft.communicationRouteId ?? null, route_profile_id: params.draft.routeProfileId ?? null, mailbox: params.draft.mailbox ?? null }
  const validation = await validateRulebookMessageWithRegistry({
    family: params.draft.messageFamily,
    code: String(params.draft.messageCode),
    processGroup: params.draft.processType ?? null,
    applicationReference: params.draft.applicationReference ?? null,
    rawPayload: params.draft.rawPayload,
    parsedPayload: params.draft.parsedPayload ?? null,
    mode: 'send',
    direction: 'outbound',
    environment: params.draft.environment ?? null,
    version: params.messageVersion ?? params.draft.messageVersion ?? null,
    companyId: params.draft.companyId ?? null,
    dateEventRow, reportingContext: params.reportingContext, dateEventContext: params.dateEventContext,
    deathStatusContext:params.deathStatusContext,
    customerMasterdataContext:params.customerMasterdataContext,
    customerMasterdataRow:{...dateEventRow,message_family:params.draft.messageFamily,raw_payload:params.draft.rawPayload,customer_id:params.draft.customerId??null,
      intent_id:params.draft.intentId??null,communication_route_id:params.draft.communicationRouteId??null},
    deathStatusRow:{...dateEventRow,message_family:params.draft.messageFamily,raw_payload:params.draft.rawPayload,
      intent_id:params.draft.intentId??null,communication_route_id:params.draft.communicationRouteId??null},
    ackSourceQualification: params.ackSourceQualification,
    requestedChangeRow:params.draft,requestedChangeBasis:params.requestedChangeBasis,
    bilateralDraftQualification,bilateralDraft:params.draft,bilateralDraftActorUserId:params.actorUserId,
  })

  // Inbound-only Z04 A/D need no independent register inventory to refuse
  // an outbound draft. Other policies retain their established first blocker;
  // every qualified draft still requires the registry's direction check.
  if (params.draft.direction === 'outbound' && validation.canonicalPolicy?.family === 'PRODAT'
    && validation.canonicalPolicy.code === 'Z04'
    && (validation.canonicalPolicy.subtype === 'A' || validation.canonicalPolicy.subtype === 'D')) {
    assertPolicyDirection(validation.canonicalPolicy, 'outbound')
  }
  const blocking = validation.issues.filter((item) => item.severity === 'error' || item.blocking)
  const qualifiedNegative = validation.canonicalPolicy && !blocking.some(issue => issue.code.startsWith('CANONICAL_') || issue.scope === 'prodat_register' || issue.scope === 'prodat_dependent')
    && sourceQualifiedNegativeFixtureMatchesDraft({ draft: params.draft, diagnosticCodes: blocking.map(issue => issue.code), qualification: params.negativeFixture })
  if(params.negativeFixture && !qualifiedNegative)throw new Error('canonical_outbound_negative_fixture_diagnostics_mismatch')
  if(params.positiveFixture && !sourceQualifiedPositiveFixtureMatchesDraft({draft:params.draft,qualification:params.positiveFixture,diagnosticCodes:blocking.map(issue=>issue.code)}))
    throw new Error('canonical_outbound_positive_fixture_diagnostics_mismatch')
  if (blocking.length > 0 && !qualifiedNegative) {
    const first = blocking[0]
    throw new Error(
      `Outbound ${params.draft.messageFamily} ${params.draft.messageCode} blockerades av canonical Ediel-policy: ${first.code} - ${first.description}`,
    )
  }
  if (validation.fieldRuleSource !== 'registry' || !validation.rulePackSnapshot) {
    throw new Error(`outbound_ediel_canonical_policy_evidence_missing:${params.draft.messageFamily}:${params.draft.messageCode}`)
  }
  return validation.rulePackSnapshot
}

/**
 * Public ACK gateway. ACK/error families inherit the exact activated rule-pack
 * evidence from the business message they acknowledge. They never select an
 * independent mutable business rule pack.
 */
export async function createCanonicalAckMessage(params: {
  actorUserId?: string | null
  sourceMessage: EdielMessageRow
  ackFamily: 'CONTRL' | 'APERAK' | 'UTILTS_ERR'
  outcome?: 'positive' | 'negative'
  draft: CreateEdielMessageInput
}) {
  const actorUserId = ensureActorUserId(params.actorUserId)
  let companyId = params.draft.companyId ?? params.sourceMessage.company_id ?? null
  const environment = params.draft.environment ?? params.sourceMessage.environment
  let prodatWire:ReturnType<typeof tokenizeEdifact>|null=null
  if(params.ackFamily==='APERAK' && params.sourceMessage.message_family==='PRODAT' && params.sourceMessage.raw_payload){
    try{prodatWire=tokenizeEdifact(params.sourceMessage.raw_payload)}catch{/* A malformed source cannot qualify a fresh common-header application ACK. */}
  }
  const commonNegative=params.ackFamily==='APERAK' && params.outcome==='negative' && prodatWire
    && !isListedProdatDocumentCode(prodatDocumentValue('202',prodatWire.segments,prodatWire.una))
  if(params.ackFamily==='CONTRL'&&!companyId){
    // Only the protected actual source endpoint can supply an unattributed
    // technical tenant; a globally matched response never supplies authority.
    companyId=(await readEdielTechnicalSourceEndpoint(params.sourceMessage.id,{actorUserId,phase:'prepare'}))?.companyId ?? null
  }
  if (!companyId || params.ackFamily!=='CONTRL'&&params.sourceMessage.company_id !== companyId
      && !(commonNegative && params.sourceMessage.company_id===null) || params.sourceMessage.environment !== environment
      || params.sourceMessage.direction !== 'inbound') throw new Error('canonical_ack_source_scope_mismatch')
  await assertEdielTenantActor(environment==='test' && (params.ackFamily==='CONTRL' || commonNegative)
    ? {companyId,actorUserId,permissionAnyOf:['communication.write','ediel_testing.write']}
    : {companyId,actorUserId,permission:'communication.write'})
  const draftWithSourceSnapshot = params.draft

  // The same shared wire projection defines the scope of a prospective ACK.
  // Caller caches/error-code sequence tokens cannot coalesce independent IDEs.
  const correlation=readPhysicalAckSourceCorrelation({id:'prospective-ack',company_id:companyId,
    environment,direction:'outbound',message_family:params.ackFamily,raw_payload:draftWithSourceSnapshot.rawPayload ?? null},params.sourceMessage)
  if(params.outcome && correlation.classification.outcome!==params.outcome)
    throw new Error('canonical_ack_draft_physical_outcome_mismatch')
  const scoped=correlation.scope==='transaction'||correlation.scope==='object'
  const references=[...new Set(correlation.acknowledgedReferences)].sort()
  // Missing LI has no string substitute. Its real object/agency/first-LIN
  // tuple provides the operation namespace, independently of the outcome.
  const objectScopes=correlation.prodatObjectOutcomes?.map(scope=>({lineItemReference:scope.lineItemReference,
    objectId:scope.objectId,identityAgency:scope.identityAgency,firstLineIndex:scope.firstLineIndex}))
    .sort((a,b)=>a.firstLineIndex-b.firstLineIndex)
  const physicalSequenceToken=objectScopes?.some(scope=>scope.lineItemReference===null)
    ? `object:${createHash('sha256').update(JSON.stringify(objectScopes),'utf8').digest('hex')}`
    : scoped ? references.length===1 ? references[0]
    : `${correlation.scope}:${createHash('sha256').update(JSON.stringify(references),'utf8').digest('hex')}` : null
  const rawProdatScope=params.sourceMessage.message_family==='PRODAT'&&params.ackFamily==='APERAK'
  const allowSequencedTransactionAck=!rawProdatScope&&correlation.scope==='transaction'
  if(allowSequencedTransactionAck&&references.length!==1)throw Error('canonical_ack_physical_transaction_scope_ambiguous')
  const physicalTransactionReference=allowSequencedTransactionAck?references[0]!:null
  const parsedReference=draftWithSourceSnapshot.parsedPayload?.relatedTransactionReference
  const parsedTransactionReference=typeof parsedReference==='string'&&parsedReference.trim().length>0?parsedReference:null
  if(physicalTransactionReference&&parsedTransactionReference&&parsedTransactionReference!==physicalTransactionReference)
    throw Error('canonical_ack_physical_transaction_metadata_mismatch')
  const sequenceToken=rawProdatScope?physicalSequenceToken:physicalTransactionReference
  const sequenceField=allowSequencedTransactionAck?'relatedTransactionReference' as const:null
  const readReplay = () => readProtectedOutboundAckReplay({companyId,environment,actorUserId,
    sourceMessage:params.sourceMessage,ackFamily:params.ackFamily,sequenceField,sequenceValue:sequenceToken,requestedRawPayload:params.draft.rawPayload})
  const returnReplay = (duplicate:EdielMessageRow) => {
    const attemptedOutcome=params.outcome ?? null
    const payload=duplicate.parsed_payload ?? {}
    const existingOutcome=duplicate.ack_outcome==='positive'||duplicate.ack_outcome==='negative' ? duplicate.ack_outcome
      : payload.ackOutcome==='positive'||payload.ackOutcome==='negative' ? payload.ackOutcome : null
    if(!(params.sourceMessage.message_family==='PRODAT'&&params.ackFamily==='APERAK') && attemptedOutcome && existingOutcome && attemptedOutcome!==existingOutcome)throw new Error(isFinalCanonicalAckStatus(duplicate.status)
      ? `blocked_final_ack_exists: Final ${params.ackFamily} finns redan med outcome ${existingOutcome}. Nytt outcome ${attemptedOutcome} blockeras.`
      : `conflicting_ack_draft_exists: ${params.ackFamily} finns redan med outcome ${existingOutcome}. Nytt outcome ${attemptedOutcome} blockeras tills den gamla draften ersätts.`)
    // Replay/conflict rejection produces no messages, witnesses, events or new
    // route/profile selection. Only the protected established row is returned.
    if(params.sourceMessage.message_family==='PRODAT'&&params.ackFamily==='APERAK'){
      const existing=duplicate
      const desired=correlation.classification.outcome
    if(correlation.prodatObjectOutcomes?.length){
      const prior=readPhysicalAckSourceCorrelation(existing,params.sourceMessage)
      if(!correlation.prodatObjectOutcomes.every(own=>prior.prodatObjectOutcomes?.some(result=>
        result.objectId===own.objectId&&result.identityAgency===own.identityAgency&&result.firstLineIndex===own.firstLineIndex
        &&result.lineItemReference===own.lineItemReference&&result.outcome===own.outcome)))
        throw new Error('blocked_final_ack_exists: Originalets objektspecifika ACK-utfall är oföränderligt.')
    }else if(correlation.scopedOutcomes?.length){
      const prior=readPhysicalAckSourceCorrelation(existing,params.sourceMessage)
      if(!correlation.scopedOutcomes.every(own=>prior.scopedOutcomes?.some(result=>result.reference===own.reference && result.outcome===own.outcome)))
        throw new Error('blocked_final_ack_exists: Originalets objektspecifika ACK-utfall är oföränderligt.')
    }else if(existing.ack_outcome!==desired)
      throw new Error('blocked_final_ack_exists: Originalets ACK-utfall är oföränderligt.')
    }
    return duplicate
  }
  const duplicate=await readReplay()
  if(params.sourceMessage.message_family==='PRODAT'&&params.ackFamily==='APERAK'){
    const desired=readPhysicalAckSourceCorrelation({id:'requested-own-ack',environment,direction:'outbound',message_family:'APERAK',raw_payload:params.draft.rawPayload??null})
    if(params.outcome&&params.outcome!==desired.classification.outcome)throw new Error('canonical_ack_draft_outcome_scope_mismatch')
  }
  if(duplicate)return returnReplay(duplicate)
  // Fresh use of the actual source bytes is independently retention gated.
  // Established immutable ACK replay above never reconstructs purged content.
  const requireBytes=supabaseService.rpc.bind(supabaseService) as unknown as (name:string,args:Record<string,unknown>)=>PromiseLike<{error:unknown}>
  const bytes=await requireBytes('ediel_require_source_bytes_available_v1',{p_company_id:companyId,p_source_message_id:params.sourceMessage.id})
  if(bytes.error)throw bytes.error
  const persistAck=async(input:CreateEdielMessageInput,commonSmtp?:{from:string;host:string;port:number}):Promise<EdielMessageRow>=>{
    try{return returnReplay(await persistAtomicOutboundAck(input,{companyId,environment,actorUserId,sourceMessage:params.sourceMessage,ackFamily:params.ackFamily,sequenceField,sequenceValue:sequenceToken,outcome:params.outcome??input.ackOutcome??null,commonSmtp}))}catch(error){
      if(isPostgresUniqueViolation(error)){
        const existing=await readReplay()
        if(existing)return returnReplay(existing)
      }
      throw error
    }
  }

  if(params.ackFamily==='CONTRL'){
    const evidence=await requireEdielTechnicalSyntaxAckEvidence(companyId,params.sourceMessage.id,{actorUserId,phase:'prepare'})
    if(evidence.environment!==environment || evidence.sourceHash!==createHash('sha256').update(params.sourceMessage.raw_payload ?? '', 'utf8').digest('hex'))throw new Error('canonical_ack_actual_original_mismatch')
    const route=await readTechnicalSyntaxAckRoute({evidence,actorUserId})
    const input:CreateEdielMessageInput={...params.draft,actorUserId,companyId,environment,direction:'outbound',messageFamily:'CONTRL',messageCode:'CONTRL',
      messageStandard:'edifact',transportType:'smtp',communicationRouteId:route.route.id,routeProfileId:route.routeRuntime.route_profile_id,
      senderEdielId:route.senderEdielId,senderSubAddress:route.senderSubAddress,senderEmail:route.senderEmail,
      receiverEdielId:route.receiverEdielId,receiverSubAddress:route.receiverSubAddress,receiverEmail:route.receiverEmail,
      mailbox:route.mailbox,applicationReference:route.applicationReference,relatedMessageId:params.sourceMessage.id,
      sourceOperationId:`ediel_ack:${params.sourceMessage.id}:CONTRL:message`,ackOutcome:params.outcome ?? params.draft.ackOutcome,
      canonicalRulePackId:null,ruleProfileKey:null,ruleProfileVersionId:null,ruleProfileVersion:null,rulePackChecksum:null,rulePackSnapshot:null,
      executionContextSnapshot:null,outboundRequestId:null,switchRequestId:null,gridOwnerDataRequestId:null,partnerExportId:null,
      customerId:null,siteId:null,meteringPointId:null,gridOwnerId:null}
    const validation=await validateRulebookMessageWithRegistry({family:'CONTRL',code:'CONTRL',rawPayload:input.rawPayload,
      direction:'outbound',mode:'send',companyId,environment,applicationReference:route.applicationReference,
      technicalSyntaxAckEvidence:evidence,version:input.messageVersion,parsedPayload:input.parsedPayload})
    if(validation.fieldRuleSource!=='technical_source'||validation.blocking||!validation.technicalSyntaxAckEvidence)throw new Error('canonical_technical_ack_validation_required')
    return persistAck(input,{from:route.senderEmail,host:route.smtpHost,port:route.smtpPort})
  }

  if(params.ackFamily==='APERAK' && prodatWire && (!isListedProdatDocumentCode(prodatDocumentValue('202',prodatWire.segments,prodatWire.una))
    ||observeAssignedProdatHeaderNegativeField(params.sourceMessage.raw_payload))) {
    if(params.outcome!=='negative' || allowSequencedTransactionAck)throw new Error('canonical_common_header_negative_only')
    const {sourceMessage,evidence}=await readProdatCommonHeaderRejectionEvidence({companyId,environment,
      sourceMessageId:params.sourceMessage.id,expectedRawPayload:params.sourceMessage.raw_payload!,actorUserId})
    const syntax=await requireEdielTechnicalSyntaxAckEvidence(companyId,sourceMessage.id,{actorUserId,phase:'prepare'})
    if(syntax.environment!==environment || syntax.sourceHash!==evidence.sourceHash || syntax.syntaxAssessmentId!==evidence.syntaxAssessmentId
      || syntax.syntaxDecision!=='accepted' || syntax.originalUNB.interchangeReference!==evidence.identities.transport.interchangeReference
      || syntax.originalUNB.applicationReference!==(evidence.identities.applicationReference??'')
      || JSON.stringify(syntax.originalUNB.sender)!==JSON.stringify(evidence.identities.transport.senderComponents)
      || JSON.stringify(syntax.originalUNB.receiver)!==JSON.stringify(evidence.identities.transport.receiverComponents))
      throw new Error('canonical_common_header_technical_source_mismatch')
    const route=await readProdatCommonHeaderNegativeAckRoute({evidence,technicalEvidence:syntax,actorUserId})
    const refs=buildCanonicalAckReferences({sourceMessage,ackFamily:'APERAK'})
    const input:CreateEdielMessageInput={...params.draft,...refs,actorUserId,companyId,environment,direction:'outbound',messageStandard:'edifact',
      messageFamily:'APERAK',messageCode:params.draft.messageCode,communicationRouteId:route.route.id,routeProfileId:route.routeRuntime.route_profile_id,
      senderEdielId:route.senderEdielId,senderSubAddress:route.senderSubAddress,senderEmail:route.senderEmail,
      receiverEdielId:route.receiverEdielId,receiverSubAddress:route.receiverSubAddress,receiverEmail:route.receiverEmail,
      mailbox:route.mailbox,applicationReference:commonHeaderReplyApplicationReference(evidence),relatedMessageId:sourceMessage.id,
      sourceOperationId:`ediel_ack:${sourceMessage.id}:APERAK:message`,ackOutcome:'negative',
      externalReference:params.draft.externalReference ?? refs.externalReference,transactionReference:params.draft.transactionReference ?? refs.transactionReference,
      correlationReference:params.draft.correlationReference ?? refs.correlationReference,canonicalRulePackId:null,
      ruleProfileKey:null,ruleProfileVersionId:null,ruleProfileVersion:null,rulePackChecksum:null,rulePackSnapshot:null,
      executionContextSnapshot:null,outboundRequestId:null,switchRequestId:null,gridOwnerDataRequestId:null,partnerExportId:null,
      customerId:null,siteId:null,meteringPointId:null,gridOwnerId:null,originalMessageCode:null}
    const validation=await validateRulebookMessageWithRegistry({family:'APERAK',code:String(input.messageCode),rawPayload:input.rawPayload,
      direction:'outbound',mode:'send',companyId,environment,applicationReference:input.applicationReference,
      prodatCommonHeaderRejectionEvidence:evidence,version:input.messageVersion,parsedPayload:input.parsedPayload})
    if(validation.fieldRuleSource!=='common_header_source' || validation.blocking || validation.prodatCommonHeaderRejectionEvidence!==evidence)
      throw new Error('canonical_common_header_ack_validation_required')
    return persistAck(input,{from:route.senderEmail,host:route.smtpHost,port:route.smtpPort})
  }

  // A qualified committed own response is replayed above before today's legal role,
  // route, guide or source-pack guards. Fresh responses consume the protected
  // actual original, never editable source metadata or a detached snapshot.
  const ackSourceQualification = await readSourceBoundOutboundAckRulePackEvidence({companyId, environment, sourceMessageId: params.sourceMessage.id})
  const sourceMessage = ackSourceQualification.sourceMessage
  if (sourceMessage.raw_payload !== params.sourceMessage.raw_payload || sourceMessage.message_family !== params.sourceMessage.message_family
      || sourceMessage.message_code !== params.sourceMessage.message_code) throw new Error('canonical_ack_actual_original_mismatch')
  await assertUtiltsPositiveAckSourceAuthority({sourceMessage, draft: params.draft})
  if (sourceMessage.message_family === 'PRODAT' && sourceMessage.raw_payload && params.ackFamily === 'APERAK') {
    const wire = tokenizeEdifact(sourceMessage.raw_payload)
    const physicalCode = prodatDocumentValue('202', wire.segments, wire.una)
    if (!isListedProdatDocumentCode(physicalCode) || physicalCode !== sourceMessage.message_code) throw new Error('canonical_ack_prodat_source_code_profile_mismatch')
  }
  const canonicalRulePackId = ackSourceQualification.evidence.rulePackId
  const routeContext = await resolveCanonicalOutboundContext({requestType: 'ediel_ack', companyId, environment,
    messageStandard: params.draft.messageStandard ?? 'edifact', receiverEdielId: params.draft.receiverEdielId ?? sourceMessage.sender_ediel_id ?? null,
    applicationReference: sourceMessage.application_reference ?? null,
    ackProfile: {family: params.ackFamily, code: params.draft.messageCode}})
  const routeProfileId = routeContext.routeRuntime?.route_profile_id ?? null
  if (!routeProfileId) throw new Error(`canonical_ack_route_profile_required:${routeContext.route.id}`)

  const baseRefs = buildCanonicalAckReferences({
    sourceMessage,
    ackFamily: params.ackFamily,
  })

  const refs = {
        ...baseRefs,
        externalReference: draftWithSourceSnapshot.externalReference ?? baseRefs.externalReference,
        transactionReference: draftWithSourceSnapshot.transactionReference ?? baseRefs.transactionReference,
        correlationReference: draftWithSourceSnapshot.correlationReference ?? baseRefs.correlationReference,
      }

  const input: CreateEdielMessageInput = {
    ...draftWithSourceSnapshot,
    parsedPayload:physicalTransactionReference?{...draftWithSourceSnapshot.parsedPayload,ackScope:'transaction',relatedTransactionReference:physicalTransactionReference}:draftWithSourceSnapshot.parsedPayload,
    direction:'outbound',
    actorUserId,
    companyId,
    communicationRouteId: routeContext.route.id,
    routeProfileId,
    // The selected route's own address and mailbox win: the atomic commit
    // re-reads exactly that route/profile (a draft-derived address cannot).
    receiverEmail: routeContext.receiverEmail ?? draftWithSourceSnapshot.receiverEmail ?? null,
    mailbox: routeContext.mailbox ?? draftWithSourceSnapshot.mailbox ?? null,
    canonicalRulePackId,
    sourceOperationId: `ediel_ack:${params.sourceMessage.id}:${params.ackFamily}:${sequenceToken ?? 'message'}`,
    externalReference: refs.externalReference,
    transactionReference: refs.transactionReference,
    correlationReference: refs.correlationReference,
    originalMessageId: refs.originalMessageId,
    originalTransactionId: refs.originalTransactionId,
    originalMessageCode: refs.originalMessageCode,
    relatedMessageId: params.sourceMessage.id,
    ackOutcome: params.outcome ?? draftWithSourceSnapshot.ackOutcome ?? null,
  }

  const rulePackSnapshot = await assertOutboundDraftAllowedByCanonicalPolicy({
    draft: input,
    messageVersion: input.messageVersion ?? null,
    ackSourceQualification,
  })

  if (!input.rawPayload || (environment !== 'test' && environment !== 'production')) throw new Error('canonical_ack_owner_scope_required')

  const canonicalAckInput: CreateEdielMessageInput = {
    ...input,
    executionContextSnapshot: null,
    ruleProfileKey: rulePackSnapshot.profileKey,
    ruleProfileVersionId: rulePackSnapshot.profileVersionId,
    ruleProfileVersion: rulePackSnapshot.version,
    rulePackChecksum: rulePackSnapshot.checksum,
    rulePackSnapshot: {
      ...rulePackSnapshot,
      ...ackSourceQualification.evidence.snapshot,
      resolvedAt: new Date().toISOString(),
      family: params.ackFamily,
      code: String(input.messageCode),
      inheritedFromSourceMessage: true,
      sourceMessageId: params.sourceMessage.id,
      authority: 'resolveCanonicalEdielPolicy',
      databaseRole: 'evidence_only',
    },
  }

  try {
    return await persistAck(canonicalAckInput)
  } catch (error) {
    if (isPostgresUniqueViolation(error) && isLegacyAckPerSourceConstraint(error) && params.ackFamily === 'APERAK' && allowSequencedTransactionAck) {
      throw new Error(
        'Databasen blockerar fortfarande flera APERAK per källmeddelande via uq_ediel_messages_outbound_ack_per_source. Kör SQL-migrationen ediel_ack_transaction_scope.sql i Supabase och kör sedan engine igen.'
      )
    }

    throw error
  }
}

/**
 * Canonical outbound gateway. Version/reference ownership stays in their
 * dedicated canonical registries, while field/D-condition validation consumes
 * the policy snapshot created by the renderer. The persisted DB rule pack is
 * evidence only and cannot redefine protocol semantics.
 */
export async function finalizeCanonicalOutboundDraft(params: {
  actorUserId?: string | null
  requestType: CanonicalRouteRequestType
  routeContext: Awaited<ReturnType<typeof resolveCanonicalOutboundContext>>
  draft: CreateEdielMessageInput
  reportingContext?: ExpectedContext
  dateEventContext?: ProdatDateEventValidationContext
  requestedChangeBasis?:RequestedChangeBasis
  deathStatusContext?: DeathStatusValidationContext
  customerMasterdataContext?: CustomerMasterdataValidationContext
  outboundRequestId?: string | null
  duplicateCheck: {
    sourceType?: string | null
    sourceId?: string | null
    receiverEdielId?: string | null
    messageFamily: string
    messageCode: string
    messageVersion?: string | null
    periodStart?: string | null
    periodEnd?: string | null
  }
}) {
  const actorUserId = ensureActorUserId(params.actorUserId)
  const messageFamily = params.draft.messageFamily
  const messageCode = String(params.draft.messageCode)
  const companyId=params.draft.companyId ?? params.routeContext.companyId
  const environment=params.draft.environment ?? params.routeContext.environment
  if(!companyId || params.draft.direction!=='outbound' || !['test','production'].includes(environment ?? '')
    || params.routeContext.companyId && params.routeContext.companyId!==companyId
    || params.routeContext.environment!==environment)throw new Error('canonical_outbound_owner_scope_required')
  const negativeFixture = readSourceQualifiedNegativeFixtureDraft(params.draft),positiveFixture=readSourceQualifiedPositiveFixtureDraft(params.draft)
  await assertOutboundPreparationActor({companyId,actorUserId,negativeFixture,positiveFixture})
  const existing = await findOutboundEdielMessageDuplicate({...params.duplicateCheck,companyId,
    environment, sourceOperationId: sourceOperationIdFromDraft(params.draft),
    outboundRequestId: params.outboundRequestId, requestType: params.requestType,
    messageFamily, messageCode, messageVersion: null})
  if (existing) {
    assertScopedOutboundDuplicate(existing,params.draft,companyId,environment,params.outboundRequestId)
    if(requiresBilateralProdatOutboundOwner(params.draft))return createAtomicBilateralProdatOriginal({...params.draft,companyId,environment},actorUserId)
    return existing
  }

  if(isTechnicalListDraft(params.draft)) {
    if(params.outboundRequestId)throw new Error('ai_list_edifact_or_foreign_link_forbidden')
    const baseInput=await prepareTechnicalListDraft({...params.draft,actorUserId,companyId,environment,
      senderEdielId:params.draft.senderEdielId ?? params.routeContext.senderEdielId,
      receiverEdielId:params.draft.receiverEdielId ?? params.routeContext.receiverEdielId,
      receiverEmail:params.draft.receiverEmail ?? params.routeContext.receiverEmail,
      mailbox:params.draft.mailbox ?? params.routeContext.mailbox,
      communicationRouteId:params.draft.communicationRouteId ?? params.routeContext.route.id,
      routeProfileId:params.draft.routeProfileId ?? sequenceString(params.routeContext.routeRuntime?.route_profile_id),
    },actorUserId)
    return createLegacyCanonicalOutboundMessage({actorUserId,requestType:params.requestType,
      duplicateCheck:{...params.duplicateCheck,messageFamily,messageCode,messageVersion:null},baseInput})
  }

  const resolvedVersion = await resolveCanonicalOutboundVersion({
    family: messageFamily,
    code: messageCode,
    standard: params.draft.messageStandard,
    fallback: params.draft.messageVersion ?? null,
    environment: params.draft.environment ?? params.routeContext.environment,
    routeDefaultMessageVersion: params.routeContext.defaultMessageVersion,
  })

  const refs = buildCanonicalOutboundReferences({
    family: messageFamily,
    code: messageCode,
    relatedMessageId: null,
    preferredExternalReference: params.draft.externalReference ?? null,
    preferredTransactionReference: params.draft.transactionReference ?? null,
    correlationReference: params.draft.correlationReference ?? null,
    originalMessageId: params.draft.originalMessageId ?? null,
    originalTransactionId: params.draft.originalTransactionId ?? null,
    originalMessageCode: params.draft.originalMessageCode ?? null,
  })

  const baseInput: CreateEdielMessageInput = {
    ...params.draft,
    actorUserId,
    companyId: params.draft.companyId ?? params.routeContext.companyId ?? null,
    messageVersion: resolvedVersion ?? params.draft.messageVersion ?? null,
    applicationReference:
      params.draft.applicationReference ??
      params.routeContext.applicationReference ??
      null,
    externalReference: refs.externalReference,
    transactionReference: refs.transactionReference,
    correlationReference: refs.correlationReference,
    originalMessageId: refs.originalMessageId,
    originalTransactionId: refs.originalTransactionId,
    originalMessageCode: refs.originalMessageCode,
    senderEdielId: params.draft.senderEdielId ?? params.routeContext.senderEdielId,
    senderName: params.draft.senderName ?? params.routeContext.senderName,
    senderSubAddress:
      params.draft.senderSubAddress ?? params.routeContext.senderSubAddress,
    receiverEdielId: params.draft.receiverEdielId ?? params.routeContext.receiverEdielId,
    receiverName: params.draft.receiverName ?? params.routeContext.receiverName,
    receiverSubAddress:
      params.draft.receiverSubAddress ?? params.routeContext.receiverSubAddress,
    receiverEmail: params.draft.receiverEmail ?? params.routeContext.receiverEmail,
    mailbox: params.draft.mailbox ?? params.routeContext.mailbox,
    communicationRouteId:
      params.draft.communicationRouteId ?? params.routeContext.route.id,
    routeProfileId: params.draft.routeProfileId ?? sequenceString(params.routeContext.routeRuntime?.route_profile_id),
    environment: params.draft.environment ?? params.routeContext.environment,
    messageStandard:
      params.draft.messageStandard ?? params.routeContext.messageStandard,
    testFlag: params.draft.testFlag ?? params.routeContext.actor.testFlag,
  }

  const deathStatusContext=await prepareDraftCustomerEventContext({draft:baseInput,actorUserId,negativeFixture,positiveFixture,context:params.deathStatusContext})
  const rulePackSnapshot = await assertOutboundDraftAllowedByCanonicalPolicy({
    draft: baseInput,actorUserId,
    messageVersion: resolvedVersion ?? params.duplicateCheck.messageVersion ?? null,
    reportingContext:params.reportingContext,dateEventContext:params.dateEventContext,deathStatusContext,customerMasterdataContext:params.customerMasterdataContext,
    requestedChangeBasis:params.requestedChangeBasis,
    negativeFixture,positiveFixture,
  })
  await assertFreshBusinessRegistryRouteSource(params.routeContext,messageFamily)
  await assertFreshDraftRegistryDispatch(baseInput)
  const routeProfileId = sequenceString(baseInput.routeProfileId)
    ?? sequenceString(params.routeContext.routeRuntime?.route_profile_id)
  if (!routeProfileId) {
    throw new Error(`canonical_ediel_route_profile_required:${params.routeContext.route.id}`)
  }
  const originalEvidence = originalValidationEvidence(rulePackSnapshot)
  const canonicalRulePackId = originalEvidence.rulePackId
  if (baseInput.canonicalRulePackId && baseInput.canonicalRulePackId !== canonicalRulePackId) throw new Error('canonical_outbound_selected_rule_pack_mismatch')
  const sourceOperationId = sourceOperationIdFromDraft(baseInput)
  if (!sourceOperationId) {
    throw new Error(`canonical_ediel_source_operation_required:${messageFamily}:${messageCode}`)
  }

  if (!baseInput.companyId || !baseInput.rawPayload || (baseInput.environment !== 'test' && baseInput.environment !== 'production')) throw new Error('canonical_outbound_owner_scope_required')
  if(requiresBilateralProdatOutboundOwner(baseInput)&&(negativeFixture||positiveFixture))throw Error('bilateral_prodat_outbound_fixture_original_owner_required')
  const fixtureWitnesses=await prepareDraftFixtureWitnesses({actorUserId,rawPayload:baseInput.rawPayload,negativeFixture,positiveFixture})
  const sealed = requiresBilateralProdatOutboundOwner(baseInput)?{witnessId:undefined,evidence:originalEvidence}:await prepareEdielOutboundOwnerWitness({companyId: baseInput.companyId, actorUserId, environment: baseInput.environment,
    rawPayload: baseInput.rawPayload, rulePackEvidence: originalEvidence,...fixtureWitnesses})

  const canonicalInput: CreateEdielMessageInput = {
    ...baseInput,
    executionContextSnapshot: {outboundOwnerWitnessId: sealed.witnessId,...fixtureWitnesses},
    routeProfileId,
    canonicalRulePackId,
    sourceOperationId,
    ruleProfileKey: rulePackSnapshot.profileKey,
    ruleProfileVersionId: rulePackSnapshot.profileVersionId,
    ruleProfileVersion: rulePackSnapshot.version,
    rulePackChecksum: rulePackSnapshot.checksum,
    rulePackSnapshot: {
      ...rulePackSnapshot,
      ...sealed.evidence.snapshot,
      resolvedAt: new Date().toISOString(),
      family: messageFamily,
      code: messageCode,
      authority: 'resolveCanonicalEdielPolicy',
      databaseRole: 'evidence_only',
    },
  }

  return createLegacyCanonicalOutboundMessage({
    actorUserId,
    requestType: params.requestType,
    duplicateCheck: {
      outboundRequestId: params.outboundRequestId ?? null,
      sourceType: params.duplicateCheck.sourceType ?? null,
      sourceId: params.duplicateCheck.sourceId ?? null,
      receiverEdielId: params.duplicateCheck.receiverEdielId ?? null,
      messageFamily,
      messageCode,
      messageVersion: resolvedVersion ?? params.duplicateCheck.messageVersion ?? null,
      periodStart: params.duplicateCheck.periodStart ?? null,
      periodEnd: params.duplicateCheck.periodEnd ?? null,
    },
    baseInput: canonicalInput,
  })
}
