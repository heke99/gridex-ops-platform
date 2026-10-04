import {NextRequest} from 'next/server'
import {decisionEvidenceRevoke} from '@/lib/ediel/retention/decisionEvidenceRetentionHttp'
export async function POST(request:NextRequest,context:{params:Promise<{policyId:string}>}){const {policyId}=await context.params;return decisionEvidenceRevoke(request,policyId)}
