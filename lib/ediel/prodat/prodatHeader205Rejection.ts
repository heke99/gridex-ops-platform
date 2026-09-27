import {tokenizeEdifact, segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {prodatDateState} from './prodatDateFields'
import {prodatDocumentValue} from './prodatDocumentFields'
import {isQualifiedProdatApplicationError} from './prodatDiagnosticProjection'
import type {AperakEngineApplicationError} from '@/lib/ediel/aperakEngine'

/** The actual first PRODAT header owns field 205; no object DTM or caller text
 * can turn a processed-message response into a whole-message rejection. */
export function prodatHeader205Rejection(params:{
  sourceWire:ReturnType<typeof tokenizeEdifact>|null
  errors:readonly AperakEngineApplicationError[]|null|undefined
}):{defect:'missing'|'invalid'|null;qualified:boolean;hasHeaderError:boolean} {
  const {sourceWire,errors}=params
  if (!sourceWire) return {defect:null,qualified:false,hasHeaderError:false}
  const rows=sourceWire.segments
  const start=rows.findIndex(token=>token.tag==='UNH')
  const bgm=rows.findIndex((token,index)=>index>start&&token.tag==='BGM')
  const end=rows.findIndex((token,index)=>index>bgm&&token.tag==='UNT')
  // A detached document/line fragment is not an original message with a
  // missing national header. The syntax owner handles broken envelopes.
  const complete=start>=0&&bgm>start&&end>bgm&&segmentComposite(rows[start],2,sourceWire.una)[0]==='PRODAT'
  const date=complete?prodatDateState('205',rows,sourceWire.una):null
  const defect=date ? date.present ? date.malformed ? 'invalid' : null : 'missing' : null
  const messageCode=complete?prodatDocumentValue('202',rows,sourceWire.una):null
  const message=start>=0?rows[start]:null
  const messageReference=message?segmentComposite(message,1,sourceWire.una)[0]||null:null
  const headerErrors=(errors??[]).filter(error=>error.fieldCode==='205'&&error.prodatOccurrence?.scope==='header')
  const qualified=Boolean(defect && messageCode && messageReference && headerErrors.length && headerErrors.every(error=>
    error.ercCode===(defect==='missing'?'41':'42') &&
    error.prodatFieldDiagnostic?.kind==='field' && error.prodatFieldDiagnostic.errorKind===defect &&
    error.prodatFieldDiagnostic.sourceRule===`PRODAT26A:§2.2:${messageCode}:205` &&
    error.prodatOccurrence?.messageReference===messageReference && error.prodatOccurrence.lineIndex===null &&
    (defect==='missing' || JSON.stringify(error.prodatFieldDiagnostic.failureEvidence)===JSON.stringify(date?.failureEvidence)) &&
    isQualifiedProdatApplicationError(error)))
  return {defect,qualified,hasHeaderError:headerErrors.length>0}
}
