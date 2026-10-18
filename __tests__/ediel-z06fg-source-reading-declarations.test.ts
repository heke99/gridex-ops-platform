// masterplan: AT-Z06F-SUPPLIER, AT-Z06G-SUPPLIER
// A received grid-owner Z06F/Z06G carries its own first-register 259. Only that
// physical own declaration may stand in for the absent root reading fact; a
// header 259, a malformed or sibling value, or another reason never does.
// Independent oracle: P26.A r3 p18-20 (214/218/259 in Z06F "då mätarställningar
// skickas i MSCONS/UTILTS"; 259 voluntary in Z06G) and the frozen AT-Z06F/G cards.
import {expect,it,vi} from 'vitest'
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:vi.fn(),rpc:vi.fn()}}))
vi.mock('@/lib/ediel/db',()=>({getEdielMessageById:vi.fn(),createEdielMessageEvent:vi.fn(),linkEdielMessage:vi.fn()}))
import {structuralOwnerSource} from './helpers/structuralOwnerFixtures'
import {OWNER} from './helpers/sourceOwnerFixtures'
import {resolveCanonicalRuntimeDecision} from '@/lib/ediel/core/runtimeDecision'
import {sourceProdatZ06ReadingDeclarations} from '@/lib/ediel/core/prodatZ06SourceReadingDeclarations'
import type {EdielMessageRow} from '@/lib/ediel/types'

const REASON={F:'E64',G:'E32'} as const
const OWN259="CCI++Z16'CAV+:::101'"
/** The actual received intake row: no stored root reading fact. */
function received(subtype:'F'|'G',transform:(raw:string)=>string=raw=>raw):EdielMessageRow{
  const base=structuralOwnerSource('Z06',REASON[subtype])
  return {...base,raw_payload:transform(base.raw_payload!),parsed_payload:{subtype},validation_report:{}}
}
function units(raw:string,delta:number){return raw.replace(/UNT\+(\d+)\+/,(_,n:string)=>`UNT+${Number(n)+delta}+`)}
function header(message:EdielMessageRow){
  const decision=resolveCanonicalRuntimeDecision(message)
  return {decision,header:decision.prodatApplicationValidation?.headerDecision,reasons:decision.prodatApplicationValidation?.objects.flatMap(o=>o.reasonCodes)??[]}
}

it.each(['F','G'] as const)('received Z06%s without a stored root fact declares its own object from its own 259 and the application header is accepted',subtype=>{
  const message=received(subtype)
  expect(message.raw_payload).toContain(OWN259)
  const {decision,header:h,reasons}=header(message)
  expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision],JSON.stringify(decision.issues)).toEqual(['accepted','accepted','accepted'])
  expect(h).toBe('accepted');expect(reasons).toEqual([])
  expect(sourceProdatZ06ReadingDeclarations({message,policy:decision.policy!})).toEqual([{meteringPointId:OWNER.external,identityAgency:'9',meterReadingsSentInUtilts:true}])
})

it('received Z06F without its own 259 stays an undetermined held header; no root or invented declaration fills it',()=>{
  const message=received('F',raw=>units(raw.replace(OWN259,''),-2))
  const {decision,header:h,reasons}=header(message)
  expect(h).toBe('held');expect(reasons).toContain('PRODAT_DEPENDENT_CONDITION_UNDETERMINED')
  expect(sourceProdatZ06ReadingDeclarations({message,policy:decision.policy!})).toEqual([{meteringPointId:OWNER.external,identityAgency:'9',meterReadingsSentInUtilts:null}])
})

it('received Z06G without its own 259 needs no declaration: 259 is voluntary in Z06G (P26.A p19)',()=>{
  const message=received('G',raw=>units(raw.replace(OWN259,''),-2))
  const {decision,header:h,reasons}=header(message)
  expect(h).toBe('accepted');expect(reasons).toEqual([])
  expect(sourceProdatZ06ReadingDeclarations({message,policy:decision.policy!})).toEqual([{meteringPointId:OWNER.external,identityAgency:'9',meterReadingsSentInUtilts:null}])
})

it('a header-level 259 belongs to no object and cannot declare one',()=>{
  const message=received('F',raw=>units(raw.replace(OWN259,'').replace("LIN+",OWN259+'LIN+'),0))
  const {decision,header:h}=header(message)
  expect(sourceProdatZ06ReadingDeclarations({message,policy:decision.policy!})).toBeNull()
  expect(h).not.toBe('accepted')
})

it('a malformed own 259 is unknown, not a declaration',()=>{
  const message=received('F',raw=>raw.replace(OWN259,"CCI++Z16'CAV+X::101'"))
  const {decision,header:h}=header(message)
  expect(sourceProdatZ06ReadingDeclarations({message,policy:decision.policy!})).toEqual([{meteringPointId:OWNER.external,identityAgency:'9',meterReadingsSentInUtilts:null}])
  expect(h).not.toBe('accepted')
})

it('a stored root boolean keeps precedence; the source reader is not consulted for it',()=>{
  const base=structuralOwnerSource('Z06','E64')
  expect(base.parsed_payload).toMatchObject({prodatDependentFacts:{meterReadingsSentInUtilts:true}})
  expect(header(base).header).toBe('accepted')
  // An explicit false root fact makes the supplied 259 forbidden (ignored) on
  // receipt instead of being overridden by the wire's own declaration.
  const declaredFalse={...base,parsed_payload:{...base.parsed_payload as object,prodatDependentFacts:{market:'electricity',meterReadingsSentInUtilts:false}}}
  const {decision}=header(declaredFalse)
  expect(decision.policy?.prodatDependentFacts?.registerObjects).toBeUndefined()
  expect(decision.policy?.prodatDependentFacts?.meterReadingsSentInUtilts).toBe(false)
})

it.each([
  ['E (E34) is outside this reader',()=>{const m=structuralOwnerSource('Z06','E34');return {...m,parsed_payload:{subtype:'E'},validation_report:{}}}],
  ['an outbound Z06F is not a received declaration',()=>({...received('F'),direction:'outbound' as const})],
  ['a gas application reference is outside this electricity reader',()=>received('F',raw=>raw.replace('23-DDQ-PRODAT','27-DDQ-PRODAT'))],
] as const)('%s',(_name,build)=>{
  const message=build(),decision=resolveCanonicalRuntimeDecision(message)
  if(decision.policy)expect(sourceProdatZ06ReadingDeclarations({message,policy:decision.policy})).toBeNull()
})

it('every object must carry the policy reason; a sibling object with another reason is unknown',()=>{
  const message=received('F')
  const {decision}=header(message)
  // Same physical object, but the policy is resolved for G: own reason E64 ≠ G.
  const foreign={...decision.policy!,subtype:'G'}
  expect(sourceProdatZ06ReadingDeclarations({message,policy:foreign})).toEqual([{meteringPointId:OWNER.external,identityAgency:'9',meterReadingsSentInUtilts:null}])
})
