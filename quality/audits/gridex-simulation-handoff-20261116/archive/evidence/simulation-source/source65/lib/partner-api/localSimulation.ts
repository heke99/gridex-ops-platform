/** Private LOCAL_SIMULATION_ONLY adapter. A token prefix selects a port, never grants authority. */
import {createHash} from 'node:crypto'
import {NextRequest, NextResponse} from 'next/server'
import {supabaseService} from '@/lib/supabase/service'
import {inspectPdfStructure} from '@/lib/documents/pdfStructure'
import {trustedClientIp} from '@/lib/integrations/ipPolicy'

type Json = Record<string, unknown>
type NativeError = {code?: string; message?: string}
type NativeResult = {data: unknown; error: NativeError | null}
type NativeName = 'gridex_execute_local_simulation_partner_v1' | 'gridex_assert_partner_response_not_local_v1'
// Runtime validation below is the boundary until the sole producer generates the new schema types.
const native = supabaseService as unknown as {rpc(name: NativeName, args: {p_command: Json}): PromiseLike<NativeResult>}
const PURPOSE = 'LOCAL_SIMULATION_ONLY'
const TOKEN = /^gdxl_[0-9a-f]{7}\.[A-Za-z0-9_-]{43}$/
const REF = /^[A-Za-z0-9_-]{1,128}$/
const object = (v:unknown):Json => v && typeof v==='object' && !Array.isArray(v) ? v as Json : {}
const digest = (v:string) => createHash('sha256').update(v,'utf8').digest('hex')
function bearer(request:NextRequest) {return /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization')?.trim() ?? '')?.[1] ?? null}
function localResponse(body:unknown,status:number) {
  return NextResponse.json(body,{status,headers:{'Cache-Control':'no-store','X-Gridex-Local-Simulation':PURPOSE}})
}
function failure(status:number,code:string) {return localResponse({error:{code,message:'The local simulation request was not admitted.'}},status)}
function nativeFailure(error:NativeError) {
  const code=error.message?.startsWith('gridex_local_') && /^[a-z0-9_]+$/.test(error.message) ? error.message : 'local_partner_unavailable'
  const status=error.message==='gridex_local_partner_invalid_credential'?401:error.message==='gridex_local_partner_rate_limited'?429:error.code==='42501'||error.code==='55000'?403:error.code==='P0002'?404:error.code==='23505'?409:error.code==='22023'||error.code==='23514'?422:503
  return failure(status,code)
}
async function boundedBody(request:NextRequest):Promise<string|null> {
  const reader=request.body?.getReader()
  if(!reader)return ''
  const chunks:Uint8Array[]=[];let size=0
  try {
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength
      if(size>7*1024*1024){await reader.cancel();return null}chunks.push(value)}
    return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))
  }finally{reader.releaseLock()}
}
function supported(method:string,p:string[]) {
  if(method==='POST' && p.length===1 && p[0]==='contract')return true
  if(method==='GET'&&p.length===3&&p[0]==='contract'&&REF.test(p[1]??'')&&p[2]==='state')return true
  if(p[0]!=='customer'||!REF.test(p[1]??''))return false
  if(method==='GET'&&p.length===2)return true
  if(method==='POST'&&p.length===3&&p[2]==='site')return true
  if(p[2]!=='site'||!REF.test(p[3]??''))return false
  if(method==='GET'&&p.length===4)return true
  return p.length===5&&((p[4]==='powerofattorney'&&['GET','POST'].includes(method))||(p[4]==='contract'&&method==='POST'))
}
/** A private credential never falls through to normal authentication, publication or address resolution. */
export async function handleLocalSimulationPartnerApi(request:NextRequest,method:string,path:string[]|undefined):Promise<NextResponse|null> {
  const raw=request.headers.get('authorization')?.trim()??''
  if(!/^(?:Bearer\s+)?gdxl_/i.test(raw))return null
  const token=bearer(request)
  if(!token||!TOKEN.test(token))return failure(401,'invalid_local_partner_credential')
  const parts=(path??[]).filter(Boolean)
  if(!supported(method,parts))return failure(404,'local_partner_route_not_supported')
  const key=request.headers.get('idempotency-key')?.trim()??null
  if(method!=='GET'&&(!key||key.length<8||key.length>200))return failure(422,'idempotency_key_required')
  let payload:Json={}
  if(method!=='GET') {
    let rawBody:string|null
    try{rawBody=await boundedBody(request)}catch{return failure(422,'local_partner_json_invalid')}
    if(rawBody===null)return failure(413,'local_partner_payload_too_large')
    try {const parsed:unknown=JSON.parse(rawBody);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return failure(422,'local_partner_object_required');payload=parsed as Json}
    catch{return failure(422,'local_partner_json_invalid')}
  }
  const poa=parts.at(-1)==='powerofattorney'?payload:payload.power_of_attorney
  if(method==='POST'&&poa!==undefined) {
    const p=object(poa)
    if(typeof p.file_base64!=='string'||p.file_base64.length>7*1024*1024||!/^[A-Za-z0-9+/]*={0,2}$/.test(p.file_base64)||p.file_base64.length%4!==0)return failure(422,'local_partner_pdf_invalid')
    const bytes=Buffer.from(p.file_base64,'base64')
    if(bytes.length>5*1024*1024||!inspectPdfStructure(bytes).ok)return failure(422,'local_partner_pdf_invalid')
  }
  try {
    const {data,error}=await native.rpc('gridex_execute_local_simulation_partner_v1',{p_command:{version:1,keyPrefix:token.slice(0,12),secretHash:digest(token),method,path:parts,idempotencyKey:key,payload,clientIp:trustedClientIp(request.headers),origin:request.headers.get('origin')?.trim()??null}})
    if(error)return nativeFailure(error)
    const result=object(data)
    if(result.version!==1||result.purpose!==PURPOSE||!Number.isInteger(result.status)||![200,201,403,404,409,422,429,503].includes(Number(result.status))||!result.body||typeof result.body!=='object'||Array.isArray(result.body)||typeof result.replayed!=='boolean')return failure(503,'local_partner_native_response_invalid')
    const response=localResponse(result.body,Number(result.status))
    if(result.replayed)response.headers.set('Idempotency-Replayed','true')
    return response
  }catch{return failure(503,'local_partner_unavailable')}
}
async function ordinaryFence(command:Json):Promise<NextResponse|null> {
  try {
    const {data,error}=await native.rpc('gridex_assert_partner_response_not_local_v1',{p_command:command})
    if(error?.code==='42501'&&error.message==='gridex_local_test_response_denied')return NextResponse.json({error:{code:'resource_not_found',message:'Resource not found.'}},{status:404,headers:{'Cache-Control':'no-store'}})
    if(error||object(data).allowed!==true)return NextResponse.json({error:{code:'partner_resource_qualification_unavailable'}},{status:503,headers:{'Cache-Control':'no-store'}})
    return null
  }catch{return NextResponse.json({error:{code:'partner_resource_qualification_unavailable'}},{status:503,headers:{'Cache-Control':'no-store'}})}
}
/** Negative only: unknown/invalid normal tokens continue to all existing authentication checks. */
export async function assertOrdinaryPartnerInputNotLocal(request:NextRequest,path:string[]|undefined) {
  const token=bearer(request)
  if(!token)return null
  return ordinaryFence({version:1,direction:'request',keyPrefix:token.slice(0,12),secretHash:digest(token),values:path??[]})
}
/** Permanent private bindings protect reads even after a run/key expires or is revoked. */
export async function assertOrdinaryPartnerResponseNotLocal(response:NextResponse) {
  if(response.status<200||response.status>=300||!response.headers.get('content-type')?.includes('application/json'))return response
  let values:unknown
  try{values=await response.clone().json()}catch{return NextResponse.json({error:{code:'partner_resource_qualification_unavailable'}},{status:503})}
  return await ordinaryFence({version:1,direction:'response',values})??response
}
