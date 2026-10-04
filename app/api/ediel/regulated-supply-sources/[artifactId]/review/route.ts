import {NextRequest,NextResponse} from 'next/server'
import {reviewRegulatedSupplyGround} from '@/lib/ediel/production/regulatedSupplyGroundIntake'
import {regulatedSupplyHttp,regulatedSupplyHeaders,regulatedSupplyReview,regulatedArtifactId,readRegulatedSupplyJson} from '@/lib/ediel/production/regulatedSupplyGroundHttp'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function POST(request:NextRequest,{params}:{params:Promise<{artifactId:string}>}){return regulatedSupplyHttp(['communication.write','contracts.read','metering.write','ediel.regulated_supply.review'],async guard=>{
 const artifactId=regulatedArtifactId.parse((await params).artifactId),input=regulatedSupplyReview.parse(await readRegulatedSupplyJson(request,128*1024))
 const result=await reviewRegulatedSupplyGround({...input,companyId:guard.companyId!,actorUserId:guard.userId,artifactId})
 return NextResponse.json(result,{status:result.status==='held'?409:200,headers:regulatedSupplyHeaders})
})}
