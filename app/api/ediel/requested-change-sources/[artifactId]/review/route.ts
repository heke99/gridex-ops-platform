import {NextRequest,NextResponse} from 'next/server'
import {reviewRequestedChangeArtifact} from '@/lib/ediel/production/requestedChangeIntake'
import {requestedChangeHttp,requestedChangeHeaders,requestedChangeReview,artifactSelector,readRequestedChangeJson} from '@/lib/ediel/production/requestedChangeHttp'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function POST(request:NextRequest,{params}:{params:Promise<{artifactId:string}>}){
 return requestedChangeHttp(['communication.write','customers.write','ediel.source.review'],async guard=>{
  const artifactId=artifactSelector.parse((await params).artifactId),input=requestedChangeReview.parse(await readRequestedChangeJson(request,128*1024))
  const result=await reviewRequestedChangeArtifact({...input,companyId:guard.companyId!,actorUserId:guard.userId,artifactId})
  return NextResponse.json(result,{status:result.status==='held'?409:200,headers:requestedChangeHeaders})
 })
}
