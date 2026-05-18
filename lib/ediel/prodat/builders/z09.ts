// lib/ediel/prodat/builders/z09.ts

import type {
  ProdatEnginePortalSnapshot,
  ProdatEngineProductionContext,
  ProdatEngineRenderResult,
} from '@/lib/ediel/prodat/types'
import { buildGenericProdatSegments } from '@/lib/ediel/prodat/builders/generic'

function normalize(value?: string | null): string {
  return String(value ?? '').trim().toUpperCase()
}

function isZ09DLike(input: {
  context: ProdatEngineProductionContext
  portalSnapshot?: ProdatEnginePortalSnapshot
  variant?: string | null
}): boolean {
  const portalData = input.portalSnapshot && typeof input.portalSnapshot === 'object'
    ? input.portalSnapshot as Record<string, unknown>
    : null
  const explicit = normalize(
    input.variant ??
    input.context.reasonForTransaction ??
    (typeof portalData?.reasonForTransaction === 'string' ? portalData.reasonForTransaction : null) ??
    (typeof portalData?.prodatTransactionType === 'string' ? portalData.prodatTransactionType : null)
  )

  return explicit === 'D' || explicit === 'Z09D' || explicit === 'Z70'
}

function z09FOrGSegments(segments: string[]): string[] {
  let convertedLineDate = false

  return segments.flatMap((segment) => {
    // L7 AGT uses Z09F/Z09G. The portal validation requires SG8/DTM[157]
    // and warns that SG8/DTM[92] is not in use for this Z09 profile.
    if (!convertedLineDate && segment.startsWith('DTM+92:')) {
      convertedLineDate = true
      return [segment.replace(/^DTM\+92:/, 'DTM+157:')]
    }

    // For Z09F/Z09G the portal report marks ANJ, UD and IT groups as not in use.
    // Keep LI/Z05 and Z02 because they are valid/supporting references for AGT.
    if (segment.startsWith('RFF+ANJ:')) return []
    if (segment.startsWith('NAD+UD+')) return []
    if (segment.startsWith('NAD+IT+')) return []

    return [segment]
  })
}

export function buildZ09Segments(input: {
  context: ProdatEngineProductionContext
  portalSnapshot?: ProdatEnginePortalSnapshot
  generatedAt?: Date
  mode?: 'test' | 'production'
  variant?: string | null
  routeDecisionReason?: string | null
  selectedVersion?: string | null
  acceptedVersions?: string[]
}): ProdatEngineRenderResult {
  const result = buildGenericProdatSegments({
    ...input,
    renderer: 'prodat.builders.z09.buildZ09Segments',
  })

  if (isZ09DLike(input)) {
    return result
  }

  const segments = z09FOrGSegments(result.segments)

  return {
    ...result,
    segments,
    diagnostics: {
      ...result.diagnostics,
      renderer: 'prodat.builders.z09.buildZ09Segments.z09FOrG',
      segmentCountBeforeEnvelope: segments.length,
    },
  }
}
