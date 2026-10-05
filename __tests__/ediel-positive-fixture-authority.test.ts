import {beforeEach,describe,expect,it,vi} from 'vitest'
import {createHash} from 'node:crypto'
import {encodeEdifactLatin1} from '@/lib/ediel/core/edifactEncoding'
const io=vi.hoisted(()=>({rpc:vi.fn(),actor:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc}}))
vi.mock('@/lib/ediel/services/authorization',()=>({assertEdielTenantActor:io.actor}))
import {resolveSourceQualifiedPositiveFixtureDraft,sourceQualifiedPositiveFixtureMatchesDraft,bindSourceQualifiedPositiveFixtureDraft,readSourceQualifiedPositiveFixtureDraft,prepareSourceQualifiedPositiveFixtureWitness} from '@/lib/ediel/testing/positiveFixtureAuthority'
const raw="UNA:+.? 'UNB+UNOC:3+S:ZZ+TEST:ZZ+260930:1200+I++APP++++1'UNH+M+PRODAT:D:97A:UN:E2SE6A'BGM+Z09+DOC+9'UNT+3+M'UNZ+1+I'"
const q=()=>({kind:'source_qualified_positive_fixture',version:1,registrationId:'original',companyId:'company',runId:'run',roleCode:'supplier',caseCode:'case',suite:'PRODAT',revision:'revision',stepNo:1,wireSha256:createHash('sha256').update(encodeEdifactLatin1(raw)).digest('hex'),originalFileSha256:createHash('sha256').update(encodeEdifactLatin1(raw)).digest('hex'),expectedOutcome:'positive',expectedDiagnosticCodes:[],testReceiverEdielId:'TEST',validUntil:new Date(Date.now()+3600_000).toISOString(),sourceReference:'synthetic://unit-original',ownerDecisionReference:'synthetic://unit-owner',authorizesBusinessEffect:false})
const input=()=>({companyId:'company',runId:'run',stepNo:1,actorUserId:'actor',rawPayload:raw,diagnosticCodes:[]})
const draft=()=>({companyId:'company',environment:'test',direction:'outbound',rawPayload:raw})
beforeEach(()=>{io.rpc.mockReset();io.actor.mockReset();io.actor.mockResolvedValue(undefined);io.rpc.mockResolvedValue({data:q(),error:null})})
describe('positive original test provenance, synthetic source port only',()=>{
 it('binds only unchanged original bytes and holds an absent original',async()=>{
  const qualification=await resolveSourceQualifiedPositiveFixtureDraft(input()),d=draft()
  bindSourceQualifiedPositiveFixtureDraft(d,qualification!)
  expect(readSourceQualifiedPositiveFixtureDraft(d)).toBe(qualification)
  expect(readSourceQualifiedPositiveFixtureDraft({...d})).toBeNull()
  expect(sourceQualifiedPositiveFixtureMatchesDraft({draft:{...d},qualification,diagnosticCodes:[]})).toBe(true)
  expect(qualification?.authorizesBusinessEffect).toBe(false)
  io.rpc.mockResolvedValue({data:null,error:null});expect(await resolveSourceQualifiedPositiveFixtureDraft(input())).toBeNull()
 })
 it.each([{environment:'production'},{companyId:'other'},{direction:'inbound'},{rawPayload:raw+' '}])('rejects changed draft scope %o',async(change)=>{
  const qualification=await resolveSourceQualifiedPositiveFixtureDraft(input())
  expect(sourceQualifiedPositiveFixtureMatchesDraft({draft:{...draft(),...change},qualification,diagnosticCodes:[]})).toBe(false)
 })
 it('does not accept copied JSON, unexpected findings or a negative registration',async()=>{
  const qualification=await resolveSourceQualifiedPositiveFixtureDraft(input())
  expect(sourceQualifiedPositiveFixtureMatchesDraft({draft:draft(),qualification:{...qualification!},diagnosticCodes:[]})).toBe(false)
  expect(sourceQualifiedPositiveFixtureMatchesDraft({draft:draft(),qualification,diagnosticCodes:['NATIONAL_ERROR']})).toBe(false)
  expect(await resolveSourceQualifiedPositiveFixtureDraft({...input(),diagnosticCodes:['NATIONAL_ERROR']})).toBeNull()
  io.rpc.mockResolvedValue({data:{...q(),expectedOutcome:'negative',expectedDiagnosticCodes:['NATIONAL_ERROR']},error:null})
  await expect(resolveSourceQualifiedPositiveFixtureDraft(input())).rejects.toThrow('scope_invalid')
 })
 it('checks the actual actor before reading and prepares only the same opaque original',async()=>{
  const qualification=await resolveSourceQualifiedPositiveFixtureDraft(input())
  expect(io.actor).toHaveBeenCalledWith({companyId:'company',actorUserId:'actor',permissionAnyOf:['communication.write','ediel_testing.write']})
  io.rpc.mockResolvedValue({data:{witnessId:'witness',qualification:q()},error:null})
  expect(await prepareSourceQualifiedPositiveFixtureWitness({qualification:qualification!,actorUserId:'actor',rawPayload:raw})).toEqual({witnessId:'witness',qualification})
  await expect(prepareSourceQualifiedPositiveFixtureWitness({qualification:qualification!,actorUserId:'other',rawPayload:raw})).rejects.toThrow('witness_required')
  await expect(prepareSourceQualifiedPositiveFixtureWitness({qualification:{...qualification!},actorUserId:'actor',rawPayload:raw})).rejects.toThrow('witness_required')
 })
})
