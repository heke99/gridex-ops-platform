import {NextRequest,NextResponse} from 'next/server'
import {readAiPurposeSourceArtifact} from '@/lib/ediel/production/aiPurposeSource'
import {aiPurposeSourceHttp,aiPurposeSourceHeaders,artifactSelector} from '@/lib/ediel/production/aiPurposeSourceHttp'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function GET(_request:NextRequest,{params}:{params:Promise<{artifactId:string}>}){return aiPurposeSourceHttp(['communication.read','customers.read','contracts.read'],async guard=>{
 const artifactId=artifactSelector.parse((await params).artifactId)
 const result=await readAiPurposeSourceArtifact({companyId:guard.companyId!,actorUserId:guard.userId,artifactId})
 return NextResponse.json(result,{headers:aiPurposeSourceHeaders})
})}
