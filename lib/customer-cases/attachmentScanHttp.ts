import 'server-only'
import {timingSafeEqual}from'node:crypto'
import {z}from'zod'
import {requireAdminApiAccess}from'@/lib/admin/apiGuards'
import {currentSupportSession}from'@/lib/customer-operations/supportSession'
import {SupportCommandError}from'@/lib/customer-operations/supportCommand'
import {processSupportAttachmentScans,receiveSupportAttachmentScannerCallback}from'./attachmentScanQueue'
import {prepareProtectedSupportAttachmentRead,denyProtectedSupportAttachmentDownload}from'./attachmentProtectedRead'

export function supportAttachmentSecurityHeaders(response:Response){
  response.headers.set('cache-control','private, no-store, max-age=0')
  response.headers.set('pragma','no-cache')
  response.headers.set('x-content-type-options','nosniff')
  response.headers.set('content-security-policy',"default-src 'none'; sandbox; frame-ancestors 'none'")
  response.headers.set('x-frame-options','DENY')
  response.headers.set('referrer-policy','no-referrer')
  response.headers.set('cross-origin-resource-policy','same-origin')
  return response
}
const json=(value:unknown,status=200)=>supportAttachmentSecurityHeaders(Response.json(value,{status}))
const denied=(code:string,status:number)=>json({error:code,releaseAllowed:false},status)
function transport(request:Request,expected:string|undefined):Response|null{
  if(!expected||expected.length>256)return denied('support_scanner_transport_unconfigured',503)
  const expectedBytes=Buffer.from(expected)
  if(expectedBytes.byteLength<32||expectedBytes.byteLength>256)return denied('support_scanner_transport_unconfigured',503)
  const header=request.headers.get('authorization')??''
  const token=header.startsWith('Bearer ')?header.slice(7):''
  if(token.length>256)return denied('unauthorized',401)
  const suppliedBytes=Buffer.from(token)
  if(suppliedBytes.byteLength!==expectedBytes.byteLength||!timingSafeEqual(suppliedBytes,expectedBytes))return denied('unauthorized',401)
  return null
}
async function boundedJson(request:Request,maximum:number){
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')??'')||!request.body)
    throw new SupportCommandError('invalid_support_scanner_request',422)
  const declared=request.headers.get('content-length')
  if(declared&&(!/^\d+$/.test(declared)||Number(declared)>maximum))
    throw new SupportCommandError('support_scanner_request_too_large',413)
  const reader=request.body.getReader(),chunks:Uint8Array[]=[];let size=0
  const deadline=Date.now()+5000
  try{
    while(true){
      let timer:ReturnType<typeof setTimeout>|undefined
      const next=await Promise.race([reader.read(),new Promise<never>((_,reject)=>{
        timer=setTimeout(()=>reject(new SupportCommandError('support_scanner_request_timeout',408)),Math.max(1,deadline-Date.now()))
      })]).finally(()=>clearTimeout(timer))
      if(next.done)break
      size+=next.value.byteLength
      if(size>maximum)throw new SupportCommandError('support_scanner_request_too_large',413)
      chunks.push(next.value)
    }
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))) as unknown
  }catch(error){
    await reader.cancel().catch(()=>{})
    if(error instanceof SupportCommandError)throw error
    throw new SupportCommandError('invalid_support_scanner_request',422)
  }finally{reader.releaseLock()}
}
function safeFailure(error:unknown){
  return error instanceof SupportCommandError?denied(error.code,error.status):denied('support_attachment_unavailable',503)
}
export async function handleSupportScannerProcess(request:Request){
  if(request.method!=='POST')return denied('method_not_allowed',405)
  const rejected=transport(request,process.env.GRIDEX_SUPPORT_SCANNER_PROCESS_SECRET)
  if(rejected)return rejected
  try{
    const input=z.object({companyId:z.string().uuid().optional(),limit:z.number().int().min(1).max(20).optional()}).strict()
      .safeParse(await boundedJson(request,512))
    if(!input.success)return denied('invalid_support_scanner_request',422)
    return json({result:await processSupportAttachmentScans(input.data),releaseAllowed:false},202)
  }catch(error){return safeFailure(error)}
}
export async function handleSupportScannerCallback(request:Request){
  if(request.method!=='POST')return denied('method_not_allowed',405)
  const rejected=transport(request,process.env.GRIDEX_SUPPORT_SCANNER_CALLBACK_SECRET)
  if(rejected)return rejected
  try{
    const input=z.object({nonceId:z.string().uuid(),token:z.string().min(1).max(8192)}).strict()
      .safeParse(await boundedJson(request,10*1024))
    if(!input.success)return denied('invalid_support_scanner_request',422)
    try{
      const receipt=await receiveSupportAttachmentScannerCallback(input.data)
      return json({accepted:true,replayed:receipt.replayed,outcome:receipt.outcome,releaseAllowed:false},202)
    }catch{return denied('support_scanner_evidence_unavailable',403)}
  }catch(error){return safeFailure(error)}
}
export async function handleProtectedSupportAttachmentDownload(request:Request,attachmentId:string){
  if(!['GET','POST'].includes(request.method))return denied('method_not_allowed',405)
  const access=await requireAdminApiAccess(['cases.read'])
  if(access.response)return supportAttachmentSecurityHeaders(access.response)
  try{
    const url=new URL(request.url),origin=request.headers.get('origin'),site=request.headers.get('sec-fetch-site')
    if(site==='cross-site'||(origin&&origin!==url.origin)||(request.method==='POST'&&origin!==url.origin))return denied('support_actor_forbidden',403)
    if(!access.guard.companyId||!z.string().uuid().safeParse(attachmentId).success)return denied('resource_not_found',404)
    const input=request.method==='POST'?z.object({customerId:z.string().uuid()}).strict().safeParse(await boundedJson(request,512)):
      z.object({customerId:z.string().uuid(),nonceId:z.string().uuid()}).strict().safeParse({customerId:url.searchParams.get('customerId'),nonceId:request.headers.get('x-gridex-support-read-nonce')})
    if(!input.success||[...url.searchParams.keys()].some(key=>key!=='customerId'))return denied('invalid_support_attachment',422)
    const context={companyId:access.guard.companyId,customerId:input.data.customerId,actor:await currentSupportSession('ops',access.guard.userId)}
    if(request.method==='POST')return json(await prepareProtectedSupportAttachmentRead(context,attachmentId),201)
    const nonce='nonceId'in input.data?input.data.nonceId:null
    if(typeof nonce!=='string')return denied('invalid_support_attachment',422)
    const decision=await denyProtectedSupportAttachmentDownload(context,attachmentId,nonce)
    return json(decision,423)
  }catch(error){return safeFailure(error)}
}
