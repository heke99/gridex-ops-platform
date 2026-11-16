import {NextRequest} from 'next/server'
import {messageRetentionPurge} from '@/lib/ediel/retention/blobRetentionHttp'
export const runtime='nodejs'
export async function POST(request:NextRequest,context:{params:Promise<{decisionId:string}>}){
 const {decisionId}=await context.params
 return messageRetentionPurge(request,decisionId)
}
