import {NextRequest,NextResponse} from 'next/server'
import {ZodError} from 'zod'
import {requireAdminApiAccess} from '@/lib/admin/apiGuards'
import {executeEdielServiceAdministration,readEdielServiceAdministration} from '@/lib/ediel/services/administration'
export const runtime='nodejs'
export const dynamic='force-dynamic'
const headers={'Cache-Control':'private, no-store'}
export async function POST(request:NextRequest){
 const access=await requireAdminApiAccess(['metering.write'])
 if(access.response)return access.response
 if(!access.guard.companyId)return NextResponse.json({error:'Välj ett behörigt bolag.'},{status:403,headers})
 try{
  const command=await request.json()
  const result=await executeEdielServiceAdministration({companyId:access.guard.companyId,actorUserId:access.guard.userId,command})
  return NextResponse.json(result,{headers})
 }catch(error){
  if(error instanceof ZodError||error instanceof SyntaxError)return NextResponse.json({error:'Ogiltigt tjänstekommando.'},{status:400,headers})
  return NextResponse.json({error:'Tjänstekommando saknar aktuellt behörigt underlag eller tillstånd.'},{status:403,headers})
 }
}

export async function GET(request:NextRequest){
 const access=await requireAdminApiAccess(['metering.read'])
 if(access.response)return access.response
 if(!access.guard.companyId)return NextResponse.json({error:'Välj ett behörigt bolag.'},{status:403,headers})
 try{
  if([...request.nextUrl.searchParams.keys()].some(key=>key!=='assignmentId'))return NextResponse.json({error:'Ogiltig uppdragsfråga.'},{status:400,headers})
  const result=await readEdielServiceAdministration({companyId:access.guard.companyId,actorUserId:access.guard.userId,assignmentId:request.nextUrl.searchParams.get('assignmentId')})
  return NextResponse.json(result,{headers})
 }catch(error){return NextResponse.json({error:error instanceof ZodError?'Ogiltigt uppdrags-ID.':'Uppdraget kunde inte auktoriseras eller läsas.'},{status:error instanceof ZodError?400:403,headers})}
}
