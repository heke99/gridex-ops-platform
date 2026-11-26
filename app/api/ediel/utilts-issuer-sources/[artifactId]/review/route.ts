import { NextRequest, NextResponse } from 'next/server'
import { reviewUtiltsIssuerSource, revokeUtiltsIssuerSource, issuerSourceReviewHttp, issuerSourceArtifactId, ISSUER_SOURCE_REVIEW, ISSUER_SOURCE_BODY_MAX_BYTES } from '@/lib/ediel/utilts/issuerSourceIntake'
import { requestedChangeHttp, requestedChangeHeaders, readRequestedChangeJson } from '@/lib/ediel/production/requestedChangeHttp'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function POST(request: NextRequest, { params }: { params: Promise<{ artifactId: string }> }) {
  return requestedChangeHttp([ISSUER_SOURCE_REVIEW], async guard => {
    const artifactId = issuerSourceArtifactId.parse((await params).artifactId)
    const input = issuerSourceReviewHttp.parse(await readRequestedChangeJson(request, ISSUER_SOURCE_BODY_MAX_BYTES))
    const scope = { artifactId, companyId: guard.companyId!, actorUserId: guard.userId }
    let result
    if (input.decision === 'revoke') {
      const { version, commandId, environment, targetKind, targetId, decisionOriginal, reason } = input
      result = await revokeUtiltsIssuerSource({ ...scope, version, commandId, environment, targetKind, targetId, decisionOriginal, reason })
    } else result = await reviewUtiltsIssuerSource({ ...scope, ...input })
    return NextResponse.json(result, { status: result.status === 'held' ? 409 : 200, headers: requestedChangeHeaders })
  })
}
