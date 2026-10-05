import {NextRequest,NextResponse} from 'next/server'
import {readBilateralProdatGroundScope} from '@/lib/ediel/production/bilateralProdatProfileIntake'
import {bilateralProdatHttp,bilateralProdatHeaders,bilateralProdatSelector,readBilateralProdatJson} from '@/lib/ediel/production/bilateralProdatProfileHttp'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function POST(request:NextRequest){return bilateralProdatHttp(['communication.read','contracts.read','metering.read'],async guard=>{
 const input=bilateralProdatSelector.parse(await readBilateralProdatJson(request,128*1024))
 const result=await readBilateralProdatGroundScope({...input,companyId:guard.companyId!,actorUserId:guard.userId})
 return NextResponse.json(result,{status:result.status==='held'?409:200,headers:bilateralProdatHeaders})
})}
