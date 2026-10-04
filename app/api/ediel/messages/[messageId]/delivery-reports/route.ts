import {NextRequest,NextResponse} from 'next/server'
import {requireAdminApiAccess} from '@/lib/admin/apiGuards'
import {readDsnSourceObservations} from '@/lib/inbound-mail/dsnSourceObservations'
export const runtime='nodejs'
export const dynamic='force-dynamic'
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export async function GET(request:NextRequest,context:{params:Promise<{messageId:string}>}){
  const access=await requireAdminApiAccess(['communication.read'])
  if(access.response)return access.response
  if(!access.guard.companyId)return NextResponse.json({error:'Välj ett behörigt bolag.'},{status:403,headers})
  const {messageId}=await context.params
  if(!uuid.test(messageId)||request.nextUrl.searchParams.size)return NextResponse.json({error:'Ogiltigt meddelande.'},{status:400,headers})
  try{return NextResponse.json(await readDsnSourceObservations({companyId:access.guard.companyId,actorUserId:access.guard.userId,messageId}),{headers})}
  catch{return NextResponse.json({error:'Leveransrapporter kunde inte auktoriseras eller läsas.'},{status:403,headers})}
}
