import {NextRequest} from 'next/server'
import {messageRetentionReview} from '@/lib/ediel/retention/blobRetentionHttp'
export const runtime='nodejs'
export async function POST(request:NextRequest,context:{params:Promise<{decisionId:string}>}){
 const {decisionId}=await context.params
 return messageRetentionReview(request,decisionId)
}
