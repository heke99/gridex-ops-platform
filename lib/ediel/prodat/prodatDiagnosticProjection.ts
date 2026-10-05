import {composeProdatAperakText} from './prodatAperakText'
import {validProdatWireDiagnostic} from './prodatFieldDiagnostic'
import type {EdielRulebookIssue} from '@/lib/ediel/rulebook/rulebook'
import type {EdielAperakApplicationError} from '@/lib/ediel/ack'
import type {ProdatProcessingDisposition, ProdatErrorOccurrence} from './prodatFieldDiagnostic'

function references(occurrence: ProdatErrorOccurrence) {
  return {prodatOccurrence:occurrence, referenceQualifier:occurrence.objectId ? 'Z07' : null,
    referenceNumber:occurrence.objectId, lineItemReference:occurrence.lineItemReference}
}
/** Classification is owned upstream; no code suffix or path may choose a national error. */
export function projectProdatDiagnostics(issues: readonly EdielRulebookIssue[]) {
  const applicationErrors: EdielAperakApplicationError[] = []
  const projectedFieldErrors = new Set<string>()
  const disposition: ProdatProcessingDisposition = {kind:'continue',reasons:[]}
  const observations = issues.map(item => {
    const diagnostic = item.prodatDiagnostic
    const aperakText=validProdatWireDiagnostic(diagnostic)?composeProdatAperakText(diagnostic):undefined
    const local = diagnostic?.kind === 'local_unknown' || diagnostic?.kind === 'local_evidence'
    if (!local && (item.blocking || item.severity === 'error')) {
      if (validProdatWireDiagnostic(diagnostic)) {
        const text = aperakText!
        if (text.kind === 'ready') {
          // The matrix and register condition can report the same missing own
          // field. Preserve both findings, but emit one national error for the
          // same physical occurrence and content. Other registers remain distinct.
          const key = diagnostic.kind === 'field' ? JSON.stringify([
            diagnostic.fieldNumber, diagnostic.errorKind, diagnostic.occurrence.messageReference,
            diagnostic.occurrence.lineIndex, diagnostic.occurrence.lineNumber,
            diagnostic.occurrence.registerPosition, diagnostic.occurrence.objectId,
            diagnostic.occurrence.identityAgency, diagnostic.component, diagnostic.failureEvidence,
            text.text,
          ]) : null
          if (key === null || !projectedFieldErrors.has(key)) {
            if (key !== null) projectedFieldErrors.add(key)
            applicationErrors.push({
              ercCode:diagnostic.kind === 'application' ? '40' : diagnostic.errorKind === 'missing' ? '41' : '42',
              fieldCode:diagnostic.kind === 'application' ? '109' : diagnostic.fieldNumber,
              text:text.text, prodatAperakText:text, ...references(diagnostic.occurrence), prodatFieldDiagnostic:diagnostic,
            })
          }
        }
        else {
          disposition.kind = 'internal_review'
          disposition.reasons.push({code:'PRODAT_APERAK_TEXT_UNREADY',sourceRule:diagnostic.sourceRule,reason:text.reason})
        }
      } else {
        disposition.kind = 'internal_review'
        disposition.reasons.push({code:item.code,sourceRule:diagnostic?.sourceRule ?? 'PRODAT:typed-diagnostic-invariant',reason:diagnostic?.kind === 'internal' ? diagnostic.reason : 'Expected source-owned error metadata is absent or invalid'})
      }
    }
    return {...item,prodatAperakText:aperakText, severity:local ? 'warning' as const : item.severity, originalSeverity:item.severity}
  })
  const hasNationalError = issues.some(item => (item.blocking || item.severity === 'error') && validProdatWireDiagnostic(item.prodatDiagnostic))
  return {applicationErrors,disposition,observations,hasNationalError}
}

/** Internal-review delivery only permits source-qualified errors surviving persistence. */
export function isQualifiedProdatApplicationError(error: EdielAperakApplicationError): boolean {
  const diagnostic = error.prodatFieldDiagnostic
  if (!validProdatWireDiagnostic(diagnostic)) return false
  const ready=error.prodatAperakText, recomposed=composeProdatAperakText(diagnostic)
  if(ready?.kind!=='ready'||recomposed.kind!=='ready'||ready.text!==recomposed.text||ready.fallback!==recomposed.fallback||error.text!==ready.text) return false
  const own=diagnostic.occurrence.ownReferences
  if(!own || ![own.objectId,own.lineItemReference,own.customerId].every(v=>v&&(['absent','unavailable'].includes(v.kind)||v.kind==='present'&&typeof v.value==='string'&&v.value.length>0)))return false
  if(error.referenceNumber!==diagnostic.occurrence.objectId||error.lineItemReference!==diagnostic.occurrence.lineItemReference||error.referenceQualifier!==(diagnostic.occurrence.objectId?'Z07':null))return false
  if(!(['scope','messageReference','lineIndex','lineNumber','registerPosition','objectId','identityAgency','lineItemReference'] as const).every(key=>error.prodatOccurrence?.[key]===diagnostic.occurrence[key]))return false
  if((own.objectId.kind==='present'?own.objectId.value:null)!==diagnostic.occurrence.objectId || (own.lineItemReference.kind==='present'?own.lineItemReference.value:null)!==diagnostic.occurrence.lineItemReference)return false
  return diagnostic.kind === 'field'
    ? error.fieldCode === diagnostic.fieldNumber && error.ercCode === (diagnostic.errorKind === 'missing' ? '41' : '42')
    : error.ercCode === '40' && error.fieldCode === '109'
}
