import {NextRequest,NextResponse} from 'next/server'
import {reviewAiPurposeSource} from '@/lib/ediel/production/aiPurposeSource'
import {aiPurposeSourceHttp,aiPurposeSourceHeaders,aiPurposeSourceReview,artifactSelector,readAiPurposeJson} from '@/lib/ediel/production/aiPurposeSourceHttp'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function POST(request:NextRequest,{params}:{params:Promise<{artifactId:string}>}){return aiPurposeSourceHttp(['communication.write','customers.write','contracts.write','ediel.ai_purpose.review'],async guard=>{
 const artifactId=artifactSelector.parse((await params).artifactId),input=aiPurposeSourceReview.parse(await readAiPurposeJson(request,128*1024))
 const result=await reviewAiPurposeSource({...input,companyId:guard.companyId!,actorUserId:guard.userId,artifactId})
 return NextResponse.json(result,{status:result.status==='held'?409:200,headers:aiPurposeSourceHeaders})
})}
