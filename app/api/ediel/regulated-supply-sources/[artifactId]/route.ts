import {NextRequest,NextResponse} from 'next/server'
import {readRegulatedSupplyGroundArtifact} from '@/lib/ediel/production/regulatedSupplyGroundIntake'
import {regulatedSupplyHttp,regulatedSupplyHeaders,regulatedArtifactId} from '@/lib/ediel/production/regulatedSupplyGroundHttp'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function GET(_request:NextRequest,{params}:{params:Promise<{artifactId:string}>}){return regulatedSupplyHttp(['communication.read','contracts.read','metering.read'],async guard=>{
 const artifactId=regulatedArtifactId.parse((await params).artifactId)
 const result=await readRegulatedSupplyGroundArtifact({companyId:guard.companyId!,actorUserId:guard.userId,artifactId})
 return NextResponse.json(result,{headers:regulatedSupplyHeaders})
})}
