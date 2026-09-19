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
  const disposition: ProdatProcessingDisposition = {kind:'continue',reasons:[]}
  const observations = issues.map(item => {
    const diagnostic = item.prodatDiagnostic
    const local = diagnostic?.kind === 'local_unknown' || diagnostic?.kind === 'local_evidence'
    if (!local && (item.blocking || item.severity === 'error')) {
      if (diagnostic?.kind === 'field' && validProdatWireDiagnostic(diagnostic)) {
        applicationErrors.push({ercCode:diagnostic.errorKind === 'missing' ? '41' : '42',fieldCode:diagnostic.fieldNumber,
          text:item.description.slice(0,70), ...references(diagnostic.occurrence), prodatFieldDiagnostic:diagnostic})
      } else if (diagnostic?.kind === 'application' && validProdatWireDiagnostic(diagnostic)) {
        applicationErrors.push({ercCode:'40',fieldCode:'109',text:item.description.slice(0,70),...references(diagnostic.occurrence),prodatFieldDiagnostic:diagnostic})
      } else {
        disposition.kind = 'internal_review'
        disposition.reasons.push({code:item.code,sourceRule:diagnostic?.sourceRule ?? 'PRODAT:typed-diagnostic-invariant',reason:diagnostic?.kind === 'internal' ? diagnostic.reason : 'Expected source-owned error metadata is absent or invalid'})
      }
    }
    return {...item, severity:local ? 'warning' as const : item.severity, originalSeverity:item.severity}
  })
  return {applicationErrors,disposition,observations}
}

/** Internal-review delivery only permits source-qualified errors surviving persistence. */
export function isQualifiedProdatApplicationError(error: EdielAperakApplicationError): boolean {
  const diagnostic = error.prodatFieldDiagnostic
  if (!validProdatWireDiagnostic(diagnostic)) return false
  return diagnostic.kind === 'field'
    ? error.fieldCode === diagnostic.fieldNumber && error.ercCode === (diagnostic.errorKind === 'missing' ? '41' : '42')
    : error.ercCode === '40' && error.fieldCode === '109'
}
