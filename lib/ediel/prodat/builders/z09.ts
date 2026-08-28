// lib/ediel/prodat/builders/z09.ts

import type {
  ProdatEnginePortalSnapshot,
  ProdatEngineProductionContext,
  ProdatEngineRenderResult,
} from '@/lib/ediel/prodat/types'
import { buildProfiledProdatSegments } from '@/lib/ediel/prodat/builders/profileRenderer'
import {
  resolveCanonicalEdielPolicy,
  type CanonicalEdielPolicy,
} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import {
  resolveCanonicalProdatRenderSemantics,
  type CanonicalProdatRenderSemantics,
} from '@/lib/ediel/prodat/canonicalRenderSemantics'

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

function applyMeteringMethodPolicy(segments: string[], renderPolicy: CanonicalProdatRenderSemantics): {
  segments: string[]
  reasonForTransaction: string | null
  meteringMethod: string | null
  warning: string | null
} {
  const nextSegments = [...segments]
  const reason = findCavAfter(nextSegments, 'CCI++Z13').value
  const metering = findCavAfter(nextSegments, 'CCI++Z04')
  const requiredMeteringMethod = renderPolicy.requiredMeteringMethod

  if (!requiredMeteringMethod || metering.index < 0) {
    return {
      segments: nextSegments,
      reasonForTransaction: reason,
      meteringMethod: metering.value,
      warning: null,
    }
  }

  const previous = metering.value
  nextSegments[metering.index] = `CAV+${requiredMeteringMethod}`

  return {
    segments: nextSegments,
    reasonForTransaction: reason,
    meteringMethod: requiredMeteringMethod,
    warning:
      previous && previous !== requiredMeteringMethod
        ? `Mätmetod korrigerad av canonical render policy från ${previous} till ${requiredMeteringMethod}.`
        : null,
  }
}

function applyStructuralPolicy(segments: string[], renderPolicy: CanonicalProdatRenderSemantics): string[] {
  let convertedLineDate = false
  return segments.flatMap((segment) => {
    if (!convertedLineDate && renderPolicy.validityDateQualifier && segment.startsWith('DTM+92:')) {
      convertedLineDate = true
      return [segment.replace(/^DTM\+92:/, `DTM+${renderPolicy.validityDateQualifier}:`)]
    }
    if (renderPolicy.suppressAgreementReference && segment.startsWith('RFF+ANJ:')) return []
    if (renderPolicy.suppressEndUserParty && segment.startsWith('NAD+UD+')) return []
    if (renderPolicy.suppressInstallationParty && segment.startsWith('NAD+IT+')) return []
    return [segment]
  })
}

function resolveBuilderPolicy(input: {
  context: ProdatEngineProductionContext
  generatedAt?: Date
  mode?: 'test' | 'production'
  variant?: string | null
  policy?: CanonicalEdielPolicy
}): CanonicalEdielPolicy {
  if (input.policy) return input.policy
  return resolveCanonicalEdielPolicy({
    family: 'PRODAT',
    messageCode: input.context.code,
    subtypeOrReasonCode: input.variant ?? input.context.reasonForTransaction ?? input.context.contractClosureReason ?? null,
    direction: 'outbound',
    referenceDate: (input.generatedAt ?? new Date()).toISOString().slice(0, 10),
    businessContext: input.context.businessContext ?? null,
    bilateralCapabilityVerified: input.context.bilateralCapabilityVerified ?? undefined,
    prodatDependentFacts: {
      market: 'electricity',
      ...(input.context.dependentConditionFacts ?? {}),
    },
    mode: input.mode === 'production' ? 'send' : 'catalog_evidence',
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
  policy?: CanonicalEdielPolicy
}): ProdatEngineRenderResult {
  const policy = resolveBuilderPolicy(input)
  const result = buildProfiledProdatSegments({
    ...input,
    policy,
    renderer: 'prodat.builders.z09.buildZ09Segments',
  })
  const renderPolicy = resolveCanonicalProdatRenderSemantics(policy)

  if (
    !renderPolicy.validityDateQualifier &&
    !renderPolicy.requiredMeteringMethod &&
    !renderPolicy.suppressAgreementReference &&
    !renderPolicy.suppressEndUserParty &&
    !renderPolicy.suppressInstallationParty
  ) {
    return result
  }

  const structurallyNormalized = applyStructuralPolicy(result.segments, renderPolicy)
  const normalized = applyMeteringMethodPolicy(structurallyNormalized, renderPolicy)
  const warnings = normalized.warning
    ? [
        ...result.issues,
        {
          severity: 'warning' as const,
          code: 'z09_metering_method_normalized',
          title: 'Mätmetod styrdes av canonical policy',
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
      renderer: 'prodat.builders.z09.buildZ09Segments.canonicalPolicy',
      reasonForTransaction: normalized.reasonForTransaction ?? result.diagnostics.reasonForTransaction,
      meteringMethod: normalized.meteringMethod ?? result.diagnostics.meteringMethod,
      segmentCountBeforeEnvelope: normalized.segments.length,
      routeDecisionReason: renderPolicy.source.section,
    },
  }
}
