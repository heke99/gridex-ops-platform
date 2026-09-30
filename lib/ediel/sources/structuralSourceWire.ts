import {isDeepStrictEqual} from 'node:util'
import {singleMessage, legalParty} from '@/lib/ediel/utilts/receivedStructuralSources'
import {segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {parseProdatMessage, parsedProdatObjects} from '@/lib/ediel/prodat/parser'
import {prodatRegisterGroups} from '@/lib/ediel/prodat/prodatRegisterGroups'
import {prodatMarketMinuteToUtc} from '@/lib/ediel/prodat/render/dates'
import type {SourceObjectScope} from './sourceOwnerWire'
import type {ProdatIgnoredField} from '@/lib/ediel/rulebook/fieldMatrix'
import {bindReceivedProdatIgnoredFields} from '@/lib/ediel/core/receivedProdatIgnoredFieldBinding'
import {prodatCharacteristicValue} from '@/lib/ediel/prodat/prodatCharacteristicFields'

export type StructuralSourceWire = {
  object: SourceObjectScope
  messageCode: 'Z04' | 'Z06' | 'Z10'
  businessCase: 'supply_baseline' | 'customer_only' | 'change_with_reading' | 'change_without_reading' | 'meter_exchange'
  functionCode: '9' | '5' | null
  documentReference: string
  caseReference: string
  effectiveFrom: {fieldNumber:'210'|'216';marketMinute:string;utc:string}
  contractStartMinute: string | null
  legalSender: string
  legalReceiver: string
  transportSender: string
  transportReceiver: string
  meterNumber: string | null
  oldMeterNumber: string | null
  registers: {position:number;registerId:string|null}[]
}

export type StructuralMeasurementProjection = Readonly<{
  productCode:string|null;measurementMethod:string|null;reportingFrequency:string|null;settlementMethod:string|null
}>

/** Lossless additional source fields. This is not a new approval marker: the
 * existing physical wire scope and dated owner selection must qualify it. */
export function readStructuralMeasurementProjection(raw:string,scope:SourceObjectScope,ignoredFields?:readonly ProdatIgnoredField[]):StructuralMeasurementProjection|null {
  if(!readStructuralSourceWire(raw,scope)||ignoredFields===undefined||!bindReceivedProdatIgnoredFields(ignoredFields,raw))return null
  const parsed=parseProdatMessage(raw),object=parsedProdatObjects(parsed).find(item=>item.meteringPointId===scope.objectId&&item.identityAgency===scope.identityAgency)
  const ast=singleMessage(raw,'PRODAT')
  if(!object?.registers.length||!ast)return null
  const first=object.registers[0]
  const group=prodatRegisterGroups(ast.segments,ast.una).groups.find(item=>item.itemId===scope.objectId&&item.identityAgency===scope.identityAgency)
  if(!group)return null
  const usable=(field:string,value:string|null)=>ignoredFields.some(item=>item.fieldNumber===field&&item.occurrence.objectId===scope.objectId&&item.occurrence.identityAgency===scope.identityAgency
    &&item.occurrence.messageReference===scope.messageReference&&item.occurrence.lineIndex===group.lineIndex)?null:value
  return Object.freeze({productCode:usable('242',first.timeSeriesProduct),measurementMethod:usable('217',first.measuringMethod),reportingFrequency:usable('222',first.reportingFrequency),
    settlementMethod:usable('254',prodatCharacteristicValue('254',group.effectiveSegments,ast.una))})
}

/** Original-wire structure only, never an approval or a completeness claim. */
export function readStructuralSourceWire(raw:string, scope:SourceObjectScope):StructuralSourceWire|null {
  try {
    const ast=singleMessage(raw,'PRODAT')
    if(!ast || scope.messageIndex!==0 || scope.messageReference!==ast.messages[0].messageReference
      || !scope.objectId || !['9','89'].includes(scope.identityAgency??''))return null
    const messageCode=ast.messages[0].messageCode
    if(messageCode!=='Z04' && messageCode!=='Z06' && messageCode!=='Z10')return null
    const physical=prodatRegisterGroups(ast.segments,ast.una).groups.filter(group=>
      group.messageIndex===scope.messageIndex && group.itemId===scope.objectId && group.identityAgency===scope.identityAgency)
    const registers=physical.map(group=>({lineIndex:group.lineIndex,lineNumber:group.lineNumber,
      registerIndex:group.registerIndex,registerPosition:group.registerPosition,segmentIndex:group.segments[0].index}))
    if(!registers.length || !isDeepStrictEqual(registers,scope.registers))return null
    const legalSender=legalParty(ast,'FR','LIN',['160','SVK']), legalReceiver=legalParty(ast,'DO','LIN',['160','SVK'])
    const unb=ast.segments.find(segment=>segment.tag==='UNB')!
    const sender=segmentComposite(unb,2,ast.una),receiver=segmentComposite(unb,3,ast.una)
    if(!legalSender || !legalReceiver || sender.length!==2 || receiver.length!==2
      || !['14','ZZ'].includes(sender[1]) || !['14','ZZ'].includes(receiver[1])
      || sender[0]!==legalSender || !receiver[0] || receiver[0]!==receiver[0].trim())return null
    const parsed=parseProdatMessage(raw), objects=parsedProdatObjects(parsed).filter(object=>
      object.meteringPointId===scope.objectId && object.identityAgency===scope.identityAgency)
    if(objects.length!==1 || !objects[0].validRegisterChain || objects[0].registers.length!==registers.length || parsed.timezoneOffset!=='1')return null
    const first=objects[0].registers[0]
    const businessCase:StructuralSourceWire['businessCase']|null=messageCode==='Z04'?'supply_baseline'
      :messageCode==='Z10'?(first.reasonForTransaction==='E58'?'meter_exchange':null)
      :first.reasonForTransaction==='E34'?'customer_only':first.reasonForTransaction==='E64'?'change_with_reading'
      :first.reasonForTransaction==='E32'?'change_without_reading':null
    const fieldNumber=messageCode==='Z04'?'210':'216'
    const minute=fieldNumber==='210'?first.contractStartDate:first.validityStartDate
    const utc=prodatMarketMinuteToUtc(minute)
    const bgms=ast.messages[0].segments.filter(segment=>segment.tag==='BGM')
    if(!businessCase || !minute || !utc || !first.lineItemReference || bgms.length!==1)return null
    const doc=segmentComposite(bgms[0],2,ast.una),fn=segmentComposite(bgms[0],3,ast.una)
    if(doc.length!==1 || !doc[0] || doc[0]!==parsed.messageReference || fn.length>1 || !['','5','9'].includes(fn[0]??''))return null
    return {object:structuredClone(scope),messageCode,businessCase,functionCode:(fn[0]||null) as StructuralSourceWire['functionCode'],
      documentReference:doc[0],caseReference:first.lineItemReference,effectiveFrom:{fieldNumber,marketMinute:minute,utc},
      contractStartMinute:first.contractStartDate,legalSender,legalReceiver,transportSender:sender[0],transportReceiver:receiver[0],
      meterNumber:first.meterNumber,oldMeterNumber:first.oldMeterNumber??null,
      registers:objects[0].registers.map((register,index)=>({position:index+1,registerId:register.meterTimeFrame}))}
  } catch {return null}
}
