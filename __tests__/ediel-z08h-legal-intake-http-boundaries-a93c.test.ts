import {createHash} from 'node:crypto'
import {beforeEach,describe,expect,it,vi} from 'vitest'
import {NextRequest,NextResponse} from 'next/server'

// HTTP prerequisite only: deliberately no masterplan approval tag. These
// synthetic lower auth/session/RPC ports certify no legal issuer or mandate.
// Parser, raw-byte reader, wrapper, route and archive intake remain real.
const ports=vi.hoisted(()=>({access:vi.fn(),user:vi.fn(),rpc:vi.fn()}))
vi.mock('@/lib/admin/apiGuards',()=>({requireAdminApiAccess:ports.access}))
// The unrelated requested-change schema imports this lower service port;
// fail closed if any tested path tries to bypass its authenticated session.
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:()=>{throw Error('service_port_forbidden')}}}))
vi.mock('@/lib/supabase/server',()=>({createSupabaseServerClient:async()=>({auth:{getUser:ports.user},rpc:ports.rpc})}))
import {POST} from '@/app/api/ediel/supply-rescission-sources/route'
import {readSupplyRescissionJson,supplyRescissionSubmission} from '@/lib/ediel/production/supplyRescissionHttp'
import {RequestedChangeBodyLimit} from '@/lib/ediel/production/requestedChangeHttp'

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const company=id(1),actor=id(2),artifact=id(3)
const missing=['authentic_legal_rescission_issuer_and_separate_qualified_review']
const submission=(sourceBytes=4,receiptBytes?:number)=>({
  environment:'test' as const,supplyPeriodId:id(4),effectiveAt:'2026-10-16T12:30:00Z',rulePackId:id(5),
  source:{bytesBase64:Buffer.alloc(sourceBytes,65).toString('base64'),mimeType:'text/plain' as const,reference:'SYNTHETIC legal input',version:'1'},
  ...(receiptBytes===undefined?{}:{issuerReceipt:{keyId:id(6),representationId:id(7),payloadBase64:Buffer.alloc(receiptBytes,66).toString('base64'),signatureHex:'a'.repeat(64)}}),
})
function streamed(bytes:Uint8Array,declared?:string,splits:number[]=[]){
  let offset=0,reads=0,cancelled=false
  const body=new ReadableStream<Uint8Array>({pull(controller){
    reads++
    if(offset===bytes.byteLength){controller.close();return}
    const end=splits.shift()??bytes.byteLength
    controller.enqueue(bytes.subarray(offset,end));offset=end
  },cancel(){cancelled=true}},{highWaterMark:0})
  const request=new NextRequest('http://localhost/api/ediel/supply-rescission-sources',{method:'POST',body,headers:declared===undefined?{}:{'content-length':declared}})
  return{request,body,state:()=>({reads,cancelled})}
}
const encoded=(text:string)=>new TextEncoder().encode(text)
const jsonAt=(input:unknown,size:number)=>{
  const text=JSON.stringify(input),bytes=encoded(text)
  if(bytes.byteLength>size)throw Error('fixture_does_not_fit')
  return encoded(text+' '.repeat(size-bytes.byteLength))
}
beforeEach(()=>{
  vi.resetAllMocks()
  ports.access.mockResolvedValue({guard:{companyId:company,userId:actor},response:null})
  ports.user.mockResolvedValue({data:{user:{id:actor}},error:null})
  ports.rpc.mockImplementation(async(name:string,args:{p_company_id:string;p_actor_user_id:string;p_submission:ReturnType<typeof submission>})=>{
    if(name!=='ediel_archive_supply_rescission_v1'||args.p_company_id!==company||args.p_actor_user_id!==actor)throw Error('unexpected_native_port')
    return{data:{status:'archived',companyId:company,artifactId:artifact,sourceHash:createHash('sha256').update(Buffer.from(args.p_submission.source.bytesBase64,'base64')).digest('hex'),scopeHash:'b'.repeat(64),missing},error:null}
  })
})

describe('separate encoded HTTP admission limits; decoded/native authority remains separate',()=>{
  // Reverting either encoded ceiling rejects admitted input or admits +1 encoded.
  it.each([{size:1398103,ok:true},{size:1398104,ok:true},{size:1398105,ok:false}])('receipt encoded length $size -> $ok',({size,ok})=>{
    const input=submission(4,1);input.issuerReceipt!.payloadBase64='A'.repeat(size)
    expect(supplyRescissionSubmission.safeParse(input).success).toBe(ok)
  })
  it.each([{size:11184811,ok:true},{size:11184812,ok:true},{size:11184813,ok:false}])('source encoded length $size -> $ok',({size,ok})=>{
    const input=submission();input.source.bytesBase64='A'.repeat(size)
    expect(supplyRescissionSubmission.safeParse(input).success).toBe(ok)
  })
  it.each([1048576,1048577,1048578])('receipt decoded %i can share the encoded ceiling; parser grants no authority',size=>{
    const input=submission(4,size)
    expect(input.issuerReceipt!.payloadBase64.length).toBe(1398104)
    expect(supplyRescissionSubmission.safeParse(input).success).toBe(true)
  })
  it('source decoded +1 shares ceiling but actual intake refuses it before session/native effects',async()=>{
    const input=submission(8388609)
    expect(input.source.bytesBase64.length).toBe(11184812)
    expect(supplyRescissionSubmission.safeParse(input).success).toBe(true)
    expect((await POST(streamed(encoded(JSON.stringify(input))).request)).status).toBe(403)
    expect(ports.user).not.toHaveBeenCalled();expect(ports.rpc).not.toHaveBeenCalled()
  })
  it.each([8388607,8388608])('actual source intake archives decoded %i with native-held legal prerequisites',async size=>{
    const input=submission(size,1048576),response=await POST(streamed(encoded(JSON.stringify(input))).request)
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({status:'archived',missing})
    expect(ports.rpc).toHaveBeenCalledExactlyOnceWith('ediel_archive_supply_rescission_v1',{p_company_id:company,p_actor_user_id:actor,p_submission:input})
  })
  it.each([undefined,1048576])('receipt %s remains optional and native hold remains 409',async receiptBytes=>{
    const input=submission(4,receiptBytes)
    ports.rpc.mockResolvedValue({data:{status:'held',companyId:company,missing},error:null})
    const response=await POST(streamed(encoded(JSON.stringify(input))).request)
    expect(response.status).toBe(409);expect(await response.json()).toEqual({status:'held',companyId:company,missing})
    expect(ports.rpc).toHaveBeenCalledExactlyOnceWith('ediel_archive_supply_rescission_v1',{p_company_id:company,p_actor_user_id:actor,p_submission:input})
  })
  it.each(['source','issuerReceipt'])('encoded %s ceiling +1 maps to 400 before session/archive effects',async field=>{
    const input=submission(4,1)
    if(field==='source')input.source.bytesBase64='A'.repeat(11184813)
    else input.issuerReceipt!.payloadBase64='A'.repeat(1398105)
    const response=await POST(streamed(encoded(JSON.stringify(input))).request)
    expect(response.status).toBe(400);expect(ports.user).not.toHaveBeenCalled();expect(ports.rpc).not.toHaveBeenCalled()
  })
  it.each([{approved:true},{issuerReceipt:{verified:true}},{source:{...submission().source,approved:true}}])('strict unknown authority fields fail before archive %j',async extra=>{
    expect((await POST(streamed(encoded(JSON.stringify({...submission(),...extra}))).request)).status).toBe(400)
    expect(ports.rpc).not.toHaveBeenCalled()
  })
})

describe('finite aggregate raw-body budget: 11184812 + 1398104 + 131072 = 12713988',()=>{
  // Shrinking the route budget or trusting lying headers breaks these controls.
  it.each([undefined,'malformed','1','12713988'])('reader and actual POST admit below/at budget with declared %s',async declared=>{
    for(const size of [12713987,12713988]){
      const bytes=jsonAt(submission(8388608,1048576),size)
      const direct=streamed(bytes,declared,[1,1000])
      expect(await readSupplyRescissionJson(direct.request,12713988)).toEqual(submission(8388608,1048576))
      expect(direct.body.locked).toBe(false)
      const response=await POST(streamed(bytes,declared,[1,1000]).request)
      expect(response.status).toBe(201);expect(await response.json()).toMatchObject({status:'archived',missing})
    }
  })
  it.each([undefined,'malformed','1','12713988'])('reader and POST reject actual budget +1 with declared %s',async declared=>{
    const bytes=jsonAt(submission(),12713989),direct=streamed(bytes,declared,[12713988])
    await expect(readSupplyRescissionJson(direct.request,12713988)).rejects.toBeInstanceOf(RequestedChangeBodyLimit)
    expect(direct.state()).toEqual({reads:2,cancelled:true});expect(direct.body.locked).toBe(false)
    const routed=streamed(bytes,declared,[12713988]),response=await POST(routed.request)
    expect(response.status).toBe(413);expect(routed.state()).toEqual({reads:2,cancelled:true});expect(routed.body.locked).toBe(false)
    expect(ports.rpc).not.toHaveBeenCalled()
  })
  it('declared budget +1 rejects before reading small body',async()=>{
    const direct=streamed(encoded('{}'),'12713989')
    await expect(readSupplyRescissionJson(direct.request,12713988)).rejects.toBeInstanceOf(RequestedChangeBodyLimit)
    expect(direct.state().reads).toBe(0);expect(direct.body.locked).toBe(false)
    const routed=streamed(encoded('{}'),'12713989')
    expect((await POST(routed.request)).status).toBe(413);expect(routed.state().reads).toBe(0);expect(ports.rpc).not.toHaveBeenCalled()
  })
  it('counts raw UTF8 bytes and reconstructs a multibyte sequence split across chunks',async()=>{
    const input=submission();input.source.reference='SYNTHETIC å'
    const bytes=encoded(JSON.stringify(input)),split=bytes.indexOf(195)+1
    expect(bytes.byteLength).toBeGreaterThan(JSON.stringify(input).length)
    const direct=streamed(bytes,undefined,[split])
    expect(await readSupplyRescissionJson(direct.request,bytes.byteLength)).toEqual(input);expect(direct.body.locked).toBe(false)
    const tooSmall=streamed(bytes,undefined,[split])
    await expect(readSupplyRescissionJson(tooSmall.request,bytes.byteLength-1)).rejects.toBeInstanceOf(RequestedChangeBodyLimit)
    expect(tooSmall.state().cancelled).toBe(true);expect(tooSmall.body.locked).toBe(false)
    expect((await POST(streamed(bytes,undefined,[split]).request)).status).toBe(201)
  })
  it.each([encoded('{'),Uint8Array.from([123,34,120,34,58,34,195,34,125])])('malformed JSON/UTF8 maps to 400 and releases reader',async bytes=>{
    const direct=streamed(bytes)
    await expect(readSupplyRescissionJson(direct.request,12713988)).rejects.toBeInstanceOf(SyntaxError)
    expect(direct.body.locked).toBe(false)
    expect((await POST(streamed(bytes).request)).status).toBe(400);expect(ports.rpc).not.toHaveBeenCalled()
  })
  it('missing body maps to 400',async()=>{
    expect((await POST(new NextRequest('http://localhost/intake',{method:'POST'}))).status).toBe(400)
    expect(ports.rpc).not.toHaveBeenCalled()
  })
  it.each(['denied','unavailable','no-company'])('auth %s precedes body work even when declared oversized',async mode=>{
    if(mode==='denied')ports.access.mockResolvedValue({response:NextResponse.json({error:'Denied'},{status:403})})
    if(mode==='unavailable')ports.access.mockRejectedValue(Error('PRIVATE auth failure'))
    if(mode==='no-company')ports.access.mockResolvedValue({guard:{companyId:null,userId:actor}})
    const input=streamed(encoded('{}'),'12713989'),response=await POST(input.request)
    expect(response.status).toBe(mode==='unavailable'?503:403)
    expect(response.headers.get('cache-control')).toBe('private, no-store');expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(input.state().reads).toBe(0);expect(input.body.locked).toBe(false);expect(ports.user).not.toHaveBeenCalled();expect(ports.rpc).not.toHaveBeenCalled()
    expect(ports.access).toHaveBeenCalledExactlyOnceWith({allOf:['communication.write','contracts.read','metering.write']})
  })
})
