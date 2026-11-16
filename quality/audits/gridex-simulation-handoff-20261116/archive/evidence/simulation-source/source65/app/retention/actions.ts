'use server'
import {cookies} from 'next/headers'
import {revalidatePath} from 'next/cache'
import {redirect} from 'next/navigation'
import {z} from 'zod'
import {createSupabaseServerClient} from '@/lib/supabase/server'
import {RETENTION_SELECTED_COMPANY_COOKIE} from '@/lib/ediel/retention/retentionHttp'
export type RetentionSelectionState={message:string;selectedCompanyId?:string}
export async function selectRetentionCompany(_state:RetentionSelectionState,form:FormData):Promise<RetentionSelectionState>{
 try{
  for(const key of form.keys())if(key!=='company_id'&&!key.startsWith('$ACTION_'))throw Error('retention_unknown_selector')
  if(form.getAll('company_id').length!==1)throw Error('retention_exact_selector_required')
  const companyId=z.string().uuid().parse(form.get('company_id')),client=await createSupabaseServerClient(),auth=await client.auth.getUser()
  if(auth.error||!auth.data.user||auth.data.user.user_metadata?.must_change_password===true)throw Error('retention_current_actor_required')
  const reply=await client.rpc('ediel_current_retention_session_v1',{p_company_id:companyId,p_actor_user_id:auth.data.user.id})
  if(reply.error)throw reply.error
  const session=z.object({companyId:z.string().uuid(),actorUserId:z.string().uuid(),permissions:z.array(z.string())}).parse(reply.data)
  if(session.companyId!==companyId||session.actorUserId!==auth.data.user.id)throw Error('retention_current_selection_binding_required')
  const store=await cookies();store.set(RETENTION_SELECTED_COMPANY_COOKIE,companyId,{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',path:'/',maxAge:3600})
  revalidatePath('/retention','layout');return {message:'Bolaget är valt med din aktuella retention- och klassbehörighet.',selectedCompanyId:companyId}
 }catch{return {message:'Bolaget kunde inte väljas. Aktuell egen medlemskap, retention- och klassbehörighet måste vara styrkta.'}}
}
export async function leaveRetentionWorkspace(){
 const client=await createSupabaseServerClient();await client.auth.signOut();(await cookies()).delete(RETENTION_SELECTED_COMPANY_COOKIE);redirect('/login')
}
