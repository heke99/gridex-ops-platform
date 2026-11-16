import {NextRequest} from 'next/server'
import {decisionEvidenceParentPurposeStatus} from '@/lib/ediel/retention/decisionEvidenceRetentionHttp'
export async function GET(_request:NextRequest,context:{params:Promise<{policyId:string}>}){const {policyId}=await context.params;return decisionEvidenceParentPurposeStatus(policyId)}
