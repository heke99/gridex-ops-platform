import {expect,it} from 'vitest'
import {ownerSource,OWNER,ownerId} from './helpers/sourceOwnerFixtures'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {validateEdifactSyntax} from '@/lib/ediel/core/syntaxValidator'
import {prodatRegisterGroups} from '@/lib/ediel/prodat/prodatRegisterGroups'
import {prodatRegisterReadingState} from '@/lib/ediel/prodat/prodatRegisterReadings'
import {evidenceHash} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {parseSourceReceiptInstant} from '@/lib/ediel/utilts/receivedSourceInventory'

// Captured once from untouched main9b before this component's implementation.
// This includes the historical default metadata; no existing caller opts in.
const originalDefault = {
  "id": "00000000-0000-4000-8000-000000000001",
  "message_received_at": "2026-09-22T10:00:00Z",
  "created_at": "2026-09-30T12:00:00.000000Z",
  "direction": "inbound",
  "message_standard": "edifact",
  "message_family": "PRODAT",
  "message_code": "Z04",
  "raw_payload": "UNA:+.? 'UNB+UNOC:3+12345:14+54321:14+260917:1200+I++23-DDQ-PRODAT'UNH+M+PRODAT:D:97A:UN:E2SE6A'BGM+Z04+D+9+AB'DTM+137:202609171200:203'DTM+ZZZ:1:805'NAD+FR+12345:160:SVK+++++++SE'NAD+DO+54321:160:SVK+++++++SE'LIN+1++735123456789012345:::9'DTM+92:202610010000:203'DTM+354:15:806'QTY+31:1000:KWH'CCI++Z13'CAV+Z22'CCI++Z04'CAV+Z03'CCI++Z07'CAV+E22'CCI++Z12'CAV+:::D'CCI++Z15'CAV+D'CCI++Z14'CAV+:::L917:8716867000030'RFF+MG:METER-1'RFF+Z05:NET-1'RFF+LI:CASE-1'NAD+UD+CUSTOMER-1::89++Synthetic+Street+City++12345+SE'NAD+IT+735123456789012345::9+++Street+Town++12345+SE'NAD+Z02+11111:160:SVK'UNT+29+M'UNZ+1+I'",
  "parsed_payload": {
    "subtype": "L",
    "start_date": "2026-10-01",
    "prodatDependentFacts": {
      "market": "electricity",
      "meterReadingsSentInUtilts": false
    }
  },
  "validation_report": {},
  "application_reference": "23-DDQ-PRODAT",
  "environment": "test",
  "test_flag": 1,
  "sender_ediel_id": "12345",
  "receiver_ediel_id": "54321",
  "transaction_reference": "CACHED-UNRELATED",
  "company_id": "00000000-0000-4000-8000-000000000002",
  "customer_id": "00000000-0000-4000-8000-000000000003",
  "metering_point_id": "00000000-0000-4000-8000-000000000004",
  "site_id": "00000000-0000-4000-8000-000000000005",
  "execution_context_snapshot": {
    "receivedProdatContext": {
      "version": 1,
      "contextOrigin": "database_insert",
      "sourceMessageId": "00000000-0000-4000-8000-000000000001",
      "companyId": "00000000-0000-4000-8000-000000000002",
      "environment": "test",
      "messageCode": "Z04",
      "payloadHash": "5686d2a0fbf4b87caf71f772e5f966293729ce2bb19b2158e4a42944c9aec1f8",
      "sourceReceivedAt": "2026-09-22T10:00:00Z",
      "capturedAt": "2026-09-22T10:00:00Z"
    }
  }
}
const inspect=(row:ReturnType<typeof ownerSource>)=>{
 const wire=tokenizeEdifact(row.raw_payload!)
 const grouped=prodatRegisterGroups(wire.segments,wire.una,'Z04')
 return {wire,grouped}
}

it('preserves the entire original no-argument source, including absent declarations',()=>{
 expect(ownerSource()).toEqual(originalDefault)
 expect(JSON.stringify(ownerSource())).toBe(JSON.stringify(originalDefault))
})
it('keeps default own readings absent rather than promoting caller FALSE',()=>{
 const {wire,grouped}=inspect(ownerSource())
 expect(grouped.groups).toHaveLength(1)
 for(const field of ['214','218','259'])expect(prodatRegisterReadingState(field,grouped.groups[0].segments,wire.una)).toEqual({present:false,value:null,malformed:false})
})

it.each(['test','production'] as const)('binds explicit %s source to the actual final envelope and counts',environment=>{
 const row=ownerSource({readingDeclarations:true,environment})
 const decoded=EdifactEnvelopeCodec.decode(row.raw_payload)
 expect(decoded.environment).toBe(environment)
 expect(decoded.testIndicator).toBe(environment==='test'?'1':null)
 expect(row.environment).toBe(environment)
 expect(row.test_flag).toBe(environment==='test'?1:0)
 expect(decoded.sender).toBe(row.sender_ediel_id)
 expect(decoded.receiver).toBe(row.receiver_ediel_id)
 expect(decoded.applicationReference).toBe(row.application_reference)
 expect(decoded.acknowledgementRequest).toBe('1')
 const {wire,grouped}=inspect(row)
 const start=wire.segments.findIndex(s=>s.tag==='UNH'),end=wire.segments.findIndex(s=>s.tag==='UNT')
 expect(Number(segmentComposite(wire.segments[end],1,wire.una)[0])).toBe(end-start+1)
 expect(Number(segmentComposite(wire.segments[end],1,wire.una)[0])).toBe(35) // frozen original29 + six physical segments
 expect(segmentComposite(wire.segments[end],2,wire.una)[0]).toBe(segmentComposite(wire.segments[start],1,wire.una)[0])
 const unz=wire.segments.find(s=>s.tag==='UNZ')!
 expect(segmentComposite(unz,1,wire.una)[0]).toBe('1')
 expect(segmentComposite(unz,2,wire.una)[0]).toBe(decoded.interchangeReference)
 const envelopeTags=new Set(['UNB','UNH','UNT','UNZ'])
 const suppliedPairs=new Set(['CCI++Z02','CAV+:::1','CCI++Z05','CAV+:::6','CCI++Z16','CAV+:::111'])
 const originalBusiness=tokenizeEdifact(originalDefault.raw_payload).segments.filter(segment=>!envelopeTags.has(segment.tag)).map(segment=>segment.raw)
 expect(wire.segments.filter(segment=>!envelopeTags.has(segment.tag)&&!suppliedPairs.has(segment.raw)).map(segment=>segment.raw)).toEqual(originalBusiness)
 expect(grouped.problems).toEqual([])
 expect(validateEdifactSyntax(row)).toMatchObject({ok:true,grammarQualification:'qualified'})
})

for(const environment of ['test','production'] as const)it.each([['214','1'],['218','6'],['259','111']] as const)(`${environment} source has own reading %s = %s`, (field,value)=>{
 const row=ownerSource({readingDeclarations:true,environment}),{wire,grouped}=inspect(row)
 expect(grouped.groups).toHaveLength(1)
 const own=grouped.groups[0]
 expect(own.itemId).toBe(OWNER.external)
 expect(own.identityAgency).toBe('9')
 expect(own.firstLineIndex).toBe(own.lineIndex)
 expect(prodatRegisterReadingState(field,own.segments,wire.una)).toEqual({present:true,value,malformed:false})
})

it.each(['test','production'] as const)('constructs %s birth metadata from complete final bytes',environment=>{
 const row=ownerSource({readingDeclarations:true,environment})
 const born=(row.execution_context_snapshot as {receivedProdatContext:Record<string,unknown>}).receivedProdatContext
 expect(born).toEqual({version:1,contextOrigin:'database_insert',sourceMessageId:row.id,companyId:row.company_id,environment,messageCode:'Z04',payloadHash:evidenceHash(row.raw_payload!),sourceReceivedAt:row.message_received_at,capturedAt:row.message_received_at})
 expect(row.inbound_email_message_id).toBe(ownerId(60))
 expect(parseSourceReceiptInstant(row.created_at)).toBe(parseSourceReceiptInstant(row.message_received_at))
 expect(parseSourceReceiptInstant(born.capturedAt)).toBe(parseSourceReceiptInstant(row.message_received_at))
 expect(born.payloadHash).not.toBe(originalDefault.execution_context_snapshot.receivedProdatContext.payloadHash)
})
it('retains caller FALSE as nonauthoritative data despite explicit physical declarations',()=>{
 const row=ownerSource({readingDeclarations:true})
 expect(row.parsed_payload).toEqual(originalDefault.parsed_payload)
 const {wire,grouped}=inspect(row)
 expect(prodatRegisterReadingState('259',grouped.groups[0].segments,wire.una).value).toBe('111')
 // No opaque private issuer token, accepted decision, database witness or
 // already-received UTILTS fact is manufactured by this primitive fixture.
})
it('does not let an opted-in caller mutate another source or the original default',()=>{
 const first=ownerSource({readingDeclarations:true}),second=ownerSource({readingDeclarations:true})
 first.raw_payload='changed only by caller'
 ;(first.parsed_payload as Record<string,unknown>).changed=true
 expect(second.raw_payload).not.toBe(first.raw_payload)
 expect(second.parsed_payload).not.toHaveProperty('changed')
 expect(ownerSource()).toEqual(originalDefault)
})
