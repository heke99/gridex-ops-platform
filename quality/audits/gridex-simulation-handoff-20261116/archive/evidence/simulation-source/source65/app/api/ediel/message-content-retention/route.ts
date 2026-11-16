import {NextRequest} from 'next/server'
import {messageRetentionSubmit} from '@/lib/ediel/retention/blobRetentionHttp'
export const runtime='nodejs'
export async function POST(request:NextRequest){return messageRetentionSubmit(request)}
