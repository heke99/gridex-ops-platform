import {NextRequest,NextResponse} from 'next/server'
import {archiveRequestedChangeSource,REQUESTED_CHANGE_SOURCE_MAX_BYTES} from '@/lib/ediel/production/requestedChangeIntake'
import {requestedChangeHttp,requestedChangeHeaders,requestedChangeSubmission,readRequestedChangeJson} from '@/lib/ediel/production/requestedChangeHttp'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function POST(request:NextRequest){
 return requestedChangeHttp(['communication.write','customers.write'],async guard=>{
  const input=requestedChangeSubmission.parse(await readRequestedChangeJson(request,Math.ceil(REQUESTED_CHANGE_SOURCE_MAX_BYTES/3)*4+128*1024))
  const companyId=guard.companyId!
  const result=await archiveRequestedChangeSource({...input,companyId,actorUserId:guard.userId,
    invoiceeProfile:{...input.invoiceeProfile,source:{kind:'caller_selection',companyId,reference:input.source.reference}}})
  return NextResponse.json(result,{status:201,headers:requestedChangeHeaders})
 })
}
