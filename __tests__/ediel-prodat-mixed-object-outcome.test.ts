// masterplan: ACK-08, AT-ACK-08
import {expect,it,vi,beforeEach} from 'vitest'
import {createHash} from 'node:crypto'
const io=vi.hoisted(()=>({database:null as ReturnType<typeof prodatOwnSourceReadingFixtureDatabase>|null}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:(name:string,args:Record<string,unknown>)=>io.database!.rpc(name,args),from:(table:string)=>io.database!.from(table)}}))
import {source} from './fixtures/prodat-identity'
import {guideOrderedFixtureRaw as raw} from './helpers/prodatGuideOrderedFixture'
import {mixedZ04Parts} from './helpers/mixedZ04Fixture'
import {resolveCanonicalRuntimeDecision,resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
import {createProdatOwnSourceReadingSdk,resetProdatOwnSourceReadingSdk,installProdatOwnSourceReadingFixture,withProdatOwnSourceReadings,prodatOwnSourceReadingMessage,prodatOwnSourceReadingActor} from './helpers/prodatOwnSourceReadingFixture'
import {prodatOwnSourceReadingFixtureDatabase,finiteProdatRulePack} from './helpers/prodatOwnSourceReadingAdapter'
import {buildAperakDraft} from '@/lib/ediel/ack'
import {validateCanonicalAckGuide} from '@/lib/ediel/rulebook/ackGuidePolicy'
import {resolveCanonicalMessagePolicy} from '@/lib/ediel/core/messagePolicy'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
const reads=createProdatOwnSourceReadingSdk()
beforeEach(()=>{resetProdatOwnSourceReadingSdk(reads);io.database=prodatOwnSourceReadingFixtureDatabase(reads,()=>[finiteProdatRulePack('Z04','L','Z22')])})
it('refuses BGM34 before the untouched sibling has a real own outcome',()=>{
 const m=source(raw(mixedZ04Parts(),'Z04'),'Z04')
 const d=resolveCanonicalRuntimeDecision(m),errors=d.responsePlan.find(p=>p.family==='APERAK')!.applicationErrors!
 expect(()=>buildAperakDraft({sourceMessage:m,outcome:'negative',applicationErrors:errors})).toThrow('APERAK_PRODAT_OBJECT_OUTCOME_MISSING')
})
it('bounded own-response guide never invents an omitted sibling outcome or send authority',()=>{
 const m=source(raw(mixedZ04Parts(),'Z04'),'Z04')
 const d=resolveCanonicalRuntimeDecision(m),errors=d.responsePlan.find(p=>p.family==='APERAK')!.applicationErrors!
 // Flat physical ACK tokens are a declared bounded diagnostic input. This
 // does not bypass full96A, mint a sibling success or claim a sendable ACK.
 expect(()=>buildAperakDraft({sourceMessage:m,outcome:'negative',applicationErrors:errors})).toThrow('APERAK_PRODAT_OBJECT_OUTCOME_MISSING')
 const own=errors[0]
 const draft={rawPayload:`UNB+UNOC:3+54321:14+12345:14+260930:1200+ACK'UNH+ACK+APERAK:D:96A:UN:E2SE6A'BGM+++34'ERC+${own.ercCode}::260'FTX+AAO++${own.fieldCode}::260'RFF+LI:${own.lineItemReference}'RFF+Z07:${own.referenceNumber}'UNT+7+ACK'UNZ+1+ACK'`}
 const wire=tokenizeEdifact(draft.rawPayload!),policy=resolveCanonicalMessagePolicy({...m,message_family:'APERAK',message_code:'APERAK',direction:'outbound',raw_payload:draft.rawPayload!})!
 const issues=validateCanonicalAckGuide({policy,rawSegments:wire.segments.map(t=>t.raw),una:wire.una,sourceRawPayload:m.raw_payload!}).map(i=>i.code)
 // The preserved authenticated P pp85-87 own-response rule permits several
 // replies. A native response receipt must qualify that exact own scope; this
 // diagnostic input cannot grant authority for the omitted second object.
 expect(issues).not.toContain('ACK_PRODAT_OBJECT_OUTCOME_MISSING')
 expect(issues).not.toContain('ACK_PRODAT_OWN_OBJECT_SCOPE_MISMATCH')
 expect(issues).toContain('ACK_APERAK_DOCUMENT_DATE_INVALID')
 expect(draft.rawPayload).not.toContain('ERC+100')
})

import {projectReceivedProdatObjectValidation} from '@/lib/ediel/core/receivedProdatObjectValidation'
it('never upgrades the original mixed fixture unknown sibling into full-guide acceptance',()=>{
 const wire=raw(mixedZ04Parts(),'Z04'),d=resolveCanonicalRuntimeDecision(source(wire,'Z04'))
 expect(projectReceivedProdatObjectValidation(wire,d)?.objects.every(o=>o.disposition!=='accepted')).toBe(true)
})
it('retains shared header errors even where the register-only facade accepted an object',()=>{
 const parts=mixedZ04Parts().filter(p=>p[0]!=='NAD'||p[1]!=='FR')
 const wire=raw(parts,'Z04'),d=resolveCanonicalRuntimeDecision(source(wire,'Z04'))
 expect(projectReceivedProdatObjectValidation(wire,d)).toMatchObject({sharedAccepted:false})
 expect(projectReceivedProdatObjectValidation(wire,d)?.objects.some(o=>o.disposition==='accepted')).toBe(false)
})
it('qualifies a complete synthetic own-field context per object without borrowing sibling outcomes',async()=>{
 const wire=withProdatOwnSourceReadings(raw(mixedZ04Parts(),'Z04')),m=prodatOwnSourceReadingMessage(wire)
 m.parsed_payload={prodatDependentFacts:{meterReadingsSentInUtilts:false,endUserAddressAvailable:true,invoiceeAddressDiffersFromEndUser:false,
  byCell:Object.fromEntries(Array.from({length:600},(_,n)=>[`Z04:${n}`,false]))}}
 installProdatOwnSourceReadingFixture(reads,m,'L',{actorUserId:prodatOwnSourceReadingActor,receivedAt:m.message_received_at!,mailId:m.inbound_email_message_id!,parseId:'00000000-0000-4000-8000-000000000005',receptionId:'00000000-0000-4000-8000-000000000006',legalActorId:'00000000-0000-4000-8000-000000000008'})
 const d=await resolveCanonicalRuntimeDecisionWithRegistry(m,{actorUserId:prodatOwnSourceReadingActor}),facet=projectReceivedProdatObjectValidation(wire,d)
 expect(facet?.objects.map(o=>o.disposition)).toEqual(['rejected','accepted'])
})

it('full-guide shared fields and unrelated own fields cannot borrow register acceptance',()=>{
 const parts=mixedZ04Parts().filter(p=>p[0]!=='NAD'||p[1]!=='UD')
 const wire=raw(parts,'Z04'),m=source(wire,'Z04')
 m.parsed_payload={prodatDependentFacts:{meterReadingsSentInUtilts:false,endUserAddressAvailable:true,invoiceeAddressDiffersFromEndUser:false,
  byCell:Object.fromEntries(Array.from({length:600},(_,n)=>[`Z04:${n}`,false]))}}
 const d=resolveCanonicalRuntimeDecision(m),facet=projectReceivedProdatObjectValidation(wire,d)
 // Own UD absence remains a full-object rejection even though unrelated
 // accepted register-only QTY/MTR cells never cover that national guide field.
 expect(facet?.objects.some(o=>o.disposition==='accepted')).toBe(false)
})

import {mixedProdatNativeWire} from '../scripts/helpers/ediel-mixed-prodat-native-wire'
const nativeFixtureInput={external:'735123456789012352',negativePoint:'735123456789012345',sender:'54321',receiver:'12345',caseReference:'EXACT-NATIVE-LI',customerIdentity:{id:'199001011234',qualifier:'SE2',agency:'260'},startMinute:'202610010000'}
// Captured from the unchanged helper before this correction. This literal is
// independent of the new option and preserves both retention consumers' wire.
const defaultNativeWire="UNA:+.? 'UNB+UNOC:3+12345:14+54321:14+260917:1200+I++23-DDQ-PRODAT++1++1'UNH+M+PRODAT:D:97A:UN:E2SE6A'BGM+Z04+D+9+AB'DTM+137:202609171200:203'DTM+ZZZ:1:805'NAD+FR+12345:160:SVK+++++++SE'NAD+DO+54321:160:SVK+++++++SE'LIN+1++735123456789012345:::9+1:1'DTM+92:202610010000:203'DTM+354:15:806'QTY+31:1000:KWH'CCI++Z13'CAV+Z22'CCI++Z04'CAV+Z03'CCI++Z07'CAV+Z12'CCI++Z12'CAV+:::D'CCI++Z15'CAV+D'CCI++Z14'CAV+:::L917:8716867000030'RFF+MG:METER-735123456789012345'RFF+Z05:TES'RFF+LI:NEGATIVE-OWN'NAD+UD+199001011234:SE2:260++Synthetic+Street+City++12345+SE'NAD+IT+735123456789012345::9+++Street+Town++12345+SE'NAD+Z02+54321:160:SVK'LIN+2++735123456789012345:::9+1:2'LIN+3++735123456789012352:::9'DTM+92:202610010000:203'DTM+354:15:806'QTY+31:1000:KWH'CCI++Z13'CAV+Z22'CCI++Z04'CAV+Z03'CCI++Z07'CAV+Z12'CCI++Z12'CAV+:::D'CCI++Z15'CAV+D'CCI++Z14'CAV+:::L917:8716867000030'RFF+MG:METER-735123456789012352'RFF+Z05:TES'RFF+LI:EXACT-NATIVE-LI'NAD+UD+199001011234:SE2:260++Synthetic+Street+City++12345+SE'NAD+IT+735123456789012352::9+++Street+Town++12345+SE'NAD+Z02+54321:160:SVK'UNT+52+M'UNZ+1+I'"
it('keeps default and explicit-false native wire byte-identical to the literal preimage',()=>{
 for(const wire of [mixedProdatNativeWire(nativeFixtureInput),mixedProdatNativeWire({...nativeFixtureInput,ownReadingDeclarations:false})]){
  expect(wire).toBe(defaultNativeWire)
  expect(Buffer.byteLength(wire,'utf8')).toBe(1082)
  expect(createHash('sha256').update(wire,'utf8').digest('hex')).toBe('49906c684be1dd61f330e8aed9b1c14a765cfd3058aef884c40102c0ea68a0f4')
 }
})
it('explicit reading opt-in supplies each physical register before birth while keeping the second quantity absent',()=>{
 const wire=mixedProdatNativeWire({...nativeFixtureInput,ownReadingDeclarations:true}),tokens=tokenizeEdifact(wire)
 const starts=tokens.segments.flatMap((token,index)=>token.tag==='LIN'?[index]:[])
 expect(starts).toHaveLength(3)
 const registers=starts.map((start,index)=>tokens.segments.slice(start,starts[index+1]??tokens.segments.findIndex(token=>token.tag==='UNT')))
 for(const own of registers){
  expect(own.flatMap((token,index)=>token.tag==='CCI'&&['Z02','Z05','Z16'].includes(segmentComposite(token,2,tokens.una)[0])?[`${token.raw}'${own[index+1].raw}`]:[])).toEqual(["CCI++Z02'CAV+:::1","CCI++Z05'CAV+:::6","CCI++Z16'CAV+:::111"])
 }
 // Literal LIN2 has only its own declarations: no inherited quantity, LI or UD.
 expect(registers[1].map(token=>token.raw)).toEqual(["LIN+2++735123456789012345:::9+1:2",'CCI++Z02','CAV+:::1','CCI++Z05','CAV+:::6','CCI++Z16','CAV+:::111'])
 expect(registers[0].filter(token=>token.tag==='QTY').map(token=>token.raw)).toEqual(['QTY+31:1000:KWH'])
 expect(registers[2].filter(token=>token.tag==='QTY').map(token=>token.raw)).toEqual(['QTY+31:1000:KWH'])
 const unh=tokens.segments.findIndex(token=>token.tag==='UNH'),unt=tokens.segments.findIndex(token=>token.tag==='UNT')
 expect(tokens.segments[unt].raw).toBe('UNT+70+M')
 expect(Number(segmentComposite(tokens.segments[unt],1,tokens.una)[0])).toBe(unt-unh+1)
 expect(segmentComposite(tokens.segments[unt],2,tokens.una)).toEqual(segmentComposite(tokens.segments[unh],1,tokens.una))
})
it('the unchanged default lacks private own readings even with the real actor and poisoned public false',async()=>{
 const wire=mixedProdatNativeWire(nativeFixtureInput),m=prodatOwnSourceReadingMessage(wire)
 m.parsed_payload={subtype:'L',prodatDependentFacts:{market:'electricity',meterReadingsSentInUtilts:false}}
 installProdatOwnSourceReadingFixture(reads,m,'L',{actorUserId:prodatOwnSourceReadingActor,receivedAt:m.message_received_at!,mailId:m.inbound_email_message_id!,parseId:'00000000-0000-4000-8000-000000000005',receptionId:'00000000-0000-4000-8000-000000000006',legalActorId:'00000000-0000-4000-8000-000000000008'})
 const d=await resolveCanonicalRuntimeDecisionWithRegistry(m,{actorUserId:prodatOwnSourceReadingActor})
 expect(projectReceivedProdatObjectValidation(wire,d)?.objects.map(o=>o.disposition)).toEqual(['unavailable','unavailable'])
})
it('native source oracle is full-guide mixed with every own field actual, without wholesale dependent overrides',async()=>{
 const wire=mixedProdatNativeWire({...nativeFixtureInput,ownReadingDeclarations:true}),m=prodatOwnSourceReadingMessage(wire)
 const hash=createHash('sha256').update(wire,'utf8').digest('hex')
 expect(m.raw_payload).toBe(wire)
 expect(m.execution_context_snapshot).toMatchObject({receivedProdatContext:{payloadHash:hash,sourceMessageId:m.id,sourceReceivedAt:m.message_received_at}})
 m.parsed_payload={subtype:'L',prodatDependentFacts:{market:'electricity',meterReadingsSentInUtilts:false}}
 installProdatOwnSourceReadingFixture(reads,m,'L',{actorUserId:prodatOwnSourceReadingActor,receivedAt:m.message_received_at!,mailId:m.inbound_email_message_id!,parseId:'00000000-0000-4000-8000-000000000005',receptionId:'00000000-0000-4000-8000-000000000006',legalActorId:'00000000-0000-4000-8000-000000000008'})
 const d=await resolveCanonicalRuntimeDecisionWithRegistry(m,{actorUserId:prodatOwnSourceReadingActor}),facet=projectReceivedProdatObjectValidation(wire,d)
 expect(facet?.objects.map(o=>o.disposition),JSON.stringify(d.issues)).toEqual(['rejected','accepted'])
})
