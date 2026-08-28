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
import { buildZ08Segments } from '@/lib/ediel/prodat/builders/z08'
import { buildZ09Segments } from '@/lib/ediel/prodat/builders/z09'
import { buildZ10Segments } from '@/lib/ediel/prodat/builders/z10'
import { buildZ13Segments } from '@/lib/ediel/prodat/builders/z13'
import { buildZ14Segments } from '@/lib/ediel/prodat/builders/z14'
import { buildZ15Segments } from '@/lib/ediel/prodat/builders/z15'
import { buildZ18Segments } from '@/lib/ediel/prodat/builders/z18'
import { deriveProdatAckExpectation, prodatMessageTypeToken } from '@/lib/ediel/prodat/registry'
import { buildRulebookMessageDecision } from '@/lib/ediel/rulebook/messageBuilder'
import { validateProdatProfile } from '@/lib/ediel/prodat/profiles'
import { getCanonicalProdatProfile } from '@/lib/ediel/rulebook/prodatRulebook'
import {
  canonicalProdatSubtypeAlias,
  canonicalProdatTransactionReason,
} from '@/lib/ediel/rulebook/prodatSubtypeRegistry'

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

export class ProdatRenderValidationError extends Error {
  readonly issues: ProdatEngineRenderResult['issues']

  constructor(input: ProdatEngineInput, issues: ProdatEngineRenderResult['issues']) {
    super(`prodat_render_blocked:${input.code}:${issues.map((issue) => issue.code).join(',')}`)
    this.name = 'ProdatRenderValidationError'
    this.issues = issues
  }
}

const BUILDERS = {
  Z01: buildZ01Segments,
  Z02: buildZ02Segments,
  Z03: buildZ03Segments,
  Z04: buildZ04Segments,
  Z05: buildZ05Segments,
  Z06: buildZ06Segments,
  Z08: buildZ08Segments,
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

function canonicalizeEngineInput(input: ProdatEngineInput): ProdatEngineInput {
  const subtypeSource = input.variant
    ?? input.context.reasonForTransaction
    ?? (input.code === 'Z08' ? input.context.contractClosureReason : null)
  const subtype = canonicalProdatSubtypeAlias(subtypeSource, input.code)
  const reason = canonicalProdatTransactionReason(subtypeSource, input.code)

  return {
    ...input,
    variant: subtype ?? input.variant ?? null,
    context: {
      ...input.context,
      reasonForTransaction: reason ?? input.context.reasonForTransaction ?? null,
    },
  }
}

export function renderProdat(input: ProdatEngineInput): ProdatEngineRenderResult {
  const canonicalInput = canonicalizeEngineInput(input)
  const builder = BUILDERS[canonicalInput.code]
  const rulebookDecision = buildRulebookMessageDecision({
    family: 'PRODAT',
    code: canonicalInput.code,
    applicationReference: canonicalInput.route.applicationReference ?? undefined,
  })
  const profileValidation = validateProdatProfile({
    code: canonicalInput.code,
    subtype: canonicalInput.variant,
    version: canonicalInput.version.selectedVersion,
    context: canonicalInput.context,
  })
  const result = builder({
    context: canonicalInput.context,
    portalSnapshot: canonicalInput.portalSnapshot ?? null,
    generatedAt: canonicalInput.generatedAt,
    mode: canonicalInput.mode,
    variant: canonicalInput.variant ?? null,
    routeDecisionReason: canonicalInput.route.routeDecisionReason ?? null,
    selectedVersion: canonicalInput.version.selectedVersion,
    acceptedVersions: canonicalInput.version.acceptedVersions ?? [],
  })

  const rendered = withAckExpectation({
    ...result,
    issues: [
      ...result.issues,
      ...profileValidation.issues,
      ...rulebookDecision.issues.map((issue) => ({
        severity: issue.severity,
        code: issue.code,
        title: issue.title,
        description: issue.description,
      })),
    ],
    diagnostics: {
      ...result.diagnostics,
      profileKey: profileValidation.profile?.key ?? null,
      rulebookProcessGroup: rulebookDecision.processGroup,
      rulebookApplicationReference: rulebookDecision.applicationReference,
      rulebookIssues: rulebookDecision.issues as unknown as Array<Record<string, unknown>>,
    },
  }, canonicalInput.code)

  const blockingIssues = rendered.issues.filter((issue) => issue.severity === 'error')
  if (canonicalInput.mode === 'production' && blockingIssues.length > 0) {
    throw new ProdatRenderValidationError(canonicalInput, blockingIssues)
  }

  return rendered
}

/** Legacy-compatible adapter. Version/token are projected from the canonical
 * PRODAT profile rather than repeated as literals here. */
export function renderProdat26A(input: {
  context: ProdatEngineProductionContext
  portalSnapshot?: ProdatEnginePortalSnapshot
  generatedAt?: Date
}): ProdatEngineRenderResult {
  const canonical = getCanonicalProdatProfile(input.context.code)
  if (!canonical) throw new Error(`canonical_prodat_profile_missing:${input.context.code}`)
  const selectedVersion = canonical.guideVersion.replace(/[^A-Z0-9]/gi, '')
  return renderProdat({
    code: input.context.code,
    mode: input.portalSnapshot ? 'test' : 'production',
    actor: {
      senderEdielId: input.context.senderEdielId,
      receiverEdielId: input.context.receiverEdielId,
    },
    route: {},
    version: {
      selectedVersion,
      messageTypeToken: prodatMessageTypeToken(selectedVersion),
      acceptedVersions: [selectedVersion, canonical.associationAssignedCode],
    },
    context: input.context,
    portalSnapshot: input.portalSnapshot ?? null,
    generatedAt: input.generatedAt,
  })
}
