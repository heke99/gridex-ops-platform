import type {ProdatRegisterValidationEvidence} from '@/lib/ediel/prodat/prodatRegisterValidationEvidence'
import type {ProdatAperakText} from '@/lib/ediel/prodat/prodatAperakText'
import {projectProdatDiagnostics} from '@/lib/ediel/prodat/prodatDiagnosticProjection'
import type {ProdatDiagnostic, ProdatProcessingDisposition} from '@/lib/ediel/prodat/prodatFieldDiagnostic'
// lib/ediel/core/runtimeDecision.ts

import type { EdielMessageRow } from '@/lib/ediel/types'
import { validateEdifactSyntax, type EdielSyntaxIssue } from '@/lib/ediel/core/syntaxValidator'
import {
  buildCanonicalParsedPayload,
  parseCanonicalMessageRow,
  type CanonicalEdielMessage,
} from '@/lib/ediel/core/canonicalMessage'
import { runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'
import type { EdielAperakApplicationError } from '@/lib/ediel/ack'
import { canonicalAckRuleForFamilyCode } from '@/lib/ediel/rulebook/canonicalEdielFacade'
import type { CanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { resolveCanonicalMessagePolicy } from '@/lib/ediel/core/messagePolicy'
import { validateCanonicalPolicyFields } from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import { resolveCanonicalRulePack } from '@/lib/ediel/rulebook/canonicalRulePackRegistry'
import {
  resolveUtiltsInboundBusinessOutcome,
  type UtiltsInboundBusinessOutcome,
} from '@/lib/ediel/utilts/inboundBusinessOutcome'

export type CanonicalDecisionState = 'accepted' | 'rejected' | 'not_applicable' | 'manual_review'

export type CanonicalResponsePlanItem = {
  family: 'CONTRL' | 'APERAK' | 'UTILTS_ERR'
  outcome?: 'positive' | 'negative' | null
  bgm?: string | null
  erc?: string | null
  ftx?: string | null
  reason: string
  applicationErrors?: EdielAperakApplicationError[]
}

export type CanonicalDecisionIssue = {
  layer: 'syntax' | 'envelope' | 'application' | 'functional' | 'dedupe' | 'route' | 'parser'
  severity: 'info' | 'warning' | 'error'
  code: string
  title: string
  description: string
  source?: string | null
  prodatDiagnostic?: ProdatDiagnostic
  prodatAperakText?: ProdatAperakText
  originalSeverity?: 'error' | 'warning'
}

export type CanonicalRuntimeDecision = {
  prodatRegisterValidation?: ProdatRegisterValidationEvidence
  prodatProcessingDisposition?: ProdatProcessingDisposition
  canonical: CanonicalEdielMessage
  policy: CanonicalEdielPolicy | null
  utiltsBusinessOutcome: UtiltsInboundBusinessOutcome | null
  syntaxDecision: CanonicalDecisionState
  applicationDecision: CanonicalDecisionState
  functionalDecision: CanonicalDecisionState
  responsePlan: CanonicalResponsePlanItem[]
  issues: CanonicalDecisionIssue[]
  sourceRules: string[]
  decisionTrace: string[]
  parsedPayload: Record<string, unknown>
  validationReport: Record<string, unknown>
}

function issue(input: CanonicalDecisionIssue): CanonicalDecisionIssue {
  return input
}

function syntaxIssueToCanonical(item: EdielSyntaxIssue): CanonicalDecisionIssue {
  return issue({
    layer: 'syntax',
    severity: item.severity,
    code: item.code,
    title: item.title,
    description: item.description,
    source: 'validateEdifactSyntax',
  })
}

function textIssue(value: string): CanonicalDecisionIssue {
  return issue({
    layer: 'parser',
    severity: 'warning',
    code: 'PARSER_WARNING',
    title: 'Parser-varning',
    description: value,
    source: 'canonicalMessage',
  })
}

function technicalResponsePlan(params: {
  message: EdielMessageRow
  canonical: CanonicalEdielMessage
  syntaxAccepted: boolean
  syntaxIssueText: string | null
}): CanonicalResponsePlanItem[] {
  if (params.message.direction !== 'inbound' || params.message.message_standard !== 'edifact') return []
  try {
    const ack = canonicalAckRuleForFamilyCode({ family: String(params.canonical.family), code: params.canonical.messageCode })
    if (ack.technicalAck !== 'CONTRL') return []
    return [{
      family: 'CONTRL',
      outcome: params.syntaxAccepted ? 'positive' : 'negative',
      reason: params.syntaxAccepted
        ? 'Inbound EDIFACT är syntaxmässigt accepterat enligt canonical ACK authority.'
        : params.syntaxIssueText ?? 'Inbound EDIFACT har syntaxfel och ska få negativ CONTRL.',
    }]
  } catch {
    return []
  }
}

function addNegativeAperakIfAllowed(params: {
  family: string
  code: string | null
  responsePlan: CanonicalResponsePlanItem[]
  reason: string
  applicationErrors?: EdielAperakApplicationError[]
}) {
  try {
    const ack = canonicalAckRuleForFamilyCode({ family: params.family, code: params.code })
    if (ack.negativeApplicationResponse !== 'APERAK' && ack.negativeApplicationResponse !== 'APERAK_OR_UTILTS_ERR') return
    if (params.responsePlan.some((item) => item.family === 'APERAK' && item.outcome === 'negative')) return
    params.responsePlan.push({
      family: 'APERAK',
      outcome: 'negative',
      erc: params.applicationErrors?.[0]?.ercCode ?? '42',
      ftx: params.applicationErrors?.[0]?.text ?? params.reason.slice(0, 70),
      reason: params.reason,
      applicationErrors: params.applicationErrors,
    })
  } catch {
    // Unsupported family remains fail-closed in the decision state; no ACK is fabricated.
  }
}

function applyProdatPolicyDecision(params: {
  policy: CanonicalEdielPolicy
  canonical: CanonicalEdielMessage
  responsePlan: CanonicalResponsePlanItem[]
  issues: CanonicalDecisionIssue[]
  sourceRules: string[]
  decisionTrace: string[]
}): { applicationDecision: CanonicalDecisionState; functionalDecision: CanonicalDecisionState; prodatProcessingDisposition: ProdatProcessingDisposition; prodatRegisterValidation?: ProdatRegisterValidationEvidence } {
  let prodatRegisterValidation: ProdatRegisterValidationEvidence | undefined
  const fieldIssues = validateCanonicalPolicyFields({
    policy: params.policy,
    rawSegments: params.canonical.rawSegments,
    una: params.canonical.una,
    scope: 'all',
    onRegisterValidation: evidence => { prodatRegisterValidation = evidence },
  })
  params.sourceRules.push('CANONICAL_EDIEL_POLICY', 'PRODAT_26A_POLICY_FIELD_VALIDATOR', 'PRODAT_DEPENDENT_CONDITION_ENGINE')
  params.decisionTrace.push(`PRODAT ${params.policy.code}${params.policy.subtype ?? ''} validerades mot en canonical policy med ${params.policy.prodatDependentConditions.length} D-villkor.`)

  const projected = projectProdatDiagnostics(fieldIssues)
  const prodatProcessingDisposition = projected.disposition
  for (const item of projected.observations) {
    params.issues.push(issue({
      layer: item.code.includes('APPLICATION_REFERENCE') ? 'route' : 'application',
      severity: item.severity,
      code: item.code,
      title: item.title,
      description: item.description,
      source: 'validateCanonicalPolicyFields',
      prodatDiagnostic: item.prodatDiagnostic,
      prodatAperakText:item.prodatAperakText,
      originalSeverity: item.originalSeverity,
    }))
  }

  const applicationErrors = projected.applicationErrors
  if (applicationErrors.length) {
    addNegativeAperakIfAllowed({
      family: params.policy.family,
      code: params.policy.code,
      responsePlan: params.responsePlan,
      reason: 'PRODAT innehåller ett blockerande canonical policy-/fältfel.',
      applicationErrors,
    })
    return { applicationDecision: 'rejected', functionalDecision: prodatProcessingDisposition.kind === 'internal_review' ? 'manual_review' : 'accepted', prodatProcessingDisposition, prodatRegisterValidation }
  }

  if (prodatProcessingDisposition.kind === 'internal_review') return {applicationDecision:projected.hasNationalError?'rejected':'manual_review',functionalDecision:projected.hasNationalError?'manual_review':'not_applicable',prodatProcessingDisposition,prodatRegisterValidation}

  if (params.policy.ackRule.applicationAck === 'APERAK') {
    params.responsePlan.push({
      family: 'APERAK',
      outcome: 'positive',
      erc: '100',
      ftx: 'OK',
      reason: 'PRODAT är accepterad enligt canonical policy och positiv APERAK krävs.',
    })
  }

  return { applicationDecision: 'accepted', functionalDecision: 'accepted', prodatProcessingDisposition, prodatRegisterValidation }
}

function resolveUtiltsDecision(params: {
  message: EdielMessageRow
  policy: CanonicalEdielPolicy
  responsePlan: CanonicalResponsePlanItem[]
  issues: CanonicalDecisionIssue[]
  sourceRules: string[]
  decisionTrace: string[]
}): {
  applicationDecision: CanonicalDecisionState
  functionalDecision: CanonicalDecisionState
  businessOutcome: UtiltsInboundBusinessOutcome
} {
  const runtime = runUtiltsRuntimeForMessage(params.message, { canonicalPolicy: params.policy })
  const businessOutcome = resolveUtiltsInboundBusinessOutcome(params.policy)
  params.sourceRules.push('CANONICAL_EDIEL_POLICY', `UTILTS_RUNTIME_${runtime.validation.classification.toUpperCase()}`, `UTILTS_BUSINESS_OUTCOME_${businessOutcome.kind.toUpperCase()}`)
  params.decisionTrace.push(`UTILTS ${params.policy.code} klassades som ${businessOutcome.kind}; runtime=${runtime.validation.classification}.`)

  if (!businessOutcome.allowIndividualCustomerLink && (params.message.customer_id || params.message.site_id || params.message.metering_point_id)) {
    params.issues.push(issue({
      layer: 'application',
      severity: 'error',
      code: 'UTILTS_INDIVIDUAL_LINK_FORBIDDEN',
      title: 'UTILTS får inte kopplas till individuell kund',
      description: `${params.policy.code} har canonical scope ${params.policy.semantics.dataScope} och får inte appliceras på customer/site/metering_point.`,
      source: 'resolveUtiltsInboundBusinessOutcome',
    }))
    addNegativeAperakIfAllowed({
      family: params.policy.family,
      code: params.policy.code,
      responsePlan: params.responsePlan,
      reason: `${params.policy.code} har fel business scope för individuell kundkoppling.`,
    })
    return { applicationDecision: 'rejected', functionalDecision: 'accepted', businessOutcome }
  }

  for (const utiltsIssue of runtime.validation.issues) {
    params.issues.push(issue({
      layer: utiltsIssue.kind === 'functional' ? 'functional' : utiltsIssue.kind === 'syntax' ? 'syntax' : 'application',
      severity: utiltsIssue.severity,
      code: utiltsIssue.code,
      title: utiltsIssue.title,
      description: utiltsIssue.description,
      source: 'runUtiltsRuntimeForMessage',
    }))
  }

  if (runtime.validation.classification === 'syntax_rejected') {
    return { applicationDecision: 'not_applicable', functionalDecision: 'not_applicable', businessOutcome }
  }

  if (runtime.ackPlan.shouldSendUtiltsErr) {
    params.responsePlan.push({
      family: 'UTILTS_ERR',
      outcome: 'negative',
      reason: runtime.ackPlan.reason || 'UTILTS process-/funktionsfel ska besvaras med UTILTS_ERR.',
    })
    return { applicationDecision: 'not_applicable', functionalDecision: 'rejected', businessOutcome }
  }

  if (runtime.ackPlan.shouldSendAperak && runtime.ackPlan.aperakOutcome === 'negative') {
    params.responsePlan.push({
      family: 'APERAK',
      outcome: 'negative',
      bgm: '313',
      erc: runtime.ackPlan.aperakApplicationErrors[0]?.ercCode ?? '41',
      ftx: runtime.ackPlan.aperakApplicationErrors[0]?.text ?? runtime.ackPlan.reason,
      reason: runtime.ackPlan.reason || 'UTILTS anvisnings-/applikationsfel ska besvaras med negativ APERAK.',
      applicationErrors: runtime.ackPlan.aperakApplicationErrors.map((item) => ({
        ercCode: item.ercCode,
        fieldCode: item.fieldCode ?? null,
        text: item.text,
        referenceQualifier: item.referenceQualifier ?? null,
        referenceNumber: item.referenceNumber ?? null,
        lineItemReference: item.lineItemReference ?? null,
      })),
    })
    return { applicationDecision: 'rejected', functionalDecision: 'accepted', businessOutcome }
  }

  if (runtime.ackPlan.shouldSendAperak && runtime.ackPlan.aperakOutcome === 'positive') {
    params.responsePlan.push({
      family: 'APERAK',
      outcome: 'positive',
      bgm: '312',
      erc: '100',
      ftx: 'OK',
      reason: 'UTILTS är korrekt och ska få positiv APERAK när canonical policy/runtime kräver det.',
    })
  }

  return { applicationDecision: 'accepted', functionalDecision: 'accepted', businessOutcome }
}

function buildResult(params: {
  prodatRegisterValidation?: ProdatRegisterValidationEvidence
  prodatProcessingDisposition?: ProdatProcessingDisposition
  canonical: CanonicalEdielMessage
  policy: CanonicalEdielPolicy | null
  utiltsBusinessOutcome: UtiltsInboundBusinessOutcome | null
  syntaxDecision: CanonicalDecisionState
  applicationDecision: CanonicalDecisionState
  functionalDecision: CanonicalDecisionState
  responsePlan: CanonicalResponsePlanItem[]
  issues: CanonicalDecisionIssue[]
  sourceRules: string[]
  decisionTrace: string[]
  syntax: unknown
}): CanonicalRuntimeDecision {
  const parsedPayload = {...buildCanonicalParsedPayload(params.canonical), ...(params.prodatProcessingDisposition ? {prodatProcessingDisposition:params.prodatProcessingDisposition} : {})}
  const validationReport = {
    canonicalRuntimeVersion: '3.0-policy',
    ...(params.prodatProcessingDisposition ? {prodatProcessingDisposition:params.prodatProcessingDisposition} : {}),
    syntaxDecision: params.syntaxDecision,
    applicationDecision: params.applicationDecision,
    functionalDecision: params.functionalDecision,
    responsePlan: params.responsePlan,
    issues: params.issues,
    sourceRules: params.sourceRules,
    decisionTrace: params.decisionTrace,
    syntax: params.syntax,
    canonicalPolicy: params.policy ? {
      family: params.policy.family,
      code: params.policy.code,
      subtype: params.policy.subtype,
      referenceDate: params.policy.referenceDate,
      profileKey: params.policy.profileKey,
      guide: params.policy.guide,
      applicationReference: params.policy.applicationReference,
      ackRule: params.policy.ackRule,
      semantics: params.policy.semantics,
      prodatDependentConditions: params.policy.prodatDependentConditions,
      sourceTrace: params.policy.sourceTrace,
    } : null,
    utiltsBusinessOutcome: params.utiltsBusinessOutcome,
  }
  return {
    prodatRegisterValidation: params.prodatRegisterValidation,
    prodatProcessingDisposition: params.prodatProcessingDisposition,
    canonical: params.canonical,
    policy: params.policy,
    utiltsBusinessOutcome: params.utiltsBusinessOutcome,
    syntaxDecision: params.syntaxDecision,
    applicationDecision: params.applicationDecision,
    functionalDecision: params.functionalDecision,
    responsePlan: params.responsePlan,
    issues: params.issues,
    sourceRules: params.sourceRules,
    decisionTrace: params.decisionTrace,
    parsedPayload,
    validationReport,
  }
}

export function resolveCanonicalRuntimeDecision(message: EdielMessageRow): CanonicalRuntimeDecision {
  const canonical = parseCanonicalMessageRow(message)
  const syntax = message.message_standard === 'edifact'
    ? validateEdifactSyntax(message)
    : { ok: true, issues: [], declaredUntCount: null, actualMessageSegmentCount: null }
  const issues: CanonicalDecisionIssue[] = canonical.parserWarnings.map(textIssue)
  issues.push(...syntax.issues.map(syntaxIssueToCanonical))

  const syntaxAccepted = syntax.ok
  const syntaxIssueText = syntax.issues.map((item) => item.description).filter(Boolean).join(' | ') || null
  const responsePlan = technicalResponsePlan({ message, canonical, syntaxAccepted, syntaxIssueText })
  const sourceRules: string[] = ['CANONICAL_RUNTIME_3_0_POLICY']
  const decisionTrace: string[] = [
    `Canonical parser: ${canonical.family} ${canonical.messageCode ?? ''} (${canonical.version ?? 'utan version'}).`,
    syntaxAccepted ? 'Syntax validator: accepterad.' : `Syntax validator: avvisad (${syntaxIssueText ?? 'syntaxfel'}).`,
  ]

  if (!syntaxAccepted) {
    return buildResult({
      canonical,
      policy: null,
      utiltsBusinessOutcome: null,
      syntaxDecision: 'rejected',
      applicationDecision: 'not_applicable',
      functionalDecision: 'not_applicable',
      responsePlan,
      issues,
      sourceRules,
      decisionTrace,
      syntax,
    })
  }

  let policy: CanonicalEdielPolicy | null = null
  try {
    policy = resolveCanonicalMessagePolicy(message, canonical)
  } catch (error) {
    const description = error instanceof Error ? error.message : String(error)
    issues.push(issue({
      layer: 'application',
      severity: 'error',
      code: 'CANONICAL_POLICY_RESOLUTION_FAILED',
      title: 'Canonical Ediel-policy kunde inte avgöras',
      description,
      source: 'resolveCanonicalEdielPolicy',
    }))
    addNegativeAperakIfAllowed({
      family: String(canonical.family),
      code: canonical.messageCode,
      responsePlan,
      reason: description,
    })
    return buildResult({
      canonical,
      policy: null,
      utiltsBusinessOutcome: null,
      syntaxDecision: 'accepted',
      applicationDecision: 'rejected',
      functionalDecision: 'not_applicable',
      responsePlan,
      issues,
      sourceRules,
      decisionTrace: [...decisionTrace, `Canonical policy: blockerad (${description}).`],
      syntax,
    })
  }

  let prodatRegisterValidation: ProdatRegisterValidationEvidence | undefined
  let prodatProcessingDisposition: ProdatProcessingDisposition | undefined
  let applicationDecision: CanonicalDecisionState = 'not_applicable'
  let functionalDecision: CanonicalDecisionState = 'not_applicable'
  let utiltsBusinessOutcome: UtiltsInboundBusinessOutcome | null = null

  if (canonical.family === 'UTILTS' && policy) {
    const utilts = resolveUtiltsDecision({ message, policy, responsePlan, issues, sourceRules, decisionTrace })
    applicationDecision = utilts.applicationDecision
    functionalDecision = utilts.functionalDecision
    utiltsBusinessOutcome = utilts.businessOutcome
  } else if (canonical.family === 'PRODAT' && policy) {
    const prodat = applyProdatPolicyDecision({ policy, canonical, responsePlan, issues, sourceRules, decisionTrace })
    prodatRegisterValidation = prodat.prodatRegisterValidation
    prodatProcessingDisposition = prodat.prodatProcessingDisposition
    applicationDecision = prodat.applicationDecision
    functionalDecision = prodat.functionalDecision
  } else if (canonical.family === 'UTILTS_ERR' && policy) {
    utiltsBusinessOutcome = resolveUtiltsInboundBusinessOutcome(policy)
    applicationDecision = 'accepted'
    functionalDecision = 'accepted'
  }

  return buildResult({
    prodatRegisterValidation,
    prodatProcessingDisposition,
    canonical,
    policy,
    utiltsBusinessOutcome,
    syntaxDecision: 'accepted',
    applicationDecision,
    functionalDecision,
    responsePlan,
    issues,
    sourceRules,
    decisionTrace,
    syntax,
  })
}

export async function resolveCanonicalRuntimeDecisionWithRegistry(message: EdielMessageRow): Promise<CanonicalRuntimeDecision> {
  const base = resolveCanonicalRuntimeDecision(message)
  if (base.syntaxDecision === 'rejected' || !base.policy) return base
  if (base.policy.family !== 'PRODAT' && base.policy.family !== 'UTILTS') return base

  try {
    const evidence = await resolveCanonicalRulePack({
      family: base.policy.family,
      messageCode: base.policy.code,
      transactionSubtype: base.policy.subtype,
      applicationReference: base.policy.applicationReference,
      direction: message.direction,
      businessDate: base.policy.referenceDate,
      requireBuilder: false,
      requireStateMachine: true,
    })
    const sourceRules = [...base.sourceRules, `RULE_PACK_EVIDENCE:${evidence.profileKey}:${evidence.sourceHash}`]
    const decisionTrace = [...base.decisionTrace, `DB evidence verifierad för source-owned policy: ${evidence.profileKey}.`]
    const validationReport = {
      ...base.validationReport,
      sourceRules,
      decisionTrace,
      rulePackEvidence: {
        profileKey: evidence.profileKey,
        ...(evidence.databaseProfileKey !== undefined ? {databaseProfileKey: evidence.databaseProfileKey} : {}),
        messageProfileId: evidence.messageProfileId,
        rulePackId: evidence.rulePackId,
        sourceHash: evidence.sourceHash,
      },
      fieldRuleSource: 'canonical_policy',
    }
    return { ...base, sourceRules, decisionTrace, validationReport }
  } catch (error) {
    const description = error instanceof Error ? error.message : String(error)
    const issues = [
      ...base.issues,
      issue({
        layer: 'application',
        severity: 'error',
        code: 'CANONICAL_RULE_PACK_EVIDENCE_NOT_ACTIVE',
        title: 'Canonical runtime-evidence saknas',
        description,
        source: 'resolveCanonicalRulePack',
      }),
    ]
    const responsePlan = [...base.responsePlan]
    addNegativeAperakIfAllowed({
      family: base.policy.family,
      code: base.policy.code,
      responsePlan,
      reason: description,
    })
    const decisionTrace = [...base.decisionTrace, `DB evidence gate: blockerad (${description}).`]
    const validationReport = {
      ...base.validationReport,
      applicationDecision: 'rejected',
      issues,
      responsePlan,
      decisionTrace,
      fieldRuleSource: 'canonical_policy',
    }
    return {
      ...base,
      applicationDecision: 'rejected',
      issues,
      responsePlan,
      decisionTrace,
      validationReport,
    }
  }
}
