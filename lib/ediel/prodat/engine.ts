// lib/ediel/prodat/engine.ts

import type {
  ProdatEngineAckExpectation,
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
import { prodatMessageTypeToken } from '@/lib/ediel/prodat/registry'
import {
  resolveCanonicalEdielPolicy,
  type CanonicalEdielPolicy,
} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { validateCanonicalPolicyFields } from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'

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

function policyReferenceDate(input: ProdatEngineInput): string {
  return (input.generatedAt ?? new Date()).toISOString().slice(0, 10)
}

function resolveRenderPolicy(input: ProdatEngineInput): CanonicalEdielPolicy {
  const subtypeSource = input.variant
    ?? input.context.reasonForTransaction
    ?? input.context.contractClosureReason
    ?? null

  return resolveCanonicalEdielPolicy({
    family: 'PRODAT',
    messageCode: input.code,
    subtypeOrReasonCode: subtypeSource,
    direction: 'outbound',
    referenceDate: policyReferenceDate(input),
    applicationReference: input.route.applicationReference ?? null,
    businessContext: input.context.businessContext ?? null,
    bilateralCapabilityVerified: input.context.bilateralCapabilityVerified ?? undefined,
    prodatDependentFacts: {
      market: 'electricity',
      ...(input.context.dependentConditionFacts ?? {}),
    },
    mode: input.mode === 'production' ? 'send' : 'catalog_evidence',
  })
}

function ackExpectationFromPolicy(policy: CanonicalEdielPolicy): ProdatEngineAckExpectation {
  const requiresContrl = policy.ackRule.technicalAck === 'CONTRL'
  const requiresAperak = policy.ackRule.applicationAck === 'APERAK' || policy.ackRule.applicationAck === 'transactional'
  return {
    requiresContrl,
    requiresAperak,
    contrlStatus: requiresContrl ? 'pending' : 'not_required',
    aperakStatus: requiresAperak ? 'pending' : 'not_required',
    utiltsErrStatus: 'not_required',
    ackDueAt: null,
  }
}

function canonicalizeEngineInput(input: ProdatEngineInput, policy: CanonicalEdielPolicy): ProdatEngineInput {
  return {
    ...input,
    variant: policy.subtype,
    route: {
      ...input.route,
      applicationReference: policy.applicationReference,
    },
    context: {
      ...input.context,
      reasonForTransaction: policy.transactionReasonCode,
    },
  }
}

export function renderProdat(input: ProdatEngineInput): ProdatEngineRenderResult {
  const policy = resolveRenderPolicy(input)
  const canonicalInput = canonicalizeEngineInput(input, policy)
  const builder = BUILDERS[canonicalInput.code]

  // `policy` is an intentional runtime-only extension passed through the thin
  // per-code wrappers to profileRenderer. The wrappers do not own protocol rules.
  const builderInput = {
    context: canonicalInput.context,
    portalSnapshot: canonicalInput.portalSnapshot ?? null,
    generatedAt: canonicalInput.generatedAt,
    mode: canonicalInput.mode,
    variant: canonicalInput.variant ?? null,
    routeDecisionReason: canonicalInput.route.routeDecisionReason ?? null,
    selectedVersion: canonicalInput.version.selectedVersion,
    acceptedVersions: canonicalInput.version.acceptedVersions ?? [],
    policy,
  }
  const result = builder(builderInput)
  const policyFieldIssues = validateCanonicalPolicyFields({
    policy,
    rawSegments: result.segments,
    scope: 'dependent_only',
  })

  const rendered: ProdatEngineRenderResult = {
    ...result,
    ackExpectation: ackExpectationFromPolicy(policy),
    issues: [
      ...result.issues,
      ...policyFieldIssues.map((issue) => ({
        severity: issue.severity,
        code: issue.code,
        title: issue.title,
        description: issue.description,
      })),
    ],
    diagnostics: {
      ...result.diagnostics,
      profileKey: policy.profileKey,
      rulebookProcessGroup: policy.processGroup,
      rulebookApplicationReference: policy.applicationReference,
      rulebookIssues: policyFieldIssues as unknown as Array<Record<string, unknown>>,
      canonicalPolicySourceTrace: policy.sourceTrace as unknown as Array<Record<string, unknown>>,
      dependentConditionStatuses: policy.prodatDependentConditions as unknown as Array<Record<string, unknown>>,
    },
  }

  const blockingIssues = rendered.issues.filter((issue) => issue.severity === 'error')
  if (canonicalInput.mode === 'production' && blockingIssues.length > 0) {
    throw new ProdatRenderValidationError(canonicalInput, blockingIssues)
  }

  return rendered
}

/** Legacy-compatible adapter. Guide/version and Application Reference are
 * resolved through the same canonical policy used by the production renderer. */
export function renderProdat26A(input: {
  context: ProdatEngineProductionContext
  portalSnapshot?: ProdatEnginePortalSnapshot
  generatedAt?: Date
}): ProdatEngineRenderResult {
  const generatedAt = input.generatedAt ?? new Date()
  const previewPolicy = resolveCanonicalEdielPolicy({
    family: 'PRODAT',
    messageCode: input.context.code,
    subtypeOrReasonCode: input.context.reasonForTransaction ?? input.context.contractClosureReason ?? null,
    direction: 'outbound',
    referenceDate: generatedAt.toISOString().slice(0, 10),
    businessContext: input.context.businessContext ?? null,
    bilateralCapabilityVerified: input.context.bilateralCapabilityVerified ?? undefined,
    prodatDependentFacts: {
      market: 'electricity',
      ...(input.context.dependentConditionFacts ?? {}),
    },
    mode: input.portalSnapshot ? 'catalog_evidence' : 'send',
  })
  const selectedVersion = previewPolicy.associationAssignedCode
  if (!selectedVersion) throw new Error(`canonical_prodat_association_missing:${input.context.code}`)

  return renderProdat({
    code: input.context.code,
    mode: input.portalSnapshot ? 'test' : 'production',
    actor: {
      senderEdielId: input.context.senderEdielId,
      receiverEdielId: input.context.receiverEdielId,
    },
    route: {
      applicationReference: previewPolicy.applicationReference,
    },
    version: {
      selectedVersion,
      messageTypeToken: prodatMessageTypeToken(selectedVersion),
      acceptedVersions: [...new Set([
        selectedVersion,
        ...previewPolicy.acceptedOutboundGuides.map((guide) => guide.associationAssignedCode).filter((value): value is string => Boolean(value)),
      ])],
    },
    context: input.context,
    portalSnapshot: input.portalSnapshot ?? null,
    generatedAt,
  })
}
