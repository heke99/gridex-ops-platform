// masterplan: ACK-08, AT-ACK-08
import {beforeEach,expect,it,vi} from 'vitest'
import {installProdatOwnSourceReadingFixture,resetProdatOwnSourceReadingSdk,prodatOwnSourceReadingMessage,withProdatOwnSourceReadings,prodatOwnSourceReadingActor,type ProdatOwnSourceReadingSdk} from './helpers/prodatOwnSourceReadingFixture'
import {loadProdatOwnSourceReadingContext} from '@/lib/ediel/core/prodatOwnSourceRegisterReadingDeclarations'
const fixtureSdk=vi.hoisted(()=>({value:null as ProdatOwnSourceReadingSdk|null}))
vi.mock('@/lib/supabase/service',async()=>{
 const {createProdatOwnSourceReadingSdk}=await import('./helpers/prodatOwnSourceReadingFixture')
 fixtureSdk.value=createProdatOwnSourceReadingSdk()
 return {supabaseService:{from:fixtureSdk.value.from,rpc:fixtureSdk.value.rpc}}
})
const io=fixtureSdk.value!
beforeEach(()=>resetProdatOwnSourceReadingSdk(io))

import {source} from './fixtures/prodat-identity'
import {guideOrderedFixtureRaw as raw} from './helpers/prodatGuideOrderedFixture'
import {mixedZ04Parts} from './helpers/mixedZ04Fixture'
import {resolveCanonicalRuntimeDecision} from '@/lib/ediel/core/runtimeDecision'
import {buildAperakDraft} from '@/lib/ediel/ack'
import {validateCanonicalAckGuide} from '@/lib/ediel/rulebook/ackGuidePolicy'
import {resolveCanonicalMessagePolicy} from '@/lib/ediel/core/messagePolicy'
import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
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
 installProdatOwnSourceReadingFixture(io,m,'L')
 const context=await loadProdatOwnSourceReadingContext(m,prodatOwnSourceReadingActor)
 if(!context)throw Error('OWN_READING_FIXTURE_CONTEXT_NOT_ISSUED')
 const d=resolveCanonicalRuntimeDecision(m,{prodatOwnSourceReadingContext:context,prodatOwnSourceReadingActorUserId:prodatOwnSourceReadingActor}),facet=projectReceivedProdatObjectValidation(wire,d)
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
it('native source oracle is full-guide mixed with every own field actual, without wholesale dependent overrides',async()=>{
 const wire=withProdatOwnSourceReadings(mixedProdatNativeWire({external:'735123456789012352',negativePoint:'735123456789012345',sender:'54321',receiver:'12345',caseReference:'EXACT-NATIVE-LI',customerIdentity:{id:'199001011234',qualifier:'SE2',agency:'260'},startMinute:'202610010000'}))
 const m=prodatOwnSourceReadingMessage(wire);m.parsed_payload={subtype:'L',prodatDependentFacts:{market:'electricity',meterReadingsSentInUtilts:false}}
 installProdatOwnSourceReadingFixture(io,m,'L')
 const context=await loadProdatOwnSourceReadingContext(m,prodatOwnSourceReadingActor)
 if(!context)throw Error('OWN_READING_FIXTURE_CONTEXT_NOT_ISSUED')
 const d=resolveCanonicalRuntimeDecision(m,{prodatOwnSourceReadingContext:context,prodatOwnSourceReadingActorUserId:prodatOwnSourceReadingActor}),facet=projectReceivedProdatObjectValidation(wire,d)
 expect(facet?.objects.map(o=>o.disposition),JSON.stringify(d.issues)).toEqual(['rejected','accepted'])
})
