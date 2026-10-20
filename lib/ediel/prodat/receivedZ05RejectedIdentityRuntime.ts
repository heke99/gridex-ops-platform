import type {EdielMessageRow} from '@/lib/ediel/types'
import type {CanonicalRuntimeDecision, CanonicalResponsePlanItem} from '@/lib/ediel/core/runtimeDecision'
import {buildCanonicalParsedPayload} from '@/lib/ediel/core/canonicalMessage'
import {canonicalAckRuleForFamilyCode} from '@/lib/ediel/rulebook/canonicalEdielFacade'
import {buildReceivedProdatResponseValidation, type ReceivedProdatResponseValidation} from '@/lib/ediel/core/receivedProdatResponseValidation'
import {projectProdatDiagnostics} from './prodatDiagnosticProjection'
import {loadReceivedZ05RejectedIdentityRejection, observeReceivedZ05RejectedIdentity,
  readReceivedZ05RejectedIdentityWitness, validateReceivedZ05RejectedIdentityStructure,
  ownReceivedZ05RejectedIdentityRejection} from './receivedZ05RejectedIdentityRejection'

/** Qualified physical209 rejection only. The caller must separately register
 * the returned facet in its private runtime response port; this grants no
 * operational H policy, accepted application or business/source capability. */
export async function resolveReceivedZ05RejectedIdentityRuntime(
  message: EdielMessageRow, base: CanonicalRuntimeDecision, actor: string | undefined,
): Promise<{decision: CanonicalRuntimeDecision; facet: ReceivedProdatResponseValidation} | null> {
  if (base.syntaxDecision !== 'accepted' || base.policy !== null || message.direction !== 'inbound'
    || message.message_family !== 'PRODAT' || message.message_code !== 'Z05'
    || base.canonical.family !== 'PRODAT' || base.canonical.messageCode !== 'Z05'
    || !['H', 'Z25'].includes(base.canonical.subtype ?? '')) return null
  const input = {rawSegments: base.canonical.rawSegments, una: base.canonical.una}
  const observed = observeReceivedZ05RejectedIdentity(input)
  if (!observed.length || !actor) return null
  const token = await loadReceivedZ05RejectedIdentityRejection(message, actor)
  const witness = token ? readReceivedZ05RejectedIdentityWitness(token, message, actor) : null
  if (!token || !witness) return null
  const structural = validateReceivedZ05RejectedIdentityStructure(input)
  if (!structural) return null
  const errors = projectProdatDiagnostics(observed).applicationErrors
  const findings = projectProdatDiagnostics(structural.issues)
  // The frozen national ACK rule authorizes this response independently from
  // an unavailable positive bilateral business capability.
  try {
    if (canonicalAckRuleForFamilyCode({family: 'PRODAT', code: 'Z05'}).negativeApplicationResponse !== 'APERAK') return null
  } catch { return null }
  const reason = 'Eget obligatoriskt fält 209 saknas eller är ogiltigt.'
  const responsePlan: CanonicalResponsePlanItem[] = [
    ...base.responsePlan.filter(plan => plan.family === 'CONTRL'),
    {family: 'APERAK', outcome: 'negative', erc: errors[0]?.ercCode, ftx: errors[0]?.text, reason, applicationErrors: errors},
  ]
  const issues: CanonicalRuntimeDecision['issues'] = [...base.issues, ...findings.observations.map(item => ({
    layer: 'application' as const, severity: item.severity, code: item.code, title: item.title,
    description: item.description, source: 'validateProdatRegisterPolicy',
    prodatDiagnostic: item.prodatDiagnostic, prodatAperakText: item.prodatAperakText,
  }))]
  const sourceRules = [...base.sourceRules, 'PRODAT26A:§2.2:Z05:209']
  const decisionTrace = [...base.decisionTrace, 'Skyddad fysisk 209-avvisning; ingen operativ H-policy eller affärsauktoritet.']
  const decision: CanonicalRuntimeDecision = {
    canonical: base.canonical, policy: null, utiltsBusinessOutcome: null, syntaxDecision: 'accepted',
    applicationDecision: 'rejected', functionalDecision: 'not_applicable', responsePlan, issues, sourceRules, decisionTrace,
    prodatRegisterValidation: structural.evidence, prodatProcessingDisposition: findings.disposition,
    parsedPayload: {...buildCanonicalParsedPayload(base.canonical), prodatProcessingDisposition: findings.disposition},
    validationReport: {
      canonicalRuntimeVersion: '3.0-policy', syntaxDecision: 'accepted', applicationDecision: 'rejected',
      functionalDecision: 'not_applicable', responsePlan, issues, sourceRules, decisionTrace,
      syntax: base.validationReport.syntax, canonicalPolicy: null, utiltsBusinessOutcome: null,
      prodatProcessingDisposition: findings.disposition, rulePackEvidence: witness,
      fieldRuleSource: 'physical_H209_rejection_only',
    },
  }
  if (!ownReceivedZ05RejectedIdentityRejection(decision, message, actor, token)) return null
  const facet = buildReceivedProdatResponseValidation(message, decision)
  return facet ? {decision, facet} : null
}
