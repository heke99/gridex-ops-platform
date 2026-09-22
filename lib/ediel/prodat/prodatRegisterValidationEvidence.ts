import {segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {parseUna, type EdifactServiceStringAdvice} from '@/lib/ediel/core/una'
import type {EdielRulebookIssue} from '@/lib/ediel/rulebook/rulebook'
import {prodatRegisterGroups, prodatRegisterMessageSegments} from './prodatRegisterGroups'
import {prodatRegisterFieldScope} from './prodat26AFieldMatrix'
import {validProdatWireDiagnostic} from './prodatFieldDiagnostic'

export type ProdatRegisterValidationEvidence = {
  version: 1
  owner: 'validateProdatRegisterPolicy'
  coverage: 'canonical_register_only'
  objects: {
    messageIndex: number
    messageReference: string | null
    objectId: string | null
    identityAgency: string | null
    disposition: 'accepted' | 'rejected' | 'unavailable'
    registers: {
      lineIndex: number
      lineNumber: string | null
      registerIndex: string | null
      registerPosition: number
      /** Zero-based index in the exact rawSegments passed to canonical validation. */
      segmentIndex: number
    }[]
    reasons: string[]
  }[]
}

/** Projection of the actual invocation and its existing structural findings.
 * Never a source, legal-party, independent inventory or business approval.
 * The caller is the canonical validator immediately after the register owner.
 */
export function projectProdatRegisterValidation(input: {
  code: string
  rawSegments: readonly string[]
  una?: EdifactServiceStringAdvice
  registerIssues: readonly EdielRulebookIssue[]
  fieldIssues: readonly EdielRulebookIssue[]
  completeRuleSelection: boolean
  handledFields: ReadonlySet<string>
}): ProdatRegisterValidationEvidence {
  const una = input.una ?? parseUna(null)
  const all = prodatRegisterGroups(input.rawSegments, una, input.code)
  const selected = prodatRegisterMessageSegments(all.tokens, una)
  const validated = prodatRegisterGroups(selected, una, input.code).groups
  const references = new Map<number, string | null>()
  let messageIndex = -1
  for (const token of all.tokens) if (token.tag === 'UNH') references.set(++messageIndex, segmentComposite(token, 1, una)[0] || null)
  const findings = [...input.registerIssues, ...input.fieldIssues.filter(issue => issue.scope === 'prodat_register'
    || issue.prodatDiagnostic?.kind === 'field' && prodatRegisterFieldScope(issue.prodatDiagnostic.fieldNumber) === 'local')]
    .filter(issue => issue.blocking || issue.severity === 'error')
  const objects = new Map<string, ProdatRegisterValidationEvidence['objects'][number]>()
  for (const group of all.groups) {
    const key = JSON.stringify([group.messageIndex,group.itemId,group.identityAgency,group.itemId ? null : group.lineIndex])
    let object = objects.get(key)
    if (!object) {
      object = {messageIndex:group.messageIndex,messageReference:references.get(group.messageIndex) ?? null,
        objectId:group.itemId,identityAgency:group.identityAgency,disposition:'accepted',registers:[],reasons:[]}
      objects.set(key, object)
    }
    object.registers.push({lineIndex:group.lineIndex,lineNumber:group.lineNumber,registerIndex:group.registerIndex,
      registerPosition:group.registerPosition,segmentIndex:group.segments[0].index})
    const own = validated.find(row => row.segments[0].index === group.segments[0].index)
    if (!input.completeRuleSelection || !own || !group.itemId || !group.identityAgency || !input.handledFields.size) {
      object.disposition = 'unavailable'
      object.reasons.push(!own ? 'REGISTER_MESSAGE_NOT_VALIDATED' : 'REGISTER_SCOPE_UNAVAILABLE')
      continue
    }
    let rejected = false
    let unavailable = false
    for (const finding of findings) {
      const diagnostic = finding.prodatDiagnostic
      if (!validProdatWireDiagnostic(diagnostic) || diagnostic.occurrence.scope === 'header') {
        unavailable = true
        object.reasons.push(finding.code)
        continue
      }
      const occurrence = diagnostic.occurrence
      const scope = validated.find(row => row.lineIndex === occurrence.lineIndex)
      if (!scope || scope.itemId !== occurrence.objectId || scope.identityAgency !== occurrence.identityAgency
        || scope.lineNumber !== occurrence.lineNumber || scope.registerPosition !== occurrence.registerPosition
        || occurrence.messageReference !== (references.get(scope.messageIndex) ?? null)) {
        unavailable = true
        object.reasons.push(finding.code)
      } else if (scope.itemId === group.itemId && scope.identityAgency === group.identityAgency) {
        rejected = true
        object.reasons.push(finding.code)
      }
    }
    if (rejected) object.disposition = 'rejected'
    else if (unavailable && object.disposition !== 'rejected') object.disposition = 'unavailable'
  }
  return {version:1,owner:'validateProdatRegisterPolicy',coverage:'canonical_register_only',
    objects:[...objects.values()].map(object => ({...object,reasons:[...new Set(object.reasons)]}))}
}
