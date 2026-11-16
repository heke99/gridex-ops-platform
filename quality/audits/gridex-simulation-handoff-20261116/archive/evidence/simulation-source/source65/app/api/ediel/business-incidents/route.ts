import {NextRequest,NextResponse} from 'next/server'
import {reportFreshEdielBusinessIncident,readFreshEdielBusinessIncident} from '@/lib/ediel/incidents/freshBusinessIncident'
import {requestedChangeHttp,requestedChangeHeaders,readRequestedChangeJson} from '@/lib/ediel/production/requestedChangeHttp'
export const runtime='nodejs'
export const dynamic='force-dynamic'
const permissions=['communication.write','communication.send']
export async function POST(request:NextRequest){return requestedChangeHttp(permissions,async guard=>{
 const command=await readRequestedChangeJson(request,16384),receipt=await reportFreshEdielBusinessIncident({companyId:guard.companyId!,actorUserId:guard.userId,command})
 return NextResponse.json(receipt,{status:201,headers:requestedChangeHeaders})
})}
export async function GET(request:NextRequest){return requestedChangeHttp(['communication.read'],async guard=>{
 if([...request.nextUrl.searchParams.keys()].some(key=>key!=='incidentId'))return NextResponse.json({error:'Ogiltig incidentfråga.'},{status:400,headers:requestedChangeHeaders})
 const receipt=await readFreshEdielBusinessIncident({companyId:guard.companyId!,actorUserId:guard.userId,incidentId:request.nextUrl.searchParams.get('incidentId')??''})
 return NextResponse.json(receipt,{headers:requestedChangeHeaders})
})}
