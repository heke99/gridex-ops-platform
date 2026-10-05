import {NextRequest} from 'next/server'
import {decisionEvidenceOriginal} from '@/lib/ediel/retention/decisionEvidenceRetentionHttp'
export async function GET(_request:NextRequest,context:{params:Promise<{retentionClass:string;targetId:string}>}){const {retentionClass,targetId}=await context.params;return decisionEvidenceOriginal(retentionClass,targetId,false)}
