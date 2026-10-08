// masterplan: AT-Z03H-SUPPLIER, AT-Z04H-SUPPLIER
// Real parser/grouping/dated registry; only the external catalog RPC is declared.
// These catalog witnesses do not validate registers or authorize private effects.
import {beforeEach,expect,it,vi} from 'vitest'
import {resolveRejectedBilateralSwitchBirthProfile} from '@/lib/inbound-mail/rejectedBilateralSwitchBirthProfile'
import {resolveBilateralSwitchBirthProfile} from '@/lib/inbound-mail/bilateralSwitchBirthProfile'
import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {prodatRegisterGroups} from '@/lib/ediel/prodat/prodatRegisterGroups'
import {resolveCanonicalEdielPolicy} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import {validateCanonicalPolicyFields} from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import {ownerRulePack} from './helpers/sourceOwnerFixtures'
import {guideOrderedFixtureRaw} from './helpers/prodatGuideOrderedFixture'
import {alphabets,line,characteristic,raw,validate,type Parts} from './fixtures/prodat-register'
const io=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc}}))
const point='735999000000001',key='PRODAT:Z04:H:26.A:r3',receipt='2026-10-06T22:30:00Z'
function registry(){
 const row=ownerRulePack();Object.assign(row,{profile_key:key,profile:{...row.profile,transactionSubtype:'H',reasonForTransaction:'Z25'}})
 Object.assign(row.original_snapshot.messageProfile,{profile_key:key,profile:row.profile});return row
}
const first=(reason='Z25'):Parts[]=>[line('1',point,'1','9'),...characteristic('Z13',reason),['RFF',['LI','OWN']]]
const body=():Parts[]=>[...first(),line('2',point,'','9')]
const wire=(parts:readonly Parts[]=body(),code='Z04')=>guideOrderedFixtureRaw(parts,code)
const resolve=(rawPayload:string|null|undefined,receivedAt=receipt)=>resolveRejectedBilateralSwitchBirthProfile({rawPayload,receivedAt})
beforeEach(()=>{io.rpc.mockReset();io.rpc.mockImplementation(async(name:string)=>{
 if(name!=='resolve_canonical_ediel_rule_pack_with_witness_v1')throw Error('undeclared_rejected_birth_rpc:'+name)
 return {data:[registry()],error:null}
})})
function expectWitness(result:Awaited<ReturnType<typeof resolve>>){
 expect(result).toEqual({canonical_rule_pack_id:'00000000-0000-4000-8000-000000000012',rule_profile_key:key,
  rule_profile_version_id:'00000000-0000-4000-8000-000000000011',rule_profile_version:'26.A:r3',rule_pack_checksum:'a'.repeat(64),
  rule_pack_snapshot:{...registry().original_snapshot,profileKey:key,profileVersionId:'00000000-0000-4000-8000-000000000011',version:'26.A:r3',checksum:'a'.repeat(64)}})
}
it('selects only six dated catalog columns while real258 validation stays blocking and inheritance stays disabled',async()=>{
 const payload=wire();expect(await resolveBilateralSwitchBirthProfile({rawPayload:payload,receivedAt:receipt})).toBeNull()
 expect(validate(payload,['258']).some(i=>i.blocking)).toBe(true)
 const t=tokenizeEdifact(payload),before=prodatRegisterGroups(t.segments,t.una,'Z04')
 expectWitness(await resolve(payload))
 expect(prodatRegisterGroups(t.segments,t.una,'Z04')).toEqual(before)
 expect(before.groups.map(g=>[g.validRegisterChain,g.firstLineIndex,g.effectiveSegments])).toEqual(before.groups.map(g=>[false,null,g.segments]))
 expect(io.rpc).toHaveBeenCalledExactlyOnceWith('resolve_canonical_ediel_rule_pack_with_witness_v1',{
  p_market:'electricity',p_family:'PRODAT',p_message_code:'Z04',p_transaction_subtype:'H',p_direction:'inbound',p_business_date:'2026-10-07'})
})
it.each(alphabets)('uses actual UNA %j and preserves released ordinary data',async(component,element,release,terminator)=>{
 const payload=guideOrderedFixtureRaw([...first().slice(0,-1),['RFF',['LI',"OWN+CCI++Z13'CAV+Z22:?!;~"]],line('2',point,'','9')],'Z04',[component,element,release,terminator])
 expectWitness(await resolve(payload))
})
it.each([1,2,3,4])('permits %s empty trailing C889 components without borrowing a value',async count=>{
 expectWitness(await resolve(wire([line('1',point,'1','9'),['CCI','','Z13'],['CAV',['Z25',...Array<string>(count).fill('')]],['RFF',['LI','OWN']],line('2',point,'','9')])))
})
it('leaves the complete healthy chain to the original positive selector',async()=>{
 const payload=wire([...first(),line('2',point,'2','9')])
 expect(await resolve(payload)).toBeNull();expect(io.rpc).not.toHaveBeenCalled()
 expectWitness(await resolveBilateralSwitchBirthProfile({rawPayload:payload,receivedAt:receipt}))
})
it.each([
 ['missing second C829',():string=>wire([...first(),line('2',point,undefined,'9')])],
 ['second index3',()=>wire([...first(),line('2',point,'3','9')])],
 ['second wrong indicator',()=>wire([...first(),['LIN','2','',[point,'','','9'],['2','']]])],
 ['second extra C829 component',()=>wire([...first(),['LIN','2','',[point,'','','9'],['1','','']]])],
 ['second extra LIN element',()=>wire([...first(),['LIN','2','',[point,'','','9'],['1',''],'EXTRA']])],
 ['first missing C829',()=>wire([line('1',point,undefined,'9'),...characteristic('Z13','Z25'),line('2',point,'','9')])],
 ['first wrong index',()=>wire([line('1',point,'2','9'),...characteristic('Z13','Z25'),line('2',point,'','9')])],
 ['first wrong sequence',()=>wire([line('2',point,'1','9'),...characteristic('Z13','Z25'),line('2',point,'','9')])],
 ['second wrong sequence',()=>wire([...first(),line('3',point,'','9')])],
 ['first malformed209',()=>wire([line('1','', '1','9'),...characteristic('Z13','Z25'),line('2',point,'','9')])],
 ['second malformed209',()=>wire([...first(),line('2','','','9')])],
 ['different object',()=>wire([...first(),line('2','735999000000002','','9')])],
 ['different agency',()=>wire([...first(),line('2',point,'','89')])],
 ['invalid agency',()=>wire([...first(),line('2',point,'','XX')])],
 ['209 extra component',()=>wire([...first(),['LIN','2','',[point,'','','9','EXTRA'],['1','']]])],
 ['209 forbidden component',()=>wire([...first(),['LIN','2','',[point,'BAD','','9'],['1','']]])],
 ['three registers',()=>wire([...body(),line('3',point,'3','9')])],
 ['single register',()=>wire(first())],
 ['no registers',()=>wire(characteristic('Z13','Z25'))],
 ['missing reason',()=>wire([line('1',point,'1','9'),line('2',point,'','9')])],
 ['blank reason',()=>wire([...first(''),line('2',point,'','9')])],
 ['different reason',()=>wire([...first('Z22'),line('2',point,'','9')])],
 ['internal alias',()=>wire([...first('H'),line('2',point,'','9')])],
 ['duplicate reason',()=>wire([...first(),...characteristic('Z13','Z25'),line('2',point,'','9')])],
 ['competing reason',()=>wire([...first(),...characteristic('Z13','Z22'),line('2',point,'','9')])],
 ['header reason',()=>wire([...characteristic('Z13','Z25'),...body()])],
 ['only header reason',()=>wire([...characteristic('Z13','Z25'),line('1',point,'1','9'),line('2',point,'','9')])],
 ['second own reason',()=>wire([...body(),...characteristic('Z13','Z25')])],
 ['second empty qualifier',()=>wire([...body(),['CCI','','Z13']])],
 ['late reason',()=>raw([line('1',point,'1','9'),['RFF',['LI','OWN']],...characteristic('Z13','Z25'),line('2',point,'','9')])],
 ['late after NAD',()=>raw([line('1',point,'1','9'),['NAD','UD',['OWN','','89']],...characteristic('Z13','Z25'),line('2',point,'','9')])],
 ...['Z25','Z22',''].map(value=>['second CAV '+value,()=>wire([line('1',point,'1','9'),...characteristic('Z13','Z25'),['CAV',value],line('2',point,'','9')])] as const),
 ['missing adjacent CAV',()=>wire([line('1',point,'1','9'),['CCI','','Z13'],['RFF',['LI','OWN']],line('2',point,'','9')])],
 ['wrong CAV slot',()=>wire([line('1',point,'1','9'),...characteristic('Z13','Z25',3),line('2',point,'','9')])],
 ['extra CAV element',()=>wire().replace('CAV+Z25','CAV+Z25+EXTRA')],
 ['extra CAV value',()=>wire().replace('CAV+Z25','CAV+Z25:Z22')],
 ['too many CAV components',()=>wire().replace('CAV+Z25','CAV+Z25:::::')],
 ['extra CCI element',()=>wire().replace('CCI++Z13','CCI++Z13+EXTRA')],
 ['extra CCI component',()=>wire().replace('CCI++Z13','CCI++Z13:EXTRA')],
 ['lowercase qualifier',()=>wire().replace('CCI++Z13','CCI++z13')],
 ...['CCI','CAV'].flatMap(tag=>['leading','trailing'].map(side=>[side+' padded '+tag,()=>wire().replace(tag==='CCI'?'CCI++Z13':'CAV+Z25',side==='leading'?' '+(tag==='CCI'?'CCI++Z13':'CAV+Z25'):(tag==='CCI'?'CCI++Z13':'CAV+Z25')+' ')] as const)),
 ['Z03',()=>wire(body(),'Z03')],['Z05',()=>wire(body(),'Z05')],
 ['composite BGM',()=>wire().replace('BGM+Z04','BGM+Z04:EXTRA')],
 ['duplicate BGM',()=>wire([['BGM','Z04','OTHER','9'],...body()])],
 ['BGM after LIN',()=>raw([...body(),['BGM','Z04','OTHER','9']])],
 ['foreign APP',()=>wire().replace('23-DDQ-PRODAT','23-DGI-PRODAT')],
 ['composite APP',()=>wire().replace('23-DDQ-PRODAT','23-DDQ-PRODAT:EXTRA')],
 ['foreign UNH family',()=>wire().replace('PRODAT:D:97A:UN','UTILTS:D:97A:UN')],
 ['foreign UNH version',()=>wire().replace('PRODAT:D:97A:UN','PRODAT:D:96A:UN')],
 ['foreign UNH agency',()=>wire().replace('PRODAT:D:97A:UN','PRODAT:D:97A:ZZZ')],
 ['missing association',()=>wire().replace(':UN:E2SE6A',':UN:')],
 ['extra association component',()=>wire().replace(':UN:E2SE6A',':UN:E2SE6A:EXTRA')],
 ['duplicate UNH',()=>wire([['UNH','OTHER',['PRODAT','D','97A','UN','E2SE6A']],...body()])],
 ['wrong UNT count',()=>wire().replace(/UNT\+\d+\+M/,'UNT+999+M')],
 ['wrong UNT reference',()=>wire().replace("+M'UNZ","+OTHER'UNZ")],
 ['wrong UNZ count',()=>wire().replace('UNZ+1+I','UNZ+2+I')],
 ['outside envelope',()=>wire()+"FTX+AAI+++outside'"],
 ['null',():null=>null],['undefined',():undefined=>undefined],['empty',():string=>''],
] as const)('refuses catalog witnesses for %s',async(_label,make)=>{
 expect(await resolve(make())).toBeNull();expect(io.rpc).not.toHaveBeenCalled()
})
it.each(['invalid','','2026-02-30T12:00:00Z','2026-10-06','2026-10-06T22:30:00','2026-10-06T24:00:00Z','2026-10-06T12:60:00Z','0000-10-06T12:00:00Z'])('rejects actual invalid receipt %s without a default clock',async clock=>{
 await expect(resolve(wire(),clock)).rejects.toThrow('rejected_bilateral_switch_birth_receipt_clock_invalid');expect(io.rpc).not.toHaveBeenCalled()
})
it.each([['2026-10-06T21:30:00Z','2026-10-06'],['2026-10-06T22:30:00.123456+00:00','2026-10-07'],['2026-12-06T22:30:00Z','2026-12-06'],['2026-12-06T23:30:00Z','2026-12-07']])('selects actual Stockholm receipt date for %s',async(clock,date)=>{
 expectWitness(await resolve(wire(),clock));expect(io.rpc.mock.calls[0][1].p_business_date).toBe(date)
})
it.each([0,2])('fails closed on real registry count %s',async count=>{
 io.rpc.mockResolvedValue({data:Array.from({length:count},registry),error:null})
 await expect(resolve(wire())).rejects.toThrow(`canonical_rule_pack_evidence_count:${count}:PRODAT:Z04:H`)
})
it('refuses a physical association different from the actual catalog',async()=>{
 await expect(resolve(wire().replace('E2SE6A','E2SE5A'))).rejects.toThrow('rejected_bilateral_switch_birth_association_mismatch')
})
it('propagates a real registry error',async()=>{
 io.rpc.mockResolvedValue({data:null,error:{message:'catalog offline'}})
 await expect(resolve(wire())).rejects.toThrow('canonical_rule_pack_evidence_resolution_failed:catalog offline')
})
it('refuses a foreign original profile witness',async()=>{
 const row=registry();row.original_snapshot.messageProfile.rule_pack_id='foreign';io.rpc.mockResolvedValue({data:[row],error:null})
 await expect(resolve(wire())).rejects.toThrow('canonical_original_rule_witness_scope_mismatch')
})
it('requires the actual database profile key',async()=>{
 const row=registry();row.profile_key='';row.original_snapshot.messageProfile.profile_key='';io.rpc.mockResolvedValue({data:[row],error:null})
 await expect(resolve(wire())).rejects.toThrow('canonical_rule_pack_result_missing:profile_key')
})

const missing314Body=(id=point,agency='9'):Parts[]=>[line('',id,undefined,agency),...characteristic('Z13','Z25'),['RFF',['LI','OWN']]]
it('selects only dated catalog witnesses for missing314 while its real sequence rejection and grouping remain unchanged',async()=>{
 const payload=wire(missing314Body()),t=tokenizeEdifact(payload),before=prodatRegisterGroups(t.segments,t.una,'Z04')
 expect(await resolveBilateralSwitchBirthProfile({rawPayload:payload,receivedAt:receipt})).toBeNull()
 expect(validate(payload,['314']).some(i=>i.blocking)).toBe(true)
 expect(before.problems).toEqual([{fieldNumber:'314',lineIndex:0,segmentIndex:t.segments.find(s=>s.tag==='LIN')!.index,reason:'global_sequence_must_increment_from_one'}])
 expectWitness(await resolve(payload));expect(prodatRegisterGroups(t.segments,t.una,'Z04')).toEqual(before)
 expect(before.groups[0]).toMatchObject({lineNumber:null,firstLineIndex:null,validRegisterChain:false})
 expect(before.groups[0].effectiveSegments).toEqual(before.groups[0].segments)
 expect(io.rpc).toHaveBeenCalledExactlyOnceWith('resolve_canonical_ediel_rule_pack_with_witness_v1',{
  p_market:'electricity',p_family:'PRODAT',p_message_code:'Z04',p_transaction_subtype:'H',p_direction:'inbound',p_business_date:'2026-10-07'})
})
it.each(alphabets)('respects actual UNA %j and escaped identifiers for missing314',async(component,element,release,terminator)=>{
 const id=`POINT${component}${element}${release}${terminator}A`
 const parts=missing314Body(id,'89');parts[parts.length-1]=['RFF',['LI',`OWN${component}${element}${release}${terminator}A`]]
 expectWitness(await resolve(guideOrderedFixtureRaw(parts,'Z04',[component,element,release,terminator])))
})
it.each(['A','A'.repeat(25)])('uses actual209 validity without a numeric-only restriction: %s',async id=>{
 expectWitness(await resolve(wire(missing314Body(id))))
})
it.each([
 ...['0','1','2','01','  ',' 1','1 ',':'].map(sequence=>['nonempty sequence '+sequence,()=>wire([line(sequence,point,undefined,'9'),...missing314Body().slice(1)])] as const),
 ['extra empty sequence component',()=>wire([['LIN',['',''],'',[point,'','','9']],...missing314Body().slice(1)])],
 ['supplied action',()=>wire([['LIN','','ACTION',[point,'','','9']],...missing314Body().slice(1)])],
 ['C829 supplied',()=>wire([line('',point,'1','9'),...missing314Body().slice(1)])],
 ['empty C829 element',()=>wire([['LIN','','',[point,'','','9'],''],...missing314Body().slice(1)])],
 ['extra LIN element',()=>wire([['LIN','','',[point,'','','9'],'',''],...missing314Body().slice(1)])],
 ['missing209',()=>wire(missing314Body(''))],
 ['too long209',()=>wire(missing314Body('A'.repeat(26)))],
 ['invalid agency',()=>wire(missing314Body(point,'XX'))],
 ['extra209 component',()=>wire([['LIN','','',[point,'','','9','']],...missing314Body().slice(1)])],
 ['reserved209 component',()=>wire([['LIN','','',[point,'BAD','','9']],...missing314Body().slice(1)])],
 ['second LIN',()=>wire([...missing314Body(),line('2',point,undefined,'9')])],
 ['second object',()=>wire([...missing314Body(),line('2','OTHER',undefined,'9')])],
 ['missing LI',()=>wire(missing314Body().slice(0,-1))],
 ['blank LI',()=>wire([...missing314Body().slice(0,-1),['RFF',['LI','']]])],
 ['padded LI value',()=>wire([...missing314Body().slice(0,-1),['RFF',['LI',' OWN']]])],
 ['duplicate LI',()=>wire([...missing314Body(),['RFF',['LI','OTHER']]])],
 ['header LI',()=>wire([['RFF',['LI','OWN']],...missing314Body().slice(0,-1)])],
 ['header duplicate LI',()=>wire([['RFF',['LI','HEADER']],...missing314Body()])],
 ['late LI after NAD',()=>raw([...missing314Body().slice(0,-1),['NAD','UD',['C','','89']],['RFF',['LI','OWN']]])],
 ['LI extra component',()=>wire([...missing314Body().slice(0,-1),['RFF',['LI','OWN','']]])],
 ['LI extra element',()=>wire([...missing314Body().slice(0,-1),['RFF',['LI','OWN'],'EXTRA']])],
 ['normalized lowercase LI',()=>wire([...missing314Body().slice(0,-1),['RFF',['li','OWN']]])],
 ['normalized padded LI',()=>wire([...missing314Body().slice(0,-1),['RFF',[' LI ','OWN']]])],
 ['missing reason',()=>wire([line('',point,undefined,'9'),['RFF',['LI','OWN']]])],
 ['duplicate reason',()=>wire([...missing314Body(),...characteristic('Z13','Z25')])],
 ['header reason',()=>wire([...characteristic('Z13','Z25'),line('',point,undefined,'9'),['RFF',['LI','OWN']]])],
 ['late reason after LI',()=>raw([line('',point,undefined,'9'),['RFF',['LI','OWN']],...characteristic('Z13','Z25')])],
 ['second CAV',()=>wire([line('',point,undefined,'9'),...characteristic('Z13','Z25'),['CAV','Z25'],['RFF',['LI','OWN']]])],
 ['missing APP',()=>wire(missing314Body()).replace('23-DDQ-PRODAT','')],
 ['foreign APP',()=>wire(missing314Body()).replace('23-DDQ-PRODAT','23-DGI-PRODAT')],
 ['missing202',()=>wire(missing314Body(),'')],
 ['Z03',()=>wire(missing314Body(),'Z03')],
 ['nonH reason',()=>wire(missing314Body()).replace('CAV+Z25','CAV+Z22')],
 ['duplicate BGM',()=>wire([['BGM','Z04','OTHER','9'],...missing314Body()])],
 ['duplicate UNH',()=>wire([['UNH','OTHER',['PRODAT','D','97A','UN','E2SE6A']],...missing314Body()])],
 ['padded LIN',()=>wire(missing314Body()).replace('LIN+++',' LIN+++')],
 ['padded end LIN',()=>wire(missing314Body()).replace(":::9'",":::9 '")],
] as const)('keeps the missing314 catalog purpose closed for %s',async(_label,make)=>{
 expect(await resolve(make())).toBeNull();expect(io.rpc).not.toHaveBeenCalled()
})
it.each(['invalid','2026-02-30T12:00:00Z','2026-10-06T22:30:00'])('refuses invalid real missing314 receipt %s',async clock=>{
 await expect(resolve(wire(missing314Body()),clock)).rejects.toThrow('rejected_bilateral_switch_birth_receipt_clock_invalid');expect(io.rpc).not.toHaveBeenCalled()
})
it('rejects missing314 catalog association mismatch instead of fabricating a witness',async()=>{
 await expect(resolve(wire(missing314Body()).replace('E2SE6A','E2SE5A'))).rejects.toThrow('rejected_bilateral_switch_birth_association_mismatch')
})

// A missing physical APP may identify a catalog, never an admitted wire source.
const missing311Body=(id=point,agency='9'):Parts[]=>[line('1',id,undefined,agency),...characteristic('Z13','Z25'),['RFF',['LI','OWN']]]
const withoutApp=(payload:string)=>payload.replace('23-DDQ-PRODAT','')
const missing311Wire=(parts:readonly Parts[]=missing311Body())=>withoutApp(wire(parts))
it('uses the established dated catalog fallback while actual national311 validation stays blocking',async()=>{
 const healthy=wire(missing311Body()),payload=withoutApp(healthy),t=tokenizeEdifact(payload),before=prodatRegisterGroups(t.segments,t.una,'Z04')
 expect(before.problems).toEqual([]);expect(await resolveBilateralSwitchBirthProfile({rawPayload:payload,receivedAt:receipt})).toBeNull()
 expectWitness(await resolve(payload))
 expect(io.rpc).toHaveBeenCalledExactlyOnceWith('resolve_canonical_ediel_rule_pack_with_witness_v1',{
  p_market:'electricity',p_family:'PRODAT',p_message_code:'Z04',p_transaction_subtype:'H',p_direction:'inbound',p_business_date:'2026-10-07'})
 const policy=resolveCanonicalEdielPolicy({family:'PRODAT',messageCode:'Z04',subtypeOrReasonCode:'Z25',direction:'inbound',
  referenceDate:'2026-10-07',applicationReference:'23-DDQ-PRODAT',mode:'catalog_evidence'})
 const field311={...policy,fieldRules:policy.fieldRules.filter(r=>'fieldNumber' in r&&r.fieldNumber==='311')}
 expect(field311.fieldRules).toHaveLength(1)
 expect(validateCanonicalPolicyFields({policy:field311,rawPayload:healthy})).toEqual([])
 expect(validateCanonicalPolicyFields({policy:field311,rawPayload:payload})).toEqual(expect.arrayContaining([expect.objectContaining({
  blocking:true,prodatDiagnostic:expect.objectContaining({kind:'field',fieldNumber:'311',errorKind:'missing',group:'header'}),
 })]))
 expect(prodatRegisterGroups(t.segments,t.una,'Z04')).toEqual(before)
})
it.each(alphabets)('preserves missing311 with actual UNA %j and released209/LI',async(component,element,release,terminator)=>{
 const parts=missing311Body(`POINT${component}${element}${release}${terminator}A`,'89')
 parts[parts.length-1]=['RFF',['LI',`OWN${component}${element}${release}${terminator}A`]]
 expectWitness(await resolve(withoutApp(guideOrderedFixtureRaw(parts,'Z04',[component,element,release,terminator]))))
})
it.each([
 ...['23-DGI-PRODAT',' ',' 23-DDQ-PRODAT','23-DDQ-PRODAT ',':','23-DDQ-PRODAT:EXTRA'].map(app=>['supplied APP '+app,()=>wire(missing311Body()).replace('23-DDQ-PRODAT',app)] as const),
 ['truncated UNB before311',()=>missing311Wire().replace("I++'","I+'")],
 ['padded UNB',()=>missing311Wire().replace('UNB+',' UNB+')],
 ...['','0','2','01',' 1','1 '].map(sequence=>['invalid314 '+sequence,()=>missing311Wire([line(sequence,point,undefined,'9'),...missing311Body().slice(1)])] as const),
 ['supplied C8291:1',()=>missing311Wire([line('1',point,'1','9'),...missing311Body().slice(1)])],
 ['empty C829',()=>missing311Wire([['LIN','1','',[point,'','','9'],''],...missing311Body().slice(1)])],
 ['extra C829 component',()=>missing311Wire([['LIN','1','',[point,'','','9'],['1','1','']],...missing311Body().slice(1)])],
 ['extra LIN element',()=>missing311Wire([['LIN','1','',[point,'','','9'],'',''],...missing311Body().slice(1)])],
 ['supplied action',()=>missing311Wire([['LIN','1','ACTION',[point,'','','9']],...missing311Body().slice(1)])],
 ['missing209',()=>missing311Wire(missing311Body(''))],
 ['too long209',()=>missing311Wire(missing311Body('A'.repeat(26)))],
 ['invalid agency',()=>missing311Wire(missing311Body(point,'XX'))],
 ['reserved209 component',()=>missing311Wire([['LIN','1','',[point,'BAD','','9']],...missing311Body().slice(1)])],
 ['extra209 component',()=>missing311Wire([['LIN','1','',[point,'','','9','']],...missing311Body().slice(1)])],
 ['noLIN',()=>missing311Wire(missing311Body().slice(1))],
 ['second LIN',()=>missing311Wire([...missing311Body(),line('2',point,undefined,'9')])],
 ['original rejected258',()=>withoutApp(wire())],
 ['missingLI',()=>missing311Wire(missing311Body().slice(0,-1))],
 ['duplicateLI',()=>missing311Wire([...missing311Body(),['RFF',['LI','OTHER']]])],
 ['headerLI',()=>missing311Wire([['RFF',['LI','OWN']],...missing311Body().slice(0,-1)])],
 ['lateLI',()=>withoutApp(raw([...missing311Body().slice(0,-1),['NAD','UD',['C','','89']],['RFF',['LI','OWN']]]))],
 ...['',' OWN','OWN '].map(li=>['invalidLI '+li,()=>missing311Wire([...missing311Body().slice(0,-1),['RFF',['LI',li]]])] as const),
 ['paddedLI qualifier',()=>missing311Wire().replace('RFF+LI','RFF+ LI ')],
 ['extraLI component',()=>missing311Wire().replace('RFF+LI:OWN','RFF+LI:OWN:')],
 ['missing223',()=>missing311Wire([line('1',point,undefined,'9'),['RFF',['LI','OWN']]])],
 ['wrong223',()=>missing311Wire().replace('CAV+Z25','CAV+Z22')],
 ['duplicate223',()=>missing311Wire([...missing311Body(),...characteristic('Z13','Z25')])],
 ['header223',()=>missing311Wire([...characteristic('Z13','Z25'),line('1',point,undefined,'9'),['RFF',['LI','OWN']]])],
 ['late223',()=>withoutApp(raw([line('1',point,undefined,'9'),['RFF',['LI','OWN']],...characteristic('Z13','Z25')]))],
 ['extraCAV',()=>missing311Wire().replace('CAV+Z25','CAV+Z25:OTHER')],
 ['paddedCAV',()=>missing311Wire().replace('CAV+Z25',' CAV+Z25')],
 ['missing312association',()=>missing311Wire().replace(':UN:E2SE6A',':UN:')],
 ['wrong312version',()=>missing311Wire().replace(':97A:',':96A:')],
 ['missing202',()=>missing311Wire().replace('BGM+Z04','BGM+')],
 ['wrong202',()=>missing311Wire().replace('BGM+Z04','BGM+Z03')],
 ['composite202',()=>missing311Wire().replace('BGM+Z04','BGM+Z04:OTHER')],
 ['duplicateBGM',()=>missing311Wire([['BGM','Z04','OTHER','9'],...missing311Body()])],
 ['lateBGM',()=>withoutApp(raw([...missing311Body(),['BGM','Z04','OTHER','9']]))],
 ['duplicateUNH',()=>missing311Wire([['UNH','OTHER',['PRODAT','D','97A','UN','E2SE6A']],...missing311Body()])],
 ['incorrectUNT',()=>missing311Wire().replace(/UNT\+\d+\+M/,'UNT+999+M')],
] as const)('refuses mixed or malformed missing311 purpose: %s',async(_label,make)=>{
 expect(await resolve(make())).toBeNull();expect(io.rpc).not.toHaveBeenCalled()
})
it.each(['invalid','2026-02-30T12:00:00Z','2026-10-06T22:30:00'])('refuses invalid actual missing311 receipt %s',async clock=>{
 await expect(resolve(missing311Wire(),clock)).rejects.toThrow('rejected_bilateral_switch_birth_receipt_clock_invalid');expect(io.rpc).not.toHaveBeenCalled()
})
it.each([0,2])('refuses missing311 catalog count %s',async count=>{
 io.rpc.mockResolvedValue({data:Array.from({length:count},registry),error:null})
 await expect(resolve(missing311Wire())).rejects.toThrow(`canonical_rule_pack_evidence_count:${count}:PRODAT:Z04:H`)
})
it('refuses missing311 current catalog association mismatch',async()=>{
 await expect(resolve(missing311Wire().replace('E2SE6A','E2SE5A'))).rejects.toThrow('rejected_bilateral_switch_birth_association_mismatch')
})
