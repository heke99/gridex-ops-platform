import {expect,it} from 'vitest'
import {ownerSource} from './helpers/sourceOwnerFixtures'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {validateEdifactSyntax} from '@/lib/ediel/core/syntaxValidator'
import {prodatRegisterGroups} from '@/lib/ediel/prodat/prodatRegisterGroups'
import {prodatRegisterReadingState} from '@/lib/ediel/prodat/prodatRegisterReadings'
import {evidenceHash} from '@/lib/ediel/utilts/durableSourceDiscovery'

// Constructor controls only: callers choose the intended scenario. Neither
// these two enumerations nor grammar qualification certify the whole source.
// In particular, the unchanged reading register111 is still synthetic.
const scenarios=(['test','production'] as const).flatMap(environment=>
 (['Z11','Z12'] as const).flatMap(installationStatus=>
  (['Z31','Z32'] as const).map(settlementMethod=>({environment,installationStatus,settlementMethod}))))

it.each(scenarios)('constructs explicit $installationStatus/$settlementMethod in $environment before birth hashing',({environment,installationStatus,settlementMethod})=>{
 const options={readingDeclarations:true as const,environment,sourceCodes:{installationStatus,settlementMethod}}
 const row=ownerSource(options),baseline=ownerSource({readingDeclarations:true,environment})
 const wire=tokenizeEdifact(row.raw_payload!),oldWire=tokenizeEdifact(baseline.raw_payload!)
 const grouped=prodatRegisterGroups(wire.segments,wire.una,'Z04')
 expect(grouped.problems).toEqual([])
 expect(grouped.groups).toHaveLength(1)
 const own=grouped.groups[0]
 for(const [descriptor,value] of [['Z07',installationStatus],['Z15',settlementMethod]]){
  const indices=own.segments.flatMap((segment,index)=>segment.tag==='CCI'&&segmentComposite(segment,2,wire.una)[0]===descriptor?[index]:[])
  expect(indices).toHaveLength(1)
  const cav=own.segments[indices[0]+1]
  expect(cav.tag).toBe('CAV')
  expect(segmentComposite(cav,1,wire.una)).toEqual([value])
 }
 // Compare the complete wire with only those two pre-existing values changed.
 const expected=oldWire.segments.map((segment,index)=>{
  const prior=oldWire.segments[index-1]
  if(segment.tag==='CAV'&&prior?.tag==='CCI'){
   const descriptor=segmentComposite(prior,2,oldWire.una)[0]
   if(descriptor==='Z07')return `CAV+${installationStatus}`
   if(descriptor==='Z15')return `CAV+${settlementMethod}`
  }
  return segment.raw
 })
 expect(wire.segments.map(segment=>segment.raw)).toEqual(expected)
 expect(prodatRegisterReadingState('259',own.segments,wire.una)).toEqual({present:true,value:'111',malformed:false})
 const decoded=EdifactEnvelopeCodec.decode(row.raw_payload)
 expect(decoded.environment).toBe(environment)
 expect(decoded.testIndicator).toBe(environment==='test'?'1':null)
 const start=wire.segments.findIndex(segment=>segment.tag==='UNH'),end=wire.segments.findIndex(segment=>segment.tag==='UNT')
 expect(Number(segmentComposite(wire.segments[end],1,wire.una)[0])).toBe(end-start+1)
 expect(Number(segmentComposite(wire.segments[end],1,wire.una)[0])).toBe(35)
 expect(validateEdifactSyntax(row)).toMatchObject({ok:true,grammarQualification:'qualified'})
 const born=(row.execution_context_snapshot as {receivedProdatContext:Record<string,unknown>}).receivedProdatContext
 expect(born).toEqual({...((baseline.execution_context_snapshot as {receivedProdatContext:Record<string,unknown>}).receivedProdatContext),payloadHash:evidenceHash(row.raw_payload!)})
 expect(born.payloadHash).not.toBe((baseline.execution_context_snapshot as {receivedProdatContext:Record<string,unknown>}).receivedProdatContext.payloadHash)
 expect({...row,raw_payload:baseline.raw_payload,execution_context_snapshot:baseline.execution_context_snapshot}).toEqual(baseline)
})

it.each([
 null,{},
 {installationStatus:'Z12'},
 {settlementMethod:'Z32'},
 {installationStatus:'E22',settlementMethod:'Z32'},
 {installationStatus:'Z12',settlementMethod:'D'},
])('refuses an untyped incomplete or unknown explicit pair: %j',sourceCodes=>{
 const options={readingDeclarations:true,sourceCodes} as unknown as Parameters<typeof ownerSource>[0]
 expect(()=>ownerSource(options)).toThrow('sourceCodes requires Z11/Z12 installationStatus and Z31/Z32 settlementMethod')
})
