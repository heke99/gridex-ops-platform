import {NextRequest} from 'next/server'
import {messageRetentionRead} from '@/lib/ediel/retention/blobRetentionHttp'
export const runtime='nodejs'
export async function GET(_request:NextRequest,context:{params:Promise<{decisionId:string}>}){
 const {decisionId}=await context.params
 return messageRetentionRead(decisionId)
}
