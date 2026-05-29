// lib/ediel/core/runtimeDecision.ts

import type { EdielMessageRow } from '@/lib/ediel/types'
import { validateEdifactSyntax, type EdielSyntaxIssue } from '@/lib/ediel/core/syntaxValidator'
import {
  buildCanonicalParsedPayload,
  parseCanonicalMessageRow,
  type CanonicalEdielMessage,
} from '@/lib/ediel/core/canonicalMessage'
import { validateRulebookMessage } from '@/lib/ediel/rulebook/validator'
import { runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'
import type { EdielAperakApplicationError } from '@/lib/ediel/ack'

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
}

export type CanonicalRuntimeDecision = {
  canonical: CanonicalEdielMessage
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

function applicationErrorFromIssue(input: {
  code?: string | null
  description?: string | null
  fieldPath?: string | null
}): EdielAperakApplicationError {
  const text = String(input.description ?? input.code ?? 'INCORRECT DATA').slice(0, 70)
  const fieldCodeMatch = String(input.fieldPath ?? input.code ?? '').match(/[0-9]{3}[a-z]?/i)
  return {
    ercCode: String(input.code ?? '').includes('MISSING') ? '41' : '42',
    fieldCode: fieldCodeMatch?.[0] ?? null,
    text,
    referenceQualifier: null,
    referenceNumber: null,
    lineItemReference: null,
  }
}

function canHaveApplicationAck(family: string): boolean {
  return family === 'PRODAT' || family === 'UTILTS'
}

function shouldContrlInbound(message: EdielMessageRow, family: string): boolean {
  return message.direction === 'inbound' && message.message_standard === 'edifact' && family !== 'CONTRL'
}

function initialResponsePlan(params: {
  message: EdielMessageRow
  canonical: CanonicalEdielMessage
  syntaxAccepted: boolean
  syntaxIssueText: string | null
}): CanonicalResponsePlanItem[] {
  if (!shouldContrlInbound(params.message, String(params.canonical.family))) return []
  return [
    {
      family: 'CONTRL',
      outcome: params.syntaxAccepted ? 'positive' : 'negative',
      reason: params.syntaxAccepted
        ? 'Inbound EDIFACT är syntaxmässigt accepterat och ska få positiv CONTRL.'
        : params.syntaxIssueText ?? 'Inbound EDIFACT har syntaxfel och ska få negativ CONTRL.',
    },
  ]
}

function resolveUtiltsDecision(params: {
  message: EdielMessageRow
  responsePlan: CanonicalResponsePlanItem[]
  issues: CanonicalDecisionIssue[]
  sourceRules: string[]
  decisionTrace: string[]
}): { applicationDecision: CanonicalDecisionState; functionalDecision: CanonicalDecisionState } {
  const runtime = runUtiltsRuntimeForMessage(params.message)
  params.sourceRules.push(`UTILTS_RUNTIME_${runtime.validation.classification.toUpperCase()}`)
  params.decisionTrace.push(`UTILTS runtime klassade meddelandet som ${runtime.validation.classification}.`)

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
    return { applicationDecision: 'not_applicable', functionalDecision: 'not_applicable' }
  }

  if (runtime.ackPlan.shouldSendUtiltsErr) {
    params.responsePlan.push({
      family: 'UTILTS_ERR',
      outcome: 'negative',
      reason: runtime.ackPlan.reason || 'UTILTS process-/funktionsfel ska besvaras med UTILTS_ERR.',
    })
    return { applicationDecision: 'not_applicable', functionalDecision: 'rejected' }
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
    return { applicationDecision: 'rejected', functionalDecision: 'accepted' }
  }

  if (runtime.ackPlan.shouldSendAperak && runtime.ackPlan.aperakOutcome === 'positive') {
    params.responsePlan.push({
      family: 'APERAK',
      outcome: 'positive',
      bgm: '312',
      erc: '100',
      ftx: 'OK',
      reason: 'UTILTS är korrekt och ska få positiv APERAK när APERAK krävs.',
    })
  }

  return { applicationDecision: 'accepted', functionalDecision: 'accepted' }
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
  const responsePlan = initialResponsePlan({ message, canonical, syntaxAccepted, syntaxIssueText })
  const sourceRules: string[] = ['CANONICAL_RUNTIME_2_5B']
  const decisionTrace: string[] = [
    `Canonical parser: ${canonical.family} ${canonical.messageCode ?? ''} (${canonical.version ?? 'utan version'}).`,
    syntaxAccepted ? 'Syntax validator: accepterad.' : `Syntax validator: avvisad (${syntaxIssueText ?? 'syntaxfel'}).`,
  ]

  if (!syntaxAccepted) {
    const parsedPayload = buildCanonicalParsedPayload(canonical)
    const validationReport = {
      canonicalRuntimeVersion: '2.5B',
      syntaxDecision: 'rejected',
      applicationDecision: 'not_applicable',
      functionalDecision: 'not_applicable',
      responsePlan,
      issues,
      sourceRules,
      decisionTrace,
      syntax,
    }
    return {
      canonical,
      syntaxDecision: 'rejected',
      applicationDecision: 'not_applicable',
      functionalDecision: 'not_applicable',
      responsePlan,
      issues,
      sourceRules,
      decisionTrace,
      parsedPayload,
      validationReport,
    }
  }

  let applicationDecision: CanonicalDecisionState = 'not_applicable'
  let functionalDecision: CanonicalDecisionState = 'not_applicable'

  if (canonical.family === 'UTILTS') {
    const utilts = resolveUtiltsDecision({ message, responsePlan, issues, sourceRules, decisionTrace })
    applicationDecision = utilts.applicationDecision
    functionalDecision = utilts.functionalDecision
  } else if (canonical.family === 'PRODAT') {
    const rulebook = validateRulebookMessage({
      family: 'PRODAT',
      code: canonical.messageCode,
      processGroup: canonical.processGroup,
      applicationReference: canonical.applicationReference,
      rawPayload: message.raw_payload,
      mode: 'parse',
    })
    sourceRules.push('PRODAT_RULEBOOK_PROCESS_CLASSIFICATION')
    decisionTrace.push(`PRODAT klassad som ${canonical.processGroup}; rulebook issues: ${rulebook.issues.length}.`)
    for (const item of rulebook.issues) {
      issues.push(issue({
        layer: item.code.includes('APPLICATION_REFERENCE') ? 'route' : 'application',
        severity: item.severity,
        code: item.code,
        title: item.title,
        description: item.description,
        source: 'validateRulebookMessage',
      }))
    }

    const blocking = rulebook.issues.some((item) => item.severity === 'error' || item.blocking)
    if (blocking) {
      applicationDecision = 'rejected'
      functionalDecision = 'accepted'
      const applicationErrors = rulebook.issues
        .filter((item) => item.severity === 'error' || item.blocking)
        .map((item) => applicationErrorFromIssue({ code: item.code, description: item.description, fieldPath: item.fieldPath }))
      responsePlan.push({
        family: 'APERAK',
        outcome: 'negative',
        erc: applicationErrors[0]?.ercCode ?? '42',
        ftx: applicationErrors[0]?.text ?? 'INCORRECT DATA',
        reason: 'PRODAT innehåller anvisnings-/applikationsfel enligt rulebook.',
        applicationErrors,
      })
    } else {
      applicationDecision = 'accepted'
      functionalDecision = 'accepted'
      responsePlan.push({
        family: 'APERAK',
        outcome: 'positive',
        erc: '100',
        ftx: 'OK',
        reason: 'PRODAT är accepterad enligt canonical parser/rulebook. APERAK skickas om route/rule kräver det.',
      })
    }
  } else if (canHaveApplicationAck(String(canonical.family))) {
    applicationDecision = 'manual_review'
    functionalDecision = 'manual_review'
  } else {
    applicationDecision = 'not_applicable'
    functionalDecision = 'not_applicable'
  }

  const parsedPayload = buildCanonicalParsedPayload(canonical)
  const validationReport = {
    canonicalRuntimeVersion: '2.5B',
    syntaxDecision: syntaxAccepted ? 'accepted' : 'rejected',
    applicationDecision,
    functionalDecision,
    responsePlan,
    issues,
    sourceRules,
    decisionTrace,
    syntax,
  }

  return {
    canonical,
    syntaxDecision: syntaxAccepted ? 'accepted' : 'rejected',
    applicationDecision,
    functionalDecision,
    responsePlan,
    issues,
    sourceRules,
    decisionTrace,
    parsedPayload,
    validationReport,
  }
}
