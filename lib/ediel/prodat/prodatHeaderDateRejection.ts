import {tokenizeEdifact, segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {prodatDateState} from './prodatDateFields'
import {prodatDocumentState,prodatDocumentValue} from './prodatDocumentFields'
import {isQualifiedProdatApplicationError} from './prodatDiagnosticProjection'
import type {ProdatFailureEvidence} from './prodatFailureEvidence'
import type {AperakEngineApplicationError} from '@/lib/ediel/aperakEngine'

function sameFailureEvidence(a:ProdatFailureEvidence|undefined,b:ProdatFailureEvidence|undefined):boolean {
  return Boolean(a && b && a.length === b.length && a.every((item,index)=>
    item.raw === b[index]?.raw && item.locator === b[index]?.locator && item.content === b[index]?.content))
}

/** The actual first PRODAT header owns fields 204, 313, 205 and 206; no object DTM or caller text
 * can turn a processed-message response into a whole-message rejection. */
export function prodatHeaderFieldRejection(params:{
  field:'204'|'313'|'205'|'206'
  sourceWire:ReturnType<typeof tokenizeEdifact>|null
  errors:readonly AperakEngineApplicationError[]|null|undefined
}):{defect:'missing'|'invalid'|null;qualified:boolean;hasHeaderError:boolean} {
  const {sourceWire,errors,field}=params
  if (!sourceWire) return {defect:null,qualified:false,hasHeaderError:false}
  const rows=sourceWire.segments
  const start=rows.findIndex(token=>token.tag==='UNH')
  const bgm=rows.findIndex((token,index)=>index>start&&token.tag==='BGM')
  const end=rows.findIndex((token,index)=>index>bgm&&token.tag==='UNT')
  // A detached document/line fragment is not an original message with a
  // missing national header. The syntax owner handles broken envelopes.
  const complete=start>=0&&bgm>start&&end>bgm&&segmentComposite(rows[start],2,sourceWire.una)[0]==='PRODAT'
  const messageCode=complete?prodatDocumentValue('202',rows,sourceWire.una):null
  const date=complete && (field==='205'||field==='206')?prodatDateState(field,rows,sourceWire.una):null
  const document=complete && (field==='204'||field==='313')?prodatDocumentState(field,rows,sourceWire.una):null
  const defect=date ? date.present ? date.malformed ? 'invalid' : null : 'missing'
    : document ? document.present ? document.malformed || !(field==='204'?['9','5']:['AB','NA']).includes(document.value??'') ? 'invalid' : null
      : field==='204'||messageCode==='Z01' ? null : 'missing' : null
  const failureEvidence=date?.failureEvidence??document?.failureEvidence
  const message=start>=0?rows[start]:null
  const messageReference=message?segmentComposite(message,1,sourceWire.una)[0]||null:null
  const headerErrors=(errors??[]).filter(error=>error.fieldCode===field&&error.prodatOccurrence?.scope==='header')
  const qualified=Boolean(defect && messageCode && messageReference && headerErrors.length && headerErrors.every(error=>
    error.ercCode===(defect==='missing'?'41':'42') &&
    error.prodatFieldDiagnostic?.kind==='field' && error.prodatFieldDiagnostic.errorKind===defect &&
    error.prodatFieldDiagnostic.sourceRule===`PRODAT26A:§2.2:${messageCode}:${field}` &&
    error.prodatOccurrence?.messageReference===messageReference && error.prodatOccurrence.lineIndex===null &&
    (defect==='missing' || sameFailureEvidence(error.prodatFieldDiagnostic.failureEvidence,failureEvidence)) &&
    isQualifiedProdatApplicationError(error)))
  return {defect,qualified,hasHeaderError:headerErrors.length>0}
}
