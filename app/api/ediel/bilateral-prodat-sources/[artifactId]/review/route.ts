import {NextRequest,NextResponse} from 'next/server'
import {reviewBilateralProdatGround} from '@/lib/ediel/production/bilateralProdatProfileIntake'
import {bilateralProdatHttp,bilateralProdatHeaders,bilateralProdatReview,bilateralProdatArtifactId,readBilateralProdatJson} from '@/lib/ediel/production/bilateralProdatProfileHttp'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function POST(request:NextRequest,{params}:{params:Promise<{artifactId:string}>}){return bilateralProdatHttp(['communication.write','contracts.read','metering.write','ediel.bilateral_profile.review'],async guard=>{
 const artifactId=bilateralProdatArtifactId.parse((await params).artifactId),input=bilateralProdatReview.parse(await readBilateralProdatJson(request,128*1024))
 const result=await reviewBilateralProdatGround({...input,companyId:guard.companyId!,actorUserId:guard.userId,artifactId})
 return NextResponse.json(result,{status:result.status==='held'?409:200,headers:bilateralProdatHeaders})
})}
