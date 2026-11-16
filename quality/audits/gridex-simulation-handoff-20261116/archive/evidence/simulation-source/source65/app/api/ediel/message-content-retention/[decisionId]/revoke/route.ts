import {NextRequest} from 'next/server'
import {messageRetentionRevoke} from '@/lib/ediel/retention/blobRetentionHttp'
export const runtime='nodejs'
export async function POST(request:NextRequest,context:{params:Promise<{decisionId:string}>}){
 const {decisionId}=await context.params
 return messageRetentionRevoke(request,decisionId)
}
