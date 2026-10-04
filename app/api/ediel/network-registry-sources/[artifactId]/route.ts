import {NextRequest,NextResponse} from 'next/server'
import {readNetworkRegistrySourceArtifact} from '@/lib/ediel/production/networkRegistrySource'
import {networkRegistrySourceHttp,networkRegistrySourceHeaders,artifactSelector} from '@/lib/ediel/production/networkRegistrySourceHttp'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function GET(_request:NextRequest,{params}:{params:Promise<{artifactId:string}>}){return networkRegistrySourceHttp(['communication.read','customers.read','contracts.read'],async guard=>{
 const artifactId=artifactSelector.parse((await params).artifactId)
 const result=await readNetworkRegistrySourceArtifact({companyId:guard.companyId!,actorUserId:guard.userId,artifactId})
 return NextResponse.json(result,{headers:networkRegistrySourceHeaders})
})}
