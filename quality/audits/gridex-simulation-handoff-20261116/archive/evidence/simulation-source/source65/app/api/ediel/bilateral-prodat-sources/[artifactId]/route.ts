import {NextRequest,NextResponse} from 'next/server'
import {readBilateralProdatGroundArtifact} from '@/lib/ediel/production/bilateralProdatProfileIntake'
import {bilateralProdatHttp,bilateralProdatHeaders,bilateralProdatArtifactId} from '@/lib/ediel/production/bilateralProdatProfileHttp'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function GET(_request:NextRequest,{params}:{params:Promise<{artifactId:string}>}){return bilateralProdatHttp(['communication.read','contracts.read','metering.read'],async guard=>{
 const artifactId=bilateralProdatArtifactId.parse((await params).artifactId)
 const result=await readBilateralProdatGroundArtifact({companyId:guard.companyId!,actorUserId:guard.userId,artifactId})
 return NextResponse.json(result,{headers:bilateralProdatHeaders})
})}
