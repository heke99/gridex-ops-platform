import {NextRequest,NextResponse} from 'next/server'
import {archiveRegulatedSupplyGround,REGULATED_SUPPLY_SOURCE_MAX_BYTES} from '@/lib/ediel/production/regulatedSupplyGroundIntake'
import {regulatedSupplyHttp,regulatedSupplyHeaders,regulatedSupplySubmission,readRegulatedSupplyJson} from '@/lib/ediel/production/regulatedSupplyGroundHttp'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function POST(request:NextRequest){return regulatedSupplyHttp(['communication.write','contracts.read','metering.write'],async guard=>{
 const input=regulatedSupplySubmission.parse(await readRegulatedSupplyJson(request,Math.ceil(REGULATED_SUPPLY_SOURCE_MAX_BYTES/3)*4+128*1024))
 const result=await archiveRegulatedSupplyGround({...input,companyId:guard.companyId!,actorUserId:guard.userId})
 return NextResponse.json(result,{status:result.status==='held'?409:201,headers:regulatedSupplyHeaders})
})}
