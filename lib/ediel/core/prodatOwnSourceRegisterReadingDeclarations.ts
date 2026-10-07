import {isDeepStrictEqual} from 'node:util'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {getEdielMessageById} from '@/lib/ediel/db'
import {supabaseService} from '@/lib/supabase/service'
import {assertEdielTenantActor} from '@/lib/ediel/services/authorization'
import {requireEdielInboundLegalContext} from '@/lib/ediel/tenant/sourceLegalContext'
import {readInboundReceptionRequest} from '@/lib/ediel/inbound/receptions'
import {evidenceHash,isEvidenceRecord,isEvidenceUuid} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {parseSourceReceiptInstant} from '@/lib/ediel/utilts/receivedSourceInventory'
import {prodatRegisterGroups} from '@/lib/ediel/prodat/prodatRegisterGroups'
import {prodatRegisterReadingMarket,prodatRegisterReadingState,prodatRegisterReadingSubtype} from '@/lib/ediel/prodat/prodatRegisterReadings'
import {resolveCanonicalEdielPolicy,type CanonicalEdielPolicy,type ProdatDependentConditionFacts} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import {stockholmBusinessDate} from './executionContext'
import {parseCanonicalMessageRow} from './canonicalMessage'
import {segmentComposite,tokenizeEdifact} from './edifactTokenizer'
import {validateEdifactSyntax} from './syntaxValidator'

declare const ownReadingBrand:unique symbol
/** Private READ provenance for a physical declaration, never APP or business authority. */
export type ProdatOwnSourceReadingContext=Readonly<{[ownReadingBrand]:true}>
type ReadingObjects=ProdatDependentConditionFacts['registerObjects']
type SourceRead={identity:string;actor:string;source:EdielMessageRow;sourceEdition:string;projection:Record<string,unknown>}
const reads=new WeakMap<ProdatOwnSourceReadingContext,SourceRead>()
const bornKeys=['version','contextOrigin','sourceMessageId','companyId','environment','messageCode','payloadHash','sourceReceivedAt','capturedAt']

function sourceIdentity(source:EdielMessageRow):string|null {
  if(!isEvidenceUuid(source.id)||!isEvidenceUuid(source.company_id)||!isEvidenceUuid(source.inbound_email_message_id)
    ||!['test','production'].includes(source.environment)||source.direction!=='inbound'
    ||source.message_standard!=='edifact'||source.message_family!=='PRODAT'||source.message_code!=='Z04'
    ||typeof source.raw_payload!=='string'||Buffer.byteLength(source.raw_payload,'utf8')>262144
    ||!isEvidenceRecord(source.execution_context_snapshot))return null
  const born=source.execution_context_snapshot.receivedProdatContext
  const received=parseSourceReceiptInstant(source.message_received_at),created=parseSourceReceiptInstant(source.created_at)
  if(!isEvidenceRecord(born)||Object.keys(born).length!==bornKeys.length||!bornKeys.every(key=>Object.hasOwn(born,key))
    ||born.version!==1||born.contextOrigin!=='database_insert'||born.sourceMessageId!==source.id
    ||born.companyId!==source.company_id||born.environment!==source.environment||born.messageCode!=='Z04'
    ||born.payloadHash!==evidenceHash(source.raw_payload)||received===null||created===null||created<received
    ||parseSourceReceiptInstant(born.sourceReceivedAt)!==received)return null
  const captured=parseSourceReceiptInstant(born.capturedAt)
  if(captured===null||captured<received)return null
  return evidenceHash(JSON.stringify([source.id,source.company_id,source.environment,source.direction,
    source.message_standard,source.message_family,source.message_code,source.message_version,source.application_reference,
    source.inbound_email_message_id,source.raw_payload,received.toString(),created.toString(),captured.toString()]))
}

function physicalSource(source:EdielMessageRow) {
  if(!validateEdifactSyntax({...source,status:'received',syntax_check_status:'not_checked',validation_report:{},failure_reason:null}).ok)return null
  const wire=tokenizeEdifact(source.raw_payload!),headers=wire.segments.filter(row=>row.tag==='UNH')
  const interchanges=wire.segments.filter(row=>row.tag==='UNB'),documents=wire.segments.filter(row=>row.tag==='BGM')
  if(headers.length!==1||interchanges.length!==1||documents.length!==1)return null
  const identity=segmentComposite(headers[0],2,wire.una),application=segmentComposite(interchanges[0],7,wire.una)
  if(identity.slice(0,5).join(':')!=='PRODAT:D:97A:UN:E2SE6A'||identity.slice(5).some(value=>value!=='')
    ||application.length!==1||application[0]!=='23-DDQ-PRODAT'||segmentComposite(documents[0],1,wire.una)[0]!=='Z04'
    ||prodatRegisterReadingMarket(wire.segments,wire.una)!=='electricity'
    ||source.environment!==(segmentComposite(interchanges[0],11,wire.una)[0]==='1'?'test':'production'))return null
  const grouped=prodatRegisterGroups(wire.segments,wire.una,'Z04')
  const first=grouped.groups.filter(group=>group.firstLineIndex===group.lineIndex)
  if(!first.length||grouped.groups.some(group=>group.messageIndex!==0||!group.validRegisterChain)
    ||first.some(group=>!group.itemId||!['9','89'].includes(group.identityAgency??'')))return null
  const reasons=first.map(group=>prodatRegisterReadingSubtype('Z04',group.segments,wire.una))
  if(!reasons.every(reason=>reason==='L'||reason==='LK')||new Set(reasons).size!==1)return null
  const subtype=reasons[0] as 'L'|'LK'
  const canonical=parseCanonicalMessageRow(source)
  if(canonical.family!=='PRODAT'||canonical.messageCode!=='Z04'||canonical.subtype!==subtype
    ||canonical.applicationReference!==application[0]||canonical.version!=='E2SE6A')return null
  return {wire,first,groups:grouped.groups,subtype,canonical,interchange:interchanges[0]}
}

/** Actual scoped source/legal/reception READs; no rule-pack capture or source writes. */
export async function loadProdatOwnSourceReadingContext(source:EdielMessageRow,actorUserId:string):Promise<ProdatOwnSourceReadingContext|null> {
  const identity=sourceIdentity(source)
  if(!identity||!isEvidenceUuid(actorUserId)||!physicalSource(source))return null
  await assertEdielTenantActor({companyId:source.company_id!,actorUserId,permission:'communication.read'})
  await assertEdielTenantActor({companyId:source.company_id!,actorUserId,permission:'metering.write'})
  const stored=await getEdielMessageById(source.id,{companyId:source.company_id})
  if(!stored||sourceIdentity(stored)!==identity)return null
  const physical=physicalSource(stored)
  if(!physical)return null
  const legal=await requireEdielInboundLegalContext(stored.company_id!,stored.id)
  const basis=legal as unknown as Record<string,unknown>,projection=basis.canonicalProjection
  const receivers=physical.wire.segments.filter(row=>row.tag==='NAD'&&segmentComposite(row,1,physical.wire.una)[0]==='DO')
  const received=parseSourceReceiptInstant(stored.message_received_at),observed=parseSourceReceiptInstant(legal.observedAt)
  if(legal.basisKind!=='observed_source_persistence'||legal.companyId!==stored.company_id||legal.direction!=='inbound'
    ||legal.environment!==stored.environment||basis.family!=='PRODAT'||basis.code!=='Z04'||basis.subtype!==physical.subtype
    ||!isEvidenceUuid(legal.legalActorId)||!isEvidenceUuid(legal.transportActorId)||legal.actorRole!=='electricity_supplier'
    ||receivers.length!==1||legal.legalEdielId!==segmentComposite(receivers[0],2,physical.wire.una)[0]
    ||legal.transportEdielId!==segmentComposite(physical.interchange,3,physical.wire.una)[0]
    ||legal.applicationReference!==physical.canonical.applicationReference||received===null||observed===null||observed<received
    ||parseSourceReceiptInstant(legal.sourceReceivedAt)!==received||typeof basis.sourceEdition!=='string'
    ||!/^[a-f0-9]{64}$/.test(basis.sourceEdition)||!isEvidenceRecord(projection)
    ||projection.family!=='PRODAT'||projection.code!=='Z04'||projection.subtype!==physical.subtype
    ||projection.transactionReasonCode!==(physical.subtype==='L'?'Z22':'Z23')
    ||!['inbound','both'].includes(String(projection.direction))
    ||!Array.isArray(projection.applicationReferences)||!projection.applicationReferences.includes(legal.applicationReference)
    ||!Array.isArray(projection.receiverRoles)||!projection.receiverRoles.some(role=>role==='supplier'||role==='electricity_supplier'))return null
  const reception=await readInboundReceptionRequest({companyId:stored.company_id!,messageId:stored.id,
    inboundEmailMessageId:stored.inbound_email_message_id!,actorUserId})
  if(!reception||reception.classification!=='first_reception'||reception.status!=='observed'
    ||!isEvidenceUuid(reception.receptionId)||!isEvidenceUuid(reception.parseResultId)
    ||reception.businessEffectAuthorized!==false||reception.responseRequestId!==null||reception.reason!==null
    ||reception.canonicalPayloadHash!==evidenceHash(stored.raw_payload!)||reception.receivedPayloadHash!==reception.canonicalPayloadHash
    ||parseSourceReceiptInstant(reception.receivedAt)!==received)return null
  const [mail,parsed]=await Promise.all([
    supabaseService.from('inbound_email_messages').select('id,company_id,environment,received_at,raw_edifact_payload')
      .eq('id',stored.inbound_email_message_id!).eq('company_id',stored.company_id!).eq('environment',stored.environment).maybeSingle(),
    supabaseService.from('inbound_ediel_parse_results').select('id,company_id,inbound_email_message_id,raw_payload,parse_status')
      .eq('id',reception.parseResultId).eq('company_id',stored.company_id!).maybeSingle(),
  ])
  if(mail.error)throw mail.error
  if(parsed.error)throw parsed.error
  if(!mail.data||mail.data.id!==stored.inbound_email_message_id||mail.data.company_id!==stored.company_id
    ||mail.data.environment!==stored.environment||mail.data.raw_edifact_payload!==stored.raw_payload
    ||parseSourceReceiptInstant(mail.data.received_at)!==received||!parsed.data||parsed.data.id!==reception.parseResultId
    ||parsed.data.company_id!==stored.company_id||parsed.data.inbound_email_message_id!==stored.inbound_email_message_id
    ||parsed.data.raw_payload!==stored.raw_payload||parsed.data.parse_status!=='parsed')return null
  // Current membership/permission errors remain security errors, never UNKNOWN success.
  await assertEdielTenantActor({companyId:stored.company_id!,actorUserId,permission:'communication.read'})
  await assertEdielTenantActor({companyId:stored.company_id!,actorUserId,permission:'metering.write'})
  const token=Object.freeze({}) as ProdatOwnSourceReadingContext
  reads.set(token,{identity,actor:actorUserId,source:structuredClone(stored),sourceEdition:basis.sourceEdition,
    projection:structuredClone(projection)})
  return token
}

/** One invocation's declaration, consumed at the internally selected compiled policy. */
export function sourceProdatOwnRegisterReadingDeclarations(input:{
  message:EdielMessageRow;actorUserId?:string;context?:ProdatOwnSourceReadingContext|null;policy:CanonicalEdielPolicy;admissionAt?:string|Date
}):ReadingObjects|null {
  // Behavioral RED boundary: the real issuer is implemented; the declaration
  // consumer is added only after its actual-source policy tests demonstrate it.
  void input
  return null
}
