import 'server-only'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { z, ZodError } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const retentionHeaders={'Cache-Control':'private, no-store'}
export const RETENTION_SELECTED_COMPANY_COOKIE='gridex_retention_company'
const uuid=z.string().uuid()
export async function requireRetentionScope(requiredPermissions:readonly string[]=[]){
 const client=await createSupabaseServerClient(),auth=await client.auth.getUser()
 if(auth.error||!auth.data.user||auth.data.user.user_metadata?.must_change_password===true)throw Error('retention_http_authenticated_actor_required')
 const selected=(await cookies()).get(RETENTION_SELECTED_COMPANY_COOKIE)?.value
 const selector=uuid.safeParse(selected)
 if(!selector.success)throw Error('retention_http_current_company_selector_required')
 const companyId=selector.data,userId=auth.data.user.id
 const {data,error}=await client.rpc('ediel_current_retention_session_v1',{p_company_id:companyId,p_actor_user_id:userId})
 if(error)throw Error('retention_http_current_company_authority_required')
 const parsed=z.object({companyId:uuid,actorUserId:uuid,permissions:z.array(z.string())}).safeParse(data)
 if(!parsed.success)throw Error('retention_http_current_company_authority_required')
 const session=parsed.data
 if(session.companyId!==companyId||session.actorUserId!==userId||!requiredPermissions.every(key=>session.permissions.includes(key)))throw Error('retention_http_current_company_authority_required')
 return {companyId,userId,permissions:session.permissions as readonly string[],client}
}
export async function requireRetentionCompanies(){
 const client=await createSupabaseServerClient(),auth=await client.auth.getUser()
 if(auth.error||!auth.data.user||auth.data.user.user_metadata?.must_change_password===true)throw Error('retention_http_authenticated_actor_required')
 const {data,error}=await client.rpc('ediel_current_retention_companies_v1',{})
 if(error)throw Error('retention_http_current_company_list_required')
 const companies=z.array(z.object({companyId:uuid,name:z.string(),status:z.enum(['active','archived','pending_deletion','closed']),permissions:z.array(z.string())})).max(1000).parse(data)
 return {userId:auth.data.user.id,client,companies}
}
export async function retentionHttp(requiredPermissions:readonly string[],handler:(scope:Awaited<ReturnType<typeof requireRetentionScope>>)=>Promise<NextResponse>){
 try{return await handler(await requireRetentionScope(requiredPermissions))}
 catch(error){const invalid=error instanceof ZodError||error instanceof SyntaxError||error instanceof Error&&error.message==='retention_http_body_limit'
  return NextResponse.json({error:invalid?'Ogiltig retentionbegäran.':'Aktuell bolags-, klass- eller källbehörighet saknas.'},{status:invalid?400:403,headers:retentionHeaders})}
}
export async function readRetentionJson(request:NextRequest,maxBytes:number):Promise<unknown>{
 if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')??''))throw new SyntaxError('json_required')
 const length=request.headers.get('content-length')
 if(length!==null&&(!/^\d+$/.test(length)||Number(length)>maxBytes))throw Error('retention_http_body_limit')
 if(!request.body)throw new SyntaxError('body_required')
 const reader=request.body.getReader(),chunks:Uint8Array[]=[]
 let count=0
 try{while(true){const part=await reader.read();if(part.done)break;count+=part.value.byteLength;if(count>maxBytes){await reader.cancel();throw Error('retention_http_body_limit')}chunks.push(part.value)}}finally{reader.releaseLock()}
 return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
