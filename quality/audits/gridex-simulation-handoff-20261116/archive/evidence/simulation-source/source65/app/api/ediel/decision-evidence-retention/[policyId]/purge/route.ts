import {NextRequest} from 'next/server'
import {decisionEvidencePurge} from '@/lib/ediel/retention/decisionEvidenceRetentionHttp'
export async function POST(request:NextRequest,context:{params:Promise<{policyId:string}>}){const {policyId}=await context.params;return decisionEvidencePurge(request,policyId)}
