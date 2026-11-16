import {NextRequest,NextResponse} from 'next/server'
import {readNetworkRegistrySourceBytes} from '@/lib/ediel/production/networkRegistrySource'
import {networkRegistrySourceHttp,networkRegistrySourceHeaders,artifactSelector} from '@/lib/ediel/production/networkRegistrySourceHttp'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function GET(_request:NextRequest,{params}:{params:Promise<{artifactId:string}>}){return networkRegistrySourceHttp(['communication.read','customers.read','contracts.read'],async guard=>{
 const artifactId=artifactSelector.parse((await params).artifactId),result=await readNetworkRegistrySourceBytes({companyId:guard.companyId!,actorUserId:guard.userId,artifactId})
 return new NextResponse(new Uint8Array(result.bytes),{headers:{...networkRegistrySourceHeaders,'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="ai-underlag-${artifactId}.pdf"`,'Content-Length':String(result.bytes.byteLength),ETag:`"${result.sourceHash}"`}})
})}
