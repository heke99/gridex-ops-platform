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
] as const)('%s',(_name,build)=>{
  const message=build(),decision=resolveCanonicalRuntimeDecision(message)
  expect(decision.policy).toBeTruthy()
  expect(sourceProdatZ06ReadingDeclarations({message,policy:decision.policy!})).toBeNull()
})

it('a gas application reference resolves no electricity policy, and the reader refuses it under an electricity policy',()=>{
  const gas=received('F',raw=>raw.replace('23-DDQ-PRODAT','27-DDQ-PRODAT'))
  expect(resolveCanonicalRuntimeDecision(gas).policy).toBeFalsy()
  const electricity=resolveCanonicalRuntimeDecision(received('F')).policy!
  expect(sourceProdatZ06ReadingDeclarations({message:gas,policy:electricity})).toBeNull()
})

it('an interchange with two Z06 messages declares nothing and is not accepted',()=>{
  const message=received('F',raw=>{
    const body=raw.slice(raw.indexOf('UNH+'),raw.indexOf('UNZ+'))
    return raw.replace("UNZ+1+I'",body.replace('UNH+M+','UNH+M2+').replace('UNT+35+M','UNT+35+M2')+"UNZ+2+I'")
  })
  expect((message.raw_payload!.match(/UNH\+/g)??[]).length).toBe(2)
  const {decision,header:h}=header(message)
  expect(decision.policy).toBeTruthy()
  expect(sourceProdatZ06ReadingDeclarations({message,policy:decision.policy!})).toBeNull()
  expect(h).not.toBe('accepted')
})

it('every object must carry the policy reason; a sibling object with another reason is unknown',()=>{
  const message=received('F')
  const {decision}=header(message)
  // Same physical object, but the policy is resolved for G: own reason E64 ≠ G.
  const foreign={...decision.policy!,subtype:'G'}
  expect(sourceProdatZ06ReadingDeclarations({message,policy:foreign})).toEqual([{meteringPointId:OWNER.external,identityAgency:'9',meterReadingsSentInUtilts:null}])
})

// Genuine second register of the same object, built the way prodatRegisterGroups
// chains registers: same 209 identity+agency, C829 `1:<position>` on every LIN
// (258 = 1, 2), and its own local 213/259/214/218 (P26.A p114-116: each register
// carries its own reading values and a distinct 259 tariff code).
const LIN1='LIN+1++735123456789012345:::9'
const READING_LOCALS=['CCI++Z02','CAV+:::1','CCI++Z05','CAV+:::6']
function twoRegisters(second259:string,first:(raw:string)=>string=raw=>raw){
  const second=['LIN+2++735123456789012345:::9+1:2','QTY+31:20:KWH','CCI++Z16',second259,...READING_LOCALS]
  return (raw:string)=>units(first(raw).replace(`${LIN1}'`,`${LIN1}+1:1'`).replace('UNT+',second.join("'")+"'UNT+"),second.length)
}
/** UNT 0074 must equal the actual UNH..UNT segment count. */
function untMatches(raw:string){
  const segments=raw.slice(raw.indexOf('UNH+'),raw.indexOf('UNZ+')).split("'").filter(Boolean)
  return Number(/UNT\+(\d+)\+/.exec(raw)![1])===segments.length
}

it('positive control: a valid two-register Z06F with its own 259 on the first register declares the object and is accepted',()=>{
  const message=received('F',twoRegisters('CAV+:::102'))
  expect(message.raw_payload).toContain(`${LIN1}+1:1'`);expect(message.raw_payload).toContain("LIN+2++735123456789012345:::9+1:2'")
  expect(untMatches(message.raw_payload!)).toBe(true)
  const {decision,header:h,reasons}=header(message)
  expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision],JSON.stringify(decision.issues)).toEqual(['accepted','accepted','accepted'])
  expect(h).toBe('accepted');expect(reasons).toEqual([])
  expect(sourceProdatZ06ReadingDeclarations({message,policy:decision.policy!})).toEqual([{meteringPointId:OWNER.external,identityAgency:'9',meterReadingsSentInUtilts:true}])
})

it('only the first register 259 declares: a 259 solely on the second register of a valid chain is no declaration and F is not accepted',()=>{
  // The reader keeps only groups whose firstLineIndex===lineIndex, so register 2's 259 is never read as the object's declaration.
  const message=received('F',twoRegisters('CAV+:::102',raw=>units(raw.replace(OWN259,''),-2)))
  expect(message.raw_payload!.match(/CCI\+\+Z16'/g)).toHaveLength(1)
  expect(message.raw_payload!.indexOf("CCI++Z16'")).toBeGreaterThan(message.raw_payload!.indexOf('LIN+2++'))
  expect(untMatches(message.raw_payload!)).toBe(true)
  const {decision,header:h,reasons}=header(message)
  expect(sourceProdatZ06ReadingDeclarations({message,policy:decision.policy!})).toEqual([{meteringPointId:OWNER.external,identityAgency:'9',meterReadingsSentInUtilts:null}])
  expect(h).not.toBe('accepted');expect(reasons).toContain('PRODAT_DEPENDENT_CONDITION_UNDETERMINED')
})

it('a malformed 259 on the second register voids the first register declaration; F is not accepted',()=>{
  const message=received('F',twoRegisters('CAV+X::101'))
  expect(message.raw_payload).toContain(OWN259);expect(untMatches(message.raw_payload!)).toBe(true)
  const {decision,header:h}=header(message)
  expect(sourceProdatZ06ReadingDeclarations({message,policy:decision.policy!})).toEqual([{meteringPointId:OWNER.external,identityAgency:'9',meterReadingsSentInUtilts:null}])
  expect(h).not.toBe('accepted')
})

it('a broken register chain (second 258 out of sequence) declares nothing; F is not accepted',()=>{
  // An invalid chain clears firstLineIndex for every register of the object, so no first register remains to declare it.
  const message=received('F',raw=>twoRegisters('CAV+:::102')(raw).replace("LIN+2++735123456789012345:::9+1:2'","LIN+2++735123456789012345:::9+1:3'"))
  expect(message.raw_payload).toContain(OWN259);expect(untMatches(message.raw_payload!)).toBe(true)
  const {decision,header:h}=header(message)
  expect(sourceProdatZ06ReadingDeclarations({message,policy:decision.policy!})).toBeNull()
  expect(h).not.toBe('accepted')
})
