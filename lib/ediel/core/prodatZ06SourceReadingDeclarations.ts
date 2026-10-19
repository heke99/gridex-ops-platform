import type {EdielMessageRow} from '@/lib/ediel/types'
import type {CanonicalEdielPolicy,ProdatDependentConditionFacts} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import {prodatRegisterGroups} from '@/lib/ediel/prodat/prodatRegisterGroups'
import {prodatRegisterReadingMarket,prodatRegisterReadingState,prodatRegisterReadingSubtype} from '@/lib/ediel/prodat/prodatRegisterReadings'
import {tokenizeEdifact,segmentComposite} from './edifactTokenizer'

/** P26.A r3 p18-20: in a received grid-owner Z06F/Z06G, each object's own
 * supplied first-register 259 declares that its readings follow in UTILTS.
 * This is an incoming declaration only, never register inventory or evidence
 * that a UTILTS message was received. Absence or a malformed value is unknown. */
export function sourceProdatZ06ReadingDeclarations(input:{message:EdielMessageRow;policy:CanonicalEdielPolicy}):ProdatDependentConditionFacts['registerObjects']|null{
 const {message,policy}=input
 if(message.direction!=='inbound'||message.message_code!=='Z06'||!message.raw_payload||policy.family!=='PRODAT'||policy.code!=='Z06'
  ||policy.direction!=='inbound'||!['F','G'].includes(policy.subtype??'')||policy.applicationReference!=='23-DDQ-PRODAT')return null
 const wire=tokenizeEdifact(message.raw_payload),headers=wire.segments.filter(token=>token.tag==='UNH'),documents=wire.segments.filter(token=>token.tag==='BGM')
 if(headers.length!==1||documents.length!==1||segmentComposite(documents[0],1,wire.una)[0]!=='Z06'
  ||prodatRegisterReadingMarket(wire.segments,wire.una)!=='electricity')return null
 const firstLine=wire.segments.findIndex(token=>token.tag==='LIN')
 // A header-level 259 belongs to no object and cannot declare one.
 if(firstLine<0||wire.segments.slice(0,firstLine).some(token=>token.tag==='CCI'&&segmentComposite(token,2,wire.una)[0]?.trim().toUpperCase()==='Z16'))return null
 const grouped=prodatRegisterGroups(wire.segments,wire.una,'Z06')
 const first=grouped.groups.filter(group=>group.messageIndex===0&&group.firstLineIndex===group.lineIndex&&group.itemId&&['9','89'].includes(group.identityAgency??''))
 const identities=first.map(group=>JSON.stringify([group.itemId,group.identityAgency]))
 if(!first.length||new Set(identities).size!==identities.length)return null
 return first.map(group=>{
  const siblings=grouped.groups.filter(row=>row.messageIndex===0&&row.itemId===group.itemId&&row.identityAgency===group.identityAgency)
  const state=prodatRegisterReadingState('259',group.segments,wire.una)
  // Each object's own reason must be the policy subtype; a sibling's malformed
  // or broken register chain cannot hide behind a valid first declaration.
  const own=prodatRegisterReadingSubtype('Z06',group.segments,wire.una)===policy.subtype
  const invalid=siblings.some(row=>!row.validRegisterChain||prodatRegisterReadingState('259',row.segments,wire.una).malformed)
  return {meteringPointId:group.itemId!,identityAgency:group.identityAgency as '9'|'89',
   meterReadingsSentInUtilts:own&&!invalid&&state.present&&!state.malformed&&state.value?true:null}
 })
}
