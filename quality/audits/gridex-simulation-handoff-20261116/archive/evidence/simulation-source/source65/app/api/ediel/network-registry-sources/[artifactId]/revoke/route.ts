import {NextRequest,NextResponse} from 'next/server'
import {revokeNetworkRegistrySource} from '@/lib/ediel/production/networkRegistrySource'
import {networkRegistrySourceHttp,networkRegistrySourceHeaders,networkRegistryWithdrawal,artifactSelector,readNetworkRegistryJson} from '@/lib/ediel/production/networkRegistrySourceHttp'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function POST(request:NextRequest,{params}:{params:Promise<{artifactId:string}>}){return networkRegistrySourceHttp(['communication.write','customers.write','contracts.write','ediel.network_registry.review'],async guard=>{
 const artifactId=artifactSelector.parse((await params).artifactId),input=networkRegistryWithdrawal.parse(await readNetworkRegistryJson(request,128*1024))
 const result=await revokeNetworkRegistrySource({...input,companyId:guard.companyId!,actorUserId:guard.userId,artifactId})
 return NextResponse.json(result,{status:result.status==='held'?409:200,headers:networkRegistrySourceHeaders})
})}
