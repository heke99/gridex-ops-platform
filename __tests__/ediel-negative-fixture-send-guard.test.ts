import {beforeEach,describe,expect,it,vi} from 'vitest'
import {createHash} from 'node:crypto'
const io=vi.hoisted(()=>({rpc:vi.fn(),validate:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc}}))
vi.mock('@/lib/ediel/rulebook/validator',()=>({validateEdielMessageRowWithRulebook:io.validate}))
vi.mock('@/lib/ediel/prodat/prodatFreeText',()=>({assertProdatFreeTextSendBoundary:vi.fn()}))
vi.mock('@/lib/ediel/prodat/prodatGasAuthority',()=>({gasApplicabilitySendIssue:()=>null}))
vi.mock('@/lib/ediel/prodat/prodatMeterChangeAuthority',()=>({assertMeterChangeSendBoundary:vi.fn()}))
import {assertRulebookAllowsSend} from '@/lib/ediel/rulebook/sendGuards'
import {resolveSourceQualifiedNegativeFixtureForMessage} from '@/lib/ediel/testing/negativeFixtureAuthority'
import {encodeEdifactLatin1} from '@/lib/ediel/core/edifactEncoding'
import type {EdielMessageRow} from '@/lib/ediel/types'
const raw="UNA:+.? 'UNB+UNOC:3+S:ZZ+TEST:ZZ+260930:1200+I'UNH+M+PRODAT:D:97A:UN:E2SE6A'BGM+Z01+DOC'UNT+3+M'UNZ+1+I'"
const message=()=>({id:'synthetic-message',company_id:'synthetic-company',environment:'test',direction:'outbound',message_standard:'edifact',raw_payload:raw}) as EdielMessageRow
const diagnostic=(code='NATIONAL_FIELD_MISSING',scope?:string)=>({code,scope,severity:'error',blocking:true,title:'Synthetic expected original error',description:'Synthetic source contract only'})
beforeEach(()=>{
 io.validate.mockReset();io.rpc.mockReset()
 io.validate.mockReturnValue({ok:false,blocking:true,issues:[diagnostic()],canonicalPolicy:{sourceTrace:['synthetic source owner']}})
 io.rpc.mockResolvedValue({data:{registrationId:'synthetic-registration',companyId:'synthetic-company',runId:'synthetic-run',roleCode:'supplier',caseCode:'synthetic-case',suite:'PRODAT',revision:'synthetic-revision',stepNo:1,wireSha256:createHash('sha256').update(encodeEdifactLatin1(raw)).digest('hex'),originalFileSha256:createHash('sha256').update(encodeEdifactLatin1(raw)).digest('hex'),expectedOutcome:'negative',expectedDiagnosticCodes:['NATIONAL_FIELD_MISSING'],testReceiverEdielId:'TEST',validUntil:new Date(Date.now()+3600_000).toISOString(),sourceReference:'synthetic://unit-original',ownerDecisionReference:'synthetic://unit-only'},error:null})
})
describe('qualified negative original send boundary, synthetic source port only',()=>{
 it('retains the actual failed validation while allowing the exact registered test original',async()=>{
  const m=message(),proof=await resolveSourceQualifiedNegativeFixtureForMessage({message:m,actorUserId:'synthetic-actor'})
  const validation=assertRulebookAllowsSend(m,undefined,undefined,proof)
  expect(validation).toMatchObject({ok:false,blocking:true,issues:[{code:'NATIONAL_FIELD_MISSING'}]})
 })
 it('does not allow metadata flags without the protected source port',()=>{
  expect(()=>assertRulebookAllowsSend({...message(),parsed_payload:{rulebookAllowInvalidSend:true,negativeFixtureEvidence:{registrationId:'synthetic-registration'}}})).toThrow(/Rulebook blockerar/)
 })
 it('never opens production with a genuine test qualification',async()=>{
  const m=message(),proof=await resolveSourceQualifiedNegativeFixtureForMessage({message:m,actorUserId:'synthetic-actor'})
  expect(()=>assertRulebookAllowsSend({...m,environment:'production'},undefined,undefined,proof)).toThrow(/Rulebook blockerar/)
 })
 it.each(['prodat_register','prodat_dependent'])('keeps protected %s source facts strict',async(scope)=>{
  const m=message(),proof=await resolveSourceQualifiedNegativeFixtureForMessage({message:m,actorUserId:'synthetic-actor'})
  io.validate.mockReturnValue({ok:false,blocking:true,canonicalPolicy:{},issues:[diagnostic('NATIONAL_FIELD_MISSING',scope)]})
  expect(()=>assertRulebookAllowsSend(m,undefined,undefined,proof)).toThrow(/PRODAT/)
 })
 it('holds an authority failure even when the private port expected that diagnostic',async()=>{
  const data=(await io.rpc()).data;io.rpc.mockResolvedValue({data:{...data,expectedDiagnosticCodes:['CANONICAL_POLICY_VALIDATION_FAILED']},error:null})
  const m=message(),proof=await resolveSourceQualifiedNegativeFixtureForMessage({message:m,actorUserId:'synthetic-actor'})
  io.validate.mockReturnValue({ok:false,blocking:true,canonicalPolicy:{},issues:[diagnostic('CANONICAL_POLICY_VALIDATION_FAILED')]})
  expect(()=>assertRulebookAllowsSend(m,undefined,undefined,proof)).toThrow(/Rulebook blockerar/)
 })
})
