import {NextRequest,NextResponse} from 'next/server'
import {z,ZodError} from 'zod'
import {requireAdminApiAccess} from '@/lib/admin/apiGuards'
import {prepareAndQueueBrpChangeZ09} from '@/lib/ediel/flows/prodatBrpChange'
import {supabaseService} from '@/lib/supabase/service'
export const runtime='nodejs'
export const dynamic='force-dynamic'
const headers={'Cache-Control':'private, no-store'}
const command=z.object({eventId:z.string().uuid(),preferredRouteId:z.string().uuid().nullable().optional()}).strict()
export async function POST(request:NextRequest){
 const access=await requireAdminApiAccess(['communication.write'])
 if(access.response)return access.response
 if(!access.guard.companyId)return NextResponse.json({error:'Välj ett behörigt bolag.'},{status:403,headers})
 try{const input=command.parse(await request.json());const result=await prepareAndQueueBrpChangeZ09({...input,companyId:access.guard.companyId,actorUserId:access.guard.userId});return NextResponse.json(result,{headers})}
 catch(error){return NextResponse.json({error:error instanceof ZodError||error instanceof SyntaxError?'Ogiltig BRP-begäran.':'BRP-begäran saknar aktuellt behörigt källunderlag.'},{status:error instanceof ZodError||error instanceof SyntaxError?400:403,headers})}
}
export async function GET(request:NextRequest){
 const access=await requireAdminApiAccess(['communication.read'])
 if(access.response)return access.response
 if(!access.guard.companyId)return NextResponse.json({error:'Välj ett behörigt bolag.'},{status:403,headers})
 try{if(request.nextUrl.searchParams.getAll('supplyPeriodId').length!==1||[...request.nextUrl.searchParams.keys()].some(k=>k!=='supplyPeriodId'))throw new ZodError([]);const periodId=z.string().uuid().parse(request.nextUrl.searchParams.get('supplyPeriodId'));
 const{data,error}=await supabaseService.rpc('ediel_brp_responsibility_history_v1',{p_company_id:access.guard.companyId,p_supply_period_id:periodId,p_actor_user_id:access.guard.userId});if(error)throw error;return NextResponse.json(data,{headers})}
 catch(error){return NextResponse.json({error:error instanceof ZodError?'Ogiltig leveransrelation.':'BRP-historiken kunde inte auktoriseras eller läsas.'},{status:error instanceof ZodError?400:403,headers})}
}
