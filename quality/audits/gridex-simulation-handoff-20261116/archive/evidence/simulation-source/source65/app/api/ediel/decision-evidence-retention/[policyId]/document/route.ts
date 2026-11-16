import {NextRequest} from 'next/server'
import {decisionEvidenceDocument} from '@/lib/ediel/retention/decisionEvidenceRetentionHttp'
export async function GET(_request:NextRequest,context:{params:Promise<{policyId:string}>}){const {policyId}=await context.params;return decisionEvidenceDocument(policyId)}
