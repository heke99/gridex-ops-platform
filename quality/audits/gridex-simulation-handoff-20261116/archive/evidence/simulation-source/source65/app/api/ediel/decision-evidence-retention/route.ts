import {NextRequest} from 'next/server'
import {decisionEvidenceSubmit} from '@/lib/ediel/retention/decisionEvidenceRetentionHttp'
export function POST(request:NextRequest){return decisionEvidenceSubmit(request)}
