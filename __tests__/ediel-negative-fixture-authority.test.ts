import {beforeEach,describe,expect,it,vi} from 'vitest'
import {createHash} from 'node:crypto'
const io=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc}}))
vi.mock('@/lib/ediel/services/authorization',()=>({assertEdielTenantActor:vi.fn().mockResolvedValue(undefined)}))
import {bindSourceQualifiedNegativeFixtureDraft,readSourceQualifiedNegativeFixtureDraft,resolveSourceQualifiedNegativeFixtureDraft,resolveSourceQualifiedNegativeFixtureForMessage,sourceQualifiedNegativeFixtureMatchesMessage,sourceQualifiedNegativeFixtureMatchesDraft,sourceQualifiedNegativeFixtureAllowsPreflight} from '@/lib/ediel/testing/negativeFixtureAuthority'
import type {EdielPayloadPreflightResult} from '@/lib/ediel/core/messageBuilder'
import {encodeEdifactLatin1} from '@/lib/ediel/core/edifactEncoding'
import type {EdielMessageRow} from '@/lib/ediel/types'
const raw="UNA:+.? 'UNB+UNOC:3+S:ZZ+TEST:ZZ+260930:1200+I'UNH+M+PRODAT:D:97A:UN:E2SE6A'BGM+Z01+DOC'UNT+3+M'UNZ+1+I'"
const source=()=>({registrationId:'synthetic-registration',companyId:'synthetic-company',runId:'synthetic-run',roleCode:'supplier',caseCode:'synthetic-case',suite:'PRODAT',revision:'synthetic-revision',stepNo:1,wireSha256:createHash('sha256').update(encodeEdifactLatin1(raw)).digest('hex'),originalFileSha256:createHash('sha256').update(encodeEdifactLatin1(raw)).digest('hex'),expectedOutcome:'negative',expectedDiagnosticCodes:['NATIONAL_FIELD_MISSING'],testReceiverEdielId:'TEST',validUntil:new Date(Date.now()+3600_000).toISOString(),sourceReference:'synthetic://unit-original',ownerDecisionReference:'synthetic://unit-only'})
const message=()=>({id:'synthetic-message',company_id:'synthetic-company',environment:'test',direction:'outbound',message_standard:'edifact',raw_payload:raw}) as EdielMessageRow
beforeEach(()=>{io.rpc.mockReset();io.rpc.mockResolvedValue({data:source(),error:null})})
describe('source-qualified negative fixture capability, synthetic port responses only',()=>{
 it('binds the actual persisted message and exact expected negative diagnostic',async()=>{
  const m=message(),qualification=await resolveSourceQualifiedNegativeFixtureForMessage({message:m,actorUserId:'synthetic-actor'})
  expect(sourceQualifiedNegativeFixtureMatchesMessage({message:m,qualification,diagnosticCodes:['NATIONAL_FIELD_MISSING']})).toBe(true)
  expect(io.rpc).toHaveBeenCalledWith('gridex_ediel_negative_fixture_read_v1',{p_context:{companyId:m.company_id,messageId:m.id,actorUserId:'synthetic-actor'}})
 })
 it('rejects copied JSON markers even with a matching original hash',()=>{
  expect(sourceQualifiedNegativeFixtureMatchesMessage({message:message(),qualification:source() as never,diagnosticCodes:['NATIONAL_FIELD_MISSING']})).toBe(false)
 })
 it.each<Partial<EdielMessageRow>>([{environment:'production'},{company_id:'other'},{id:'different'},{raw_payload:raw+' '}])('retains exact environment/tenant/message/bytes binding %o',async(change)=>{
  const m=message(),qualification=await resolveSourceQualifiedNegativeFixtureForMessage({message:m,actorUserId:'synthetic-actor'})
  expect(sourceQualifiedNegativeFixtureMatchesMessage({message:{...m,...change},qualification,diagnosticCodes:['NATIONAL_FIELD_MISSING']})).toBe(false)
 })
 it('does not allow an unanticipated local error or erase the expected diagnostic',async()=>{
  const m=message(),qualification=await resolveSourceQualifiedNegativeFixtureForMessage({message:m,actorUserId:'synthetic-actor'})
  expect(sourceQualifiedNegativeFixtureMatchesMessage({message:m,qualification,diagnosticCodes:['NATIONAL_FIELD_MISSING','LOCAL_STORAGE_FAILED']})).toBe(false)
  expect(sourceQualifiedNegativeFixtureMatchesMessage({message:m,qualification,diagnosticCodes:[]})).toBe(false)
 })
 it('holds missing authenticated originals without minting a qualification',async()=>{
  io.rpc.mockResolvedValue({data:null,error:null})
  expect(await resolveSourceQualifiedNegativeFixtureForMessage({message:message(),actorUserId:'synthetic-actor'})).toBeNull()
 })
 it('passes prospective evidence only to the exact unchanged draft input',async()=>{
  const qualification=await resolveSourceQualifiedNegativeFixtureDraft({companyId:'synthetic-company',runId:'synthetic-run',stepNo:1,actorUserId:'synthetic-actor',rawPayload:raw,diagnosticCodes:['NATIONAL_FIELD_MISSING']})
  const draft={companyId:'synthetic-company',environment:'test',direction:'outbound',rawPayload:raw}
  bindSourceQualifiedNegativeFixtureDraft(draft,qualification!)
  expect(readSourceQualifiedNegativeFixtureDraft(draft)).toBe(qualification)
  expect(readSourceQualifiedNegativeFixtureDraft({...draft})).toBeNull()
  expect(sourceQualifiedNegativeFixtureMatchesDraft({draft:{...draft},qualification,diagnosticCodes:['NATIONAL_FIELD_MISSING']})).toBe(true)
  expect(sourceQualifiedNegativeFixtureMatchesDraft({draft:{...draft,rawPayload:raw+' '},qualification,diagnosticCodes:['NATIONAL_FIELD_MISSING']})).toBe(false)
  expect(sourceQualifiedNegativeFixtureMatchesDraft({draft:{...draft},qualification,diagnosticCodes:['LOCAL_CONFIG_FAILED']})).toBe(false)
  draft.rawPayload+=' ';expect(readSourceQualifiedNegativeFixtureDraft(draft)).toBeNull()
 })
 it('does not mint a draft exception for mismatched diagnostic expectation',async()=>{
  expect(await resolveSourceQualifiedNegativeFixtureDraft({companyId:'synthetic-company',runId:'synthetic-run',stepNo:1,actorUserId:'synthetic-actor',rawPayload:raw,diagnosticCodes:['LOCAL_CONFIG_FAILED']})).toBeNull()
 })
 it('qualifies only the exact preflight failure on the persisted test port',async()=>{
  const m=message(),qualification=await resolveSourceQualifiedNegativeFixtureForMessage({message:m,actorUserId:'synthetic-actor'})
  const preflight={ok:false,blocking:true,issues:[{code:'NATIONAL_FIELD_MISSING',severity:'error'}]} as EdielPayloadPreflightResult
  expect(sourceQualifiedNegativeFixtureAllowsPreflight({message:m,preflight,qualification})).toBe(true)
  expect(sourceQualifiedNegativeFixtureAllowsPreflight({message:{...m,environment:'production'},preflight,qualification})).toBe(false)
  expect(sourceQualifiedNegativeFixtureAllowsPreflight({message:m,preflight,qualification:{...qualification!}})).toBe(false)
  for(const code of ['LOCAL_UNEXPECTED','CANONICAL_AUTHORITY_MISSING','PRODAT_REGISTER_SCOPE','PRODAT_DEPENDENT_PREFLIGHT_UNKNOWN']){
   expect(sourceQualifiedNegativeFixtureAllowsPreflight({message:m,preflight:{...preflight,issues:[{code,severity:'error',title:'Synthetic',description:'synthetic'}]},qualification})).toBe(false)
  }
 })
})
