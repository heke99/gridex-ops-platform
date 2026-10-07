import type {EdielMessageRow} from '@/lib/ediel/types'
import type {CanonicalEdielPolicy,ProdatDependentConditionFacts} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import {prodatRegisterGroups} from '@/lib/ediel/prodat/prodatRegisterGroups'
import {prodatRegisterReadingMarket,prodatRegisterReadingState,prodatRegisterReadingSubtype} from '@/lib/ediel/prodat/prodatRegisterReadings'
import {parseSourceReceiptInstant} from '@/lib/ediel/utilts/receivedSourceInventory'
import {tokenizeEdifact,segmentComposite} from './edifactTokenizer'
import {sourceQualifiedProdatBilateralCapability,type SourceQualifiedProdatBilateralCapability} from './prodatBilateralSourceCapability'

/** P26.A r3 p20: own supplied259 declares that UTILTS readings will follow.
 * This is an incoming declaration, never independent register inventory or
 * evidence that a UTILTS message has already been received. Absence is unknown. */
export function sourceProdatRegisterReadingDeclarations(input:{
 message:EdielMessageRow;qualification?:SourceQualifiedProdatBilateralCapability|null;policy:CanonicalEdielPolicy;admissionAt?:string|Date
}):ProdatDependentConditionFacts['registerObjects']|null{
 const {message,policy}=input,qualification=sourceQualifiedProdatBilateralCapability(message,input.qualification)
 const regulated=qualification?.owner==='immutable-regulated-supply-ground-v1'&&['A','D'].includes(qualification.subtype)
 const bilateralStart=qualification?.owner==='immutable-bilateral-prodat-profile-v1'&&qualification.subtype==='H'
  &&qualification.objects.every(own=>own.process==='normal_start_h')
 if(!qualification||!(regulated||bilateralStart)
  ||message.message_code!=='Z04'||policy.family!=='PRODAT'||policy.code!=='Z04'||policy.subtype!==qualification.subtype)return null
 const explicit=input.admissionAt instanceof Date?input.admissionAt.toISOString():input.admissionAt
 if(explicit!==undefined&&explicit!==''&&parseSourceReceiptInstant(explicit)!==parseSourceReceiptInstant(message.message_received_at))throw Error('prodat_source_readings_admission_clock_mismatch')
 if(policy.guide.guideRevision!=='26-A'||policy.guide.associationAssignedCode!=='E2SE6A'||policy.associationAssignedCode!=='E2SE6A'
  ||policy.guide.fieldMatrixStatus!=='certified'||policy.direction!=='inbound'||policy.applicationReference!=='23-DDQ-PRODAT')throw Error('prodat_source_readings_guide_unqualified')
 const wire=tokenizeEdifact(message.raw_payload!),headers=wire.segments.filter(token=>token.tag==='UNH'),interchanges=wire.segments.filter(token=>token.tag==='UNB'),documents=wire.segments.filter(token=>token.tag==='BGM')
 const identity=headers.length===1?segmentComposite(headers[0],2,wire.una):[]
 const application=interchanges.length===1?segmentComposite(interchanges[0],7,wire.una):[]
 // A supplied canonical projection cannot replace the original association,
 // application reference or function when qualifying physical declarations.
 if(identity.slice(0,5).join(':')!=='PRODAT:D:97A:UN:E2SE6A'||identity.slice(5).some(value=>value!=='')
  ||application.length!==1||application[0]!=='23-DDQ-PRODAT'||documents.length!==1||segmentComposite(documents[0],1,wire.una)[0]!=='Z04')throw Error('prodat_source_readings_wire_guide_unqualified')
 const grouped=prodatRegisterGroups(wire.segments,wire.una,'Z04')
 const first=grouped.groups.filter(group=>group.firstLineIndex===group.lineIndex),firstLine=wire.segments.findIndex(token=>token.tag==='LIN')
 const header259=wire.segments.slice(0,firstLine).some(token=>token.tag==='CCI'&&segmentComposite(token,2,wire.una)[0]?.trim().toUpperCase()==='Z16')
 const market=prodatRegisterReadingMarket(wire.segments,wire.una)
 return qualification.objects.map(own=>{
  const group=first.find(row=>row.messageIndex===0&&row.itemId===own.objectId&&row.identityAgency===own.identityAgency&&row.lineIndex===own.firstLineIndex)
  const state=group?prodatRegisterReadingState('259',group.segments,wire.una):null
  const reason=group?prodatRegisterReadingSubtype('Z04',group.segments,wire.una):null
  const siblings=grouped.groups.filter(row=>row.messageIndex===0&&row.itemId===own.objectId&&row.identityAgency===own.identityAgency)
  // Every occurrence remains source-local. A later malformed/duplicated value
  // cannot hide behind a valid first register or another object's declaration.
  const invalid=siblings.some(row=>!row.validRegisterChain||prodatRegisterReadingState('259',row.segments,wire.una).malformed)
  return {meteringPointId:own.objectId,identityAgency:own.identityAgency,
   meterReadingsSentInUtilts:market==='electricity'&&!header259&&!invalid&&reason===qualification.subtype&&state?.present&&!state.malformed&&state.value?true:null}
 })
}
