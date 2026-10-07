// Proposed whole Z03L/LK native proof; NOT_RUN at authoring. No whole-ID tags.
// Existing #595 finite assertions are retained unchanged. Public synthetic
// agreement/mail inputs and one external SMTP double; all owners and consumers
// are production code. Future activation and market certification are separate.
import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
const smtp = vi.hoisted(() => vi.fn())
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: smtp }) } }))
import { seedNormalSwitchNativeFixture, normalSwitchNetworkRegistry, nativeSql as sql, literal, type NormalSwitchStageNativeFixture, type NormalSwitchNativeRequestInput } from './helpers/ediel-normal-switch-native-fixture'
import { attachNetworkRegistrySourceFixture } from './helpers/ediel-network-registry-native-fixture'
import { seedOriginalMailboxNative } from './helpers/originalMailboxNative'
import { parseSourceReceiptInstant } from '@/lib/ediel/utilts/receivedSourceInventory'
import { readInboundReceptionRequest } from '@/lib/ediel/inbound/receptions'
import { requireEdielInboundLegalContext } from '@/lib/ediel/tenant/sourceLegalContext'
import { requireEdielSourceRulePackEvidence } from '@/lib/ediel/core/sourceRulePackEvidence'
import { ownerSource, OWNER } from '../__tests__/helpers/sourceOwnerFixtures'
import { supabaseService } from '@/lib/supabase/service'
import { saveElectricitySupplier, saveCustomerSite } from '@/lib/masterdata/db'
import { setOwnElectricitySupplier } from '@/lib/masterdata/selfSupplier'
import { electricitySupplierInputSchema, customerSiteInputSchema } from '@/lib/masterdata/validators'
import { createSupplierSwitchRequest, findCustomerSiteById, listMeteringPointsForSite, listPowersOfAttorneyByCustomerId, updateSupplierSwitchValidationSnapshot } from '@/lib/operations/db'
import { evaluateSiteSwitchReadiness } from '@/lib/operations/readiness'
import { importActorRegistryXml } from '@/lib/actor-registry/importActorRegistry'
import { readRegistryRouteSource, verifyElRegistryActor } from '@/lib/actor-registry/registryMarketSource'
import { getCompanyGridOwnerRouteReadiness } from '@/lib/ediel/companyRouteReadiness'
import { evaluateCustomerProcessRouteReadiness } from '@/lib/customer-operations/customerProcessRouteReadiness'
import { prepareAndQueueEdielZ03 } from '@/lib/ediel/flows/prodatSwitch'
import { ensureInitialSwitchEdielAutomation } from '@/lib/operations/edielAutomation'
import { evaluateSupplierSwitchSchedule } from '@/lib/operations/supplierSwitchScheduler'
import { sendEdielMessageViaSmtp } from '@/lib/ediel/transport'
import { assertEdielSmtpReadiness } from '@/lib/ediel/mailReadiness'
import { readAcceptedEdielTransportProjection } from '@/lib/ediel/transport/acceptedProjection'
import { getEdielMessageById, listEdielMessageEvents } from '@/lib/ediel/db'
import { archiveNetworkRegistrySource, readNetworkRegistrySourceArtifact, reviewNetworkRegistrySource } from '@/lib/ediel/production/networkRegistrySource'
import { readContractRequestedMethodSource } from '@/lib/ediel/production/contractRequestedMethodSource'
import type { SupplyObjectPartition } from '@/lib/ediel/flows/supplyMarketTransition'
import { observeOriginalNegativeSupply, assertOriginalNegativeSupplyCause } from './helpers/ediel-z03-native-supply-observation'
import { createInboundEdielMessage } from '@/lib/inbound-mail/inboundStatusUpdater'
import { processInboundEdielMessage } from '@/lib/ediel/flows/inboundProcessing'
import { processInboundAckMessage } from '@/lib/ediel/flows/inboundAckProcessing'
import { readCommittedInboundAck } from '@/lib/ediel/ack/committedInboundAck'
import { listBusinessAckMessagesForSource } from '@/lib/ediel/inbound/businessAckMessages'
import { recordReceivedSourceValidation } from '@/lib/ediel/core/receivedSourceValidationLedger'
import { buildContrlDraft, buildAperakDraft } from '@/lib/ediel/ack'
import { createCanonicalOutboundMessage } from '@/lib/ediel/core/kernel'
import { preflightEdielPayload } from '@/lib/ediel/core/messageBuilder/payloadPreflight'
import { resolveCanonicalRuntimeDecisionWithRegistry } from '@/lib/ediel/core/runtimeDecision'
import type { CanonicalDecisionState } from '@/lib/ediel/core/runtimeDecision'
import type { ReceivedSourceValidationReceipt } from '@/lib/ediel/core/receivedSourceValidationLedger'
import type { ProdatProcessingDisposition } from '@/lib/ediel/prodat/prodatFieldDiagnostic'
import { validateRulebookMessageWithRegistry } from '@/lib/ediel/rulebook/validator'
import { validateCanonicalPolicyFields } from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import { PRODAT_26A_FIELD_MATRIX } from '@/lib/ediel/prodat/prodat26AFieldMatrix'
import { prepareCustomerMasterdataSource, bindCustomerMasterdataValidationContext, loadCustomerMasterdataValidationContext } from '@/lib/ediel/production/customerMasterdataSource'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { tokenizeEdifact, segmentComposite } from '@/lib/ediel/core/edifactTokenizer'
import type { ProdatInvoiceeObject } from '@/lib/ediel/prodat/prodatInvoicee'
import type { CreateEdielMessageInput, EdielMessageRow, EdielMessageStatus, EdielMessageEventRow, EdielMessageEventType, EdielMessageEventStatus } from '@/lib/ediel/types'

type Variant = 'L' | 'LK'
type Fixture = NormalSwitchStageNativeFixture & { variant: Variant; original: EdielMessageRow; li: string }
const required = ['311','312','202','203','313','205','206','207','208','314','209','210','217','223','260','261','226','227','228','231','232','316','262'] as const
const conditional = ['229','233','234','250','251','252','253','317','318','INVOICEE_GROUP'] as const
const diagnosticMessageStatuses = ['draft','prepared','queued','dispatching','provider_accepted','sent','delivered','received','parsed','validated','acknowledged','failed','cancelled'] as const satisfies readonly EdielMessageStatus[]
const diagnosticEventTypes = ['created','prepared','queued','dispatching','provider_accepted','sent','delivered','received','parsed','validated','linked','contrl_sent','contrl_received','aperak_sent','aperak_received','utilts_err_sent','utilts_err_received','failed','cancelled','manual_note'] as const satisfies readonly EdielMessageEventType[]
const diagnosticEventStatuses = ['info','success','warning','error'] as const satisfies readonly EdielMessageEventStatus[]
const diagnosticDecisions = ['accepted','rejected','not_applicable','manual_review'] as const satisfies readonly CanonicalDecisionState[]
const diagnosticDispositions = ['continue','internal_review'] as const satisfies readonly ProdatProcessingDisposition['kind'][]
const diagnosticEvidenceStatuses = ['not_requested','unconfirmed','recorded'] as const satisfies readonly ReceivedSourceValidationReceipt['status'][]
// Exact identifiers from the current normal-switch owner and scoped supply
// adapter. Unknown untrusted text is hashed, never copied to assertion output.
const diagnosticHeldReasons = ['own_application_not_accepted','ambiguous_physical_supply_scope','own_supply_wire_or_legal_scope_unavailable','own_supply_business_unqualified','supply_original_cohort_changed',
  'normal_z04_source_required','normal_z04_execution_actor_required','normal_z04_frozen_legal_context_required','normal_z04_canonical_leaf_ambiguous','normal_z04_canonical_source_not_accepted',
  'normal_z04_whole_physical_scope_required','normal_z04_register_owner_scope_required','normal_z04_exact_sent_original_required','normal_z04_locked_original_scope_required',
  'normal_z04_owned_signed_contract_scope_required','normal_z04_conflicting_supply_period'] as const
const diagnosticRollbackReasons = ['supply_service_required','supply_partition_replay_conflict','supply_scoped_business_receipt_required','supply_scoped_canonical_assessment_changed',
  'supply_own_canonical_application_and_function_required','normal_z04_replay_conflict','ediel_inbound_legal_context_required','ediel_source_rule_pack_basis_required',
  'ediel_historical_identity_basis_unavailable','ediel_historical_rule_pack_basis_unavailable'] as const
function diagnosticRecord(value: unknown): Record<string,unknown> {
  return value && typeof value==='object' && !Array.isArray(value) ? value as Record<string,unknown> : {}
}
function diagnosticEnum<T extends string>(value:unknown, allowed:readonly T[]):T|'absent'|'unknown' {
  return value==null ? 'absent' : typeof value==='string' && allowed.includes(value as T) ? value as T : 'unknown'
}
function diagnosticHash(value:unknown):string {
  let text='unknown'
  try { text=value instanceof Error ? value.message : typeof value==='string' ? value : JSON.stringify(value)??'unknown' } catch { /* Never mask the business assertion. */ }
  return createHash('sha256').update(text,'utf8').digest('hex')
}
function diagnosticRollback(value:unknown) {
  if (typeof value!=='string') return {reason:'unknown',sqlstate:'unknown',reasonHash:diagnosticHash(value)}
  // formatErrorMessage appends code/details/hint after a middle-dot delimiter.
  // Only an exact leading owner identifier and a delimited SQLSTATE survive.
  const reason=value.split(' · ')[0],code=/ · kod: ([0-9A-Z]{5})(?: · |$)/.exec(value)?.[1]
  return {reason:diagnosticEnum(reason,diagnosticRollbackReasons),
    sqlstate:diagnosticEnum(code,['42501','P0001','23502','23503','23505','23514','22P02','40001','40P01','XX000'] as const),reasonHash:diagnosticHash(value)}
}
function diagnosticEvent(event:EdielMessageEventRow|undefined, f:Fixture, source:EdielMessageRow) {
  if (!event) return {read:'absent'}
  const scope={companyMatches:event.company_id===f.companyId,sourceMatches:event.ediel_message_id===source.id}
  if (!scope.companyMatches || !scope.sourceMatches) return {read:'scope_unqualified',scope}
  const p=diagnosticRecord(event.payload),partition=p.sourceObjectPartition
  const ackPrefix=typeof p.ackFamily==='string'&&['CONTRL','APERAK','UTILTS_ERR'].includes(p.ackFamily)?p.ackFamily+' skapades inte: ':null
  const warningReason=p.reason??(ackPrefix&&typeof event.message==='string'&&event.message.startsWith(ackPrefix)?event.message.slice(ackPrefix.length).split(' · ')[0]:undefined)
  return {read:'available',scope,eventType:diagnosticEnum(event.event_type,diagnosticEventTypes),eventStatus:diagnosticEnum(event.event_status,diagnosticEventStatuses),
    syntax:diagnosticEnum(p.syntaxDecision,diagnosticDecisions),application:diagnosticEnum(p.applicationDecision,diagnosticDecisions),functional:diagnosticEnum(p.functionalDecision,diagnosticDecisions),
    disposition:diagnosticEnum(diagnosticRecord(p.prodatProcessingDisposition).kind,diagnosticDispositions),
    blockedBy:diagnosticEnum(p.blockedBy,['canonical_inbound_ack_guard'] as const),
    ackFamily:diagnosticEnum(p.ackFamily,['CONTRL','APERAK','UTILTS_ERR'] as const),
    automationPipeline:diagnosticEnum(p.automationPipeline,['trace_failed_non_blocking'] as const),
    reason:diagnosticEnum(warningReason,[...diagnosticHeldReasons,...diagnosticRollbackReasons,...diagnosticApplicationReasons,
      'duplicate_same_outcome','conflicting_outcome','duplicate_same_family','prodat_application_original_owner_unavailable',
      'prodat_application_original_rule_witness_mismatch','prodat_structural_response_own_effect_unavailable'] as const),
    reasonHash:warningReason==null?'absent':diagnosticHash(warningReason),errorHash:p.error==null?'absent':diagnosticHash(p.error),
    messageHash:event.message==null?'absent':diagnosticHash(event.message),
    tenantResolutionStatus:diagnosticEnum(p.tenantResolutionStatus,['tenant_resolved','tenant_not_found','tenant_ambiguous'] as const),
    supplySourceApply:diagnosticEnum(p.supplySourceApply,['rolled_back'] as const),
    ...(p.supplySourceApply==='rolled_back'?{rollback:diagnosticRollback(p.reason)}:{}),
    actorTestingGlobalHook:typeof p.actorTestingGlobalHook==='boolean'?p.actorTestingGlobalHook:'absent',
    phase:diagnosticEnum(p.phase,['pre_business_processing','post_ack_processing','post_generic_processing'] as const),
    ...Object.fromEntries(['applied','fullyApplied','reviewRequired','idempotent'].map(key=>[key,typeof p[key]==='boolean'?p[key]:'absent'])),
    partition:Array.isArray(partition)?partition.slice(0,8192).map(value=>{
      const entry=diagnosticRecord(value),disposition=diagnosticEnum(entry.disposition,['applied','held'] as const satisfies readonly SupplyObjectPartition['disposition'][])
      return {disposition,...(disposition==='held'?{reason:diagnosticEnum(entry.reason,diagnosticHeldReasons),reasonHash:diagnosticHash(entry.reason)}:{})}
    }):partition==null?'absent':'unknown',
    committedEffectReceiptCount:Array.isArray(p.committedEffectReceiptIds)?p.committedEffectReceiptIds.length:'absent'}
}
function diagnosticSql(input:string):unknown {
  if(process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:54321')throw Error('owned_local_only')
  const output=execFileSync('psql',['postgresql://postgres:postgres@127.0.0.1:54322/postgres','-XAtq','-v','ON_ERROR_STOP=1'],
    {input,encoding:'utf8',timeout:10000,maxBuffer:2_000_000,stdio:'pipe'}).trim()
  return output?JSON.parse(output):undefined
}
const diagnosticApplicationReasons = ['PRODAT_APPLICATION_INVOCATION_INCOMPLETE','REGISTER_MESSAGE_NOT_VALIDATED','REGISTER_SCOPE_UNAVAILABLE'] as const
function diagnosticCount(value:unknown) { return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=2_097_152?value:'unknown' }
function projectDiagnosticApplication(value:unknown) {
  const p=diagnosticRecord(value)
  return {read:'available',assessmentCount:diagnosticCount(p.assessmentCount),facetCount:diagnosticCount(p.facetCount),
    headerDecision:diagnosticEnum(p.headerDecision,['accepted','rejected','held'] as const),
    ...Object.fromEntries(['objectCount','accepted','held','rejected','registerObjectCount','registerAccepted','registerUnavailable','registerRejected',
      'incompleteInvocationReasons','registerMessageNotValidatedReasons','registerScopeUnavailableReasons','unknownReasonCount'].map(key=>[key,diagnosticCount(p[key])])),
    unknownReasonHashes:Array.isArray(p.unknownReasonHashes)?p.unknownReasonHashes.slice(0,16).map(hash=>typeof hash==='string'&&/^[a-f0-9]{64}$/.test(hash)?hash:diagnosticHash(hash)):[]}
}
/** Read the exact persisted invocation, never revalidate or select a newer
 * assessment. Facet absence is diagnostic only; it proves no opaque result. */
function readDiagnosticApplication(f:Fixture,source:EdielMessageRow,message:EdielMessageRow|null) {
  if(!message||message.id!==source.id||message.company_id!==f.companyId||message.environment!=='test'
    ||message.direction!=='inbound'||message.message_standard!=='edifact'||message.message_family!=='PRODAT'||message.message_code!=='Z04')return {read:'scope_unqualified'}
  const evidence=diagnosticRecord(message.validation_report?.receivedSourceValidationEvidence)
  if(evidence.status!=='recorded'||typeof evidence.assessmentId!=='string'||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(evidence.assessmentId)
    ||typeof evidence.factsHash!=='string'||!/^[a-f0-9]{64}$/.test(evidence.factsHash))return {read:'assessment_unqualified'}
  try {
    return projectDiagnosticApplication(diagnosticSql(`WITH canonical AS (
      SELECT a.id,a.company_id,a.environment,a.source_message_id,a.source_payload_hash,a.facts_text::jsonb AS facts
      FROM public.ediel_messages m
      JOIN gridex_received_sources.sources s ON s.source_message_id=m.id AND s.company_id=m.company_id AND s.environment=m.environment
        AND s.origin='database_insert' AND s.payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')
        AND s.payload_hash=encode(sha256(convert_to(s.raw_payload,'UTF8')),'hex')
      JOIN gridex_received_sources.validation_assessments a ON a.source_message_id=s.source_message_id AND a.company_id=s.company_id
        AND a.environment=s.environment AND a.source_payload_hash=s.payload_hash
      WHERE m.id=${literal(source.id)}::uuid AND m.company_id=${literal(f.companyId)}::uuid
        AND m.environment='test' AND m.direction='inbound' AND m.message_standard='edifact' AND m.message_family='PRODAT' AND m.message_code='Z04'
        AND m.validation_report#>>'{receivedSourceValidationEvidence,status}'='recorded'
        AND m.validation_report#>>'{receivedSourceValidationEvidence,assessmentId}'=${literal(evidence.assessmentId)}
        AND m.validation_report#>>'{receivedSourceValidationEvidence,factsHash}'=${literal(evidence.factsHash)}
        AND a.id=${literal(evidence.assessmentId)}::uuid AND a.owner='canonical-runtime-with-registry-v1'
        AND a.facts_hash=${literal(evidence.factsHash)} AND a.facts_hash=encode(sha256(convert_to(a.facts_text,'UTF8')),'hex')
    ), facet AS (
      SELECT f.application_facts_text::jsonb AS app FROM canonical a
      JOIN gridex_received_sources.prodat_application_facets f ON f.assessment_id=a.id AND f.company_id=a.company_id
        AND f.environment=a.environment AND f.source_message_id=a.source_message_id AND f.source_payload_hash=a.source_payload_hash
      WHERE f.application_facts_hash=encode(sha256(convert_to(f.application_facts_text,'UTF8')),'hex')
    ), objects AS (
      SELECT o FROM facet f CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(f.app->'objects')='array' THEN f.app->'objects' ELSE '[]'::jsonb END)o
    ), registers AS (
      SELECT o FROM canonical a CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(a.facts#>'{registerValidation,objects}')='array' THEN a.facts#>'{registerValidation,objects}' ELSE '[]'::jsonb END)o
    ), reasons AS (
      SELECT r#>>'{}' AS reason FROM objects CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(o->'reasonCodes')='array' THEN o->'reasonCodes' ELSE '[]'::jsonb END)r
      UNION ALL SELECT r#>>'{}' FROM registers CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(o->'reasons')='array' THEN o->'reasons' ELSE '[]'::jsonb END)r
    ), unknown_reasons AS (
      SELECT DISTINCT encode(sha256(convert_to(reason,'UTF8')),'hex') AS hash FROM reasons
      WHERE reason IS NOT NULL AND reason NOT IN(${diagnosticApplicationReasons.map(literal).join(',')})
    ) SELECT jsonb_build_object(
      'assessmentCount',(SELECT count(*) FROM canonical),'facetCount',(SELECT count(*) FROM facet),
      'headerDecision',(SELECT CASE WHEN app->>'headerDecision' IN('accepted','rejected','held') THEN app->>'headerDecision' ELSE 'unknown' END FROM facet),
      'objectCount',(SELECT count(*) FROM objects),'accepted',(SELECT count(*) FROM objects WHERE o->>'applicationDecision'='accepted'),
      'held',(SELECT count(*) FROM objects WHERE o->>'applicationDecision'='held'),'rejected',(SELECT count(*) FROM objects WHERE o->>'applicationDecision'='rejected'),
      'registerObjectCount',(SELECT count(*) FROM registers),'registerAccepted',(SELECT count(*) FROM registers WHERE o->>'disposition'='accepted'),
      'registerUnavailable',(SELECT count(*) FROM registers WHERE o->>'disposition'='unavailable'),'registerRejected',(SELECT count(*) FROM registers WHERE o->>'disposition'='rejected'),
      'incompleteInvocationReasons',(SELECT count(*) FROM reasons WHERE reason='PRODAT_APPLICATION_INVOCATION_INCOMPLETE'),
      'registerMessageNotValidatedReasons',(SELECT count(*) FROM reasons WHERE reason='REGISTER_MESSAGE_NOT_VALIDATED'),
      'registerScopeUnavailableReasons',(SELECT count(*) FROM reasons WHERE reason='REGISTER_SCOPE_UNAVAILABLE'),
      'unknownReasonCount',(SELECT count(*) FROM unknown_reasons),
      'unknownReasonHashes',(SELECT coalesce(jsonb_agg(hash ORDER BY hash),'[]'::jsonb) FROM (SELECT hash FROM unknown_reasons ORDER BY hash LIMIT 16)h));`))
  } catch(error) { return {read:'read_unavailable',reasonHash:diagnosticHash(error)} }
}
function projectZ04Diagnostic(f:Fixture,source:EdielMessageRow,reads:readonly [PromiseSettledResult<EdielMessageRow|null>,PromiseSettledResult<EdielMessageEventRow[]>]) {
  try {
    const [messageRead,eventRead]=reads
    const message=messageRead.status==='fulfilled'?messageRead.value:null
    const scope=message?{companyMatches:message.company_id===f.companyId,sourceMatches:message.id===source.id,environmentMatches:message.environment==='test'}:null
    const report=scope?.companyMatches&&scope.sourceMatches&&scope.environmentMatches?diagnosticRecord(message?.validation_report):{}
    const evidence=diagnosticRecord(report.receivedSourceValidationEvidence)
    const ownEvents=eventRead.status==='fulfilled'?eventRead.value.filter(event=>event.company_id===f.companyId&&event.ediel_message_id===source.id):[]
    return {cause:'UNKNOWN',application:readDiagnosticApplication(f,source,message),message:messageRead.status==='rejected'?{read:'read_unavailable',reasonHash:diagnosticHash(messageRead.reason)}:
      !message?{read:'not_found'}:{read:scope?.companyMatches&&scope.sourceMatches&&scope.environmentMatches?'available':'scope_unqualified',scope,
        status:scope?.companyMatches&&scope.sourceMatches&&scope.environmentMatches?diagnosticEnum(message.status,diagnosticMessageStatuses):'unknown',
        syntax:diagnosticEnum(report.syntaxDecision,diagnosticDecisions),application:diagnosticEnum(report.applicationDecision,diagnosticDecisions),functional:diagnosticEnum(report.functionalDecision,diagnosticDecisions),
        disposition:diagnosticEnum(diagnosticRecord(report.prodatProcessingDisposition).kind,diagnosticDispositions),sourceValidation:diagnosticEnum(evidence.status,diagnosticEvidenceStatuses),
        recordedAssessmentReferencePresent:evidence.status==='recorded'&&typeof evidence.assessmentId==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(evidence.assessmentId)},
      events:eventRead.status==='rejected'?{read:'read_unavailable',reasonHash:diagnosticHash(eventRead.reason)}:{read:'available',
        allCompanyMatches:eventRead.value.every(event=>event.company_id===f.companyId),allSourceMatches:eventRead.value.every(event=>event.ediel_message_id===source.id),
        latest:diagnosticEvent(eventRead.value[0],f,source),
        ackGuard:diagnosticEvent(ownEvents.find(event=>event.event_type==='manual_note'&&diagnosticRecord(event.payload).blockedBy==='canonical_inbound_ack_guard'),f,source),
        automationPipeline:diagnosticEvent(ownEvents.find(event=>event.event_type==='manual_note'&&diagnosticRecord(event.payload).automationPipeline==='trace_failed_non_blocking'),f,source),
        runtime:diagnosticEvent(ownEvents.find(event=>event.event_type==='validated'&&'syntaxDecision' in diagnosticRecord(event.payload)),f,source),
        domain:diagnosticEvent(ownEvents.find(event=>event.event_type==='validated'&&'sourceObjectPartition' in diagnosticRecord(event.payload)),f,source),
        rollback:diagnosticEvent(ownEvents.find(event=>event.event_type==='manual_note'&&diagnosticRecord(event.payload).supplySourceApply==='rolled_back'),f,source),
        tenant:diagnosticEvent(ownEvents.find(event=>'tenantResolutionStatus' in diagnosticRecord(event.payload)),f,source),
        actorTesting:diagnosticEvent(ownEvents.find(event=>diagnosticRecord(event.payload).actorTestingGlobalHook===true),f,source)}}
  } catch (error) { return {cause:'UNKNOWN',read:'read_unavailable',reasonHash:diagnosticHash(error)} }
}
// Inherited optional JSON.stringify(decision.issues) assertion messages remain
// unchanged: an old privacy limit, not a whole-artifact finite-output guarantee.
// Physical reading fixtures serve positive cases, omission contrasts and
// correlation-negative cases. Field259 declares future UTILTS TRUE only;
// absence remains UNKNOWN. No metadata/inventory/APP authority.
const ownReadingCodes = ['PRODAT_DEPENDENT_CONDITION_UNDETERMINED','PRODAT_REGISTER_READING_INVALID',
  'PRODAT_REGISTER_READING_SCOPE_INVALID','PRODAT_DEPENDENT_FIELD_MISSING','FIELD_MATRIX_REQUIRED_FIELD_MISSING',
  'FIELD_MATRIX_FIELD_FORMAT_INVALID','FIELD_MATRIX_FIELD_LENGTH_INVALID','FIELD_MATRIX_CODE_LIST_INVALID',
  'FIELD_MATRIX_FORBIDDEN_FIELD_PRESENT'] as const
const ownReadingFields = ['214','218','259'] as const
function withOwnReadings(body:string[], declaredTrue:boolean):string[] {
  const lines=body.map((value,index)=>value.startsWith('LIN+')?index:-1).filter(index=>index>=0)
  if(lines.length!==1 || body.some(value=>/^CCI\+\+Z(?:02|05|16)(?:[+:]|$)/.test(value)))throw Error('native_own_reading_insertion_scope_required')
  const line=lines[0],boundary=body.findIndex((value,index)=>index>line&&/^(?:RFF|NAD)\+/.test(value))
  if(boundary<0)throw Error('native_own_reading_reference_boundary_required')
  const readings=['CCI++Z02','CAV+:::1','CCI++Z05','CAV+:::6',...(declaredTrue?['CCI++Z16','CAV+:::111']:[])]
  return [...body.slice(0,boundary),...readings,...body.slice(boundary)]
}
function assertOwnReadingWire(f:Fixture,raw:string,declaredTrue:boolean) {
  const envelope=EdifactEnvelopeCodec.decode(raw),wire=tokenizeEdifact(raw),segments=wire.segments
  const originalEnvelope=EdifactEnvelopeCodec.decode(f.original.raw_payload!)
  const unh=segments.findIndex(value=>value.tag==='UNH'),unt=segments.findIndex(value=>value.tag==='UNT')
  const lines=segments.map((value,index)=>value.tag==='LIN'?index:-1).filter(index=>index>=0),line=lines[0]
  const boundary=segments.findIndex((value,index)=>index>line&&['RFF','NAD'].includes(value.tag))
  const readingPositions=['Z02','Z05','Z16'].map(qualifier=>segments.map((value,index)=>value.tag==='CCI'&&segmentComposite(value,2,wire.una)[0]===qualifier?index:-1).filter(index=>index>=0))
  const values=['1','6','111']
  const readingShape=readingPositions.every((positions,index)=>index===2&&!declaredTrue?positions.length===0:
    positions.length===1&&positions[0]>line&&positions[0]+1<boundary&&segments[positions[0]].elements.slice(1).join('+')===`+${['Z02','Z05','Z16'][index]}`
      &&segments[positions[0]+1].tag==='CAV'&&segments[positions[0]+1].elements.slice(1).join('+')===`:::${values[index]}`
      &&segments[positions[0]+2]?.tag!=='CAV')
  expect({una:raw.startsWith('UNA'),singleEnvelope:['UNB','UNH','BGM','UNT','UNZ'].every(tag=>segments.filter(value=>value.tag===tag).length===1),
    counted:segmentComposite(segments[unt],1,wire.una)[0]===String(unt-unh+1),
    messageReference:segmentComposite(segments[unh],1,wire.una)[0]===segmentComposite(segments[unt],2,wire.una)[0],
    interchangeCount:segmentComposite(segments.find(value=>value.tag==='UNZ'),1,wire.una)[0]==='1',
    interchangeReference:segmentComposite(segments.find(value=>value.tag==='UNZ'),2,wire.una)[0]===envelope.interchangeReference,
    currentAssociation:segmentComposite(segments[unh],2,wire.una).join(':')==='PRODAT:D:97A:UN:E2SE6A',
    businessHeader:segments.find(value=>value.tag==='BGM')?.elements[1]==='Z04'&&segments.find(value=>value.tag==='BGM')?.elements.slice(3,5).join(':')==='9:AB',
    reverseParties:envelope.sender===originalEnvelope.receiver&&envelope.receiver===originalEnvelope.sender,
    reverseQualifiers:envelope.senderQualifier===originalEnvelope.receiverQualifier&&envelope.receiverQualifier===originalEnvelope.senderQualifier,
    reverseSubaddresses:envelope.senderSubAddress===originalEnvelope.receiverSubAddress&&envelope.receiverSubAddress===originalEnvelope.senderSubAddress,
    testApplication:envelope.environment==='test'&&envelope.applicationReference==='23-DDQ-PRODAT',
    ownObject:lines.length===1&&segmentComposite(segments[line],3,wire.una)[0]===f.external&&segmentComposite(segments[line],3,wire.una)[3]==='9',
    ownReason:segments.filter(value=>value.tag==='CCI'&&segmentComposite(value,2,wire.una)[0]==='Z13').length===1
      &&segments.some((value,index)=>value.tag==='CCI'&&segmentComposite(value,2,wire.una)[0]==='Z13'&&segmentComposite(segments[index+1],1,wire.una)[0]===(f.variant==='L'?'Z22':'Z23')),
    readingShape}).toEqual({una:true,singleEnvelope:true,counted:true,messageReference:true,interchangeCount:true,interchangeReference:true,
      currentAssociation:true,businessHeader:true,reverseParties:true,reverseQualifiers:true,reverseSubaddresses:true,testApplication:true,ownObject:true,ownReason:true,readingShape:true})
}
// All untrusted descriptions are parsed privately. The return contains only
// fixed enums/booleans/bounded counts; never descriptions, values, IDs or hashes.
function projectOwnReadingIssues(value:unknown) {
  const counts=ownReadingCodes.map(code=>({code,fields:ownReadingFields.map(field=>({field,count:0}))}))
  const result={read:Array.isArray(value)?'available' as const:'issues_unavailable' as const,
    conclusive:false,issueTotal:0,inspected:0,overLimit:0,unknownCode:0,unrecognizedField:0,malformedRow:0,counts}
  if(!Array.isArray(value))return result
  result.issueTotal=Math.min(value.length,2_097_152)
  result.overLimit=value.length>2048?1:0
  for(const raw of value.slice(0,2048)) {
    result.inspected++
    if(!raw||typeof raw!=='object'||Array.isArray(raw)){result.malformedRow++;continue}
    const row=raw as Record<string,unknown>
    if(typeof row.code!=='string'){result.malformedRow++;continue}
    const code=ownReadingCodes.find(candidate=>candidate===row.code)
    if(!code){result.unknownCode++;continue}
    if(row.source!=='validateCanonicalPolicyFields'||row.layer!=='application'){result.malformedRow++;continue}
    const diagnostic=diagnosticRecord(row.prodatDiagnostic)
    let field:typeof ownReadingFields[number]|undefined
    if(code==='PRODAT_DEPENDENT_CONDITION_UNDETERMINED') {
      const description=row.description
      if(diagnostic.kind!=='local_unknown'||diagnostic.sourceRule!=='PRODAT26A:register-readings'
        ||typeof description!=='string'||description.length>4096||/[\u0000-\u001f\u007f]/.test(description)) {result.malformedRow++;continue}
      const match=/^LIN 1, fält (214|218|259): /.exec(description)
      field=ownReadingFields.find(candidate=>candidate===match?.[1])
    } else {
      field=ownReadingFields.find(candidate=>candidate===diagnostic.fieldNumber)
    }
    if(!field){result.unrecognizedField++;continue}
    counts.find(row=>row.code===code)!.fields.find(row=>row.field===field)!.count++
  }
  result.conclusive=result.overLimit===0&&result.unknownCode===0&&result.unrecognizedField===0&&result.malformedRow===0
  return result
}
function finiteOwnApplication(value:unknown) {
  const p=diagnosticRecord(value)
  return {read:diagnosticEnum(p.read,['available','scope_unqualified','assessment_unqualified','read_unavailable'] as const),
    assessmentCount:diagnosticCount(p.assessmentCount),facetCount:diagnosticCount(p.facetCount),
    headerDecision:diagnosticEnum(p.headerDecision,['accepted','rejected','held'] as const),
    objectCount:diagnosticCount(p.objectCount),accepted:diagnosticCount(p.accepted),held:diagnosticCount(p.held),rejected:diagnosticCount(p.rejected),
    registerObjectCount:diagnosticCount(p.registerObjectCount),registerAccepted:diagnosticCount(p.registerAccepted),
    registerUnavailable:diagnosticCount(p.registerUnavailable),registerRejected:diagnosticCount(p.registerRejected),unknownReasonCount:diagnosticCount(p.unknownReasonCount)}
}
async function assertOwnFieldReception(f:Fixture,source:EdielMessageRow) {
  const mailId=source.inbound_email_message_id
  expect(typeof mailId==='string'&&/^[0-9a-f-]{36}$/i.test(mailId)).toBe(true)
  if(!mailId)throw Error('native_own_field_mail_source_required')
  const reception=await readInboundReceptionRequest({companyId:f.companyId,messageId:source.id,inboundEmailMessageId:mailId,actorUserId:f.actorUserId})
  expect(reception!==null).toBe(true)
  if(!reception)throw Error('native_own_field_first_reception_required')
  const [mailRead,parseRead]=await Promise.all([
    supabaseService.from('inbound_email_messages').select('id,company_id,environment,received_at,raw_edifact_payload').eq('id',mailId).eq('company_id',f.companyId).maybeSingle(),
    supabaseService.from('inbound_ediel_parse_results').select('id,company_id,inbound_email_message_id,raw_payload,parse_status').eq('id',reception.parseResultId).eq('company_id',f.companyId).maybeSingle(),
  ])
  const received=parseSourceReceiptInstant(reception.receivedAt)
  const hash=createHash('sha256').update(source.raw_payload!,'utf8').digest('hex')
  // Reading the saved receipt replays the observation; its first-reception classification stays immutable.
  expect({first:reception.classification==='first_reception'&&reception.status==='observed',readReplay:reception.isReplay===true,
    exactSource:reception.companyId===f.companyId&&reception.sourceMessageId===source.id&&reception.inboundEmailMessageId===mailId,
    exactHash:reception.canonicalPayloadHash===hash&&reception.receivedPayloadHash===hash,
    noAuthority:reception.businessEffectAuthorized===false&&reception.responseRequestId===null&&reception.reason===null,
    mail:!mailRead.error&&mailRead.data?.id===mailId&&mailRead.data.company_id===f.companyId&&mailRead.data.environment==='test'&&mailRead.data.raw_edifact_payload===source.raw_payload,
    parse:!parseRead.error&&parseRead.data?.id===reception.parseResultId&&parseRead.data.company_id===f.companyId&&parseRead.data.inbound_email_message_id===mailId&&parseRead.data.raw_payload===source.raw_payload&&parseRead.data.parse_status==='parsed',
    clock:received!==null&&received===parseSourceReceiptInstant(mailRead.data?.received_at)&&received===parseSourceReceiptInstant(source.message_received_at)})
    .toEqual({first:true,readReplay:true,exactSource:true,exactHash:true,noAuthority:true,mail:true,parse:true,clock:true})
}
function projectOwnReadingObservation(f:Pick<Fixture,'companyId'|'variant'>,source:EdielMessageRow,messageRead:PromiseSettledResult<EdielMessageRow|null>,immutableHash:unknown,applicationValue:unknown,arm:'declared_true'|'omitted_unknown') {
  const message=messageRead.status==='fulfilled'?messageRead.value:null
  const sourceScope=source.company_id===f.companyId&&source.environment==='test'&&source.direction==='inbound'
    &&source.message_standard==='edifact'&&source.message_family==='PRODAT'&&source.message_code==='Z04'
  const scopeMatches=sourceScope&&!!message&&message.id===source.id&&message.company_id===f.companyId&&message.environment==='test'
    &&message.direction==='inbound'&&message.message_standard==='edifact'&&message.message_family==='PRODAT'&&message.message_code==='Z04'
  const hashMatches=scopeMatches&&typeof source.raw_payload==='string'&&source.raw_payload.length>0&&message?.raw_payload===source.raw_payload
    &&immutableHash===createHash('sha256').update(source.raw_payload,'utf8').digest('hex')
  const report=scopeMatches&&hashMatches?diagnosticRecord(message?.validation_report):{}
  const evidence=diagnosticRecord(report.receivedSourceValidationEvidence)
  const application=finiteOwnApplication(applicationValue)
  const assessmentMatches=scopeMatches&&hashMatches&&evidence.status==='recorded'
    &&typeof evidence.assessmentId==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(evidence.assessmentId)
    &&typeof evidence.factsHash==='string'&&/^[a-f0-9]{64}$/.test(evidence.factsHash)
    &&application.read==='available'&&application.assessmentCount===1&&application.facetCount===1
  const fields=projectOwnReadingIssues(assessmentMatches?diagnosticRecord(report.canonicalRuntime).issues:undefined)
  return {case:arm,variant:f.variant,read:messageRead.status==='rejected'?'read_unavailable':!message?'not_found':!scopeMatches?'scope_unqualified':!hashMatches?'hash_unqualified':!assessmentMatches?'assessment_unqualified':'available',
    scopeMatches,hashMatches,assessmentMatches,application,fields}
}
async function readStoredOwnReadingFields(f:Fixture,source:EdielMessageRow,messageRead:PromiseSettledResult<EdielMessageRow|null>,arm:'declared_true'|'omitted_unknown') {
  const message=messageRead.status==='fulfilled'?messageRead.value:null
  const immutableHash=message?sql<string>(`SELECT to_jsonb(immutable_payload_hash) FROM public.ediel_messages WHERE id=${literal(source.id)} AND company_id=${literal(f.companyId)} AND environment='test';`):null
  const observation=projectOwnReadingObservation(f,source,messageRead,immutableHash,readDiagnosticApplication(f,source,message),arm)
  const {scopeMatches,hashMatches,assessmentMatches,application,fields}=observation
  console.info('native_own_reading_fields',JSON.stringify(observation))
  expect({read:observation.read,scopeMatches,hashMatches,assessmentMatches,fieldRead:fields.read,conclusive:fields.conclusive})
    .toEqual({read:'available',scopeMatches:true,hashMatches:true,assessmentMatches:true,fieldRead:'available',conclusive:true})
  if(!message)throw Error('native_own_field_stored_source_required')
  const [legal,rulePack]=await Promise.all([requireEdielInboundLegalContext(f.companyId,source.id),requireEdielSourceRulePackEvidence(f.companyId,source.id)])
  const report=diagnosticRecord(message.validation_report)
  const runtime=diagnosticRecord(report.canonicalRuntime),policy=diagnosticRecord(runtime.canonicalPolicy),guide=diagnosticRecord(policy.guide)
  const current=diagnosticRecord(runtime.rulePackEvidence),sourceSnapshot=diagnosticRecord(source.rule_pack_snapshot)
  const sourceReceived=parseSourceReceiptInstant(source.message_received_at)
  expect({legal:legal.companyId===f.companyId&&legal.environment==='test'&&legal.direction==='inbound'&&legal.actorRole==='electricity_supplier'
      &&legal.legalEdielId===f.sender&&legal.transportEdielId===f.sender&&legal.applicationReference==='23-DDQ-PRODAT'
      &&sourceReceived!==null&&parseSourceReceiptInstant(legal.sourceReceivedAt)===sourceReceived,
    sourceGuide:rulePack.rulePackId===source.canonical_rule_pack_id&&rulePack.messageProfileId===source.rule_profile_version_id
      &&rulePack.profileKey===source.rule_profile_key&&rulePack.version===source.rule_profile_version&&rulePack.sourceHash===source.rule_pack_checksum
      &&sourceSnapshot.profileKey===rulePack.profileKey&&sourceSnapshot.profileVersionId===rulePack.messageProfileId
      &&sourceSnapshot.version===rulePack.version&&sourceSnapshot.checksum===rulePack.sourceHash,
    currentGuide:current.rulePackId===rulePack.rulePackId&&current.messageProfileId===rulePack.messageProfileId&&current.sourceHash===rulePack.sourceHash
      &&policy.code==='Z04'&&policy.subtype===(f.variant==='L'?'L':'LK')&&guide.guideRevision==='26-A'&&guide.associationAssignedCode==='E2SE6A',
    actor:sql<boolean>(`SELECT to_jsonb(EXISTS(SELECT FROM public.user_profiles u JOIN public.company_memberships c ON c.user_id=u.id
      WHERE u.id=${literal(f.actorUserId)} AND u.user_status='active' AND c.company_id=${literal(f.companyId)} AND c.status='active' AND c.is_active AND c.accepted_at IS NOT NULL)
      AND public.gridex_actor_has_company_permission(${literal(f.actorUserId)}::uuid,${literal(f.companyId)}::uuid,'metering.write'));`)===true})
    .toEqual({legal:true,sourceGuide:true,currentGuide:true,actor:true})
  return observation
}
function assertOwnReadingOracle(observation:Awaited<ReturnType<typeof readStoredOwnReadingFields>>) {
  const {case:arm,fields,application}=observation
  const unknownCounts=fields.counts.find(row=>row.code==='PRODAT_DEPENDENT_CONDITION_UNDETERMINED')!.fields
  expect(unknownCounts).toEqual(ownReadingFields.map(field=>({field,count:arm==='declared_true'?0:1})))
  expect(fields.counts.filter(row=>row.code!=='PRODAT_DEPENDENT_CONDITION_UNDETERMINED').every(row=>row.fields.every(field=>field.count===0))).toBe(true)
  expect(application).toMatchObject({read:'available',assessmentCount:1,facetCount:1,headerDecision:arm==='declared_true'?'accepted':'held',
    objectCount:1,accepted:arm==='declared_true'?1:0,held:arm==='declared_true'?0:1,rejected:0,registerObjectCount:1,
    registerAccepted:arm==='declared_true'?1:0,registerUnavailable:arm==='declared_true'?0:1,registerRejected:0})
}

function configureOwnContrlReturn(f:Fixture) {
  // Four dedicated sources only: configure a distinct prospective technical return
  // route from the actual immutable Z03 UNB before public inbound reception.
  // This configured-universe read does not prove source/mailbox/actor custody.
  const originalEnvelope=EdifactEnvelopeCodec.decode(f.original.raw_payload!)
  expect(sql(`SELECT to_jsonb(immutable_payload_hash) FROM public.ediel_messages
    WHERE id=${literal(f.original.id)} AND company_id=${literal(f.companyId)} AND environment='test';`))
    .toBe(createHash('sha256').update(f.original.raw_payload!,'utf8').digest('hex'))
  const incomingUNB={sender:[originalEnvelope.receiver,originalEnvelope.receiverQualifier??'',originalEnvelope.receiverSubAddress??''],
    receiver:[originalEnvelope.sender,originalEnvelope.senderQualifier??'',originalEnvelope.senderSubAddress??''],
    applicationReference:originalEnvelope.applicationReference}
  const {from,host,port}=assertEdielSmtpReadiness()
  const targetEmail=sql<string>(`SELECT to_jsonb(target_email) FROM public.communication_routes
    WHERE id=${literal(f.routeId)} AND company_id=${literal(f.companyId)} AND grid_owner_id=${literal(f.gridId)};`)
  expect(typeof targetEmail==='string'&&/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(targetEmail)).toBe(true)
  const contrlRouteId=randomUUID(),contrlProfileId=randomUUID()
  sql(`INSERT INTO public.communication_routes(id,company_id,route_name,route_scope,grid_owner_id,environment_type,is_active,target_email)
    VALUES(${literal(contrlRouteId)},${literal(f.companyId)},'Synthetic own CONTRL return route','ediel_ack',${literal(f.gridId)},'bilateral_test',true,${literal(targetEmail)});
    INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,payload_format,
      is_enabled,is_active,message_family,business_code,sender_ediel_id,receiver_ediel_id,sender_subaddress,sender_sub_address,
      receiver_subaddress,receiver_sub_address,application_reference,mailbox,smtp_host,smtp_port,transport_profile_id)
    VALUES(${literal(contrlProfileId)},${literal(f.companyId)},${literal(contrlRouteId)},'Synthetic own CONTRL return profile','test','edifact','edifact',
      true,true,'CONTRL',NULL,${literal(originalEnvelope.sender)},${literal(originalEnvelope.receiver)},
      ${literal(originalEnvelope.senderSubAddress)},${literal(originalEnvelope.senderSubAddress)},
      ${literal(originalEnvelope.receiverSubAddress)},${literal(originalEnvelope.receiverSubAddress)},
      ${literal(originalEnvelope.applicationReference)},${literal(from)},${literal(host)},${literal(port)},NULL);`)
  // Complete configured predicate from 20260930215206, retained by the
  // 20261005130401 custody extension. Count ALL matches, then bind both IDs.
  const configuredContrl=sql<{count:number;routeIds:string[];profileIds:string[]}>(`WITH basis AS(
    SELECT ${literal(f.companyId)}::uuid AS c,'test'::text AS env,'CONTRL'::text AS reply_family,
      ${literal(incomingUNB)}::jsonb AS u,${literal(from)}::text AS current_smtp_from,
      ${literal(host)}::text AS current_smtp_host,${literal(port)}::integer AS current_smtp_port)
    SELECT jsonb_build_object('count',count(*),'routeIds',coalesce(jsonb_agg(r.id),'[]'::jsonb),
      'profileIds',coalesce(jsonb_agg(p.id),'[]'::jsonb))
    FROM public.communication_routes r CROSS JOIN basis JOIN public.ediel_route_profiles p ON p.communication_route_id=r.id AND p.company_id=r.company_id
    LEFT JOIN public.ediel_transport_profiles tp ON tp.id=p.transport_profile_id AND tp.company_id=c AND tp.environment=env
 WHERE r.company_id=c AND r.is_active AND r.route_scope='ediel_ack'
AND ((env='production' AND r.environment_type::text='production') OR(env='test' AND r.environment_type::text IN('tgt_test','agt_test','bilateral_test')))
AND p.environment=env AND p.is_enabled AND p.is_active AND p.message_standard='edifact' AND p.payload_format='edifact'
AND (p.message_family IS NULL OR p.message_family=reply_family) AND (p.business_code IS NULL OR p.business_code=reply_family)
AND p.sender_ediel_id=u#>>'{receiver,0}' AND p.receiver_ediel_id=u#>>'{sender,0}'
AND coalesce(p.sender_subaddress,p.sender_sub_address,'')=coalesce(u#>>'{receiver,2}','')
AND coalesce(p.receiver_subaddress,p.receiver_sub_address,'')=coalesce(u#>>'{sender,2}','')
AND (p.sender_subaddress IS NULL OR p.sender_sub_address IS NULL OR p.sender_subaddress=p.sender_sub_address)
AND (p.receiver_subaddress IS NULL OR p.receiver_sub_address IS NULL OR p.receiver_subaddress=p.receiver_sub_address)
AND p.application_reference IS NOT DISTINCT FROM u->>'applicationReference' AND p.mailbox=current_smtp_from
AND r.target_email~'^[^[:space:]@<>]+@[^[:space:]@<>]+\\.[^[:space:]@<>]+$'
AND ((p.transport_profile_id IS NULL AND p.smtp_host=current_smtp_host AND p.smtp_port=current_smtp_port)
  OR(tp.id IS NOT NULL AND tp.is_active AND tp.transport_channel='smtp' AND tp.direction IN('outbound','both') AND tp.sender_email=current_smtp_from AND tp.host=current_smtp_host AND tp.port=current_smtp_port
    AND(p.smtp_host IS NULL OR p.smtp_host=current_smtp_host) AND(p.smtp_port IS NULL OR p.smtp_port=current_smtp_port)));`)
  expect(configuredContrl.count).toBe(1)
  expect(configuredContrl.routeIds).toEqual([contrlRouteId])
  expect(configuredContrl.profileIds).toEqual([contrlProfileId])
  return {originalEnvelope,contrlRouteId,contrlProfileId}
}

async function assertOwnTechnicalContrl(f:Fixture,source:EdielMessageRow,configuration:ReturnType<typeof configureOwnContrlReturn>) {
  const {originalEnvelope,contrlRouteId,contrlProfileId}=configuration
  // Construction is independent of APP acceptance and provider delivery.
  // Observe only the ordinary processor's own returned technical original.
  const technicalReplies=replies(f,source.id).filter(message=>message.message_family==='CONTRL')
  expect(technicalReplies.length).toBe(1)
  const technicalReply=(await getEdielMessageById(technicalReplies[0].id,{companyId:f.companyId}))!
  expect(technicalReply).toBeTruthy()
  expect(technicalReply.status).toBe('draft')
  expect({id:technicalReply.id,company:technicalReply.company_id,environment:technicalReply.environment,
    direction:technicalReply.direction,standard:technicalReply.message_standard,family:technicalReply.message_family,
    code:technicalReply.message_code,source:technicalReply.related_message_id,route:technicalReply.communication_route_id,
    profile:technicalReply.route_profile_id}).toEqual({id:technicalReplies[0].id,company:f.companyId,environment:'test',
    direction:'outbound',standard:'edifact',family:'CONTRL',code:'CONTRL',source:source.id,route:contrlRouteId,profile:contrlProfileId})
  expect(sql(`SELECT to_jsonb(immutable_payload_hash) FROM public.ediel_messages
    WHERE id=${literal(technicalReply.id)} AND company_id=${literal(f.companyId)} AND environment='test';`))
    .toBe(createHash('sha256').update(technicalReply.raw_payload!,'utf8').digest('hex'))
  // Queue state belongs to the actual outbox, not the draft message status.
  expect(sql(`SELECT coalesce(jsonb_agg(jsonb_build_object('company',company_id,'message',ediel_message_id,
    'source',source_message_id,'environment',environment,'status',status,'profile',route_profile_id) ORDER BY id),'[]'::jsonb)
    FROM public.ediel_outbox WHERE company_id=${literal(f.companyId)} AND ediel_message_id=${literal(technicalReply.id)};`))
    .toEqual([{company:f.companyId,message:technicalReply.id,source:source.id,environment:'test',status:'queued',profile:contrlProfileId}])
  const receivedOriginal=(await getEdielMessageById(source.id,{companyId:f.companyId}))!
  expect({id:receivedOriginal.id,company:receivedOriginal.company_id,environment:receivedOriginal.environment,
    direction:receivedOriginal.direction}).toEqual({id:source.id,company:f.companyId,environment:'test',direction:'inbound'})
  expect(createHash('sha256').update(receivedOriginal.raw_payload!,'utf8').digest('hex'))
    .toBe(createHash('sha256').update(source.raw_payload!,'utf8').digest('hex'))
  const receivedEnvelope=EdifactEnvelopeCodec.decode(receivedOriginal.raw_payload!),replyEnvelope=EdifactEnvelopeCodec.decode(technicalReply.raw_payload!)
  expect({sender:replyEnvelope.sender,senderQualifier:replyEnvelope.senderQualifier,senderSubAddress:replyEnvelope.senderSubAddress,
    receiver:replyEnvelope.receiver,receiverQualifier:replyEnvelope.receiverQualifier,receiverSubAddress:replyEnvelope.receiverSubAddress,
    applicationReference:replyEnvelope.applicationReference,environment:replyEnvelope.environment,testIndicator:replyEnvelope.testIndicator})
    .toEqual({sender:receivedEnvelope.receiver,senderQualifier:receivedEnvelope.receiverQualifier,
    senderSubAddress:receivedEnvelope.receiverSubAddress,receiver:receivedEnvelope.sender,receiverQualifier:receivedEnvelope.senderQualifier,
    receiverSubAddress:receivedEnvelope.senderSubAddress,applicationReference:receivedEnvelope.applicationReference,
    environment:'test',testIndicator:receivedEnvelope.testIndicator})
  expect({sender:receivedEnvelope.sender,senderQualifier:receivedEnvelope.senderQualifier,senderSubAddress:receivedEnvelope.senderSubAddress,
    receiver:receivedEnvelope.receiver,receiverQualifier:receivedEnvelope.receiverQualifier,receiverSubAddress:receivedEnvelope.receiverSubAddress,
    applicationReference:receivedEnvelope.applicationReference}).toEqual({sender:originalEnvelope.receiver,senderQualifier:originalEnvelope.receiverQualifier,
    senderSubAddress:originalEnvelope.receiverSubAddress,receiver:originalEnvelope.sender,receiverQualifier:originalEnvelope.senderQualifier,
    receiverSubAddress:originalEnvelope.senderSubAddress,applicationReference:originalEnvelope.applicationReference})
  const uci=replyEnvelope.segments.filter(segment=>segment.tag==='UCI'),sourceUnb=receivedEnvelope.segments.find(segment=>segment.tag==='UNB')
  expect(uci).toHaveLength(1)
  expect(sourceUnb).toBeTruthy()
  expect(segmentComposite(uci[0],1,replyEnvelope.una)).toEqual([receivedEnvelope.interchangeReference!.slice(0,14)])
  expect(segmentComposite(uci[0],2,replyEnvelope.una)).toEqual(segmentComposite(sourceUnb!,2,receivedEnvelope.una))
  expect(segmentComposite(uci[0],3,replyEnvelope.una)).toEqual(segmentComposite(sourceUnb!,3,receivedEnvelope.una))
  expect(segmentComposite(uci[0],4,replyEnvelope.una)).toEqual(['1'])
}

afterEach(() => { vi.unstubAllEnvs(); smtp.mockReset() })
function configureSmtp() {
  for (const [key,value] of Object.entries({ EDIEL_SHARED_MAILBOX_ADDRESS:'synthetic@example.invalid',
    EDIEL_APP_DKIM_ENABLED:'false', EMAIL_PROVIDER:'resend', EDIEL_SMTP_FROM:'synthetic@example.invalid',
    EDIEL_SMTP_USER:'synthetic@example.invalid', EDIEL_SMTP_PASS:'synthetic-only', EDIEL_EMAIL_PROVIDER:'strato' })) vi.stubEnv(key,value)
  smtp.mockImplementation(async()=>({ accepted:['recipient@example.invalid'], rejected:[], messageId:randomUUID(), response:'250 synthetic accepted' }))
}
// Independent calendar oracle: real Stockholm today, calendar arithmetic only.
function today() { return new Intl.DateTimeFormat('sv-SE',{ timeZone:'Europe/Stockholm',year:'numeric',month:'2-digit',day:'2-digit' }).format(new Date()) }
function days(date: string, offset: number) { const value=new Date(date+'T12:00:00Z'); value.setUTCDate(value.getUTCDate()+offset); return value.toISOString().slice(0,10) }
function months(date: string, offset: number) {
  const value=new Date(date+'T12:00:00Z'),day=value.getUTCDate(); value.setUTCDate(1); value.setUTCMonth(value.getUTCMonth()+offset)
  const last=new Date(Date.UTC(value.getUTCFullYear(),value.getUTCMonth()+1,0)).getUTCDate(); value.setUTCDate(Math.min(day,last)); return value.toISOString().slice(0,10)
}
async function createPublicCase(input: NormalSwitchNativeRequestInput,variant: Variant) {
  expect(sql(`SELECT to_jsonb(count(*)) FROM public.supplier_switch_requests WHERE company_id=${literal(input.companyId)};`)).toBe(0)
  const supplier=await saveElectricitySupplier(supabaseService,electricitySupplierInputSchema.parse({
    name:'Synthetic own supplier '+input.companyId,ediel_id:input.sender,is_active:true,
  }))
  const ownSupplierId=await setOwnElectricitySupplier(supabaseService,input.companyId,supplier.id)
  expect(ownSupplierId).not.toBe(supplier.id)
  expect(sql(`SELECT jsonb_build_object('company',company_id,'own',is_own_supplier,'edielId',ediel_id) FROM public.electricity_suppliers WHERE id=${literal(ownSupplierId)};`))
    .toEqual({company:input.companyId,own:true,edielId:input.sender})
  const existingSite=await findCustomerSiteById(supabaseService,input.siteId)
  expect(existingSite).toMatchObject({id:input.siteId,company_id:input.companyId,customer_id:input.customerId})
  // Prospective site facts pass through the existing public master-data writer.
  // The explicit command type, rather than a patched subtype, selects L or LK.
  const site=await saveCustomerSite(supabaseService,customerSiteInputSchema.parse({...existingSite,
    id:input.siteId,company_id:input.companyId,customer_id:input.customerId,
    move_in_date:input.requestedStartDate,current_supplier_name:'Synthetic prior supplier '+input.companyId,
  }))
  const points=await listMeteringPointsForSite(supabaseService,input.siteId)
  const point=points.find(row=>row.id===input.pointId)!
  expect(point).toMatchObject({id:input.pointId,company_id:input.companyId,customer_id:input.customerId})
  const powers=await listPowersOfAttorneyByCustomerId(supabaseService,input.customerId,{companyId:input.companyId})
  const readiness=evaluateSiteSwitchReadiness({site,meteringPoints:[point],powersOfAttorney:powers})
  expect(readiness,JSON.stringify(readiness.issues)).toMatchObject({isReady:true,issues:[],latestPowerOfAttorneyId:input.powerOfAttorneyId,candidateMeteringPointId:input.pointId})
  const created=await createSupplierSwitchRequest(supabaseService,{readiness,site,meteringPoint:point,
    companyId:input.companyId,contractId:input.contractId,authorizationDocumentId:input.authorizationDocumentId,
    requestType:variant==='L'?'switch':'move_in',requestedStartDate:input.requestedStartDate,
    automationOrigin:'native_z03_literal_case',automationKey:'native_z03_literal_case:'+input.companyId,
    businessBlockers:readiness.issues.map(issue=>({code:issue.code,message:issue.title})),
  })
  // The real service-role command is authorized by the installed writer guard.
  // Its auth.getUser() has no user session; do not invent actor attribution.
  expect(created).toMatchObject({company_id:input.companyId,customer_id:input.customerId,site_id:input.siteId,
    metering_point_id:input.pointId,customer_contract_id:input.contractId,contract_id:input.contractId,
    power_of_attorney_id:input.powerOfAttorneyId,authorization_document_id:input.authorizationDocumentId,
    request_type:variant==='L'?'switch':'move_in',prodat_variant:variant,prodat_reason:variant==='L'?'Z22':'Z23',
    requested_start_date:input.requestedStartDate,status:'queued',created_by:null})
  expect(created.validation_snapshot.portalData).toMatchObject({reasonForTransaction:variant==='L'?'Z22':'Z23'})
  const selectedPortal=input.invoiceeSnapshot.portalData as Record<string,unknown>
  // Preserve the actual creator/trigger projection, including its own reason.
  // Add only the prospective caller's POA reference and invoicee selection.
  const validationSnapshot={...created.validation_snapshot,portalData:{
    ...created.validation_snapshot.portalData as Record<string,unknown>,
    powerOfAttorneyReference:selectedPortal.powerOfAttorneyReference,
    dependentConditionFacts:selectedPortal.dependentConditionFacts,
  }}
  const updated=await updateSupplierSwitchValidationSnapshot(supabaseService,{requestId:created.id,
    validationSnapshot})
  expect(updated.validation_snapshot).toEqual(validationSnapshot)
  expect(sql(`SELECT jsonb_build_object('requests',(SELECT count(*) FROM public.supplier_switch_requests WHERE company_id=${literal(input.companyId)}),
    'createdEvents',(SELECT count(*) FROM public.supplier_switch_events WHERE switch_request_id=${literal(created.id)} AND company_id=${literal(input.companyId)} AND event_type='created' AND event_status='success' AND created_by IS NULL),
    'messages',(SELECT count(*) FROM public.ediel_messages WHERE company_id=${literal(input.companyId)}),
    'originals',(SELECT count(*) FROM gridex_received_sources.switch_originals WHERE company_id=${literal(input.companyId)}),
    'periods',(SELECT count(*) FROM public.customer_supply_periods WHERE company_id=${literal(input.companyId)}));`))
    .toEqual({requests:1,createdEvents:1,messages:0,originals:0,periods:0})
  return created.id
}
async function stage(variant: Variant, date=days(today(),14), invoicee=false,publicCase=false) {
  configureSmtp()
  const f=await seedNormalSwitchNativeFixture({ deferOriginal:true,requestedStartDate:date,
    ...(publicCase?{createSwitchRequest:(input:NormalSwitchNativeRequestInput)=>createPublicCase(input,variant)}:{}),
  })
  if (variant==='LK'&&!publicCase) sql(`UPDATE public.supplier_switch_requests SET request_type='move_in',prodat_variant='LK',prodat_reason='Z23' WHERE id=${literal(f.switchId)} AND company_id=${literal(f.companyId)};`)
  if (invoicee) {
    // Typed caller selection is prospective protocol input, not an accepted
    // decision. Preserve the producer's UD source and qualify a distinct IV.
    const snapshot=sql<{ portalData: { dependentConditionFacts: { invoiceeObjects: ProdatInvoiceeObject[] }; [key:string]:unknown } }>(`SELECT to_jsonb(validation_snapshot) FROM public.supplier_switch_requests WHERE id=${literal(f.switchId)};`)
    const selected=snapshot.portalData.dependentConditionFacts.invoiceeObjects[0]
    selected.invoicee={ ...selected.invoicee,nameLines:['Synthetic Invoicee'],address:{ ...selected.invoicee.address,
      lines:['Invoicegatan 2','',''],postalCode:'54321',city:'Annanstad',country:'SE' } }
    snapshot.portalData.invoicee={ id:selected.invoicee.identity.id,idCodeListQualifier:selected.invoicee.identity.qualifier,
      idAgency:selected.invoicee.identity.agency,name:'Synthetic Invoicee',nameLines:['Synthetic Invoicee'],
      address:'Invoicegatan 2',addressLines:['Invoicegatan 2'],postalCode:'54321',city:'Annanstad',country:'SE' }
    sql(`UPDATE public.supplier_switch_requests SET validation_snapshot=${literal(snapshot)}::jsonb WHERE id=${literal(f.switchId)} AND company_id=${literal(f.companyId)};`)
    // Installation is optional until the own public site supplies an address.
    // Select it before production; no accepted source or rendered wire changes.
    sql(`UPDATE public.customer_sites SET street='Installationgatan 3',postal_code='11122',city='Installationsstad',country='SE' WHERE id=${literal(f.siteId)} AND company_id=${literal(f.companyId)} AND customer_id=${literal(f.customerId)};`)
    expect(sql(`SELECT jsonb_build_object('street',street,'postalCode',postal_code,'city',city,'country',country) FROM public.customer_sites WHERE id=${literal(f.siteId)} AND company_id=${literal(f.companyId)} AND customer_id=${literal(f.customerId)};`))
      .toEqual({street:'Installationgatan 3',postalCode:'11122',city:'Installationsstad',country:'SE'})
  }
  return { ...f,variant }
}
async function materializeWindowRoute(f: NormalSwitchStageNativeFixture) {
  const registry=await attachNetworkRegistrySourceFixture(f),prior=normalSwitchNetworkRegistry(f.companyId)
  expect(prior).toBeTruthy()
  if (!prior) throw Error('native_window_original_network_source_required')
  const oldScope={companyId:f.companyId,actorUserId:registry.reviewer.id,artifactId:prior.artifact.artifactId}
  expect(await readNetworkRegistrySourceArtifact(oldScope)).toMatchObject({status:'authorized',sourceVersion:'1',
    networkActorId:registry.networkActorId,networkEdielId:f.receiver,sourceHash:prior.artifact.sourceHash,claimsHash:prior.artifact.claimsHash})
  const originalNetwork=()=>sql(`SELECT jsonb_build_object(
    'artifact',(SELECT to_jsonb(a) FROM gridex_network_registry_sources.artifacts a WHERE a.id=${literal(prior.artifact.artifactId)} AND a.company_id=${literal(f.companyId)}),
    'origin',(SELECT to_jsonb(o) FROM gridex_network_registry_sources.origins o WHERE o.artifact_id=${literal(prior.artifact.artifactId)} AND o.company_id=${literal(f.companyId)}));`)
  const signedSource=()=>sql(`SELECT jsonb_build_object(
    'contract',(SELECT to_jsonb(c) FROM public.customer_contracts c WHERE c.id=${literal(f.contractId)} AND c.company_id=${literal(f.companyId)}),
    'pdf',(SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.id),'[]') FROM public.customer_contract_documents d WHERE d.company_id=${literal(f.companyId)} AND d.customer_contract_id=${literal(f.contractId)}),
    'method',(SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.id),'[]') FROM gridex_metering_method_changes.contract_request_declarations d WHERE d.company_id=${literal(f.companyId)} AND d.contract_id=${literal(f.contractId)}));`)
  const oldNetwork=originalNetwork(),agreement=signedSource()
  const methodScope={companyId:f.companyId,contractId:f.contractId,actorUserId:f.actorUserId,environment:'test' as const}
  const method=await readContractRequestedMethodSource(methodScope)
  expect(method).toMatchObject({status:'authorized',companyId:f.companyId,contractId:f.contractId,
    customerId:f.customerId,siteId:f.siteId,meteringPointId:f.pointId,environment:'test'})
  // Submit actual prospective test catalog bytes through the public importer.
  // Registry verification deliberately keeps automatic sending disabled; no
  // certificate/readiness/accepted-source fact or production approval is seeded.
  const xml=`<Market Code="EL" Country="SE"><Company><Name>Synthetic window grid ${f.gridId}</Name>
    <Key Type="EdielId">${f.receiver}</Key><Role>DSO</Role><EDIFACTDetails Type="PRODAT" environment="test">
    <PartyId>${f.receiver}</PartyId><InterchangePartyId>${f.receiver}</InterchangePartyId>
    <ApplicationReference>23-DDQ-PRODAT</ApplicationReference><SubAddress>NATIVE</SubAddress>
    <CommunicationAddress Type="SMTP">recipient@example.invalid</CommunicationAddress></EDIFACTDetails></Company></Market>`
  // The normal producer fixture removes its temporary platform administrator
  // before returning. Its supplier must retain only tenant business authority.
  expect(sql(`SELECT to_jsonb(public.canonical_actor_is_platform_admin(${literal(f.actorUserId)}::uuid));`)).toBe(false)
  const registryTables=['public.actor_registry_import_runs','public.actor_registry_import_items',
    'public.platform_actor_import_runs','public.platform_actor_import_issues',
    'public.platform_market_actors','public.platform_actor_identifiers','public.platform_actor_roles',
    'public.platform_actor_routes','public.platform_actor_certificates',
    'gridex_registry_import.batches','gridex_registry_import.normalized_batches',
    'gridex_registry_import.market_records','gridex_registry_import.market_current',
    'gridex_registry_import.route_market_sources','gridex_registry_import.route_market_current']
  const registryState=()=>sql(`SELECT jsonb_build_object(${registryTables.map(table=>
    `${literal(table)},(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb) FROM ${table} r)`).join(',')});`)
  const beforeSupplierImport=registryState()
  await expect(importActorRegistryXml({xml,uploadedBy:f.actorUserId,sourceFilename:'synthetic-window-test-route.xml'}))
    .rejects.toMatchObject({code:'42501',message:'ediel_registry_platform_actor_required'})
  expect(registryState()).toEqual(beforeSupplierImport)
  // Prospective disposable administrative configuration, separate from the
  // supplier. No route readiness, certificate or accepted business fact is set.
  const registryAdmin=randomUUID()
  sql(`INSERT INTO auth.users(instance_id,confirmation_token,recovery_token,email_change_token_new,email_change,
    id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
    VALUES('00000000-0000-0000-0000-000000000000','','','','',${literal(registryAdmin)},
      'authenticated','authenticated',${literal(registryAdmin+'@example.invalid')},now(),'{}','{}',now(),now(),false,false);
    INSERT INTO public.user_profiles(id,email,full_name,user_status)
    VALUES(${literal(registryAdmin)},${literal(registryAdmin+'@example.invalid')},'Synthetic window registry administrator','active');
    INSERT INTO public.admin_users(user_id,role,is_active) VALUES(${literal(registryAdmin)},'platform_admin',true);`)
  expect(sql(`SELECT jsonb_build_object('supplier',public.canonical_actor_is_platform_admin(${literal(f.actorUserId)}::uuid),
    'administrator',public.canonical_actor_is_platform_admin(${literal(registryAdmin)}::uuid));`))
    .toEqual({supplier:false,administrator:true})
  const imported=await importActorRegistryXml({xml,uploadedBy:registryAdmin,sourceFilename:'synthetic-window-test-route.xml'})
  const routeIds=Reflect.get(imported,'routeIds')
  expect(routeIds).toEqual([expect.stringMatching(/^[0-9a-f-]{36}$/)])
  expect(Reflect.get(imported,'activation')).toBe('held_pending_current_source_readiness')
  const platformRouteId=routeIds[0] as string
  const source=await readRegistryRouteSource(platformRouteId)
  expect(source).toMatchObject({status:'source_qualified',market:'EL',legalEdielId:f.receiver,
    wire:{family:'PRODAT',environment:'test',partyId:f.receiver,interchangePartyId:f.receiver,
      subaddress:'NATIVE',applicationReference:'23-DDQ-PRODAT',address:'recipient@example.invalid'}})
  if (source.status!=='source_qualified') throw Error('native_window_actual_registry_source_required')
  expect(await verifyElRegistryActor({actorUserId:registryAdmin,actorId:source.actorId,routeId:platformRouteId}))
    .toEqual({actorId:source.actorId,routeIds:[platformRouteId],market:'EL',autoSendAllowed:false})
  expect(sql(`WITH changed AS(UPDATE public.grid_owners SET platform_market_actor_id=${literal(source.actorId)}
    WHERE id=${literal(f.gridId)} AND company_id=${literal(f.companyId)} AND ediel_id=${literal(f.receiver)} AND environment='test' RETURNING id) SELECT to_jsonb(count(*)) FROM changed;`)).toBe(1)
  // Message code is prospective public configuration; the immutable catalog
  // source continues to own its family/environment/address/identity tuple.
  expect(sql(`WITH changed AS(UPDATE public.platform_actor_routes SET metadata=metadata||'{"message_code":"Z03"}'::jsonb
    WHERE id=${literal(platformRouteId)} AND actor_id=${literal(source.actorId)} AND environment='test' RETURNING id) SELECT to_jsonb(count(*)) FROM changed;`)).toBe(1)
  const before=await readRegistryRouteSource(platformRouteId)
  expect(before).toEqual(source)
  const {data,error}=await supabaseService.rpc('gridex_materialize_company_operational_routes',{
    p_company_id:f.companyId,p_environment:'test',p_message_family:'PRODAT',p_grid_owner_id:f.gridId,
    p_platform_actor_route_id:platformRouteId,p_message_code:'Z03',p_dry_run:false,
  })
  expect(error).toBeNull()
  const rows=Array.isArray(data)?data as Array<Record<string,unknown>>:[]
  expect(rows,JSON.stringify(data)).toHaveLength(1)
  expect(rows[0]).toMatchObject({result_status:'materialized',company_id:f.companyId,grid_owner_id:f.gridId,
    platform_actor_route_id:platformRouteId,environment:'test',message_family:'PRODAT',message_code:'Z03'})
  expect(rows[0].communication_route_id).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/))
  expect(rows[0].ediel_route_profile_id).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/))
  f.routeId=rows[0].communication_route_id as string
  f.routeProfileId=rows[0].ediel_route_profile_id as string
  // The public import prospectively changes current registry claims. Preserve
  // the old original and qualify a distinct version through the cached issuer
  // and the separate public reviewer before the unchanged calendar dispatcher.
  expect(source.actorId).toBe(registry.networkActorId)
  expect(await readNetworkRegistrySourceArtifact(oldScope)).toMatchObject({status:'held',
    sourceHash:prior.artifact.sourceHash,claimsHash:prior.artifact.claimsHash})
  expect(await readContractRequestedMethodSource(methodScope)).toEqual({status:'held',missing:['ai_bi_network_registry_current_source_unqualified']})
  const submission=registry.submission('SYNTHETIC prospective window network original',registry.pdf('prospective window network'))
  expect(submission.source.version).toBe('2')
  const next=await archiveNetworkRegistrySource({...submission,companyId:f.companyId,actorUserId:registry.uploader.id})
  expect(next.missing).toEqual([])
  expect(next.artifactId).not.toBe(prior.artifact.artifactId)
  expect(next.sourceHash).not.toBe(prior.artifact.sourceHash)
  expect(next.claimsHash).not.toBe(prior.artifact.claimsHash)
  expect(registry.reviewer.id).not.toBe(registry.uploader.id)
  expect(await reviewNetworkRegistrySource({...next,companyId:f.companyId,actorUserId:registry.reviewer.id,
    decision:'approve',reason:'SYNTHETIC separate review of prospective window network original',clause:registry.clause}))
    .toMatchObject({status:'authorized',artifactId:next.artifactId})
  expect(await readNetworkRegistrySourceArtifact({...oldScope,artifactId:next.artifactId})).toMatchObject({status:'authorized',
    sourceVersion:submission.source.version,networkActorId:source.actorId,networkEdielId:f.receiver,sourceHash:next.sourceHash,claimsHash:next.claimsHash})
  expect(await readNetworkRegistrySourceArtifact(oldScope)).toMatchObject({status:'held',sourceHash:prior.artifact.sourceHash,claimsHash:prior.artifact.claimsHash})
  expect(originalNetwork()).toEqual(oldNetwork)
  expect(signedSource()).toEqual(agreement)
  expect(await readContractRequestedMethodSource(methodScope)).toEqual(method)
  expect(sql(`SELECT to_jsonb(auto_send_allowed) FROM public.platform_actor_routes WHERE id=${literal(platformRouteId)} AND actor_id=${literal(source.actorId)};`)).toBe(false)
  const readiness=await getCompanyGridOwnerRouteReadiness({companyId:f.companyId,gridOwnerId:f.gridId,
    environment:'test',messageFamily:'PRODAT',messageCode:'Z03'})
  expect(readiness).toMatchObject({company_id:f.companyId,grid_owner_id:f.gridId,environment:'test',message_code:'Z03',
    communication_route_id:f.routeId,ediel_route_profile_id:f.routeProfileId,operational_route_ready:true,send_ready:true,blocker_code:null})
  const checked=await evaluateCustomerProcessRouteReadiness({companyId:f.companyId,customerId:f.customerId,
    siteId:f.siteId,gridOwnerId:f.gridId,process:'supplier_switch',actorUserId:f.actorUserId,environment:'test',emitEvents:false})
  expect(checked,JSON.stringify(checked)).toMatchObject({ready:true,communicationRouteId:f.routeId,routeProfileId:f.routeProfileId,blockers:[]})
}
async function originate(f: NormalSwitchStageNativeFixture & { variant:Variant }): Promise<Fixture> {
  const prepared=await prepareAndQueueEdielZ03({ actorUserId:f.actorUserId,switchRequestId:f.switchId,communicationRouteId:f.routeId,environment:'test' })
  const original=(await getEdielMessageById(prepared.id))!
  expect(original).toBeTruthy()
  const wire=tokenizeEdifact(original.raw_payload!),reference=wire.segments.find(s=>s.tag==='RFF'&&segmentComposite(s,1,wire.una)[0]==='LI')
  expect(reference).toBeTruthy(); const li=segmentComposite(reference!,1,wire.una)[1]; expect(li).toBeTruthy()
  return { ...f,original,li }
}
async function seed(variant: Variant, invoicee=false) { return originate(await stage(variant,days(today(),14),invoicee)) }
function business(f: NormalSwitchStageNativeFixture) {
  return sql(`SELECT jsonb_build_object(
    'switches',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.supplier_switch_requests s WHERE company_id=${literal(f.companyId)}),
    'periods',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.customer_supply_periods s WHERE company_id=${literal(f.companyId)}),
    'contracts',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.customer_contracts s WHERE company_id=${literal(f.companyId)}),
    'sites',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.customer_sites s WHERE company_id=${literal(f.companyId)}),
    'points',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.metering_points s WHERE company_id=${literal(f.companyId)}),
    'permissions',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.metering_permissions s WHERE company_id=${literal(f.companyId)}),
    'permissionSites',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.metering_permission_sites s WHERE company_id=${literal(f.companyId)}),
    'actorPermissions',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.user_id,s.permission_id),'[]') FROM public.user_permissions s WHERE company_id=${literal(f.companyId)}),
    'confirmations',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.source_message_id),'[]') FROM gridex_received_sources.normal_switch_confirmations s WHERE company_id=${literal(f.companyId)}),
    'transitions',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.source_message_id),'[]') FROM gridex_received_sources.supply_source_transitions s WHERE company_id=${literal(f.companyId)}));`)
}
function effects(f: NormalSwitchStageNativeFixture) {
  return { business:business(f), durable:sql(`SELECT jsonb_build_object(
    'messages',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.ediel_messages s WHERE company_id=${literal(f.companyId)}),
    'intents',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.ediel_message_intents s WHERE company_id=${literal(f.companyId)}),
    'outbox',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.ediel_outbox s WHERE company_id=${literal(f.companyId)}),
    'requests',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.outbound_requests s WHERE company_id=${literal(f.companyId)}),
    'providerAttempts',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM gridex_ediel_transport.attempts s WHERE company_id=${literal(f.companyId)}),
    'originals',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.message_id),'[]') FROM gridex_received_sources.switch_originals s WHERE company_id=${literal(f.companyId)}),
    'ackCorrelations',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.ack_message_id),'[]') FROM gridex_ack_authority.source_correlations s WHERE s.company_id=${literal(f.companyId)}),
    'ackReceipts',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.ack_message_id),'[]') FROM gridex_ack_authority.applied_receipts s JOIN gridex_ack_authority.source_correlations c ON c.ack_message_id=s.ack_message_id WHERE c.company_id=${literal(f.companyId)}),
    'ackScopeOutcomes',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.source_message_id,s.ack_family,s.ack_scope,s.source_reference),'[]') FROM gridex_ack_authority.scope_outcomes s JOIN gridex_ack_authority.source_correlations c ON c.ack_message_id=s.ack_message_id AND c.source_message_id=s.source_message_id WHERE c.company_id=${literal(f.companyId)}),
    'receptions',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM gridex_ediel_inbound_receptions.receptions s WHERE s.company_id=${literal(f.companyId)}),
    'responseRequests',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM gridex_ediel_inbound_receptions.response_requests s WHERE s.company_id=${literal(f.companyId)}),
    'receivedSources',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.source_message_id),'[]') FROM gridex_received_sources.sources s WHERE s.company_id=${literal(f.companyId)}),
    'sourceValidations',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM gridex_received_sources.validation_assessments s WHERE s.company_id=${literal(f.companyId)}),
    'supplyPartitions',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.source_message_id),'[]') FROM gridex_received_sources.supply_object_partitions s WHERE s.company_id=${literal(f.companyId)}),
    'supplyEffectReceipts',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM gridex_received_sources.supply_object_effect_receipts s WHERE s.company_id=${literal(f.companyId)}),
    'prodatIgnoredFields',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.canonical_assessment_id),'[]') FROM gridex_received_sources.prodat_ignored_field_facets s WHERE s.company_id=${literal(f.companyId)}),
    'prodatObjectValidations',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.assessment_id),'[]') FROM gridex_received_sources.prodat_object_validation_facets s WHERE s.company_id=${literal(f.companyId)}),
    'prodatResponseValidations',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.assessment_id),'[]') FROM gridex_received_sources.prodat_response_facets s WHERE s.company_id=${literal(f.companyId)}),
    'prodatApplicationValidations',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.assessment_id),'[]') FROM gridex_received_sources.prodat_application_facets s WHERE s.company_id=${literal(f.companyId)}),
    'prodatSourceFunctionValidations',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.assessment_id),'[]') FROM gridex_received_sources.prodat_source_function_facets s WHERE s.company_id=${literal(f.companyId)}),
    'events',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.supplier_switch_events s WHERE switch_request_id=${literal(f.switchId)}),
    'cases',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.customer_cases s WHERE company_id=${literal(f.companyId)}));`),providerCalls:smtp.mock.calls.length }
}
// Ordinary Z04 replay revalidates once. Its append-only audit may grow, while
// every prior authority row and every non-audit effect must remain exact.
function preserveZ04ValidationAudit(f: Fixture, source: EdielMessageRow, baseline: ReturnType<typeof effects>, actual: ReturnType<typeof effects>,
  replay: { startedAt:number; finishedAt:number; ackMessages:EdielMessageRow[]; inboundCaseId:string }) {
  type AuditRows = Record<string,Record<string,unknown>[]>
  const before=baseline.durable as AuditRows,normalized=structuredClone(actual),after=normalized.durable as AuditRows
  expect(source).toMatchObject({company_id:f.companyId,environment:'test',direction:'inbound',message_family:'PRODAT',message_code:'Z04'})
  const scope={company_id:f.companyId,environment:'test',source_message_id:source.id,
    source_payload_hash:createHash('sha256').update(source.raw_payload!,'utf8').digest('hex')}
  const own=before.sourceValidations.filter(row=>row.source_message_id===source.id)
  const leaves=own.filter(row=>!own.some(child=>child.previous_assessment_id===row.id))
  expect(leaves,'one actual baseline own-source validation leaf').toHaveLength(1)
  const leaf=leaves[0]
  expect(leaf).toMatchObject({...scope,owner:'canonical-runtime-with-registry-v1'})
  const additions=(key:string,primaryKey:string)=>{
    const previous=before[key],current=after[key],ids=new Set(previous.map(row=>row[primaryKey]))
    expect(current.filter(row=>ids.has(row[primaryKey])),key+' immutable old primary-key rows').toEqual(previous)
    const added=current.filter(row=>!ids.has(row[primaryKey]))
    after[key]=previous
    return added
  }
  const factsHash=(row:Record<string,unknown>,textKey:string,hashKey:string)=>{
    expect(row[textKey],textKey).toEqual(expect.any(String))
    expect(row[hashKey],hashKey).toBe(createHash('sha256').update(row[textKey] as string,'utf8').digest('hex'))
  }
  const clock=(value:unknown,previous?:unknown)=>{
    expect(value).toEqual(expect.any(String))
    const instant=Date.parse(value as string)
    expect(Number.isFinite(instant)).toBe(true)
    expect(instant).toBeGreaterThanOrEqual(replay.startedAt)
    expect(instant).toBeLessThanOrEqual(replay.finishedAt)
    if (previous!==undefined) {
      const prior=Date.parse(previous as string)
      expect(Number.isFinite(prior)).toBe(true)
      expect(instant).toBeGreaterThanOrEqual(prior)
    }
  }
  const assessments=additions('sourceValidations','id')
  expect(assessments,'exactly one fresh own-source assessment').toHaveLength(1)
  const assessment=assessments[0]
  expect(assessment.id).toEqual(expect.stringMatching(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/))
  expect(assessment.id).not.toBe(leaf.id)
  expect(assessment).toMatchObject({...scope,previous_assessment_id:leaf.id,owner:'canonical-runtime-with-registry-v1'})
  factsHash(assessment,'facts_text','facts_hash')
  clock(assessment.assessed_at,leaf.assessed_at)
  expect(JSON.parse(assessment.facts_text as string)).toMatchObject({
    owner:'canonical-runtime-with-registry-v1',syntaxDecision:'accepted',applicationDecision:'accepted',functionalDecision:'accepted',
  })
  for (const [key,primaryKey,textKey,hashKey] of [
    ['prodatIgnoredFields','canonical_assessment_id','fields_text','fields_hash'],
    ['prodatObjectValidations','assessment_id','facts_text','facts_hash'],
    ['prodatResponseValidations','assessment_id','response_facts_text','response_facts_hash'],
    ['prodatApplicationValidations','assessment_id','application_facts_text','application_facts_hash'],
    ['prodatSourceFunctionValidations','assessment_id','function_facts_text','function_facts_hash'],
  ] as const) {
    const established=before[key].filter(row=>row[primaryKey]===leaf.id)
    if (established.length) {
      expect(established,key+' single baseline leaf facet').toHaveLength(1)
      expect(established[0]).toMatchObject({...scope,[primaryKey]:leaf.id})
    }
    // Normal Z04 has no customer-life-event source-function projection.
    if (key==='prodatSourceFunctionValidations') expect(before[key].filter(row=>row.source_message_id===source.id)).toHaveLength(0)
    const added=additions(key,primaryKey)
    expect(added,key+' matches the actual baseline leaf facet presence').toHaveLength(established.length)
    for (const row of added) {
      expect(row).toMatchObject({...scope,[primaryKey]:assessment.id})
      factsHash(row,textKey,hashKey)
    }
  }
  // These protected business receipts retain the original execution actor,
  // unlike the service client's nullable creator on a later operational event.
  const partitions=before.supplyPartitions.filter(row=>row.source_message_id===source.id)
  const effectReceipts=before.supplyEffectReceipts.filter(row=>row.source_message_id===source.id)
  expect(partitions).toHaveLength(1); expect(effectReceipts).toHaveLength(1)
  const partition=partitions[0],effect=effectReceipts[0]
  const businessScope={company_id:f.companyId,environment:'test',source_message_id:source.id,payload_hash:scope.source_payload_hash}
  expect(partition).toMatchObject({...businessScope,canonical_assessment_id:leaf.id,actor_user_id:f.actorUserId})
  expect(effect).toMatchObject({...businessScope,canonical_assessment_id:partition.canonical_assessment_id})
  factsHash(partition,'partition_text','partition_hash'); factsHash(effect,'effect_text','effect_hash')
  const partitionObjects=JSON.parse(partition.partition_text as string)
  expect(partitionObjects).toEqual([{object:effect.object_scope,disposition:'applied',effectReceiptId:effect.id,effectFactsHash:effect.effect_hash}])
  expect(partition.result).toMatchObject({applied:true,partition:partitionObjects,effectReceiptIds:[effect.id],switchIds:[f.switchId]})
  expect(JSON.parse(effect.effect_text as string)).toMatchObject({version:1,owner:'inbound-supply-object-v1',
    sourceMessageId:source.id,sourcePayloadHash:scope.source_payload_hash,companyId:f.companyId,environment:'test',
    canonicalAssessmentId:partition.canonical_assessment_id,object:effect.object_scope,plan:{switchId:f.switchId}})
  expect(after.supplyPartitions).toEqual(before.supplyPartitions)
  expect(after.supplyEffectReceipts).toEqual(before.supplyEffectReceipts)

  // Only this source's projected receipt and two audit clocks may change.
  const previousMessages=before.messages.filter(row=>row.id===source.id),currentMessages=after.messages.filter(row=>row.id===source.id)
  expect(previousMessages).toHaveLength(1); expect(currentMessages).toHaveLength(1)
  const previousMessage=previousMessages[0],currentMessage=currentMessages[0]
  expect(Object.keys(currentMessage).sort()).toEqual(Object.keys(previousMessage).sort())
  expect(previousMessage.updated_by).toBe(f.actorUserId); expect(currentMessage.updated_by).toBe(f.actorUserId)
  const previousReport=previousMessage.validation_report as Record<string,unknown>,currentReport=currentMessage.validation_report as Record<string,unknown>
  expect(previousReport.receivedSourceValidationEvidence).toEqual({status:'recorded',sourceDisposition:'not_established',assessmentId:leaf.id,factsHash:leaf.facts_hash})
  expect(currentReport.receivedSourceValidationEvidence).toEqual({status:'recorded',sourceDisposition:'not_established',assessmentId:assessment.id,factsHash:assessment.facts_hash})
  for (const key of ['validated_at','updated_at'] as const) {
    clock(currentMessage[key],previousMessage[key])
    currentMessage[key]=previousMessage[key]
  }
  currentReport.receivedSourceValidationEvidence=previousReport.receivedSourceValidationEvidence

  const priorEvents=before.events.filter(row=>row.event_type==='ediel_inbound_processed'&&(row.payload as Record<string,unknown>).edielMessageId===source.id)
  expect(priorEvents,'one genuine baseline source processing event').toHaveLength(1)
  const priorEvent=priorEvents[0],priorPayload=priorEvent.payload as Record<string,unknown>
  const eventDefaults={company_id:f.companyId,switch_request_id:f.switchId,event_type:'ediel_inbound_processed',event_status:'success',
    message:'Inbound PRODAT behandlad via canonical inbound flow och staging-case skapades för eventuell admin-granskning.',
    created_by:null,metadata:{},archived_at:null,archived_by:null,archive_reason:null}
  expect(priorEvent).toMatchObject(eventDefaults)
  expect(priorPayload).toMatchObject({edielMessageId:source.id,inboundCaseId:replay.inboundCaseId,
    customerInfoRequestLink:{applied:false,targetId:null,reason:'not_z02'},meteringPermissionLink:{applied:false,targetId:null,reason:'not_z14'}})
  expect(priorPayload.businessState).toMatchObject({outcome:'supplier_switch_accepted',reviewRequired:false,
    updated:['supplier_switch_requests','customer_supply_periods'],metadata:{companyId:f.companyId,messageFamily:'PRODAT',messageCode:'Z04',
      matchedSwitchRequestId:f.switchId,customerInfoRequestId:null,source:'prodat_with_strong_switch_match',
      prodatProcess:'supplier_switch',prodatSubtype:f.variant,prodatState:'switch_accepted'}})
  expect(replay.ackMessages.map(row=>row.message_family).sort()).toEqual(['APERAK','CONTRL'])
  for (const ack of replay.ackMessages) expect(ack).toMatchObject({company_id:f.companyId,environment:'test',direction:'outbound',
    related_message_id:source.id,status:'sent',ack_outcome:'positive'})
  expect(replay.ackMessages.map(row=>row.id).sort()).toEqual(before.messages.filter(row=>row.related_message_id===source.id&&['CONTRL','APERAK'].includes(row.message_family as string)).map(row=>row.id).sort())
  const events=additions('events','id')
  expect(events,'exactly one processing audit attempt').toHaveLength(1)
  const event=events[0]
  expect(event.id).toEqual(expect.stringMatching(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/))
  clock(event.created_at,priorEvent.created_at); clock(event.updated_at,priorEvent.updated_at)
  expect(event).toEqual({...eventDefaults,id:event.id,created_at:event.created_at,updated_at:event.updated_at,payload:{
    edielMessageId:source.id,createdAckMessageIds:[replay.ackMessages.find(row=>row.message_family==='CONTRL')!.id],
    canonicalAckState:'ack_originals_qualified',ackMessages:replay.ackMessages.map(row=>({id:row.id,family:row.message_family,
      code:row.message_code,status:row.status,outcome:row.ack_outcome})),safeApplyProposalChanges:[],inboundCaseId:replay.inboundCaseId,
    customerInfoRequestLink:{applied:false,targetId:null,reason:'not_z02'},meteringPermissionLink:{applied:false,targetId:null,reason:'not_z14'},
    businessState:priorPayload.businessState,
  }})
  return normalized
}
function noActivation(f: NormalSwitchStageNativeFixture) {
  expect(sql(`SELECT jsonb_build_object('periods',(SELECT count(*) FROM public.customer_supply_periods WHERE company_id=${literal(f.companyId)}),
    'accepted',(SELECT status IN('accepted','confirmed','active','completed') OR inbound_z04_message_id IS NOT NULL OR completed_at IS NOT NULL FROM public.supplier_switch_requests WHERE id=${literal(f.switchId)}))`)).toEqual({ periods:0,accepted:false })
}
function encode(f: Fixture, body: string[], inbound=false, ownReverseOriginalEnvelope=false) {
  const envelope=EdifactEnvelopeCodec.decode(f.original.raw_payload!)
  if(ownReverseOriginalEnvelope&&(!inbound||!envelope.senderQualifier||!envelope.receiverQualifier))throw Error('native_own_reverse_source_qualifiers_required')
  return EdifactEnvelopeCodec.encode({ sender:inbound?f.receiver:f.sender,receiver:inbound?f.sender:f.receiver,
    senderQualifier:ownReverseOriginalEnvelope?envelope.receiverQualifier:'14',receiverQualifier:ownReverseOriginalEnvelope?envelope.senderQualifier:'14',
    senderSubAddress:inbound?envelope.receiverSubAddress:envelope.senderSubAddress,
    receiverSubAddress:inbound?envelope.senderSubAddress:envelope.receiverSubAddress,applicationReference:'23-DDQ-PRODAT',
    acknowledgementRequest:true,environment:'test',interchangeReference:randomUUID().replaceAll('-','').slice(0,14),
    messages:[{ messageReference:randomUUID().replaceAll('-','').slice(0,14),messageTypeToken:'PRODAT:D:97A:UN:E2SE6A',businessSegments:body }] })
}
function confirmation(f: Fixture, change: (body:string[])=>string[]=body=>body, ownReverseOriginalEnvelope=false) {
  const selected=ownerSource().raw_payload!.replaceAll(OWNER.external,f.external)
    .replaceAll('12345:160:SVK',`${f.receiver}:160:SVK`).replaceAll('54321:160:SVK',`${f.sender}:160:SVK`)
    .replaceAll('11111:160:SVK',`${f.brpEdielId}:160:SVK`).replaceAll('CUSTOMER-1::89',`${f.customerIdentity.id}:SE2:260`)
    .replaceAll('RFF+Z05:NET-1',`RFF+Z05:${f.gridAreaCode}`).replaceAll('RFF+LI:CASE-1',`RFF+LI:${f.li}`)
    .replaceAll('202610010000',f.requestedStartDate.replaceAll('-','')+'0000').replaceAll('CAV+Z22',`CAV+${f.variant==='L'?'Z22':'Z23'}`)
  const body=tokenizeEdifact(selected).segments.filter(s=>!['UNA','UNB','UNH','UNT','UNZ'].includes(s.tag))
    .map(s=>s.tag==='BGM'?`BGM+Z04+${randomUUID().replaceAll('-','').slice(0,20)}+9+AB`:s.raw)
  return encode(f,change(body),true,ownReverseOriginalEnvelope)
}
async function receive(f: Fixture, raw: string) {
  const mail=await seedOriginalMailboxNative(sql,literal,{ companyId:f.companyId,environment:'test',raw,smtpFrom:'synthetic@example.invalid' })
  const id=await createInboundEdielMessage({ companyId:f.companyId,actorUserId:f.actorUserId,environment:'test',
    inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId,parsed:mail.parsed })
  expect(id).toBeTruthy(); return (await getEdielMessageById(id!))!
}
async function send(f: Fixture) {
  await sendEdielMessageViaSmtp(f.original,{ actorUserId:f.actorUserId,smtpMimeMode:'nodemailer-attachment' })
  f.original=(await getEdielMessageById(f.original.id))!; expect(f.original.status).toBe('sent')
  expect(sql(`SELECT to_jsonb(gridex_received_sources.sent_source_is_current_v1(m)) FROM public.ediel_messages m WHERE id=${literal(f.original.id)}`)).toBe(true)
}
async function physicalAck(f: Fixture, family:'CONTRL'|'APERAK') {
  const input={ actorUserId:f.actorUserId,sourceMessage:{ ...f.original,direction:'inbound' as const },outcome:'positive' as const }
  const ack=await receive(f,(family==='CONTRL'?buildContrlDraft(input):buildAperakDraft(input)).rawPayload!)
  const decision=await resolveCanonicalRuntimeDecisionWithRegistry(ack)
  expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision],JSON.stringify(decision.issues)).toEqual(['accepted','accepted','accepted'])
  expect(await recordReceivedSourceValidation({ original:ack,validated:ack,resolvedCompanyId:f.companyId,decision })).toMatchObject({ status:'recorded' })
  expect(await processInboundAckMessage({ actorUserId:f.actorUserId,message:ack })).toMatchObject({ outcome:'positive',sourceMessage:{ id:f.original.id } })
  const received=(await getEdielMessageById(ack.id))!
  expect(received).toMatchObject({ack_outcome:'positive'})
  expect(await readCommittedInboundAck({ actorUserId:f.actorUserId,message:received })).toMatchObject({ kind:'exact_receipt',sourceMessageId:f.original.id,result:{outcome:'positive'} })
  const before=effects(f)
  expect(await processInboundAckMessage({ actorUserId:f.actorUserId,message:ack })).toMatchObject({ outcome:'positive',sourceMessage:{ id:f.original.id } })
  expect(effects(f)).toEqual(before)
  return received
}
function draft(f: Fixture, raw=f.original.raw_payload!): CreateEdielMessageInput {
  const m=f.original
  return { actorUserId:f.actorUserId,companyId:f.companyId,direction:'outbound',messageStandard:'edifact',messageFamily:'PRODAT',messageCode:'Z03',
    environment:'test',testFlag:1,status:'draft',transportType:'smtp',mailbox:m.mailbox,receiverEmail:m.receiver_email,
    messageVersion:m.message_version,processType:m.process_type,senderEdielId:f.sender,receiverEdielId:f.receiver,
    senderSubAddress:m.sender_sub_address,receiverSubAddress:m.receiver_sub_address,applicationReference:m.application_reference,
    communicationRouteId:m.communication_route_id,routeProfileId:m.route_profile_id,intentId:m.intent_id,
    outboundRequestId:m.outbound_request_id,sourceOperationId:f.switchId,switchRequestId:f.switchId,customerId:f.customerId,
    siteId:f.siteId,meteringPointId:f.pointId,gridOwnerId:f.gridId,rawPayload:raw,parsedPayload:m.parsed_payload??{} }
}
async function sourceContext(f: Fixture, raw: string) {
  const projection=await prepareCustomerMasterdataSource({ companyId:f.companyId,customerId:f.customerId,
    actorUserId:f.actorUserId,environment:'test',asOf:f.requestedStartDate+'T00:00:00+01:00' })
  return bindCustomerMasterdataValidationContext({ kind:'customer_masterdata',companyId:f.companyId,customerId:f.customerId,
    environment:'test',rawPayload:raw,intentId:f.original.intent_id!,routeId:f.routeId,projection })
}
function masterdataRow(f:Fixture,raw:string) {
  return {company_id:f.companyId,customer_id:f.customerId,environment:'test' as const,direction:'outbound' as const,
    message_family:'PRODAT',message_code:'Z03',raw_payload:raw,intent_id:f.original.intent_id,communication_route_id:f.routeId}
}
async function registryProfile(f:Fixture) {
  // Retained producer evidence is read through its public protected owner. A
  // runtime parse projection intentionally does not carry caller invoicee facts.
  const context=await loadCustomerMasterdataValidationContext(f.original,f.actorUserId)
  expect(context).toBeTruthy()
  const result=await validateRulebookMessageWithRegistry({family:'PRODAT',code:'Z03',rawPayload:f.original.raw_payload,
    mode:'send',direction:'outbound',environment:'test',companyId:f.companyId,applicationReference:'23-DDQ-PRODAT',
    parsedPayload:f.original.parsed_payload,customerMasterdataContext:context,customerMasterdataRow:masterdataRow(f,f.original.raw_payload!),
    validationPurpose:'outbound_original',version:f.original.message_version,processGroup:f.original.process_type})
  expect(result.blocking,JSON.stringify(result.issues)).toBe(false)
  expect(result.fieldRuleSource).toBe('registry'); expect(result.rulePackSnapshot).toBeTruthy(); expect(result.canonicalPolicy).toBeTruthy()
  return result.canonicalPolicy!
}

// Pure wire mutation preserves untouched raw elements and release sequences.
// Count changes are owned by the existing envelope codec, never hand-edited UNT.
function splitWire(value:string, separator:string, release:string) {
  const parts:string[]=[]; let part='',released=false
  for (const character of value) {
    if (released) { part+=character; released=false; continue }
    if (character===release) { part+=character; released=true; continue }
    if (character===separator) { parts.push(part); part=''; continue }
    part+=character
  }
  parts.push(part); return parts
}
function omitField(f:Fixture, field:string) {
  const descriptor=PRODAT_26A_FIELD_MATRIX.find(row=>row.fieldNumber===field)!
  expect(descriptor,field).toBeTruthy()
  const tokens=tokenizeEdifact(f.original.raw_payload!),una=tokens.una
  let removed=0,discardNextCav=false
  const body=tokens.segments.filter(s=>!['UNA','UNB','UNH','UNT','UNZ'].includes(s.tag)).flatMap(token=>{
    if (discardNextCav && token.tag==='CAV') { discardNextCav=false; return [] }
    const elements=splitWire(token.raw,una.dataElementSeparator,una.releaseCharacter)
    const role=segmentComposite(token,1,una)[0]
    if (descriptor.partyQualifier && token.tag==='NAD' && role===descriptor.partyQualifier) {
      removed++
      if (field.endsWith('_GROUP')) return []
      if (descriptor.partyElement===2) {
        const components=splitWire(elements[2]??'',una.componentDataElementSeparator,una.releaseCharacter)
        components[0]=''; elements[2]=components.join(una.componentDataElementSeparator)
      } else elements[descriptor.partyElement!]=''
      return [elements.join(una.dataElementSeparator)]
    }
    if (field.endsWith('_GROUP') && token.tag==='NAD' && role===(field==='END_USER_GROUP'?'UD':'IV')) { removed++; return [] }
    if (descriptor.documentElement && token.tag==='BGM') { removed++; elements[descriptor.documentElement]=''; return [elements.join(una.dataElementSeparator)] }
    if (descriptor.linElement && token.tag==='LIN') {
      removed++; const components=splitWire(elements[descriptor.linElement]??'',una.componentDataElementSeparator,una.releaseCharacter)
      components[descriptor.linComponent??0]=''; elements[descriptor.linElement]=components.join(una.componentDataElementSeparator)
      return [elements.join(una.dataElementSeparator)]
    }
    if (descriptor.dateQualifier && token.tag==='DTM' && role===descriptor.dateQualifier) { removed++; return [] }
    if (descriptor.referenceScope && token.tag==='RFF' && token.raw.startsWith(descriptor.segmentPath+':')) { removed++; return [] }
    if (descriptor.cavComponent!==undefined && token.tag==='CCI' && segmentComposite(token,2,una)[0]===descriptor.segmentPath.split('++')[1].split('/')[0]) {
      removed++; discardNextCav=true; return []
    }
    return [token.raw]
  })
  let raw=encode(f,body)
  if (field==='311' || field==='312') {
    const tag=field==='311'?'UNB':'UNH'
    const token=tokenizeEdifact(raw).segments.find(s=>s.tag===tag)!
    const elements=splitWire(token.raw,una.dataElementSeparator,una.releaseCharacter)
    if (field==='311') elements[7]=''
    else { const components=splitWire(elements[2],una.componentDataElementSeparator,una.releaseCharacter); components[4]=''; elements[2]=components.join(una.componentDataElementSeparator) }
    raw=raw.replace(token.raw,elements.join(una.dataElementSeparator)); removed++
  }
  expect(removed,field+' exactly one own field selection').toBe(1)
  return raw
}
function replies(f:Fixture, sourceId:string) {
  return sql<EdielMessageRow[]>(`SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.id),'[]') FROM public.ediel_messages m
    WHERE company_id=${literal(f.companyId)} AND environment='test' AND direction='outbound' AND related_message_id=${literal(sourceId)};`)
}
function noPositiveAperak(f:Fixture, sourceId:string) {
  expect(replies(f,sourceId).filter(m=>m.message_family==='APERAK' && tokenizeEdifact(m.raw_payload).segments
    .some(s=>s.tag==='ERC'&&segmentComposite(s,1)[0]==='100'))).toHaveLength(0)
}
function originalHistory(f:Fixture) {
  return sql(`SELECT jsonb_build_object('original',(SELECT to_jsonb(o) FROM gridex_received_sources.switch_originals o WHERE message_id=${literal(f.original.id)}),
    'raw',(SELECT raw_payload FROM public.ediel_messages WHERE id=${literal(f.original.id)}),
    'hash',(SELECT immutable_payload_hash FROM public.ediel_messages WHERE id=${literal(f.original.id)}),
    'permissions',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]') FROM public.metering_permissions p WHERE company_id=${literal(f.companyId)}),
    'permissionSites',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]') FROM public.metering_permission_sites p WHERE company_id=${literal(f.companyId)}));`)
}
async function assertMissingField(f:Fixture,field:string,policy:NonNullable<Awaited<ReturnType<typeof resolveCanonicalRuntimeDecisionWithRegistry>>['policy']>) {
  const raw=omitField(f,field),wire=tokenizeEdifact(raw),descriptor=PRODAT_26A_FIELD_MATRIX.find(row=>row.fieldNumber===field)!
  const unh=wire.segments.findIndex(s=>s.tag==='UNH'),unt=wire.segments.findIndex(s=>s.tag==='UNT')
  expect(segmentComposite(wire.segments[unt],1,wire.una)[0],field+' unchanged envelope framing').toBe(String(unt-unh+1))
  expect(segmentComposite(wire.segments.find(s=>s.tag==='UNZ'),1,wire.una)[0]).toBe('1')
  if (field==='311') {
    const originalContext=await loadCustomerMasterdataValidationContext(f.original,f.actorUserId)
    expect(originalContext).toBeTruthy()
    const positive=preflightEdielPayload({rawPayload:f.original.raw_payload,mimeType:f.original.mime_type,messageStandard:'edifact',mode:'send',
      companyId:f.companyId,parsedPayload:f.original.parsed_payload,dateEventRow:f.original,customerMasterdataRow:f.original,
      customerMasterdataContext:originalContext,validationPurpose:'outbound_original'})
    expect(positive.blocking,JSON.stringify(positive.issues)).toBe(false)
    expect(segmentComposite(wire.segments.find(s=>s.tag==='UNB'),7,wire.una)[0]).toBe('')
  } else {
    // Use the actual current selected registry policy, retaining the genuine
    // producer's typed condition facts. No constructed field-rule/policy override.
    const issues=validateCanonicalPolicyFields({ policy,rawPayload:raw,rawSegments:wire.segments.map(s=>s.raw),una:wire.una })
    if (field==='229' || field==='252') {
      const qualifier=field==='229'?'UD':'IV'
      const parties=wire.segments.filter(s=>s.tag==='NAD' && segmentComposite(s,1,wire.una)[0]===qualifier)
      expect(parties,field+' retains its own party').toHaveLength(1)
      expect(segmentComposite(parties[0],5,wire.una),field+' omits the whole physical C059').toEqual([''])
      // These source-address comparison owners deliberately replace the generic
      // numeric missing-field diagnostic; retain their exact closed codes/paths.
      expect(issues,field+': '+JSON.stringify(issues)).toEqual(expect.arrayContaining([expect.objectContaining({
        scope:'prodat_dependent',severity:'error',blocking:true,
        ...(field==='229'
          ? {code:'PRODAT_END_USER_ADDRESS_VALUE_MISMATCH',fieldPath:'NAD+UD/C059/3042[1..3]'}
          : {code:'PRODAT_INVOICEE_VALUE_MISMATCH',fieldPath:'NAD+IV',description:'Z03:252, P26.A s.23/82/109: adressen avviker från vald källa'}),
      })]))
    } else {
      const diagnostic=issues.find(issue=>issue.severity==='error' && (field.endsWith('_GROUP')
        ? issue.fieldPath===descriptor.segmentPath : issue.prodatDiagnostic?.kind==='field' && issue.prodatDiagnostic.fieldNumber===field))
      expect(diagnostic,field+': '+JSON.stringify(issues)).toBeTruthy()
      if (!field.endsWith('_GROUP')) {
        expect(diagnostic!.prodatDiagnostic).toMatchObject({kind:'field',fieldNumber:field,
          errorKind:['207','208','209','227','233','250','262'].includes(field)?'invalid':'missing'})
      }
    }
  }
  const input=draft(f,raw),context=await sourceContext(f,raw),before=effects(f)
  if (field==='311') {
    // Keep the physical preflight and its exact owner diagnostic. The current
    // selected policy also observes UNB7 before any original witness is issued;
    // retained route metadata must not manufacture the missing physical value.
    const preflight=preflightEdielPayload({rawPayload:raw,mimeType:f.original.mime_type,messageStandard:'edifact',mode:'send',
      companyId:f.companyId,parsedPayload:input.parsedPayload,dateEventRow:f.original,
      customerMasterdataContext:context,customerMasterdataRow:masterdataRow(f,raw),validationPurpose:'outbound_original'})
    expect(preflight.blocking,JSON.stringify(preflight.issues)).toBe(true)
    expect(preflight.issues).toEqual(expect.arrayContaining([expect.objectContaining({
      code:'PROFILE_APPLICATION_REFERENCE_MISSING',severity:'error',segment:wire.segments.find(s=>s.tag==='UNB')!.raw,
    })]))
    expect(input.applicationReference).toBe(f.original.application_reference)
    const validation=await validateRulebookMessageWithRegistry({family:'PRODAT',code:'Z03',applicationReference:input.applicationReference,
      rawPayload:raw,mode:'send',roleCode:'DDQ',direction:'outbound',environment:'test',companyId:f.companyId,
      parsedPayload:input.parsedPayload,customerMasterdataContext:context,customerMasterdataRow:masterdataRow(f,raw),validationPurpose:'outbound_original',
      version:input.messageVersion,processGroup:input.processType})
    expect(validation.blocking).toBe(true)
    expect(validation.issues.filter(issue=>issue.severity==='error' || issue.blocking)).toEqual([
      expect.objectContaining({code:'FIELD_MATRIX_REQUIRED_FIELD_MISSING',fieldPath:'UNB/S005/0026',
        description:'UNB/S005/0026 krävs för PRODAT Z03.',
        prodatDiagnostic:expect.objectContaining({kind:'field',fieldNumber:'311',errorKind:'missing'})}),
    ])
    await expect(createCanonicalOutboundMessage({actorUserId:f.actorUserId,requestType:'supplier_switch',baseInput:input,customerMasterdataContext:context}))
      .rejects.toThrow('Outbound PRODAT Z03 blockerades av canonical Ediel-policy: FIELD_MATRIX_REQUIRED_FIELD_MISSING - UNB/S005/0026 krävs för PRODAT Z03.')
    expect(effects(f),field+' no durable/provider effects').toEqual(before)
    return
  }
  // UD omissions can be refused by the authentic source comparison before
  // registry field selection. The field-owner oracle above and this native public
  // persistence boundary intentionally assert different owners.
  const validation=await validateRulebookMessageWithRegistry({ family:'PRODAT',code:'Z03',applicationReference:'23-DDQ-PRODAT',
      rawPayload:raw,mode:'send',roleCode:'DDQ',direction:'outbound',environment:'test',companyId:f.companyId,
      parsedPayload:input.parsedPayload,customerMasterdataContext:context,customerMasterdataRow:masterdataRow(f,raw),validationPurpose:'outbound_original',
      version:input.messageVersion,processGroup:input.processType })
  expect(validation.blocking,field+': '+JSON.stringify(validation.issues)).toBe(true)
  const first=validation.issues.find(issue=>issue.severity==='error')!
  expect(first,field).toBeTruthy()
  await expect(createCanonicalOutboundMessage({actorUserId:f.actorUserId,requestType:'supplier_switch',baseInput:input,customerMasterdataContext:context}))
    .rejects.toThrow(`Outbound PRODAT Z03 blockerades av canonical Ediel-policy: ${first.code} - ${first.description}`)
  expect(effects(f),field+' no durable/provider effects').toEqual(before)
}

describe.each(['L','LK'] as const)('ordinary supplier Z03%s native proposals',variant=>{
  it('holds a genuine Z04 with unknown UTILTS declaration when own field 259 is omitted',async()=>{
    // Separate public fixture/source cohort for each national subtype; no private
    // seeded request or original/assessment token supplies incoming authority.
    const f=await originate(await stage(variant,days(today(),14),false,true))
    const configuration=configureOwnContrlReturn(f)
    await send(f); noActivation(f)
    const accepted=await readAcceptedEdielTransportProjection({companyId:f.companyId,environment:'test',actorUserId:f.actorUserId,messageId:f.original.id})
    expect(!!accepted&&accepted.status==='accepted_projection'&&accepted.companyId===f.companyId&&accepted.environment==='test'
      &&accepted.messageId===f.original.id&&accepted.originalHash===createHash('sha256').update(f.original.raw_payload!,'utf8').digest('hex')
      &&accepted.authorizesProviderEntry===false&&accepted.deliveryProven===false&&parseSourceReceiptInstant(accepted.observedAt)!==null&&parseSourceReceiptInstant(accepted.observedAt)===parseSourceReceiptInstant(f.original.message_sent_at)).toBe(true)
    const contrlAck=await physicalAck(f,'CONTRL'); noActivation(f)
    const aperakAck=await physicalAck(f,'APERAK'); noActivation(f)
    for(const [ack,finalAckReached,sourceAccepted] of [[contrlAck,false,false],[aperakAck,true,true]] as const) {
      const receipt=await readCommittedInboundAck({actorUserId:f.actorUserId,message:ack})
      expect(receipt!==null&&receipt.kind==='exact_receipt'&&receipt.sourceMessageId===f.original.id&&receipt.result.outcome==='positive'
        &&receipt.result.finalAckReached===finalAckReached&&receipt.result.sourceAccepted===sourceAccepted
        &&receipt.result.wholeSourceRejected===false&&receipt.result.failureReason===null
        &&receipt.result.sourceMessage.id===f.original.id&&receipt.result.sourceMessage.company_id===f.companyId
        &&receipt.result.sourceMessage.environment==='test'&&receipt.result.sourceMessage.direction==='outbound').toBe(true)
    }
    const acknowledged=await getEdielMessageById(f.original.id,{companyId:f.companyId})
    expect(acknowledged?.status==='acknowledged'&&acknowledged.contrl_status==='received'&&acknowledged.aperak_status==='received'&&acknowledged.failure_reason===null).toBe(true)
    noActivation(f)
    const raw=confirmation(f,body=>withOwnReadings(body,false),true)
    assertOwnReadingWire(f,raw,false)
    const source=await receive(f,raw)
    await assertOwnFieldReception(f,source)
    const before=business(f),history=originalHistory(f),providerCalls=smtp.mock.calls.length
    await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:source.id})
    const providerAfterZ04=smtp.mock.calls.length
    const reads=await Promise.allSettled([getEdielMessageById(source.id,{companyId:f.companyId})] as const)
    const fieldObservation=await readStoredOwnReadingFields(f,source,reads[0],'omitted_unknown')
    expect(providerAfterZ04).toBe(providerCalls)
    // Technical syntax construction is separate from REG/APP hold and effects.
    await assertOwnTechnicalContrl(f,source,configuration)
    assertOwnReadingOracle(fieldObservation)
    expect(smtp.mock.calls.length).toBe(providerCalls)
    expect(JSON.stringify(business(f))===JSON.stringify(before)).toBe(true)
    expect(JSON.stringify(originalHistory(f))===JSON.stringify(history)).toBe(true)
    expect(sql(`SELECT jsonb_build_object(
      'normalConfirmations',(SELECT count(*) FROM gridex_received_sources.normal_switch_confirmations WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(source.id)}),
      'partitions',(SELECT count(*) FROM gridex_received_sources.supply_object_partitions WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(source.id)}),
      'effectReceipts',(SELECT count(*) FROM gridex_received_sources.supply_object_effect_receipts WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(source.id)}),
      'transitions',(SELECT count(*) FROM gridex_received_sources.supply_source_transitions WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(source.id)}),
      'confirmedOrActivePeriods',(SELECT count(*) FROM public.customer_supply_periods WHERE company_id=${literal(f.companyId)} AND status IN('confirmed_by_grid_owner','active')));`))
      .toEqual({normalConfirmations:0,partitions:0,effectReceipts:0,transitions:0,confirmedOrActivePeriods:0})
    const returned=replies(f,source.id)
    expect(returned.map(message=>message.message_family)).toEqual(['CONTRL'])
    const stored=reads[0].status==='fulfilled'?reads[0].value:null
    const runtime=diagnosticRecord(stored?.validation_report?.canonicalRuntime)
    const responsePlan=runtime.responsePlan
    expect(Array.isArray(responsePlan)).toBe(true)
    expect(Array.isArray(responsePlan)&&responsePlan.every(value=>{
      const reply=diagnosticRecord(value)
      if(reply.family!=='APERAK')return true
      // A global positive proposal coexists with held own APP. Only returned
      // physical replies above prove that no positive APERAK was constructed.
      return !Array.isArray(reply.applicationErrors)||reply.applicationErrors.every(value=>{
        const error=diagnosticRecord(value)
        return !(['41','42'].includes(String(error.ercCode))&&ownReadingFields.includes(error.fieldCode as typeof ownReadingFields[number]))
      })
    })).toBe(true)
    noActivation(f)
  })

  it('queues the signed own original and keeps physical ACKs distinct from the causal business confirmation',async()=>{
    const staged=await stage(variant,days(today(),14),false,true)
    // Establish the caller facts before production; rendered absence is not
    // evidence that the invoicee condition is inactive or annual basis absent.
    const snapshot=sql<{ portalData: { dependentConditionFacts: { invoiceeObjects: ProdatInvoiceeObject[] }; [key:string]:unknown }; [key:string]:unknown }>(`SELECT to_jsonb(validation_snapshot) FROM public.supplier_switch_requests WHERE id=${literal(staged.switchId)} AND company_id=${literal(staged.companyId)};`)
    const selected=snapshot.portalData.dependentConditionFacts.invoiceeObjects
    expect(selected).toHaveLength(1)
    expect(selected[0]).toMatchObject({meteringPointId:staged.external,invoicee:{availability:'available'},event:{state:'none'},source:{kind:'caller_selection',companyId:staged.companyId}})
    expect(selected[0].endUser.identity).toEqual(staged.customerIdentity)
    expect(selected[0].invoicee.identity).toEqual(selected[0].endUser.identity)
    expect(selected[0].invoicee.address).toEqual(selected[0].endUser.address)
    for (const input of [snapshot,snapshot.portalData]) {
      expect(input.registers).toBeUndefined()
      expect(input.annualConsumption).toBeUndefined()
      expect(input.annualEnergyKwh).toBeUndefined()
    }
    expect(sql(`SELECT jsonb_build_object('point',(SELECT to_jsonb(p.estimated_annual_consumption_kwh) FROM public.metering_points p WHERE id=${literal(staged.pointId)} AND company_id=${literal(staged.companyId)}),'site',(SELECT to_jsonb(s.annual_consumption_kwh) FROM public.customer_sites s WHERE id=${literal(staged.siteId)} AND company_id=${literal(staged.companyId)}));`)).toEqual({point:null,site:null})
    const started=Date.now(),f=await originate(staged),finished=Date.now()

    const {originalEnvelope,contrlRouteId,contrlProfileId}=configureOwnContrlReturn(f)
    const original=f.original,wire=tokenizeEdifact(original.raw_payload!),history=originalHistory(f)
    expect(wire.segments.filter(s=>s.tag==='NAD'&&segmentComposite(s,1,wire.una)[0]==='IV')).toEqual([])
    expect(wire.segments.filter(s=>s.tag==='QTY'&&segmentComposite(s,1,wire.una)[0]==='31')).toEqual([])
    expect(EdifactEnvelopeCodec.decode(original.raw_payload!)).toMatchObject({ sender:f.sender,receiver:f.receiver,applicationReference:'23-DDQ-PRODAT',environment:'test',acknowledgementRequest:'1' })
    expect(wire.segments.find(s=>s.tag==='BGM')?.elements.slice(1,5)).toEqual(['Z03',original.external_reference,'9','AB'])
    const reason=wire.segments.findIndex(s=>s.tag==='CCI'&&segmentComposite(s,2,wire.una)[0]==='Z13')
    expect(segmentComposite(wire.segments[reason+1],1,wire.una)[0]).toBe(variant==='L'?'Z22':'Z23')
    expect(wire.segments.some(s=>s.tag==='DTM'&&segmentComposite(s,1,wire.una).join(':')===`92:${f.requestedStartDate.replaceAll('-','')}0000:203`)).toBe(true)
    expect(original).toMatchObject({ direction:'outbound',message_code:'Z03',requires_contrl:true,requires_aperak:true,contrl_status:'pending',aperak_status:'pending' })
    expect(Date.parse(original.ack_due_at!)).toBeGreaterThanOrEqual(started+30*60*1000)
    expect(Date.parse(original.ack_due_at!)).toBeLessThanOrEqual(finished+30*60*1000)
    expect(sql(`SELECT jsonb_build_object('binding',(SELECT count(*) FROM gridex_received_sources.switch_originals WHERE message_id=${literal(original.id)} AND company_id=${literal(f.companyId)} AND switch_id=${literal(f.switchId)} AND contract_id=${literal(f.contractId)}),
      'intent',(SELECT count(*) FROM public.ediel_message_intents WHERE id=${literal(original.intent_id)} AND company_id=${literal(f.companyId)}),
      'outbox',(SELECT count(*) FROM public.ediel_outbox WHERE ediel_message_id=${literal(original.id)} AND company_id=${literal(f.companyId)}),
      'switch',(SELECT count(*) FROM public.supplier_switch_requests WHERE id=${literal(f.switchId)} AND company_id=${literal(f.companyId)} AND customer_id=${literal(f.customerId)} AND customer_contract_id=${literal(f.contractId)} AND outbound_z03_message_id=${literal(original.id)} AND rff_li_reference=${literal(f.li)}))`)).toEqual({ binding:1,intent:1,outbox:1,switch:1 })
    noActivation(f)
    const queued=effects(f),replay=await prepareAndQueueEdielZ03({actorUserId:f.actorUserId,switchRequestId:f.switchId,communicationRouteId:f.routeId,environment:'test'})
    expect(replay.id).toBe(original.id); expect(effects(f)).toEqual(queued)
    await send(f); noActivation(f)
    const accepted=await readAcceptedEdielTransportProjection({companyId:f.companyId,environment:'test',actorUserId:f.actorUserId,messageId:original.id})
    expect(accepted).toMatchObject({status:'accepted_projection',companyId:f.companyId,environment:'test',messageId:original.id,
      lane:'generic_journal',originalHash:createHash('sha256').update(original.raw_payload!,'utf8').digest('hex'),businessExpectationPlan:null,authorizesProviderEntry:false,deliveryProven:false})
    const observation=Date.parse(accepted!.observedAt)
    expect(Number.isFinite(observation)).toBe(true)
    expect(Date.parse(f.original.message_sent_at!)).toBe(observation)
    expect(Date.parse(f.original.ack_due_at!)).toBe(observation+30*60*1000)
    expect(Date.parse(f.original.contrl_due_at!)).toBe(observation+30*60*1000)
    const frozen=sql<{plan:Record<string,unknown>;policy:Record<string,unknown>}>(`SELECT jsonb_build_object('plan',binding->'technicalExpectationPlan',
      'policy',jsonb_build_object('guideRevision',binding#>'{admissionDecision,guide,guideRevision}','referenceDate',binding#>'{admissionDecision,referenceDate}',
        'profileKey',binding#>'{admissionDecision,profileKey}','sourceTrace',binding#>'{admissionDecision,sourceTrace}'))
      FROM gridex_ediel_transport.attempts WHERE id=${literal(accepted!.attemptId)} AND company_id=${literal(f.companyId)} AND environment='test' AND message_id=${literal(original.id)} AND classification='accepted' AND observed_at=${literal(accepted!.observedAt)}::timestamptz;`)
    expect(frozen.plan).toEqual({version:1,ruleId:'TM-CONTRL',offset:30,unit:'minutes',anchor:'actual_accepted_smtp_observed_at',timerKind:'internal_sender_watch',remoteReceiptKnown:false,policy:frozen.policy})
    expect(frozen.policy).toMatchObject({guideRevision:expect.any(String),referenceDate:expect.any(String),profileKey:expect.any(String),sourceTrace:expect.any(Array)})
    expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_business_expectations WHERE company_id=${literal(f.companyId)} AND environment='test' AND source_message_id=${literal(original.id)};`)).toBe(0)
    const contrlAck=await physicalAck(f,'CONTRL'); noActivation(f)
    const aperakAck=await physicalAck(f,'APERAK'); noActivation(f)
    expect(await getEdielMessageById(original.id)).toMatchObject({contrl_status:'received',aperak_status:'received'})
    // Each immutable receipt retains its own apply-time summary. Reading both
    // after APERAK must not turn the earlier CONTRL into a final acceptance.
    for (const [ack,finalAckReached,sourceAccepted] of [[contrlAck,false,false],[aperakAck,true,true]] as const) {
      expect(await readCommittedInboundAck({actorUserId:f.actorUserId,message:ack})).toMatchObject({
        kind:'exact_receipt',sourceMessageId:original.id,result:{outcome:'positive',finalAckReached,
          sourceAccepted,wholeSourceRejected:false,failureReason:null,
          sourceMessage:{id:original.id,company_id:f.companyId,environment:'test',direction:'outbound'}},
      })
    }
    // Acknowledged original means both ACKs arrived; only the later causal Z04
    // may confirm a supply period or accept the supplier switch.
    expect(await getEdielMessageById(original.id)).toMatchObject({status:'acknowledged',failure_reason:null})
    noActivation(f)
    const positiveRaw=confirmation(f,body=>withOwnReadings(body,true),true)
    assertOwnReadingWire(f,positiveRaw,true)
    const source=await receive(f,positiveRaw),decision=await resolveCanonicalRuntimeDecisionWithRegistry(source,{actorUserId:f.actorUserId})
    await assertOwnFieldReception(f,source)
    const providerBeforeZ04=smtp.mock.calls.length
    expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision],JSON.stringify(decision.issues)).toEqual(['accepted','accepted','accepted'])
    await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:source.id})
    const providerAfterZ04=smtp.mock.calls.length
    const diagnosticReads=await Promise.allSettled([
      getEdielMessageById(source.id,{companyId:f.companyId}),listEdielMessageEvents(source.id,f.companyId),
    ] as const)
    const diagnostic=projectZ04Diagnostic(f,source,diagnosticReads)
    const fieldObservation=await readStoredOwnReadingFields(f,source,diagnosticReads[0],'declared_true')
    expect(providerAfterZ04).toBe(providerBeforeZ04)

    // Construction is independent of APP acceptance and provider delivery.
    // Observe only the ordinary processor's own returned technical original.
    const technicalReplies=replies(f,source.id).filter(message=>message.message_family==='CONTRL')
    expect(technicalReplies.length).toBe(1)
    const technicalReply=(await getEdielMessageById(technicalReplies[0].id,{companyId:f.companyId}))!
    expect(technicalReply).toBeTruthy()
    expect(technicalReply.status).toBe('draft')
    expect({id:technicalReply.id,company:technicalReply.company_id,environment:technicalReply.environment,
      direction:technicalReply.direction,standard:technicalReply.message_standard,family:technicalReply.message_family,
      code:technicalReply.message_code,source:technicalReply.related_message_id,route:technicalReply.communication_route_id,
      profile:technicalReply.route_profile_id}).toEqual({id:technicalReplies[0].id,company:f.companyId,environment:'test',
      direction:'outbound',standard:'edifact',family:'CONTRL',code:'CONTRL',source:source.id,route:contrlRouteId,profile:contrlProfileId})
    expect(sql(`SELECT to_jsonb(immutable_payload_hash) FROM public.ediel_messages
      WHERE id=${literal(technicalReply.id)} AND company_id=${literal(f.companyId)} AND environment='test';`))
      .toBe(createHash('sha256').update(technicalReply.raw_payload!,'utf8').digest('hex'))
    // Queue state belongs to the actual outbox, not the draft message status.
    expect(sql(`SELECT coalesce(jsonb_agg(jsonb_build_object('company',company_id,'message',ediel_message_id,
      'source',source_message_id,'environment',environment,'status',status,'profile',route_profile_id) ORDER BY id),'[]'::jsonb)
      FROM public.ediel_outbox WHERE company_id=${literal(f.companyId)} AND ediel_message_id=${literal(technicalReply.id)};`))
      .toEqual([{company:f.companyId,message:technicalReply.id,source:source.id,environment:'test',status:'queued',profile:contrlProfileId}])
    const receivedOriginal=(await getEdielMessageById(source.id,{companyId:f.companyId}))!
    expect({id:receivedOriginal.id,company:receivedOriginal.company_id,environment:receivedOriginal.environment,
      direction:receivedOriginal.direction}).toEqual({id:source.id,company:f.companyId,environment:'test',direction:'inbound'})
    expect(createHash('sha256').update(receivedOriginal.raw_payload!,'utf8').digest('hex'))
      .toBe(createHash('sha256').update(source.raw_payload!,'utf8').digest('hex'))
    const receivedEnvelope=EdifactEnvelopeCodec.decode(receivedOriginal.raw_payload!),replyEnvelope=EdifactEnvelopeCodec.decode(technicalReply.raw_payload!)
    expect({sender:replyEnvelope.sender,senderQualifier:replyEnvelope.senderQualifier,senderSubAddress:replyEnvelope.senderSubAddress,
      receiver:replyEnvelope.receiver,receiverQualifier:replyEnvelope.receiverQualifier,receiverSubAddress:replyEnvelope.receiverSubAddress,
      applicationReference:replyEnvelope.applicationReference,environment:replyEnvelope.environment,testIndicator:replyEnvelope.testIndicator})
      .toEqual({sender:receivedEnvelope.receiver,senderQualifier:receivedEnvelope.receiverQualifier,
      senderSubAddress:receivedEnvelope.receiverSubAddress,receiver:receivedEnvelope.sender,receiverQualifier:receivedEnvelope.senderQualifier,
      receiverSubAddress:receivedEnvelope.senderSubAddress,applicationReference:receivedEnvelope.applicationReference,
      environment:'test',testIndicator:receivedEnvelope.testIndicator})
    expect({sender:receivedEnvelope.sender,senderQualifier:receivedEnvelope.senderQualifier,senderSubAddress:receivedEnvelope.senderSubAddress,
      receiver:receivedEnvelope.receiver,receiverQualifier:receivedEnvelope.receiverQualifier,receiverSubAddress:receivedEnvelope.receiverSubAddress,
      applicationReference:receivedEnvelope.applicationReference}).toEqual({sender:originalEnvelope.receiver,senderQualifier:originalEnvelope.receiverQualifier,
      senderSubAddress:originalEnvelope.receiverSubAddress,receiver:originalEnvelope.sender,receiverQualifier:originalEnvelope.senderQualifier,
      receiverSubAddress:originalEnvelope.senderSubAddress,applicationReference:originalEnvelope.applicationReference})
    const uci=replyEnvelope.segments.filter(segment=>segment.tag==='UCI'),sourceUnb=receivedEnvelope.segments.find(segment=>segment.tag==='UNB')
    expect(uci).toHaveLength(1)
    expect(sourceUnb).toBeTruthy()
    expect(segmentComposite(uci[0],1,replyEnvelope.una)).toEqual([receivedEnvelope.interchangeReference!.slice(0,14)])
    expect(segmentComposite(uci[0],2,replyEnvelope.una)).toEqual(segmentComposite(sourceUnb!,2,receivedEnvelope.una))
    expect(segmentComposite(uci[0],3,replyEnvelope.una)).toEqual(segmentComposite(sourceUnb!,3,receivedEnvelope.una))
    expect(segmentComposite(uci[0],4,replyEnvelope.una)).toEqual(['1'])
    assertOwnReadingOracle(fieldObservation)
    expect(sql(`SELECT jsonb_build_object('switch',(SELECT jsonb_build_object('status',status,'original',outbound_z03_message_id,'source',inbound_z04_message_id,'li',rff_li_reference) FROM public.supplier_switch_requests WHERE id=${literal(f.switchId)}),
      'periods',(SELECT count(*) FROM public.customer_supply_periods WHERE company_id=${literal(f.companyId)} AND customer_id=${literal(f.customerId)} AND metering_point_id=${literal(f.pointId)} AND source_message_id=${literal(source.id)} AND status='confirmed_by_grid_owner'),
      'active',(SELECT count(*) FROM public.customer_supply_periods WHERE company_id=${literal(f.companyId)} AND status='active'),
      'proof',(SELECT count(*) FROM gridex_received_sources.normal_switch_confirmations WHERE company_id=${literal(f.companyId)} AND switch_id=${literal(f.switchId)} AND original_message_id=${literal(original.id)} AND source_message_id=${literal(source.id)}))`),JSON.stringify(diagnostic))
      .toEqual({switch:{status:'accepted',original:original.id,source:source.id,li:f.li},periods:1,active:0,proof:1})
    expect(originalHistory(f)).toEqual(history)
    const returned=replies(f,source.id)
    expect(returned.map(m=>m.message_family).sort()).toEqual(['APERAK','CONTRL'])
    expect(returned.find(m=>m.message_family==='APERAK')!.raw_payload).toContain('ERC+100')
    for (const reply of returned) {
      await sendEdielMessageViaSmtp(reply,{actorUserId:f.actorUserId,smtpMimeMode:'nodemailer-attachment'})
      expect(await getEdielMessageById(reply.id)).toMatchObject({status:'sent',related_message_id:source.id})
      expect(sql(`SELECT to_jsonb(gridex_received_sources.sent_source_is_current_v1(m)) FROM public.ediel_messages m WHERE id=${literal(reply.id)}`)).toBe(true)
    }
    const confirmed=effects(f),replyIds=replies(f,source.id).map(m=>m.id),providerCalls=smtp.mock.calls.length
    const ackMessages=await listBusinessAckMessagesForSource({companyId:f.companyId,sourceMessageId:source.id,actorUserId:f.actorUserId,environment:'test'})
    const inboundCases=()=>sql<Array<{id:string;company_id:string;ediel_message_id:string}>>(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'company_id',c.company_id,'ediel_message_id',c.ediel_message_id) ORDER BY c.id),'[]') FROM public.ediel_inbound_cases c WHERE c.company_id=${literal(f.companyId)} AND c.ediel_message_id=${literal(source.id)};`)
    const baselineCases=inboundCases()
    expect(baselineCases).toHaveLength(1)
    expect(baselineCases[0]).toEqual({id:expect.stringMatching(/^[0-9a-f-]{36}$/),company_id:f.companyId,ediel_message_id:source.id})
    const replayStartedAt=Date.now()
    await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:source.id})
    const replayFinishedAt=Date.now()
    expect(inboundCases()).toEqual(baselineCases)
    expect(preserveZ04ValidationAudit(f,source,confirmed,effects(f),{startedAt:replayStartedAt,finishedAt:replayFinishedAt,
      ackMessages,inboundCaseId:baselineCases[0].id})).toEqual(confirmed); expect(replies(f,source.id).map(m=>m.id)).toEqual(replyIds)
    expect(smtp.mock.calls.length).toBe(providerCalls); expect(originalHistory(f)).toEqual(history)
  })

  it('refuses each of the 23 required fields and the UD parent before public persistence',async()=>{
    const f=await seed(variant),policy=await registryProfile(f)
    expect(policy.fieldRules.filter(rule=>'requirement' in rule && rule.requirement==='required').map(rule=>'fieldNumber' in rule?rule.fieldNumber:null)).toEqual(expect.arrayContaining([...required]))
    for (const field of [...required,'END_USER_GROUP']) await assertMissingField(f,field,policy)
  })

  it('qualifies active IV and selected IT/address facts through the ordinary producer, then refuses each applicable D omission',async()=>{
    const f=await seed(variant,true),wire=tokenizeEdifact(f.original.raw_payload!),policy=await registryProfile(f)
    expect(wire.segments.filter(s=>s.tag==='NAD'&&segmentComposite(s,1,wire.una)[0]==='IV')).toHaveLength(1)
    expect(wire.segments.filter(s=>s.tag==='NAD'&&segmentComposite(s,1,wire.una)[0]==='IT')).toHaveLength(1)
    expect(validateCanonicalPolicyFields({policy,rawPayload:f.original.raw_payload!,rawSegments:wire.segments.map(s=>s.raw),una:wire.una}).filter(issue=>issue.severity==='error')).toEqual([])
    for (const field of conditional) await assertMissingField(f,field,policy)
    noActivation(f)
  })

  for (const contrast of ['line reference','object','grid area','start date','opposite subtype'] as const) {
    it(`refuses a counted received Z04 with wrong ${contrast}`,async()=>{
      const f=await seed(variant); await send(f)
      const other=contrast==='object'?await seed(variant):null
      const raw=confirmation(f,body=>withOwnReadings(body.map(segment=>{
        if (contrast==='line reference'&&segment.startsWith('RFF+LI:')) {
          const wrongLineReference=randomUUID().replaceAll('-','')
          expect(wrongLineReference).not.toBe(f.li)
          return 'RFF+LI:'+wrongLineReference
        }
        if (contrast==='object') return segment.replaceAll(f.external,other!.external)
        if (contrast==='grid area'&&segment.startsWith('RFF+Z05:')) return 'RFF+Z05:OTHER'
        if (contrast==='start date'&&segment.startsWith('DTM+92:')) return `DTM+92:${days(f.requestedStartDate,1).replaceAll('-','')}0000:203`
        if (contrast==='opposite subtype'&&segment.startsWith('CAV+'+(variant==='L'?'Z22':'Z23'))) return 'CAV+'+(variant==='L'?'Z23':'Z22')
        return segment
      }),true))
      const source=await receive(f,raw),before=business(f),history=originalHistory(f),otherBefore=other?business(other):null
      const supplyObservation=observeOriginalNegativeSupply(f,source)
      try {
        await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:source.id})
      } finally { supplyObservation.stop() }
      const negativeDiagnosticReads=await Promise.allSettled([
        getEdielMessageById(source.id,{companyId:f.companyId}),
        listEdielMessageEvents(source.id,f.companyId),
      ] as const)
      console.info('native_original_negative_gate',JSON.stringify({variant,contrast,diagnostic:projectZ04Diagnostic(f,source,negativeDiagnosticReads)}))
      expect(business(f)).toEqual(before); expect(originalHistory(f)).toEqual(history); noPositiveAperak(f,source.id)
      if (other) expect(business(other)).toEqual(otherBefore)
      noActivation(f)
      assertOriginalNegativeSupplyCause(f,source,contrast,other,supplyObservation.observation)
    })
  }

  it('refuses a genuine other grid party using the same own LI and object',async()=>{
    const f=await seed(variant),other=await seed(variant); await send(f)
    const source=await receive(f,confirmation(f,body=>withOwnReadings(body,true)).replaceAll(f.receiver,other.receiver))
    const before=business(f),otherBefore=business(other),history=originalHistory(f)
    const supplyObservation=observeOriginalNegativeSupply(f,source)
    try {
      await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:source.id})
    } finally { supplyObservation.stop() }
    const negativeDiagnosticReads=await Promise.allSettled([
      getEdielMessageById(source.id,{companyId:f.companyId}),
      listEdielMessageEvents(source.id,f.companyId),
    ] as const)
    console.info('native_original_negative_gate',JSON.stringify({variant,contrast:'other grid party',diagnostic:projectZ04Diagnostic(f,source,negativeDiagnosticReads)}))
    expect(business(f)).toEqual(before); expect(business(other)).toEqual(otherBefore)
    expect(originalHistory(f)).toEqual(history); noPositiveAperak(f,source.id); noActivation(f)
    assertOriginalNegativeSupplyCause(f,source,'other grid party',other,supplyObservation.observation)
  })

  it('rejects wrong direction, foreign actor and disabled environment at the actual public outbound boundary',async()=>{
    const f=await seed(variant),other=await seed(variant),context=await sourceContext(f,f.original.raw_payload!),before=effects(f),otherBefore=effects(other)
    await expect(createCanonicalOutboundMessage({actorUserId:f.actorUserId,requestType:'supplier_switch',baseInput:{...draft(f),direction:'inbound'},customerMasterdataContext:context}))
      .rejects.toThrow('canonical_outbound_owner_scope_required')
    await expect(createCanonicalOutboundMessage({actorUserId:other.actorUserId,requestType:'supplier_switch',baseInput:draft(f),customerMasterdataContext:context}))
      .rejects.toMatchObject({disposition:{kind:'security_quarantine',code:'EDIEL_TENANT_ACTOR_FORBIDDEN'},message:'ediel_tenant_actor_forbidden'})
    await expect(createCanonicalOutboundMessage({actorUserId:f.actorUserId,requestType:'supplier_switch',baseInput:{...draft(f),environment:'production'},customerMasterdataContext:context}))
      .rejects.toThrow(`tenant_ediel_profile_not_enabled:${f.companyId}:production`)
    expect(effects(f)).toEqual(before); expect(effects(other)).toEqual(otherBefore)
  })

  it('refuses a formerly qualified supplier after real current-role expiry without persistence',async()=>{
    const f=await seed(variant),context=await sourceContext(f,f.original.raw_payload!)
    expect(sql(`WITH changed AS(UPDATE public.tenant_actor_roles SET valid_to=clock_timestamp() WHERE company_id=${literal(f.companyId)} AND environment='test' AND actor_id=${literal(f.actorUserId)} AND role_code='electricity_supplier' RETURNING id) SELECT to_jsonb(count(*)) FROM changed`)).toBe(1)
    const before=effects(f)
    await expect(createCanonicalOutboundMessage({actorUserId:f.actorUserId,requestType:'supplier_switch',baseInput:draft(f),customerMasterdataContext:context}))
      .rejects.toThrow(`tenant_market_roles_missing:${f.companyId}:test`)
    expect(effects(f)).toEqual(before)
  })

  it('rejects source raw/direction mutation through installed immutable-original guards',async()=>{
    const f=await seed(variant),before=effects(f)
    for (const attempt of [
      {update:{raw_payload:f.original.raw_payload!+' '},error:{code:'23514',message:'immutable_ediel_payload_cannot_change'}},
      {update:{direction:'inbound'},error:{code:'P0001',message:'switch_original_bound_message_immutable'}},
    ]) {
      const result=await supabaseService.from('ediel_messages').update(attempt.update).eq('company_id',f.companyId).eq('id',f.original.id)
      expect(result.error).toMatchObject(attempt.error)
      expect(effects(f)).toEqual(before)
    }
  })

  for (const boundary of ['latest lawful','one day late','fourteen months','one day too early'] as const) {
    it(`uses the actual public dispatch owner at the real ${boundary} calendar boundary`,async()=>{
      const calendar=today(),latest=days(calendar,variant==='L'?14:0),upper=months(calendar,14)
      const date=boundary==='latest lawful'?latest:boundary==='one day late'?days(latest,-1):boundary==='fourteen months'?upper:days(upper,1)
      const expected=boundary==='one day late'?'expired':boundary==='one day too early'?'too_early':'open'
      const f=await stage(variant,date)
      if (expected==='open') await materializeWindowRoute(f)
      const before=business(f)
      expect(today(),'no boundary crossed while constructing this prospective agreement').toBe(calendar)
      const schedule=await evaluateSupplierSwitchSchedule({ switchRequestId:f.switchId,companyId:f.companyId,requestedStartDate:date,
        transactionSubtype:variant,requestType:variant==='L'?'supplier_switch':'move_in',siteId:f.siteId,meteringPointId:f.pointId })
      expect(schedule.window).toMatchObject({reason:expected,windowOpen:expected==='open',transactionSubtype:variant})
      const result=await ensureInitialSwitchEdielAutomation({actorUserId:f.actorUserId,switchRequestId:f.switchId,communicationRouteId:f.routeId,environment:'test'})
      if (expected==='open') {
        expect(result.blocked,JSON.stringify(result)).not.toBe(true); expect(result.message).toBeTruthy()
        expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.switch_originals WHERE company_id=${literal(f.companyId)} AND switch_id=${literal(f.switchId)}`)).toBe(1)
      } else {
        expect(result).toMatchObject({blocked:true,message:null,outboundRequestId:null,blockers:expect.arrayContaining([expect.objectContaining({code:'supplier_switch_send_window_'+expected})])})
        expect(sql(`SELECT jsonb_build_object('messages',(SELECT count(*) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)}),
          'originals',(SELECT count(*) FROM gridex_received_sources.switch_originals WHERE company_id=${literal(f.companyId)}),
          'periods',(SELECT count(*) FROM public.customer_supply_periods WHERE company_id=${literal(f.companyId)}))`)).toEqual({messages:0,originals:0,periods:0})
        // The dispatch owner is allowed to record readiness/blocker diagnostics.
        const after=business(f) as Record<string,unknown>,initial=before as Record<string,unknown>
        for (const key of ['periods','contracts','sites','points','permissions','permissionSites','actorPermissions','confirmations','transitions']) expect(after[key],key).toEqual(initial[key])
      }
      expect(smtp).not.toHaveBeenCalled(); noActivation(f)
    })
  }
})
