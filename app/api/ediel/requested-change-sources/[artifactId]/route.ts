import {NextRequest,NextResponse} from 'next/server'
import {readRequestedChangeArtifact} from '@/lib/ediel/production/requestedChangeIntake'
import {requestedChangeHttp,requestedChangeHeaders,artifactSelector} from '@/lib/ediel/production/requestedChangeHttp'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function GET(_request:NextRequest,{params}:{params:Promise<{artifactId:string}>}){
 return requestedChangeHttp(['communication.read','customers.read'],async guard=>{
  const artifactId=artifactSelector.parse((await params).artifactId)
  const result=await readRequestedChangeArtifact({companyId:guard.companyId!,actorUserId:guard.userId,artifactId})
  return NextResponse.json(result,{headers:requestedChangeHeaders})
 })
}
