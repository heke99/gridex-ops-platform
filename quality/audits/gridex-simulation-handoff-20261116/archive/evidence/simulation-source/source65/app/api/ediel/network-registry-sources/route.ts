import {NextRequest,NextResponse} from 'next/server'
import {archiveNetworkRegistrySource} from '@/lib/ediel/production/networkRegistrySource'
import {networkRegistrySourceHttp,networkRegistrySourceHeaders,networkRegistrySubmission,readNetworkRegistryJson,NETWORK_REGISTRY_BODY_MAX_BYTES} from '@/lib/ediel/production/networkRegistrySourceHttp'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function POST(request:NextRequest){return networkRegistrySourceHttp(['communication.write','customers.write','contracts.write'],async guard=>{
 const input=networkRegistrySubmission.parse(await readNetworkRegistryJson(request,NETWORK_REGISTRY_BODY_MAX_BYTES))
 const result=await archiveNetworkRegistrySource({...input,companyId:guard.companyId!,actorUserId:guard.userId})
 return NextResponse.json(result,{status:201,headers:networkRegistrySourceHeaders})
})}
