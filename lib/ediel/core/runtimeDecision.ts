import {buildReceivedUtiltsTransactionValidation,type ReceivedUtiltsTransactionValidation} from './receivedUtiltsTransactionValidation'
import {readSourceBoundAckRulePackEvidence} from './ackSourceRulePackEvidence'
import {validateCanonicalAckGuide} from '@/lib/ediel/rulebook/ackGuidePolicy'
import { classifyEdielFailure } from '@/lib/ediel/core/failureDisposition'
import type {ProdatIgnoredField} from '@/lib/ediel/rulebook/fieldMatrix'
import type {ProdatRegisterValidationEvidence} from '@/lib/ediel/prodat/prodatRegisterValidationEvidence'
import type {ProdatAperakText} from '@/lib/ediel/prodat/prodatAperakText'
import {projectProdatDiagnostics,isQualifiedProdatApplicationError} from '@/lib/ediel/prodat/prodatDiagnosticProjection'
import {prodatFieldDiagnostic} from '@/lib/ediel/prodat/prodatFieldDiagnostic'
import {prodatHeaderFieldRejection} from '@/lib/ediel/prodat/prodatHeaderDateRejection'
import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import type {ProdatDiagnostic, ProdatProcessingDisposition} from '@/lib/ediel/prodat/prodatFieldDiagnostic'
// lib/ediel/core/runtimeDecision.ts

import type { EdielMessageRow } from '@/lib/ediel/types'
import { validateEdifactSyntax, type EdielSyntaxIssue } from '@/lib/ediel/core/syntaxValidator'
import {
  buildCanonicalParsedPayload,
  parseCanonicalMessageRow,
  type CanonicalEdielMessage,
} from '@/lib/ediel/core/canonicalMessage'
import { runUtiltsRuntimeForMessage,takeUtiltsRuntimeOwner,type UtiltsRuntimeResult } from '@/lib/ediel/utiltsEngine'
import {evidenceHash} from '@/lib/ediel/utilts/durableSourceDiscovery'
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
  utiltsHeaderRejected?: boolean
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
  utiltsTransactionValidation?: ReceivedUtiltsTransactionValidation
  prodatIgnoredFields?: ProdatIgnoredField[]
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
}): { applicationDecision: CanonicalDecisionState; functionalDecision: CanonicalDecisionState; prodatProcessingDisposition: ProdatProcessingDisposition; prodatRegisterValidation?: ProdatRegisterValidationEvidence; prodatIgnoredFields: ProdatIgnoredField[] } {
  let prodatRegisterValidation: ProdatRegisterValidationEvidence | undefined
  const prodatIgnoredFields: ProdatIgnoredField[] = []
  const fieldIssues = validateCanonicalPolicyFields({
    policy: params.policy,
    rawSegments: params.canonical.rawSegments,
    una: params.canonical.una,
    scope: 'all',
    onRegisterValidation: evidence => { prodatRegisterValidation = evidence },
    onIgnoredField: field => { if (!prodatIgnoredFields.some(existing => JSON.stringify(existing) === JSON.stringify(field))) prodatIgnoredFields.push(field) },
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
    return { applicationDecision: 'rejected', functionalDecision: prodatProcessingDisposition.kind === 'internal_review' ? 'manual_review' : 'accepted', prodatProcessingDisposition, prodatRegisterValidation, prodatIgnoredFields }
  }

  if (prodatProcessingDisposition.kind === 'internal_review') return {applicationDecision:projected.hasNationalError?'rejected':'manual_review',functionalDecision:projected.hasNationalError?'manual_review':'not_applicable',prodatProcessingDisposition,prodatRegisterValidation,prodatIgnoredFields}

  if (params.policy.ackRule.applicationAck === 'APERAK') {
    params.responsePlan.push({
      family: 'APERAK',
      outcome: 'positive',
      erc: '100',
      ftx: 'OK',
      reason: 'PRODAT är accepterad enligt canonical policy och positiv APERAK krävs.',
    })
  }

  return { applicationDecision: 'accepted', functionalDecision: 'accepted', prodatProcessingDisposition, prodatRegisterValidation, prodatIgnoredFields }
}

function resolveUtiltsDecision(params: {
  runtime?:UtiltsRuntimeResult
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
  utiltsTransactionValidation?: ReceivedUtiltsTransactionValidation
} {
  const runtime = params.runtime ?? runUtiltsRuntimeForMessage(params.message, { canonicalPolicy: params.policy })
  const utiltsTransactionValidation=buildReceivedUtiltsTransactionValidation({source:params.message,transactions:runtime.transactionDispositions}) ?? undefined
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
    return { applicationDecision: 'rejected', functionalDecision: 'accepted', businessOutcome, utiltsTransactionValidation }
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
    return { applicationDecision: 'not_applicable', functionalDecision: 'not_applicable', businessOutcome, utiltsTransactionValidation }
  }

  if (runtime.ackPlan.shouldSendUtiltsErr) {
    params.responsePlan.push({
      family: 'UTILTS_ERR',
      outcome: 'negative',
      reason: runtime.ackPlan.reason || 'UTILTS process-/funktionsfel ska besvaras med UTILTS_ERR.',
    })
    return { applicationDecision: 'not_applicable', functionalDecision: 'rejected', businessOutcome, utiltsTransactionValidation }
  }

  if (runtime.ackPlan.shouldSendAperak && runtime.ackPlan.aperakOutcome === 'negative') {
    params.responsePlan.push({
      family: 'APERAK',
      outcome: 'negative',
      bgm: '313',
      erc: runtime.ackPlan.aperakApplicationErrors[0]?.ercCode ?? '41',
      ftx: runtime.ackPlan.aperakApplicationErrors[0]?.text ?? runtime.ackPlan.reason,
      reason: runtime.ackPlan.reason || 'UTILTS anvisnings-/applikationsfel ska besvaras med negativ APERAK.',
      utiltsHeaderRejected: Boolean(runtime.ackPlan.utiltsHeaderRejection),
      applicationErrors: (runtime.ackPlan.utiltsHeaderRejection?.applicationErrors ?? runtime.ackPlan.aperakApplicationErrors).map((item) => ({
        ercCode: item.ercCode,
        fieldCode: item.fieldCode ?? null,
        text: item.text,
        referenceQualifier: item.referenceQualifier ?? null,
        referenceNumber: item.referenceNumber ?? null,
        lineItemReference: item.lineItemReference ?? null,
      })),
    })
    return { applicationDecision: 'rejected', functionalDecision: 'accepted', businessOutcome, utiltsTransactionValidation }
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

  return { applicationDecision: 'accepted', functionalDecision: 'accepted', businessOutcome, utiltsTransactionValidation }
}

function buildResult(params: {
  utiltsTransactionValidation?: ReceivedUtiltsTransactionValidation
  prodatIgnoredFields?: ProdatIgnoredField[]
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
  const parsedPayload = {...buildCanonicalParsedPayload(params.canonical), ...(params.prodatIgnoredFields ? {prodatIgnoredFields:params.prodatIgnoredFields} : {}), ...(params.prodatProcessingDisposition ? {prodatProcessingDisposition:params.prodatProcessingDisposition} : {})}
  const validationReport = {
    canonicalRuntimeVersion: '3.0-policy',
    ...(params.prodatProcessingDisposition ? {prodatProcessingDisposition:params.prodatProcessingDisposition} : {}),
    ...(params.prodatIgnoredFields ? {prodatIgnoredFields:params.prodatIgnoredFields} : {}),
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
      timeAnchors: params.policy.timeAnchors ?? null,
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
    utiltsTransactionValidation: params.utiltsTransactionValidation,
    prodatRegisterValidation: params.prodatRegisterValidation,
    prodatIgnoredFields: params.prodatIgnoredFields,
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
  const syntax = message.message_standard === 'edifact'
    ? validateEdifactSyntax(message)
    : { ok: true, issues: [], declaredUntCount: null, actualMessageSegmentCount: null }
  let canonical: CanonicalEdielMessage
  try {
    canonical = parseCanonicalMessageRow(message)
  } catch (error) {
    if (syntax.ok) throw error
    // A lexical rejection has no trustworthy physical envelope projection.
    // Retain the rejection without promoting row metadata to actors or an ACK.
    canonical = parseCanonicalMessageRow({ ...message, raw_payload: null })
  }
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
    // Field 202 is required across the entire frozen P26.A code list. Resolve
    // this one physical header error before code-specific policy selection;
    // an unlisted code is invalid field content, not ERC40/100 "unimplemented".
    const sourceWire=canonical.family==='PRODAT' && message.raw_payload ? tokenizeEdifact(message.raw_payload) : null
    const field202=sourceWire && /^(canonical_policy_message_code_missing|canonical_ediel_prodat_code_unsupported):/.test(description)
      ? prodatHeaderFieldRejection({field:'202',sourceWire,errors:[]}) : null
    const diagnostic=field202?.defect ? prodatFieldDiagnostic('202',field202.defect,
      {rawSegments:canonical.rawSegments,una:canonical.una,code:canonical.messageCode},canonical.rawSegments,
      'PRODAT26A:§2.2:ALL:202',undefined,'header') : null
    const projected=diagnostic ? projectProdatDiagnostics([{severity:'error',blocking:true,code:'PRODAT_HEADER_202_POLICY',
      title:'Meddelandenamn saknas eller är ogiltigt',description:'BGM/C002/1001 följer inte P26.A §2.2.',prodatDiagnostic:diagnostic}]) : null
    const qualified=Boolean(field202 && sourceWire && projected?.applicationErrors.length &&
      prodatHeaderFieldRejection({field:'202',sourceWire,errors:projected.applicationErrors}).qualified)
    const failureDisposition = classifyEdielFailure(error, qualified ? { sourceRule: 'PRODAT26A:§2.2:ALL:202' } : undefined)
    if (failureDisposition.kind !== 'protocol_rejection') {
      const contextRule = description.startsWith('ediel_energy_sharing_activation_held:') ? 'GOV-07'
        : /^ediel_(?:admission_time|business_time|actual_send_time|replay_time)_/.test(description) ? 'GOV-06' : 'OPS-05'
      sourceRules.push(`${contextRule}:LOCAL_CONTEXT`)
      const prodatProcessingDisposition: ProdatProcessingDisposition | undefined = canonical.family === 'PRODAT'
        ? { kind: 'internal_review', reasons: [{ code: failureDisposition.code, sourceRule: contextRule, reason: description }] }
        : undefined
      const result = buildResult({ canonical, policy: null, prodatProcessingDisposition, utiltsBusinessOutcome: null,
        syntaxDecision: 'accepted', applicationDecision: 'manual_review', functionalDecision: 'not_applicable',
        responsePlan, issues, sourceRules, decisionTrace: [...decisionTrace, `Lokalt beslutsunderlag kräver granskning (${description}); inget nationellt APERAK-fältfel skapas.`], syntax })
      result.validationReport.failureDisposition = failureDisposition
      return result
    }
    if (qualified && projected) {
      sourceRules.push('PRODAT26A:§2.2:ALL:202')
      issues.push(issue({layer:'application',severity:'error',code:'PRODAT_HEADER_202_POLICY',
        title:'Meddelandenamn saknas eller är ogiltigt',description:'Fält 202 i fysisk BGM kvalificerar ERC41/42.',
        source:'P26.A §2.2 p16',prodatDiagnostic:diagnostic!,prodatAperakText:projected.observations[0]?.prodatAperakText}))
    }
    addNegativeAperakIfAllowed({family:String(canonical.family),code:canonical.messageCode,responsePlan,
      reason:description,...(qualified && projected ? {applicationErrors:projected.applicationErrors} : {})})
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

  let utiltsTransactionValidation: ReceivedUtiltsTransactionValidation | undefined
  let prodatRegisterValidation: ProdatRegisterValidationEvidence | undefined
  let prodatProcessingDisposition: ProdatProcessingDisposition | undefined
  let prodatIgnoredFields: ProdatIgnoredField[] | undefined
  let applicationDecision: CanonicalDecisionState = 'not_applicable'
  let functionalDecision: CanonicalDecisionState = 'not_applicable'
  let utiltsBusinessOutcome: UtiltsInboundBusinessOutcome | null = null

  if (canonical.family === 'UTILTS' && policy) {
    const utilts = resolveUtiltsDecision({ message, policy, responsePlan, issues, sourceRules, decisionTrace })
    applicationDecision = utilts.applicationDecision
    functionalDecision = utilts.functionalDecision
    utiltsBusinessOutcome = utilts.businessOutcome
    utiltsTransactionValidation = utilts.utiltsTransactionValidation
  } else if (canonical.family === 'PRODAT' && policy) {
    const prodat = applyProdatPolicyDecision({ policy, canonical, responsePlan, issues, sourceRules, decisionTrace })
    prodatRegisterValidation = prodat.prodatRegisterValidation
    prodatIgnoredFields = prodat.prodatIgnoredFields
    prodatProcessingDisposition = prodat.prodatProcessingDisposition
    applicationDecision = prodat.applicationDecision
    functionalDecision = prodat.functionalDecision
  } else if ((canonical.family === 'APERAK' || canonical.family === 'CONTRL') && policy) {
    const guideIssues=validateCanonicalAckGuide({policy,rawSegments:canonical.rawSegments,una:canonical.una})
    issues.push(...guideIssues.map(finding=>issue({layer:'application',severity:finding.severity,code:finding.code,title:finding.title,description:finding.description,source:policy.guide.documentName})))
    applicationDecision=guideIssues.some(finding=>finding.blocking||finding.severity==='error')?'rejected':'accepted'
    functionalDecision=applicationDecision==='accepted'?'manual_review':'not_applicable'
    decisionTrace.push('Nationell kvittensanvisning prövad; faktisk originalkorrelation och fryst källpaket återstår i beständig auktoritet.')
  } else if (canonical.family === 'UTILTS_ERR' && policy) {
    utiltsBusinessOutcome = resolveUtiltsInboundBusinessOutcome(policy)
    applicationDecision = 'accepted'
    functionalDecision = 'accepted'
  }

  return buildResult({
    utiltsTransactionValidation,
    prodatRegisterValidation,
    prodatIgnoredFields,
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

const initialUtiltsOwners=new WeakMap<CanonicalRuntimeDecision,{sourceIdentity:string;decisionHash:string;policy:CanonicalEdielPolicy}>()
function immutableUtiltsSourceIdentity(message:EdielMessageRow):string {
  return evidenceHash(JSON.stringify({id:message.id,companyId:message.company_id,environment:message.environment,direction:message.direction,
    family:message.message_family,code:message.message_code,raw:message.raw_payload,receivedAt:message.message_received_at,executionContext:message.execution_context_snapshot}))
}

/** Consume the real final UTILTS owner, retaining the initial whole-guide and
 * locked witness. Matching/structural facts may qualify its own functional
 * scope, but no subsequent consumer reselects or reruns national guidance. */
export function finalizeCanonicalUtiltsRuntimeDecision(input:{message:EdielMessageRow;initialDecision:CanonicalRuntimeDecision;runtime:UtiltsRuntimeResult}):CanonicalRuntimeDecision {
  const initial=input.initialDecision,owner=initialUtiltsOwners.get(initial)
  if(!owner||initial.policy!==owner.policy||immutableUtiltsSourceIdentity(input.message)!==owner.sourceIdentity
    ||evidenceHash(JSON.stringify(initial))!==owner.decisionHash)throw new Error('ediel_initial_utilts_owner_unavailable')
  const actual=takeUtiltsRuntimeOwner(input.runtime,input.message,owner.policy)
  if(!actual)throw new Error('ediel_final_utilts_owner_unavailable')
  initialUtiltsOwners.delete(initial)
  const responsePlan=initial.responsePlan.filter(item=>item.family==='CONTRL')
  const issues=initial.issues.filter(item=>item.source!=='runUtiltsRuntimeForMessage')
  const sourceRules=initial.sourceRules.filter(rule=>!rule.startsWith('UTILTS_RUNTIME_')&&!rule.startsWith('UTILTS_BUSINESS_OUTCOME_'))
  const decisionTrace=[...initial.decisionTrace,'Final faktisk UTILTS-ägare konsumerad med samma valda anvisning och oförändrat regelvittne.']
  const utilts=resolveUtiltsDecision({message:input.message,policy:owner.policy,runtime:actual,responsePlan,issues,sourceRules,decisionTrace})
  const final=buildResult({canonical:initial.canonical,policy:owner.policy,utiltsBusinessOutcome:utilts.businessOutcome,
    utiltsTransactionValidation:utilts.utiltsTransactionValidation,syntaxDecision:initial.syntaxDecision,applicationDecision:utilts.applicationDecision,
    functionalDecision:utilts.functionalDecision,responsePlan,issues,sourceRules,decisionTrace,syntax:initial.validationReport.syntax})
  final.validationReport={...final.validationReport,rulePackEvidence:initial.validationReport.rulePackEvidence,fieldRuleSource:initial.validationReport.fieldRuleSource}
  return final
}

export async function resolveCanonicalRuntimeDecisionWithRegistry(message: EdielMessageRow): Promise<CanonicalRuntimeDecision> {
  const base = resolveCanonicalRuntimeDecision(message)
  if (base.syntaxDecision === 'rejected' || !base.policy) return base
  if (base.policy.family === 'APERAK' || base.policy.family === 'CONTRL') {
    if(base.applicationDecision !== 'accepted')return base
    try {
      const {sourceMessage,evidence}=await readSourceBoundAckRulePackEvidence(message)
      const guideIssues=validateCanonicalAckGuide({policy:base.policy,rawSegments:base.canonical.rawSegments,una:base.canonical.una,sourceRawPayload:sourceMessage.raw_payload})
      const issues=[...base.issues,...guideIssues.map(finding=>issue({layer:'application',severity:finding.severity,code:finding.code,title:finding.title,description:finding.description,source:base.policy!.guide.documentName}))]
      const rejected=guideIssues.some(finding=>finding.blocking||finding.severity==='error')
      const applicationDecision:CanonicalDecisionState=rejected?'rejected':'accepted',functionalDecision:CanonicalDecisionState=rejected?'not_applicable':'accepted'
      const decisionTrace=[...base.decisionTrace,`Original ${sourceMessage.id}; oförändrat källpaket ${evidence.rulePackId}/${evidence.sourceHash}.`]
      const rulePackEvidence={profileKey:evidence.profileKey,messageProfileId:evidence.messageProfileId,rulePackId:evidence.rulePackId,sourceHash:evidence.sourceHash,version:evidence.version,snapshot:{rulePack:evidence.snapshot.rulePack,messageProfile:evidence.snapshot.messageProfile,guideSources:evidence.snapshot.guideSources}}
      return {...base,applicationDecision,functionalDecision,issues,decisionTrace,validationReport:{...base.validationReport,applicationDecision,functionalDecision,issues,decisionTrace,rulePackEvidence,ackOriginalMessageId:sourceMessage.id,fieldRuleSource:'canonical_policy'}}
    } catch(error) {
      const failureDisposition=classifyEdielFailure(error),description=error instanceof Error?error.message:String(error)
      const issues=[...base.issues,issue({layer:'application',severity:'error',code:'CANONICAL_ACK_SOURCE_EVIDENCE_UNAVAILABLE',title:'Fryst kvittensursprung saknas',description,source:'readSourceBoundAckRulePackEvidence'})]
      const decisionTrace=[...base.decisionTrace,'Kvittensutfall hålls för lokal granskning; inget APERAK-fel fabriceras.']
      return {...base,applicationDecision:'manual_review',functionalDecision:'manual_review',issues,decisionTrace,validationReport:{...base.validationReport,applicationDecision:'manual_review',functionalDecision:'manual_review',issues,decisionTrace,failureDisposition}}
    }
  }
  if (base.policy.family !== 'PRODAT' && base.policy.family !== 'UTILTS') return base

  try {
    const evidence = await resolveCanonicalRulePack({
      family: base.policy.family,
      messageCode: base.policy.code,
      transactionSubtype: base.policy.subtype,
      applicationReference: base.policy.applicationReference,
      direction: message.direction,
      businessDate: base.policy.referenceDate,
      canonicalPolicy: base.policy,
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
        version: evidence.originalVersion,
        snapshot: evidence.originalSnapshot,
      },
      fieldRuleSource: 'canonical_policy',
    }
    const resolved={ ...base, sourceRules, decisionTrace, validationReport }
    if(base.policy.family==='UTILTS'&&base.syntaxDecision==='accepted')initialUtiltsOwners.set(resolved,{sourceIdentity:immutableUtiltsSourceIdentity(message),decisionHash:evidenceHash(JSON.stringify(resolved)),policy:base.policy})
    return resolved
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
    // Retain independently source-qualified syntax/national negatives. The
    // local incident supplies no national code and never authorizes a positive
    // response or business effect. Typed P diagnostics preserve exact own scope.
    const responsePlan = base.responsePlan.filter(response => response.family === 'CONTRL'
      || response.family === 'APERAK' && response.outcome === 'negative'
        && Boolean(response.applicationErrors?.length)
        && response.applicationErrors!.every(isQualifiedProdatApplicationError))
    const failureDisposition=classifyEdielFailure(error)
    const decisionTrace = [...base.decisionTrace, `DB evidence gate: blockerad (${description}).`]
    const validationReport = {
      ...base.validationReport,
      applicationDecision: 'manual_review',
      functionalDecision: 'manual_review',
      failureDisposition,
      issues,
      responsePlan,
      decisionTrace,
      fieldRuleSource: 'canonical_policy',
    }
    return {
      ...base,
      applicationDecision: 'manual_review',
      functionalDecision: 'manual_review',
      issues,
      responsePlan,
      decisionTrace,
      validationReport,
    }
  }
}
