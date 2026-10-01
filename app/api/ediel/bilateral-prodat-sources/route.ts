import {NextRequest,NextResponse} from 'next/server'
import {archiveBilateralProdatGround,BILATERAL_PRODAT_SOURCE_MAX_BYTES} from '@/lib/ediel/production/bilateralProdatProfileIntake'
import {bilateralProdatHttp,bilateralProdatHeaders,bilateralProdatSubmission,readBilateralProdatJson} from '@/lib/ediel/production/bilateralProdatProfileHttp'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function POST(request:NextRequest){return bilateralProdatHttp(['communication.write','contracts.read','metering.write'],async guard=>{
 const input=bilateralProdatSubmission.parse(await readBilateralProdatJson(request,Math.ceil(BILATERAL_PRODAT_SOURCE_MAX_BYTES/3)*4+128*1024))
 const result=await archiveBilateralProdatGround({...input,companyId:guard.companyId!,actorUserId:guard.userId})
 return NextResponse.json(result,{status:result.status==='held'?409:201,headers:bilateralProdatHeaders})
})}
