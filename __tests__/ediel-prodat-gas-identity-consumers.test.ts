import {it,expect,vi,beforeEach} from 'vitest'
import {resolveCanonicalEdielPolicy} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import {validateCanonicalPolicyFields} from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import {buildProfiledProdatSegments} from '@/lib/ediel/prodat/builders/profileRenderer'
import {createProdatRegisterEvidence} from '@/lib/ediel/prodat/prodatRegisterEvidence'
import {validateEdielMessageRowWithRulebook,validateRulebookMessageWithRegistry} from '@/lib/ediel/rulebook/validator'
import {preflightEdielMessageRow} from '@/lib/ediel/core/messageBuilder/payloadPreflight'
import {assertEdielSendLock} from '@/lib/ediel/transport/sendLock'
import {assertRulebookAllowsSend} from '@/lib/ediel/rulebook/sendGuards'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {payload,input,selection,alphabets} from './fixtures/prodat-gas'
import {identity} from './fixtures/prodat-gas-identity'
const io=vi.hoisted(()=>({from:vi.fn(()=>{throw new Error('UNEXPECTED_DB')}),provider:vi.fn(()=>{throw new Error('UNEXPECTED_PROVIDER')}),route:vi.fn(),event:vi.fn(),update:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:io.from}}))
vi.mock('@/lib/ediel/mailReadiness',()=>({assertEdielSmtpReadiness:io.provider}))
vi.mock('@/lib/ediel/db',()=>({getEdielRouteProfileByCommunicationRouteId:io.route,createEdielMessageEvent:io.event,updateEdielMessageStatus:io.update}))
import {sendEdielMessageViaSmtp} from '@/lib/ediel/transport'
beforeEach(()=>vi.clearAllMocks())
function policy(code:string,subtype:string,reporting:unknown,changed=true){
 const gasSerialChange=code==='Z06'?selection(changed):code==='Z10'?selection(changed,'Z10'):undefined
 return resolveCanonicalEdielPolicy({family:'PRODAT',messageCode:code,subtypeOrReasonCode:subtype,direction:'outbound',referenceDate:'2026-09-20',mode:'catalog_evidence',prodatDependentFacts:{gasSerialChange,gasReportingIdentity:reporting} as never})
}
for(const alphabet of alphabets)for(const [code,reason,subtype] of [['Z04','Z22','L'],['Z06','E64','F'],['Z10','E58','M']] as const)it(`actual canonical field owner compares supplied identity ${code} ${alphabet}`,()=>{
 for(const [kind,value,expected] of [['TIM','ACTUAL-TIM-SERIES',[]],['TIM','A',['PRODAT_GAS_240_IDENTITY_MISMATCH']],['SCH','A',[]],['SCH','B',['PRODAT_GAS_240_IDENTITY_MISMATCH']]] as const){
  const selected=policy(code,subtype,identity(code,reason,kind))
  const result=validateCanonicalPolicyFields({policy:{...selected,fieldRules:selected.fieldRules.filter(r=>'fieldNumber' in r&&r.fieldNumber==='240')},...input(payload(code,reason,[['RFF',['Z06',value]]],'gas',alphabet),code)})
  expect(result.filter(i=>i.blocking).map(i=>i.code)).toEqual(expected)
 }
})
for(const [code,reason,subtype] of [['Z04','Z22','L'],['Z06','E64','F'],['Z10','E58','M']] as const)it(`actual existing renderer keeps missing R, optional omission and EL boundary ${code}`,()=>{
 const context={code,senderEdielId:'12345',receiverEdielId:'54321',bgmReference:'DOC',transactionReference:'EVENT-A',customerName:'Synthetic',meterPointId:'A',meterPointIdAgency:'89' as const}
 const selected=policy(code,subtype,identity(code,reason))
 // Synthetic fragment policy only: production guide resolution and producer stay inactive.
 const result=buildProfiledProdatSegments({context,policy:{...selected,applicationReference:'27-DDQ-PRODAT'},mode:'test'})
 expect(result.issues.map(i=>i.code)).toContain('PRODAT_GAS_240_REQUIRED')
 expect(result.segments.some(s=>s.startsWith('RFF+Z06:'))).toBe(false)
 if(code!=='Z04'){
  const optional=buildProfiledProdatSegments({context,policy:{...policy(code,subtype,undefined,false),applicationReference:'27-DDQ-PRODAT'},mode:'test'})
  expect(optional.issues.filter(i=>i.code.startsWith('PRODAT_GAS_240'))).toEqual([])
  expect(optional.diagnostics.dependentConditionStatuses).toContainEqual(expect.objectContaining({fieldNumber:'240',requirement:'optional'}))
 }
 const el=buildProfiledProdatSegments({context,policy:selected,mode:'test'})
 expect(el.issues.filter(i=>i.code.startsWith('PRODAT_GAS_240'))).toEqual([])
 expect(el.segments.some(s=>s.startsWith('RFF+Z06:'))).toBe(false)
})
for(const [code,reason] of [['Z04','Z22'],['Z06','E64'],['Z10','E58']])it(`serialized reporting identity cannot unlock any persisted GAS send path ${code}`,async()=>{
 const raw=payload(code,reason,[['RFF',['Z06','ACTUAL-TIM-SERIES']]],'gas')
 const registerEvidence=createProdatRegisterEvidence({...input(raw,code),facts:{gasReportingIdentity:identity(code,reason)} as never})
 const message={id:'00000000-0000-4000-8000-000000000001',company_id:'00000000-0000-4000-8000-000000000002',direction:'outbound',environment:'test',message_family:'PRODAT',message_code:code,message_standard:'edifact',raw_payload:raw,parsed_payload:{rulebookAllowInvalidSend:true,gasReportingIdentity:identity(code,reason),prodatEngine:{registerEvidence}},communication_route_id:'route',receiver_email:'synthetic@example.test'} as unknown as EdielMessageRow
 expect(validateEdielMessageRowWithRulebook(message,'send').issues.map(i=>i.code)).toContain('PRODAT_GAS_SOURCE_UNQUALIFIED')
 expect((await validateRulebookMessageWithRegistry({family:'PRODAT',code,rawPayload:raw,mode:'send',parsedPayload:message.parsed_payload})).issues.map(i=>i.code)).toContain('PRODAT_GAS_SOURCE_UNQUALIFIED')
 expect(preflightEdielMessageRow(message).issues.map(i=>i.code)).toContain('PRODAT_DEPENDENT_PREFLIGHT_PRODAT_GAS_SOURCE_UNQUALIFIED')
 expect(()=>assertRulebookAllowsSend(message)).toThrow('PRODAT_GAS_SOURCE_UNQUALIFIED')
 expect(()=>assertEdielSendLock(message)).toThrow('PRODAT_GAS_SOURCE_UNQUALIFIED')
 await expect(sendEdielMessageViaSmtp(message,{actorUserId:'00000000-0000-4000-8000-000000000003'})).rejects.toThrow('PRODAT_GAS_SOURCE_UNQUALIFIED')
 for(const mock of Object.values(io))expect(mock).not.toHaveBeenCalled()
})
