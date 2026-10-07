// Component-only prospective profile selection. The catalog RPC is a finite
// readonly port; actual parser, envelope, register/reason and registry owners run.
// No bilateral agreement, source admission, business effect or whole proof.
import {beforeEach,expect,it,vi} from 'vitest'
import {ownerRulePack} from './helpers/sourceOwnerFixtures'
import {guideOrderedFixtureRaw} from './helpers/prodatGuideOrderedFixture'
import {alphabets,characteristic,line,raw,type Parts} from './fixtures/prodat-register'
import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {validateEdifactEnvelope} from '@/lib/ediel/core/edifactValidation'
import {prodatRegisterFieldState} from '@/lib/ediel/prodat/prodatRegisterFields'
import {resolveBilateralSwitchBirthProfile} from '@/lib/inbound-mail/bilateralSwitchBirthProfile'
const io=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc}}))
const receipt='2026-10-06T22:30:00Z',key='PRODAT:Z04:H:26.A:r3',point='735999000000001'
function registry(){
  const row=ownerRulePack()
  Object.assign(row,{profile_key:key,profile:{...row.profile,transactionSubtype:'H',reasonForTransaction:'Z25'}})
  Object.assign(row.original_snapshot.messageProfile,{profile_key:key,profile:row.profile})
  return row
}
function object(reason='Z25',sequence='1',objectId=point,register?:string):Parts[]{
  return [line(sequence,objectId,register,'9'),...characteristic('Z13',reason),['RFF',['LI','OWN-'+sequence]]]
}
function wire(body:readonly Parts[]=object(),code='Z04') {return guideOrderedFixtureRaw(body,code)}
const resolve=(payload:string|null|undefined,receivedAt=receipt)=>resolveBilateralSwitchBirthProfile({rawPayload:payload,receivedAt})
beforeEach(()=>{io.rpc.mockReset();io.rpc.mockImplementation(async(name:string)=>{
  if(name!=='resolve_canonical_ediel_rule_pack_with_witness_v1')throw Error('undeclared_birth_rpc:'+name)
  return {data:[registry()],error:null}
})})
function expectWitness(result:Awaited<ReturnType<typeof resolve>>){
  expect(result).toEqual({canonical_rule_pack_id:'00000000-0000-4000-8000-000000000012',rule_profile_key:key,
    rule_profile_version_id:'00000000-0000-4000-8000-000000000011',rule_profile_version:'26.A:r3',rule_pack_checksum:'a'.repeat(64),
    rule_pack_snapshot:{...registry().original_snapshot,profileKey:key,profileVersionId:'00000000-0000-4000-8000-000000000011',version:'26.A:r3',checksum:'a'.repeat(64)}})
}
it('selects six actual current-catalog witnesses from physical Z04/Z25, without admission flags',async()=>{
  expectWitness(await resolve(wire()))
  expect(io.rpc).toHaveBeenCalledExactlyOnceWith('resolve_canonical_ediel_rule_pack_with_witness_v1',{
    p_market:'electricity',p_family:'PRODAT',p_message_code:'Z04',p_transaction_subtype:'H',p_direction:'inbound',p_business_date:'2026-10-07'})
})
it('requires each distinct physical object to supply its own H reason',async()=>{
  expectWitness(await resolve(wire([...object(),...object('Z25','2','735999000000002')])))
})
it('allows legitimate first-register H inheritance in repeated Z04 meters',async()=>{
  expectWitness(await resolve(wire([...object('Z25','1',point,'1'),line('2',point,'2','9')])))
})
it('keeps separate object witnesses when each object has a valid repeated register chain',async()=>{
  expectWitness(await resolve(wire([...object('Z25','1',point,'1'),line('2',point,'2','9'),...object('Z25','3','735999000000002','1'),line('4','735999000000002','2','9')])))
})
it.each(alphabets)('parses the actual UNA alphabet %j and released reference data',async(component,element,release,terminator)=>{
  const payload=guideOrderedFixtureRaw([line('1',point,undefined,'9'),...characteristic('Z13','Z25'),['RFF',['LI',"OWN+CCI++Z13'CAV+Z22:?!;~"]]],'Z04',[component,element,release,terminator])
  expectWitness(await resolve(payload))
})
it.each([
  ['Z03',():string=>wire(object(),'Z03')],['Z05',()=>wire(object(),'Z05')],['Z08',()=>wire(object(),'Z08')],['Z02',()=>wire(object(),'Z02')],
  ['L',()=>wire(object('Z22'))],['LK',()=>wire(object('Z23'))],['assigned E',()=>wire(object('Z26'))],['production A',()=>wire(object('Z70'))],
  ['mixed H/L',()=>wire([...object(),...object('Z22','2','735999000000002')])],
  ['mixed LK/H',()=>wire([...object('Z23'),...object('Z25','2','735999000000002')])],
  ['missing second own reason',()=>wire([...object(),line('2','735999000000002',undefined,'9'),['RFF',['LI','SECOND']]])],
  ['missing reason',()=>wire([line('1',point,undefined,'9'),['RFF',['LI','OWN']]])],
  ['empty reason',()=>wire(object(''))],
  ['internal H alias',()=>wire(object('H'))],
  ['CAV value in wrong slot',()=>wire([line('1',point,undefined,'9'),...characteristic('Z13','Z25',3),['RFF',['LI','OWN']]])],
  ['missing adjacent CAV',()=>wire([line('1',point,undefined,'9'),['CCI','','Z13'],['RFF',['LI','OWN']]])],
  ['unrelated CCI supplying first subtype',()=>wire([line('1',point,undefined,'9'),...characteristic('Z04','Z25'),['RFF',['LI','OWN']]])],
  ['duplicate reason',()=>wire([line('1',point,undefined,'9'),...characteristic('Z13','Z25'),...characteristic('Z13','Z25'),['RFF',['LI','OWN']]])],
  ['header reason',()=>wire([...characteristic('Z13','Z25'),...object()])],
  ['only header reason',()=>wire([...characteristic('Z13','Z25'),line('1',point,undefined,'9'),['RFF',['LI','OWN']]])],
  ['reason after own RFF',()=>raw([line('1',point,undefined,'9'),['RFF',['LI','OWN']],...characteristic('Z13','Z25')],'Z04')],
  ['reason after own NAD',()=>raw([line('1',point,undefined,'9'),['NAD','UD',['001','','89']],...characteristic('Z13','Z25')],'Z04')],
  ['reason in later register',()=>wire([...object('Z25','1',point,'1'),line('2',point,'2','9'),...characteristic('Z13','Z25')])],
  ['missing object ID',()=>wire(object('Z25','1',''))],
  ['duplicate object without register indices',()=>wire([...object(),...object('Z25','2')])],
  ['invalid global LIN sequence',()=>wire(object('Z25','2'))],
  ['missing first register indicator',()=>wire([...object(),line('2',point,'2','9')])],
  ['register sequence skips',()=>wire([...object('Z25','1',point,'1'),line('2',point,'3','9')])],
  ['second register changes agency',()=>wire([...object('Z25','1',point,'1'),line('2',point,'2','89')])],
  ['standalone register index',()=>wire(object('Z25','1',point,'1'))],
  ['foreign application reference',()=>wire().replace('23-DDQ-PRODAT','10-LQR-PRODAT')],
  ['missing application reference',()=>wire().replace('23-DDQ-PRODAT','')],
  ['foreign UNH family',()=>wire().replace('PRODAT:D:97A','UTILTS:D:97A')],
  ['foreign UNH release',()=>wire().replace('PRODAT:D:97A','PRODAT:D:96A')],
  ['foreign UNH agency',()=>wire().replace('PRODAT:D:97A:UN','PRODAT:D:97A:ZZZ')],
  ['missing BGM',()=>wire().replace("BGM+Z04+D+9+AB'",'')],
  ['duplicate BGM',()=>wire([['BGM','Z04','SECOND','9'],...object()])],
  ['BGM after LIN',()=>raw([...object(),['BGM','Z04','SECOND','9']],'Z04')],
  ['wrong UNT count',()=>wire().replace(/UNT\+\d+\+M/,'UNT+999+M')],
  ['wrong UNT reference',()=>wire().replace("+M'UNZ", "+FOREIGN'UNZ")],
  ['wrong UNZ count',()=>wire().replace('UNZ+1+I','UNZ+2+I')],
  ['wrong UNZ reference',()=>wire().replace("UNZ+1+I'","UNZ+1+OTHER'")],
  ['missing UNZ',()=>wire().replace("UNZ+1+I'",'')],
  ['business after envelope',()=>wire()+"FTX+AAI+++outside'"],
  ['second physical UNH',()=>wire([['UNH','SECOND',['PRODAT','D','97A','UN','E2SE6A']],...object()])],
  ['dangling release',()=>wire()+'?'],
  ['null payload',():null=>null],['undefined payload',():undefined=>undefined],['empty payload',():string=> ''],
] as const)('does not mint a profile witness for %s',async(_label,payload)=>{
  expect(await resolve(payload())).toBeNull();expect(io.rpc).not.toHaveBeenCalled()
})
it.each(['Z13','z13',' Z13 '])('rejects a stray header qualifier %s even without a value',async qualifier=>{
  expect(await resolve(wire([['CCI','',qualifier],...object()]))).toBeNull();expect(io.rpc).not.toHaveBeenCalled()
})
it.each(['invalid','','2026-02-30T12:00:00Z','2026-10-06','2026-10-06T22:30:00'])('never substitutes now for invalid receipt %s',async receivedAt=>{
  await expect(resolve(wire(),receivedAt)).rejects.toThrow('bilateral_switch_birth_receipt_clock_invalid');expect(io.rpc).not.toHaveBeenCalled()
})
it.each([
  ['2026-10-06T21:30:00Z','2026-10-06'],['2026-10-06T22:30:00.123456+00:00','2026-10-07'],
  ['2026-12-06T22:30:00Z','2026-12-06'],['2026-12-06T23:30:00Z','2026-12-07'],
])('uses actual Stockholm receipt calendar for %s',async(receivedAt,date)=>{
  expectWitness(await resolve(wire(),receivedAt));expect(io.rpc.mock.calls[0][1].p_business_date).toBe(date)
})
it('compares actual UNH association with the selected current catalog',async()=>{
  await expect(resolve(wire().replace('E2SE6A','E2SE5A'))).rejects.toThrow('bilateral_switch_birth_association_mismatch')
})
it.each([0,2])('propagates an actual catalog count %s without selecting an arbitrary profile',async count=>{
  io.rpc.mockResolvedValue({data:Array.from({length:count},registry),error:null})
  await expect(resolve(wire())).rejects.toThrow(`canonical_rule_pack_evidence_count:${count}:PRODAT:Z04:H`)
})
it('requires the actual database profile key and never substitutes a semantic alias',async()=>{
  const row=registry();row.profile_key='';row.original_snapshot.messageProfile.profile_key='';io.rpc.mockResolvedValue({data:[row],error:null})
  await expect(resolve(wire())).rejects.toThrow('canonical_rule_pack_result_missing:profile_key')
})
it('propagates a real catalog port failure',async()=>{
  io.rpc.mockResolvedValue({data:null,error:{message:'catalog offline'}})
  await expect(resolve(wire())).rejects.toThrow('canonical_rule_pack_evidence_resolution_failed:catalog offline')
})
it('refuses a catalog original witness whose profile belongs to a foreign pack',async()=>{
  const row=registry();row.original_snapshot.messageProfile.rule_pack_id='foreign';io.rpc.mockResolvedValue({data:[row],error:null})
  await expect(resolve(wire())).rejects.toThrow('canonical_original_rule_witness_scope_mismatch')
})

it.each([
  {label:'missing identity agency',identity:[point,'','']},
  {label:'unknown identity agency',identity:[point,'','','XYZ']},
  {label:'object ID exceeds25 characters',identity:['7'.repeat(26),'','','9']},
  {label:'forbidden C212/1131 populated',identity:[point,'BAD','','9']},
])('refuses malformed own field209: $label',async({identity})=>{
  const payload=wire([['LIN','1','',identity],...characteristic('Z13','Z25'),['RFF',['LI','OWN']]])
  expect(validateEdifactEnvelope(payload).syntaxOk).toBe(true)
  const tokens=tokenizeEdifact(payload),field=prodatRegisterFieldState('209',tokens.segments,tokens.una)
  expect(field).toMatchObject({present:true,malformed:true})
  expect(await resolve(payload)).toBeNull()
  expect(io.rpc).not.toHaveBeenCalled()
})
