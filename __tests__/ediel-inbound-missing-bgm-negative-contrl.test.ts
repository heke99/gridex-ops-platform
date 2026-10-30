// Finding 019: UTILTS without BGM (UTILTS_UNKNOWN) must reach the SQL-owned
// syntax-negative birth instead of an ordinary insert that the rule-pack
// trigger refuses with 23514 (which was swallowed and gave no negative CONTRL).
import {beforeEach,afterEach,expect,it,vi} from 'vitest'
import {parseEdifactPayload} from '@/lib/inbound-mail/edielEmailParser'
import {evidenceHash} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {validateEdifactSyntax} from '@/lib/ediel/core/syntaxValidator'
import {mapEdielErrorToAck} from '@/lib/ediel/ack/errorCodeMapper'

const io=vi.hoisted(()=>({rpc:vi.fn(),actor:vi.fn(),tables:{} as Record<string,{data:unknown;error:unknown}>,inserts:[] as Array<{table:string;row:unknown}>,reception:vi.fn()}))
vi.mock('@/lib/ediel/services/authorization',()=>({assertEdielTenantActor:io.actor}))
vi.mock('@/lib/ediel/inbound/receptions',async original=>({...await original<Record<string,unknown>>(),recordInboundReception:io.reception,requireFirstReception:()=>undefined}))
vi.mock('@/lib/ediel/core/dedupe',async original=>({...await original<Record<string,unknown>>(),findInboundDuplicateByCanonicalIdentity:async()=>null}))
vi.mock('@/lib/supabase/service',()=>{
 function chain(table:string):unknown{
  const result=()=>io.tables[table]??{data:null,error:null}
  const proxy:unknown=new Proxy(function(){},{get(_t,key){
   if(key==='then')return (resolve:(v:unknown)=>unknown,reject:(e:unknown)=>unknown)=>Promise.resolve(result()).then(resolve,reject)
   if(key==='insert')return (row:unknown)=>{io.inserts.push({table,row});return proxy}
   if(key==='maybeSingle'||key==='single')return ()=>Promise.resolve(result())
   return ()=>proxy
  }})
  return proxy
 }
 return {supabaseService:{rpc:io.rpc,from:(table:string)=>chain(table)}}
})
import {createInboundEdielMessage,observeUtiltsMissingBgmSyntaxNegative} from '@/lib/inbound-mail/inboundStatusUpdater'

const company='00000000-0000-4000-8000-000000000011',actor='00000000-0000-4000-8000-000000000012'
const mail='00000000-0000-4000-8000-000000000013',parse='00000000-0000-4000-8000-000000000014',source='00000000-0000-4000-8000-000000000015'
const received='2026-10-30T15:08:45Z'
function utilts(bgm?:string){
 const body=[ 'UNH+1+UTILTS:D:02B:UN:E5SE5A',...(bgm?[bgm]:[]),'DTM+137:202610301508:203','DTM+735:?+0200:406','MKS+23+E02::260',
  'NAD+MS+70007:SVK:260','NAD+MR+16724:SVK:260','IDE+24+SYNTHETIC0001','LOC+172+735999260756511878::9','LIN+++8716867000030:::9',
  'DTM+324:202607010000202607010015:719','QTY+136:500']
 return ['UNB+UNOC:3+70007:ZZ+16724:ZZ+261030:1508+SYNTH0019REF01++23-DDQ-E66-T++1++1',...body,`UNT+${body.length+1}+1`,'UNZ+1+SYNTH0019REF01'].join("'\r\n")+"'"
}
const call=(raw:string)=>({companyId:company,actorUserId:actor,environment:'test',inboundEmailMessageId:mail,parseResultId:parse,parsed:parseEdifactPayload(raw)})
const born=(raw:string)=>({version:1,disposition:'utilts_syntax_negative',sourceMessageId:source,companyId:company,environment:'test',
 sourcePayloadHash:evidenceHash(raw),inboundEmailMessageId:mail,parseResultId:parse,sourceReceivedAt:received,missingSegment:'BGM',authorizesBusinessEffect:false,permanentNegative:true})
let warn:ReturnType<typeof vi.spyOn>
beforeEach(()=>{
 io.rpc.mockReset();io.actor.mockReset();io.actor.mockResolvedValue(undefined);io.reception.mockReset();io.inserts.length=0
 io.tables={ediel_messages:{data:[],error:null},inbound_email_messages:{data:{id:mail,company_id:company,environment:'test',received_at:received},error:null}}
 warn=vi.spyOn(console,'warn').mockImplementation(()=>undefined)
})
afterEach(()=>{warn.mockRestore()})

it('parses UTILTS without BGM as UTILTS_UNKNOWN whose actual syntax is a negative CONTRL (UCI 4) basis',()=>{
 const raw=utilts(),parsed=parseEdifactPayload(raw)
 expect(parsed).toMatchObject({messageFamily:'UTILTS',messageCode:'UTILTS_UNKNOWN',interchangeReference:'SYNTH0019REF01'})
 expect(observeUtiltsMissingBgmSyntaxNegative(parsed)).toBe(true)
 const syntax=validateEdifactSyntax({raw_payload:raw,message_standard:'edifact',message_family:'UTILTS',message_code:'UTILTS_UNKNOWN'} as never)
 expect(syntax.ok).toBe(false)
 const errors=syntax.issues.filter(issue=>issue.severity==='error')
 expect(errors.length).toBeGreaterThan(0)
 expect(errors.map(issue=>issue.code)).toContain('missing_bgm')
 expect(mapEdielErrorToAck({layer:'syntax'})).toMatchObject({ackFamily:'CONTRL',outcome:'negative',contrlActionCode:'4'})
})

it('UTILTS without BGM is born through the SQL syntax-negative owner, never the trigger-refused insert',async()=>{
 const raw=utilts();io.rpc.mockResolvedValue({data:born(raw),error:null})
 expect(await createInboundEdielMessage(call(raw))).toBe(source)
 expect(io.actor).toHaveBeenCalledWith({companyId:company,actorUserId:actor,permission:'communication.write'})
 expect(io.rpc).toHaveBeenCalledExactlyOnceWith('ediel_create_utilts_syntax_negative_v1',{p_company_id:company,p_environment:'test',
  p_actor_user_id:actor,p_inbound_email_message_id:mail,p_parse_result_id:parse,p_expected_raw_payload:raw,p_expected_payload_hash:evidenceHash(raw)})
 expect(io.inserts).toEqual([])
})

it('replay/retry returns the same retained source and still performs no ordinary insert',async()=>{
 const raw=utilts();io.rpc.mockResolvedValue({data:born(raw),error:null})
 expect(await createInboundEdielMessage(call(raw))).toBe(source)
 expect(await createInboundEdielMessage(call(raw))).toBe(source)
 expect(io.rpc).toHaveBeenCalledTimes(2);expect(io.inserts).toEqual([])
})

it.each([
 ['unlisted BGM code',()=>utilts('BGM+ZZZ+DOC1+9')],
 ['ordinary E66',()=>utilts('BGM+E66+DOC1+9')],
 ['two BGM-less messages',()=>utilts()+utilts()],
] as const)('%s is not selected for the syntax-negative birth',(_name,make)=>{
 expect(observeUtiltsMissingBgmSyntaxNegative(parseEdifactPayload(make()))).toBe(false)
})

it('other unknown UTILTS stays on the ordinary insert; a 23514 refusal is logged structured without payload',async()=>{
 const raw=utilts('BGM+ZZZ+DOC1+9')
 // The duplicate lookup reads an empty list; the ordinary insert is refused.
 const refused={data:null,error:{code:'23514',message:'canonical_inbound_rule_profile_resolution_failed:UTILTS:ZZZ:2026-10-30:0',details:raw}}
 Object.defineProperty(io.tables,'ediel_messages',{configurable:true,enumerable:true,get:()=>io.inserts.length?refused:{data:[],error:null}})
 expect(await createInboundEdielMessage(call(raw))).toBeNull()
 expect(io.rpc).not.toHaveBeenCalled()
 expect(io.inserts).toHaveLength(1)
 const structured=warn.mock.calls.find(args=>args[0]==='[inbound-mail] ediel_message_birth_check_refused')
 expect(structured?.[1]).toEqual({code:'23514',reason:'canonical_inbound_rule_profile_resolution_failed:UTILTS:ZZZ:2026-10-30:0',stage:'ediel_message_insert',
  messageFamily:'UTILTS',messageCode:'ZZZ',inboundEmailMessageId:mail,interchangeReference:'SYNTH0019REF01'})
 expect(JSON.stringify(structured)).not.toContain('UNB+')
})

it('a 23514 refusal in the syntax-negative birth is logged structured and propagated, not swallowed',async()=>{
 const raw=utilts(),error={code:'23514',message:'utilts_syntax_negative_exact_classification_required',details:raw}
 io.rpc.mockResolvedValue({data:null,error})
 await expect(createInboundEdielMessage(call(raw))).rejects.toBe(error)
 const structured=warn.mock.calls.find(args=>args[0]==='[inbound-mail] ediel_message_birth_check_refused')
 expect(structured?.[1]).toMatchObject({code:'23514',reason:'utilts_syntax_negative_exact_classification_required',stage:'utilts_syntax_negative_birth',messageFamily:'UTILTS',messageCode:'UTILTS_UNKNOWN'})
 expect(JSON.stringify(structured)).not.toContain('UNB+')
 expect(io.inserts).toEqual([])
})

it('actor refusal (42501) precedes any birth',async()=>{
 const denied=Object.assign(new Error('ediel_reception_actor_forbidden'),{code:'42501'});io.actor.mockRejectedValue(denied)
 await expect(createInboundEdielMessage(call(utilts()))).rejects.toBe(denied)
 expect(io.rpc).not.toHaveBeenCalled();expect(io.inserts).toEqual([])
})

it('a mismatched returned birth is refused',async()=>{
 const raw=utilts(),data={...born(raw),companyId:'00000000-0000-4000-8000-000000000099'}
 io.rpc.mockResolvedValue({data,error:null})
 await expect(createInboundEdielMessage(call(raw))).rejects.toThrow('ediel_utilts_syntax_negative_birth_required')
})

it.each([
 ['23514 check refusal',{code:'23514',message:'canonical_inbound_rule_profile_resolution_failed:UTILTS:ZZZ:2026-10-30:0'}],
 ['other DB error',{code:'XX000',message:'synthetic_internal_error'}],
] as const)('%s on the ordinary insert never writes details/raw payload to console',async(_name,base)=>{
 const raw=utilts('BGM+ZZZ+DOC1+9'),errorSpy=vi.spyOn(console,'error').mockImplementation(()=>undefined)
 const refused={data:null,error:{...base,details:raw,hint:raw}}
 Object.defineProperty(io.tables,'ediel_messages',{configurable:true,enumerable:true,get:()=>io.inserts.length?refused:{data:[],error:null}})
 expect(await createInboundEdielMessage(call(raw))).toBeNull()
 const logged=JSON.stringify([...warn.mock.calls,...errorSpy.mock.calls])
 errorSpy.mockRestore()
 expect(logged).not.toContain('UNB+')
 expect(logged).not.toContain('NAD+')
 expect(logged).toContain(base.code)
})
