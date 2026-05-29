// lib/ediel/prodat/engine.ts

import type {
  ProdatEngineInput,
  ProdatEnginePortalSnapshot,
  ProdatEngineProductionContext,
  ProdatEngineRenderResult,
} from '@/lib/ediel/prodat/types'
import { buildZ01Segments } from '@/lib/ediel/prodat/builders/z01'
import { buildZ02Segments } from '@/lib/ediel/prodat/builders/z02'
import { buildZ03Segments } from '@/lib/ediel/prodat/builders/z03'
import { buildZ04Segments } from '@/lib/ediel/prodat/builders/z04'
import { buildZ05Segments } from '@/lib/ediel/prodat/builders/z05'
import { buildZ06Segments } from '@/lib/ediel/prodat/builders/z06'
import { buildZ09Segments } from '@/lib/ediel/prodat/builders/z09'
import { buildZ10Segments } from '@/lib/ediel/prodat/builders/z10'
import { buildZ13Segments } from '@/lib/ediel/prodat/builders/z13'
import { buildZ14Segments } from '@/lib/ediel/prodat/builders/z14'
import { buildZ15Segments } from '@/lib/ediel/prodat/builders/z15'
import { buildZ18Segments } from '@/lib/ediel/prodat/builders/z18'
import { deriveProdatAckExpectation } from '@/lib/ediel/prodat/registry'
import { buildRulebookMessageDecision } from '@/lib/ediel/rulebook/messageBuilder'

export type {
  ProdatEngineAckExpectation,
  ProdatEngineActorContext,
  ProdatEngineCode,
  ProdatEngineDiagnostics,
  ProdatEngineInput,
  ProdatEngineMode,
  ProdatEnginePortalSnapshot,
  ProdatEngineProductionContext,
  ProdatEngineRenderResult,
  ProdatEngineRouteContext,
  ProdatEngineValidationIssue,
  ProdatEngineVersionContext,
} from '@/lib/ediel/prodat/types'

const BUILDERS = {
  Z01: buildZ01Segments,
  Z02: buildZ02Segments,
  Z03: buildZ03Segments,
  Z04: buildZ04Segments,
  Z05: buildZ05Segments,
  Z06: buildZ06Segments,
  Z09: buildZ09Segments,
  Z10: buildZ10Segments,
  Z13: buildZ13Segments,
  Z14: buildZ14Segments,
  Z15: buildZ15Segments,
  Z18: buildZ18Segments,
} satisfies Record<ProdatEngineInput['code'], typeof buildZ09Segments>

function withAckExpectation(result: ProdatEngineRenderResult, code?: string | null): ProdatEngineRenderResult {
  return {
    ...result,
    ackExpectation: result.ackExpectation ?? deriveProdatAckExpectation(code),
  }
}

export function renderProdat(input: ProdatEngineInput): ProdatEngineRenderResult {
  const builder = BUILDERS[input.code]
  const rulebookDecision = buildRulebookMessageDecision({
    family: 'PRODAT',
    code: input.code,
    applicationReference: input.route.applicationReference ?? undefined,
  })
  const result = builder({
    context: input.context,
    portalSnapshot: input.portalSnapshot ?? null,
    generatedAt: input.generatedAt,
    mode: input.mode,
    variant: input.variant ?? null,
    routeDecisionReason: input.route.routeDecisionReason ?? null,
    selectedVersion: input.version.selectedVersion,
    acceptedVersions: input.version.acceptedVersions ?? [],
  })

  return withAckExpectation({
    ...result,
    issues: [
      ...result.issues,
      ...rulebookDecision.issues.map((issue) => ({
        severity: issue.severity,
        code: issue.code,
        title: issue.title,
        description: issue.description,
      })),
    ],
    diagnostics: {
      ...result.diagnostics,
      rulebookProcessGroup: rulebookDecision.processGroup,
      rulebookApplicationReference: rulebookDecision.applicationReference,
      rulebookIssues: rulebookDecision.issues as unknown as Array<Record<string, unknown>>,
    },
  }, input.code)
}

/**
 * Legacy-compatible adapter used by existing switch/TGT code. It renders the
 * same body segments as the old implementation, but the actual responsibility
 * now sits inside lib/ediel/prodat/* so PRODAT can grow without becoming one
 * giant generator.
 */
export function renderProdat26A(input: {
  context: ProdatEngineProductionContext
  portalSnapshot?: ProdatEnginePortalSnapshot
  generatedAt?: Date
}): ProdatEngineRenderResult {
  return renderProdat({
    code: input.context.code,
    mode: input.portalSnapshot ? 'test' : 'production',
    actor: {
      senderEdielId: input.context.senderEdielId,
      receiverEdielId: input.context.receiverEdielId,
    },
    route: {},
    version: {
      selectedVersion: '26A',
      messageTypeToken: 'PRODAT:D:97A:UN:E2SE6A',
      acceptedVersions: ['26A', 'E2SE6A'],
    },
    context: input.context,
    portalSnapshot: input.portalSnapshot ?? null,
    generatedAt: input.generatedAt,
  })
}
