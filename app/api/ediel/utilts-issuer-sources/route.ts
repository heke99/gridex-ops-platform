import { NextRequest, NextResponse } from 'next/server'
import { archiveUtiltsIssuerSource, readUtiltsIssuerSource, issuerSourceSubmission, issuerSourceArtifactId, ISSUER_SOURCE_SUBMIT, ISSUER_SOURCE_BODY_MAX_BYTES } from '@/lib/ediel/utilts/issuerSourceIntake'
import { requestedChangeHttp, requestedChangeHeaders, readRequestedChangeJson } from '@/lib/ediel/production/requestedChangeHttp'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function POST(request: NextRequest) {
  return requestedChangeHttp([ISSUER_SOURCE_SUBMIT], async guard => {
    const input = issuerSourceSubmission.parse(await readRequestedChangeJson(request, ISSUER_SOURCE_BODY_MAX_BYTES))
    const result = await archiveUtiltsIssuerSource({ ...input, companyId: guard.companyId!, actorUserId: guard.userId })
    return NextResponse.json(result, { status: result.status === 'held' ? 409 : 201, headers: requestedChangeHeaders })
  })
}
export async function GET(request: NextRequest) {
  return requestedChangeHttp([ISSUER_SOURCE_SUBMIT], async guard => {
    const entries = [...request.nextUrl.searchParams.entries()]
    if (entries.length !== 1 || entries[0][0] !== 'artifactId') throw new SyntaxError('exact_artifact_selector_required')
    const artifactId = issuerSourceArtifactId.parse(entries[0][1])
    const result = await readUtiltsIssuerSource({ artifactId, companyId: guard.companyId!, actorUserId: guard.userId })
    return NextResponse.json(result, { status: 200, headers: requestedChangeHeaders })
  })
}
