import 'server-only'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { z, ZodError } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { ADMIN_SELECTED_COMPANY_COOKIE } from '@/lib/admin/navigationPreferences'

export const retentionHeaders={'Cache-Control':'private, no-store'}
const uuid=z.string().uuid()
export async function requireRetentionScope(requiredPermissions:readonly string[]=[]){
 const client=await createSupabaseServerClient(),auth=await client.auth.getUser()
 if(auth.error||!auth.data.user)throw Error('retention_http_authenticated_actor_required')
 const selected=(await cookies()).get(ADMIN_SELECTED_COMPANY_COOKIE)?.value
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
