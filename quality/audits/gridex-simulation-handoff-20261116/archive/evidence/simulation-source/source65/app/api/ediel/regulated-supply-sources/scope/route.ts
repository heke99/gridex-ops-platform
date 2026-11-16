import {NextRequest,NextResponse} from 'next/server'
import {readRegulatedSupplyGroundScope} from '@/lib/ediel/production/regulatedSupplyGroundIntake'
import {regulatedSupplyHttp,regulatedSupplyHeaders,regulatedSupplySelector,readRegulatedSupplyJson} from '@/lib/ediel/production/regulatedSupplyGroundHttp'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function POST(request:NextRequest){return regulatedSupplyHttp(['communication.read','contracts.read','metering.read'],async guard=>{
 const input=regulatedSupplySelector.parse(await readRegulatedSupplyJson(request,128*1024))
 const result=await readRegulatedSupplyGroundScope({...input,companyId:guard.companyId!,actorUserId:guard.userId})
 return NextResponse.json(result,{status:result.status==='held'?409:200,headers:regulatedSupplyHeaders})
})}
