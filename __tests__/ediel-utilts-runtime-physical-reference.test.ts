import {describe,expect,it,vi} from 'vitest'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {escapeEdifactValue} from '@/lib/ediel/core/edifactSerializer'
import {segmentUntrimmedRaw} from '@/lib/ediel/core/edifactTokenizer'
import {parseUtiltsRuntimeFacts,runUtiltsRuntimeForMessage} from '@/lib/ediel/utiltsEngine'
import {buildReceivedUtiltsTransactionValidation} from '@/lib/ediel/core/receivedUtiltsTransactionValidation'
import {buildReceivedUtiltsFunctionalValidation} from '@/lib/ediel/core/receivedUtiltsFunctionalValidation'
import {parseCanonicalMessageRow} from '@/lib/ediel/core/canonicalMessage'
import {parseInboundUtilts} from '@/lib/ediel/utilts'
import {resolveCanonicalMessagePolicy} from '@/lib/ediel/core/messagePolicy'
import {prepareUtiltsConsumptionContracts} from '@/lib/ediel/utilts/consumptionPreparation'
import {parseUtilts} from '@/lib/ediel/utilts/parseUtilts'
import {parseMeteringObservations} from '@/lib/ediel/utilts/meteringObservationParser'
import {isSingletonE30Reading} from '@/lib/ediel/utilts/profiles'
import {energyHandoffMessage,observationHandoffMessage} from './helpers/utiltsObservationHandoff'
import {priorE30PointWire} from './helpers/priorUtiltsStructureFixtures'
import type {EdielMessageRow} from '@/lib/ediel/types'
vi.mock('@/lib/ediel/matching',()=>({matchMeteringPointIdByIdentifier:vi.fn().mockResolvedValue('point'),matchSiteAndCustomerForMeteringPoint:vi.fn().mockResolvedValue({customerId:'customer',siteId:'site',gridOwnerId:'owner'})}))

function alternateAlphabet(message:EdielMessageRow) {
  const wire=EdifactEnvelopeCodec.decode(message.raw_payload!)
  message.raw_payload=EdifactEnvelopeCodec.encode({sender:wire.sender!,receiver:wire.receiver!,senderQualifier:wire.senderQualifier,receiverQualifier:wire.receiverQualifier,interchangeReference:wire.interchangeReference!,environment:'test',applicationReference:message.application_reference!,acknowledgementRequest:true,una:{componentDataElementSeparator:'*',dataElementSeparator:';',releaseCharacter:'!',segmentTerminator:'~'},
   messages:[{messageReference:'1',messageTypeToken:'UTILTS:D:02B:UN:E5SE5A',businessSegments:wire.segments.filter(segment=>!['UNB','UNH','UNT','UNZ'].includes(segment.tag)).map(segmentUntrimmedRaw)}]})
}
function source(reference:string,alternate=false,precisionFailure=true) {
 const message=energyHandoffMessage()
 message.raw_payload=message.raw_payload!.replace('IDE+24+GRIDEX2607E66001',`IDE+24+${escapeEdifactValue(reference)}`)
 // Genuine own functional precision error, after a guide-valid energy series.
 if(precisionFailure)message.raw_payload=message.raw_payload!.replace('QTY+136:500','QTY+136:1.1234')
 if(alternate)alternateAlphabet(message)
 return message
}
describe('UTILTS actual runtime preserves physical own-reference scope',()=>{
 it.each([false,true])('keeps released own-ID bytes through facts and real canonical owner sidecars with alternate=%s',alternate=>{
  const reference='OWN:A+B?C',message=source(reference,alternate),facts=parseUtiltsRuntimeFacts(message.raw_payload!)
  expect(facts.transactionId).toBe(reference)
  expect(facts.transactions.map(tx=>tx.transactionId)).toEqual([reference])
  const runtime=runUtiltsRuntimeForMessage(message,{referenceDate:'2026-10-01'})
  expect(runtime.validation.syntaxOk).toBe(true)
  expect(runtime.transactionDispositions).toEqual([{transactionId:reference,disposition:'processability_rejected',responseType:'utilts_err',issueCodes:['UTILTS_QUANTITY_PRECISION_INVALID']}])
  expect(runtime.ackPlan.utiltsErrDetails).toMatchObject([{code:'E51',referenceQualifier:'TN',referenceNumber:reference,lineItemReference:reference}])
  expect(buildReceivedUtiltsTransactionValidation({source:message,transactions:runtime.transactionDispositions})?.transactions[0].transactionId).toBe(reference)
  expect(buildReceivedUtiltsFunctionalValidation({source:message,runtime})?.transactions[0]).toMatchObject({transactionId:reference,errors:[{code:'E51',referenceNumber:reference}]})
 })
 it('does not turn source punctuation into the identity of a sibling',()=>{
  const own=source('OWN+A'),other=source('OWNA')
  expect(parseUtiltsRuntimeFacts(own.raw_payload!).transactionId).toBe('OWN+A')
  expect(parseUtiltsRuntimeFacts(other.raw_payload!).transactionId).toBe('OWNA')
 })
 it.each([false,true])('decodes BGM/RFF physical reference components once, alternate=%s',alternate=>{
  const message=source('OWN:A+B?C',false),document='DOC:A+B?C',related='LINK:A+B?C'
  message.raw_payload=message.raw_payload!.replace('GRIDEX2607E66MSG001',escapeEdifactValue(document))
   .replace('IDE+24+',`RFF+TN:${escapeEdifactValue(related)}'IDE+24+`)
  if(alternate)alternateAlphabet(message)
  // Input identity projection only; the extra RFF grants no guide admission.
  const parsed=parseInboundUtilts(message.raw_payload!),canonical=parseCanonicalMessageRow(message)
  expect(parsed.externalReference).toBe(document)
  expect(parsed.transactionReference).toBe(related)
  expect(canonical.documentReference).toBe(document)
  expect(canonical.transactionReference).toBe(related)
  expect(parseUtiltsRuntimeFacts(message.raw_payload!).references).toContainEqual({qualifier:'TN',value:related})
 })
 it('keeps a supplied own-ID data-space as observational input before guide admission',()=>{
  const reference='OWN+A ',message=source(reference)
  expect(parseUtiltsRuntimeFacts(message.raw_payload!).transactionId).toBe(reference)
  expect(parseUtiltsRuntimeFacts(message.raw_payload!).transactions[0].transactionId).toBe(reference)
  // This is physical input preservation, not acceptance of whitespace content.
 })
 it.each([false,true])('preserves original own QTY and explicit timezone through actual consumption and meter projection, alternate=%s',async alternate=>{
  const message=source('OWN:A+B?C',alternate,false)
  const policy=resolveCanonicalMessagePolicy(message,undefined,{admissionAt:'2026-10-01'})!
  const runtime=runUtiltsRuntimeForMessage(message,{canonicalPolicy:policy})
  expect(runtime.transactionDispositions).toMatchObject([{transactionId:'OWN:A+B?C',disposition:'accepted'}])
  const originalQuantity=runtime.facts.utiltsObservedTransactions![0].observations[0].quantities[0]
  expect(runtime.facts.transactions[0].quantities[0].raw).toBe(originalQuantity.raw)
  const contracts=await prepareUtiltsConsumptionContracts({message,runtime,policy,matches:[],dataRequest:null,
   fallback:{customerId:'customer',siteId:'site',meteringPointId:'point',gridOwnerId:'owner'},allowConsumption:true})
  expect(contracts[0]).toMatchObject({transactionId:'OWN:A+B?C',interpretation:{offsetMinutes:120},observations:[{quantity:'500',sourceOrdinal:0,periodStart:'2026-06-30T22:00:00.000Z',periodEnd:'2026-06-30T22:15:00.000Z'}]})
  expect(parseMeteringObservations(parseUtilts(message.raw_payload!))[0]).toMatchObject({transactionReference:'OWN:A+B?C',periodStart:'2026-06-30T22:00:00.000Z',periodEnd:'2026-06-30T22:15:00.000Z'})
 })
 it.each([false,true])('reads the existing singleton E30 DTM597 exception from the shared alphabet, alternate=%s',alternate=>{
  const message=observationHandoffMessage('2026-09-30')
  message.message_code='E30';message.application_reference='23-MDR-E30-T'
  message.raw_payload=priorE30PointWire('E24','METER-1','735999260731000007')
  if(alternate)alternateAlphabet(message)
  const facts=parseUtiltsRuntimeFacts(message.raw_payload!)
  expect(isSingletonE30Reading(facts,0)).toBe(true)
  const runtime=runUtiltsRuntimeForMessage(message,{referenceDate:'2026-09-30'})
  expect(runtime.validation.issues.map(issue=>issue.code)).not.toContain('UTILTS_PROFILE_PERIOD_MISSING')
  expect(runtime.validation.issues.map(issue=>issue.code)).not.toContain('UTILTS_PROFILE_RESOLUTION_MISSING')
  expect(runtime.transactionDispositions,JSON.stringify(runtime.validation.issues)).toMatchObject([{disposition:'accepted'}])
 })
})
