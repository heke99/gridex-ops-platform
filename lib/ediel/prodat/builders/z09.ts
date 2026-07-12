// lib/ediel/prodat/builders/z09.ts

import type {
  ProdatEnginePortalSnapshot,
  ProdatEngineProductionContext,
  ProdatEngineRenderResult,
} from '@/lib/ediel/prodat/types'
import { buildProfiledProdatSegments } from '@/lib/ediel/prodat/builders/profileRenderer'

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

function findCavAfter(segments: string[], cciSegment: string): { index: number; value: string | null } {
  const cciIndex = segments.findIndex((segment) => segment === cciSegment)
  if (cciIndex < 0) return { index: -1, value: null }

  for (let index = cciIndex + 1; index < segments.length; index += 1) {
    const segment = segments[index]
    if (segment.startsWith('CCI+')) break
    if (segment.startsWith('CAV+')) return { index, value: segment.slice(4).split(':')[0]?.trim().toUpperCase() || null }
  }

  return { index: -1, value: null }
}

function resolveZ09ProductionMeteringMethod(segments: string[]): {
  segments: string[]
  reasonForTransaction: string | null
  meteringMethod: string | null
  appliedRule: string | null
  warning: string | null
} {
  const nextSegments = [...segments]
  const reason = findCavAfter(nextSegments, 'CCI++Z13').value
  const metering = findCavAfter(nextSegments, 'CCI++Z04')

  let requiredMeteringMethod: string | null = null
  let appliedRule: string | null = null

  if (reason === 'E64') {
    requiredMeteringMethod = 'Z04'
    appliedRule = 'Z09F/E64 => mätmetod Z04'
  }

  if (reason === 'E32') {
    requiredMeteringMethod = 'Z03'
    appliedRule = 'Z09G/E32 => mätmetod Z03'
  }

  if (!requiredMeteringMethod || metering.index < 0) {
    return {
      segments: nextSegments,
      reasonForTransaction: reason,
      meteringMethod: metering.value,
      appliedRule,
      warning: null,
    }
  }

  const previous = metering.value
  nextSegments[metering.index] = `CAV+${requiredMeteringMethod}`

  return {
    segments: nextSegments,
    reasonForTransaction: reason,
    meteringMethod: requiredMeteringMethod,
    appliedRule,
    warning:
      previous && previous !== requiredMeteringMethod
        ? `Mätmetod korrigerad av Z09-regel från ${previous} till ${requiredMeteringMethod}.`
        : null,
  }
}

function z09FOrGSegments(segments: string[]): string[] {
  let convertedLineDate = false

  return segments.flatMap((segment) => {
    // Z09F/Z09G uses SG8/DTM[157] as validity date. Some legacy paths still
    // render DTM+92; keep this adapter until every old entry point uses the
    // new engine contract directly.
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
  const result = buildProfiledProdatSegments({
    ...input,
    renderer: 'prodat.builders.z09.buildZ09Segments',
  })

  if (isZ09DLike(input)) {
    return result
  }

  const filteredSegments = z09FOrGSegments(result.segments)
  const normalized = resolveZ09ProductionMeteringMethod(filteredSegments)
  const warnings = normalized.warning
    ? [
        ...result.issues,
        {
          severity: 'warning' as const,
          code: 'z09_metering_method_normalized',
          title: 'Mätmetod styrdes av Z09-regeln',
          description: normalized.warning,
        },
      ]
    : result.issues

  return {
    ...result,
    segments: normalized.segments,
    issues: warnings,
    diagnostics: {
      ...result.diagnostics,
      renderer: 'prodat.builders.z09.buildZ09Segments.z09FOrGEngine',
      reasonForTransaction: normalized.reasonForTransaction ?? result.diagnostics.reasonForTransaction,
      meteringMethod: normalized.meteringMethod ?? result.diagnostics.meteringMethod,
      segmentCountBeforeEnvelope: normalized.segments.length,
      routeDecisionReason: normalized.appliedRule ?? input.routeDecisionReason ?? result.diagnostics.routeDecisionReason,
    },
  }
}
