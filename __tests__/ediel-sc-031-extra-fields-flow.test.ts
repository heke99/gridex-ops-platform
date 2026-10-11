// masterplan: SC-031
import {beforeEach,it,expect,vi} from 'vitest'
import {guideOrderedFixtureRaw as raw} from './helpers/prodatGuideOrderedFixture'
import {source,head,own} from './fixtures/prodat-identity'
import type {EdielMessageRow} from '@/lib/ediel/types'
const state=vi.hoisted(()=>({message:{} as EdielMessageRow, effects:[] as string[], calls:[] as {kind:string;args:Record<string,unknown>}[], drafts:[] as Record<string,unknown>[], events:[] as Record<string,unknown>[]}))
vi.mock('@/lib/ediel/rulebook/canonicalRulePackRegistry',async original=>({...await original<Record<string,unknown>>(),resolveCanonicalRulePack:async()=>(await import('./helpers/prodatInboundSourceFixture')).prodatFixtureRegistryResolution}))
vi.mock('@/lib/ediel/mailReadiness',()=>({assertEdielSmtpReadiness:()=>({from:'fixture@example.invalid',host:'smtp.example.invalid',port:465})}))
vi.mock('@/lib/supabase/service',async()=>({supabaseService:(await import('./helpers/prodatInboundSourceFixture')).prodatFixtureSourceDatabase}))
vi.mock('@/lib/ediel/db',()=>({getEdielMessageById:async()=>state.message,createEdielMessageEvent:async(p:Record<string,unknown>)=>{state.events.push(p)},updateEdielMessageStatus:async(p:{status:string;parsedPayload?:Record<string,unknown>;validationReport?:Record<string,unknown>})=>{state.message={...state.message,status:p.status,parsed_payload:p.parsedPayload??state.message.parsed_payload,validation_report:p.validationReport??state.message.validation_report} as EdielMessageRow;return state.message},linkEdielMessage:async()=>{state.effects.push('link')},listAckMessagesForSource:async()=>[],getEdielRouteProfileByCommunicationRouteId:async()=>null,listEdielMessagesByIds:async()=>[]}))
vi.mock('@/lib/ediel/core/tenantResolver',()=>({resolveInboundTenantForMessage:async()=>({status:'tenant_resolved',message:state.message,companyId:state.message.company_id,evidence:{companyId:state.message.company_id}})}))
vi.mock('@/lib/ediel/core/kernel',()=>({createCanonicalAckMessage:async(p:{ackFamily:string;sourceMessage:EdielMessageRow;draft:Record<string,unknown>})=>{state.drafts.push(p.draft);return (await import('./helpers/prodatInboundSourceFixture')).prodatFixtureAckResult(p)}}))
vi.mock('@/lib/ediel/actorTestingEngine',()=>({syncActorTestingForMessage:async()=>{state.effects.push('actor-auto');return null}}))
vi.mock('@/lib/ediel/inbound/inboundFacilityRecognition',()=>({recognizeInboundFacilityData:async()=>{state.effects.push('facility');return null}}))
vi.mock('@/lib/ediel/matching',()=>({matchMeteringPointForEdielMessage:async()=>null,matchSiteAndCustomerForMeteringPoint:async()=>null,findMatchingSupplierSwitchRequest:async()=>null}))
vi.mock('@/lib/ediel/inboundCases',()=>({createOrUpdateInboundProdatCase:async(a:Record<string,unknown>)=>{state.calls.push({kind:'case',args:a});return null}}))
vi.mock('@/lib/onboarding/inboundEdielLinking',()=>({applyInboundProdatZ02ToCustomerInfoRequest:async()=>null,applyInboundProdatZ14ToMeteringPermission:async()=>null}))
vi.mock('@/lib/ediel/flows/inboundBusinessStateMachine',()=>({applyInboundBusinessStateMachine:async(a:Record<string,unknown>)=>{state.calls.push({kind:'business',args:a});return null}}))
vi.mock('@/lib/ediel/operationalVerification',()=>({buildSafeMasterdataProposal:async()=>[{field:'synthetic',reviewRequired:true}]}))
vi.mock('@/lib/ediel/orchestrator/edielProcessingPipeline',()=>({analyzeEdielProcessingPipeline:async()=>null}))
vi.mock('@/lib/ediel/core/messageBuilder',async importOriginal=>(await import('./helpers/p16bHold')).captureP16bPreflight(importOriginal))
vi.mock('@/lib/inbound-mail/edielMailboxPoller',()=>({runInboundEdielMailEngine:async()=>null}))
import {processInboundEdielMessage} from '@/lib/ediel/flows/inboundProcessing'
import {p16bBlockedAperaks} from './helpers/p16bHold'
import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {resolveCanonicalEdielPolicy} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import {validateCanonicalPolicyFields} from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import {validateEdielMessageRowWithRulebook} from '@/lib/ediel/rulebook/validator'
import {assertRulebookAllowsSend} from '@/lib/ediel/rulebook/sendGuards'
import {buildProdatMessage} from '@/lib/ediel/prodat/buildProdat'
import {selectedAddressFact} from './fixtures/prodat-ud'
import {withProdatFixtureInsertContext} from './helpers/prodatInboundSourceFixture'

beforeEach(()=>{p16bBlockedAperaks.length=0;state.effects=[];state.calls=[];state.drafts=[];state.events=[]})
const run=async(message:EdielMessageRow)=>{state.effects=[];state.calls=[];state.drafts=[];state.events=[];state.message=withProdatFixtureInsertContext({...message,status:'received',parsed_payload:{fileEngine:{mode:'agt'}}} as EdielMessageRow);await processInboundEdielMessage({actorUserId:'00000000-0000-4000-8000-000000000002',edielMessageId:message.id});
 return {message:state.message,drafts:[...state.drafts],calls:[...state.calls],effects:[...state.effects]}}
type Parts=ReturnType<typeof head>[number]
type Row=EdielMessageRow&{parsed_payload:{canonical:Record<string,unknown>}}
const base=():Parts[]=>[...head(),...own('1','735123456789012345','CASE-A')]
// P26.A r3 p119 (incoming X): field 224 RFF+MG meter number and field 213 QTY+31 are not used in Z01.
const extras:[string,string,Parts,(body:Parts[])=>number][]=[
 ['224','RFF+MG:IGNORED-METER',['RFF',['MG','IGNORED-METER']],body=>body.findIndex(p=>p[0]==='RFF')],
 ['213','QTY+31:777:KWH',['QTY',['31','777','KWH']],body=>body.findIndex(p=>p[0]==='LIN')+1],
]
const insert=(segment:Parts,at:(body:Parts[])=>number)=>{const body=base();body.splice(at(body),0,segment);return body}
// Business projection received by the case and business-state owners; only raw evidence carriers are left out.
const business=(calls:{kind:string;args:Record<string,unknown>}[])=>calls.map(({kind,args})=>{
 const omit=<T extends Record<string,unknown>>(value:T,keys:string[])=>Object.fromEntries(Object.entries(value).filter(([key])=>!keys.includes(key)))
 const message=args.message as Row,rest=omit(args,['message','onSourceSwitchCommitted'])
 const canonical=omit(message.parsed_payload.canonical,['rawSegments','prodatIgnoredFields'])
 return {kind,rest,companyId:message.company_id,code:message.message_code,status:message.status,canonical}})

const flow=async(field:string,marker:string,segment:Parts,at:(body:Parts[])=>number)=>{
 const withWire=raw(insert(segment,at),'Z01'),withoutWire=raw(base(),'Z01')
 expect(withWire).toContain(marker);expect(withoutWire).not.toContain(marker)
 const withExtra=await run(source(withWire)),without=await run(source(withoutWire))
 for(const result of [withExtra,without]){
  expect(result.message.validation_report).toMatchObject({syntaxDecision:'accepted',applicationDecision:'accepted',prodatProcessingDisposition:{kind:'continue'}})
  const plan=result.message.validation_report.responsePlan as {family:string;outcome:string}[]
  expect(plan.length).toBeGreaterThan(0);expect(plan.every(item=>item.outcome==='positive')).toBe(true)
  expect(result.drafts.length).toBeGreaterThan(0)
  expect(result.drafts.every(draft=>draft.ackOutcome==='positive')).toBe(true)
  expect(result.drafts.some(draft=>['APERAK','CONTRL'].includes(String(draft.messageFamily))&&draft.ackOutcome!=='positive')).toBe(false)
  expect(result.drafts.map(draft=>String(draft.rawPayload)).join('')).not.toMatch(/ERC\+|UCI\+[^']*\+[478]'/)
  expect(p16bBlockedAperaks).toEqual([])
  expect(result.calls.map(call=>call.kind)).toEqual(['case','business'])
 }
 expect(withExtra.drafts.map(d=>[d.messageFamily,d.ackOutcome])).toEqual(without.drafts.map(d=>[d.messageFamily,d.ackOutcome]))
 expect((withExtra.message as Row).parsed_payload.canonical.prodatIgnoredFields).toContainEqual(expect.objectContaining({fieldNumber:field,sourceRule:'PRODAT26A:P119'}))
 expect((without.message as Row).parsed_payload.canonical.prodatIgnoredFields).toEqual([])
 expect(business(withExtra.calls)).toEqual(business(without.calls))
 // The raw segment list keeps the ignored evidence; the business projection does not.
 expect((withExtra.message as Row).parsed_payload.canonical.rawSegments).toContain(marker)
 for(const call of withExtra.calls){const canonical=(call.args.message as Row).parsed_payload.canonical as {references:{raw:string}[];quantities:{raw:string}[]}
  expect([...canonical.references,...canonical.quantities].map(row=>row.raw)).not.toContain(marker)}
 // Raw evidence is preserved unchanged on the stored row and on the message handed to the business owners.
 expect(withExtra.message.raw_payload).toBe(withWire)
 for(const call of withExtra.calls)expect((call.args.message as EdielMessageRow).raw_payload).toBe(withWire)
}
it('incoming Z01 with ignorable field 224 (RFF+MG): same positive ACKs and identical business data as without it',()=>flow(...extras[0]))
it('incoming Z01 with ignorable field 213 (QTY+31): same positive ACKs and identical business data as without it',()=>flow(...extras[1]))

const outboundInput={companyId:'tenant',role:'supplier',businessCode:'Z01',transactionSubtype:'L',sender:{edielId:'12345'},receiver:{edielId:'54321'},
 meteringPoint:{id:'A',identityAgency:'89' as const,gridArea:'TES'},customer:{id:'USER',idAgency:'89' as const,name:'Synthetic',addressLines:['Street'],city:'City',postalCode:'12345'},
 dates:{contractStartDate:'202610010000'},references:{LI:'CASE',ANJ:'POA'} as Record<string,string>,codedAttributes:{Z13:'Z22'},environment:'test',
 dependentConditionFacts:{endUserAddressObjects:[selectedAddressFact('A','tenant','89','USER',['Street'])]}}
const sendRow=(built:ReturnType<typeof buildProdatMessage>)=>({company_id:'tenant',direction:'outbound',environment:'test',message_family:'PRODAT',message_code:'Z01',message_version:'26A',
 application_reference:'23-DDQ-PRODAT',mime_type:'application/edifact',message_standard:'edifact',raw_payload:built.rawEdifact,
 parsed_payload:{prodatEngine:{registerEvidence:built.registerEvidence}}}) as unknown as EdielMessageRow
const outboundPolicyBlocking=(wire:string)=>{const t=tokenizeEdifact(wire)
 const policy=resolveCanonicalEdielPolicy({family:'PRODAT',messageCode:'Z01',subtypeOrReasonCode:'L',direction:'outbound',referenceDate:'2026-09-30',mode:'send',applicationReference:'23-DDQ-PRODAT'})
 return validateCanonicalPolicyFields({policy,rawSegments:t.segments.map(x=>x.raw),una:t.una}).filter(issue=>issue.blocking)}

it('receive tolerance does not make the canonical PRODAT builder send ignored fields, and outbound validation blocks them',()=>{
 const built=buildProdatMessage(outboundInput)
 const segments=tokenizeEdifact(built.rawEdifact).segments.map(segment=>segment.raw)
 expect(segments.some(segment=>segment.startsWith('RFF+MG'))).toBe(false)
 expect(segments.some(segment=>segment.startsWith('QTY+31'))).toBe(false)
 expect(()=>assertRulebookAllowsSend(sendRow(built))).not.toThrow()
 expect(outboundPolicyBlocking(built.rawEdifact).some(issue=>issue.prodatDiagnostic?.kind==='field'&&issue.prodatDiagnostic.fieldNumber==='224')).toBe(false)
 // A caller-supplied ignored field is never sendable: the outbound field matrix and the send gate block it.
 const tainted=buildProdatMessage({...outboundInput,references:{...outboundInput.references,MG:'IGNORED-METER'}})
 expect(outboundPolicyBlocking(tainted.rawEdifact)).toContainEqual(expect.objectContaining({code:'FIELD_MATRIX_FORBIDDEN_FIELD_PRESENT',fieldPath:'RFF+MG',blocking:true,
  prodatDiagnostic:expect.objectContaining({fieldNumber:'224'})}))
 expect(validateEdielMessageRowWithRulebook(sendRow(tainted),'send').issues).toContainEqual(expect.objectContaining({code:'FIELD_MATRIX_FORBIDDEN_FIELD_PRESENT',fieldPath:'RFF+MG',blocking:true}))
 expect(()=>assertRulebookAllowsSend(sendRow(tainted))).toThrow(/FIELD_MATRIX_FORBIDDEN_FIELD_PRESENT/)
 // Same for field 213 QTY+31 spliced into our own built wire.
 const qty=built.rawEdifact.replace("DTM+92:","QTY+31:5:KWH'DTM+92:")
 expect(outboundPolicyBlocking(qty)).toContainEqual(expect.objectContaining({blocking:true,prodatDiagnostic:expect.objectContaining({fieldNumber:'213'})}))
})
