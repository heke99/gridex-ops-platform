import {NextRequest,NextResponse} from 'next/server'
import {archiveAiPurposeSource} from '@/lib/ediel/production/aiPurposeSource'
import {aiPurposeSourceHttp,aiPurposeSourceHeaders,aiPurposeSubmission,readAiPurposeJson,AI_PURPOSE_BODY_MAX_BYTES} from '@/lib/ediel/production/aiPurposeSourceHttp'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function POST(request:NextRequest){return aiPurposeSourceHttp(['communication.write','customers.write','contracts.write'],async guard=>{
 const input=aiPurposeSubmission.parse(await readAiPurposeJson(request,AI_PURPOSE_BODY_MAX_BYTES))
 const result=await archiveAiPurposeSource({...input,companyId:guard.companyId!,actorUserId:guard.userId})
 return NextResponse.json(result,{status:201,headers:aiPurposeSourceHeaders})
})}
