import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {parseUna,type EdifactServiceStringAdvice} from '@/lib/ediel/core/una'
import {validateProdatReportingPermission} from '@/lib/ediel/rulebook/prodatReportingPermissionPolicy'
import {validateProdatMeterChange} from '@/lib/ediel/rulebook/prodatMeterChangePolicy'
import {validateProdatDeathStatus} from '@/lib/ediel/rulebook/prodatDeathStatusPolicy'
import {validateProdatGasApplicability} from '@/lib/ediel/rulebook/prodatGasApplicabilityPolicy'
import {prodatRegisterTokens} from './prodatRegisterFields'
import {prodatLocalDiagnostic} from './prodatFieldDiagnostic'
import {projectProdatDiagnostics} from './prodatDiagnosticProjection'
import type {ProdatDependentConditionFacts} from './prodatDependentConditionEngine'
import type {EdielRulebookIssue} from '@/lib/ediel/rulebook/rulebook'

/** Nine finite incoming cells; predicates and diagnostics stay with their source
 * owners. This assessment never reads persisted caller facts or registry rules. */
export function evaluateIncomingSelectedProdatAck(input:{rawSegments:readonly string[];una?:EdifactServiceStringAdvice;code?:string|null;facts?:ProdatDependentConditionFacts|null;selectedFields?:readonly string[]}):{code:string;issues:EdielRulebookIssue[]}&ReturnType<typeof projectProdatDiagnostics>{
 const una=input.una??parseUna(null),tokens=prodatRegisterTokens(input.rawSegments,una),bgms=tokens.filter(t=>t.tag==='BGM')
 const firstLin=tokens.findIndex(t=>t.tag==='LIN'),code=bgms.length===1&&(firstLin<0||tokens.indexOf(bgms[0])<firstLin)?segmentComposite(bgms[0],1,una)[0]??'':bgms.length===0&&!tokens.some(t=>t.tag==='UNH')?input.code??'':''
 const selected=['Z04','Z05','Z06','Z09','Z10','Z14'],issues:EdielRulebookIssue[]=[]
 // Existing owners can safely retain known fields in separate UNH scopes.
 // Registry/draft mutation still holds the aggregate until multi-message delivery
 // is qualified; no scope can supply another message's BGM, LI or object.
 const starts=tokens.flatMap((t,i)=>t.tag==='UNH'?[i]:[])
 if(starts.length>1){
  const envelope=tokens.slice(0,starts[0]).map(t=>t.raw)
  const assessments=starts.map((start,index)=>evaluateIncomingSelectedProdatAck({...input,rawSegments:[...envelope,...tokens.slice(start,starts[index+1]).map(t=>t.raw)]}))
  const combined:EdielRulebookIssue[]=assessments.flatMap(a=>a.issues)
  const relevant=assessments.some(a=>selected.includes(a.code)&&(!input.selectedFields||input.selectedFields.some(f=>(a.code==='Z14'?['321','323']:a.code==='Z10'?['254','242']:a.code==='Z04'?['320']:a.code==='Z06'?['310','320']:['310']).includes(f))))
  if(relevant)combined.push({severity:'error',blocking:true,code:'PRODAT_SELECTED_ACK_SCOPE_UNQUALIFIED',title:'PRODAT kräver intern granskning',description:'Selected incoming ACK delivery requires one own message',prodatDiagnostic:prodatLocalDiagnostic('internal','PRODAT26A:own-message','Multiple message delivery is unqualified')})
  return {code:assessments[0]?.code??'',issues:combined,...projectProdatDiagnostics(combined)}
 }
 const fields=code==='Z14'?['321','323']:code==='Z10'?['254','242']:code==='Z04'?['320']:code==='Z06'?['310','320']:['310']
 const active=fields.filter(f=>!input.selectedFields||input.selectedFields.includes(f))
 const ownInput={...input,code,una,direction:'inbound' as const}
 if(selected.includes(code)&&active.length){
  issues.push(...(code==='Z14'?validateProdatReportingPermission(ownInput):code==='Z10'?validateProdatMeterChange(ownInput):validateProdatDeathStatus(ownInput)),...validateProdatGasApplicability({...ownInput,fields:['320']}))
 }
 if(active.length&&(tokens.filter(t=>t.tag==='UNH').length>1||bgms.length>1||bgms.length===1&&firstLin>=0&&tokens.indexOf(bgms[0])>firstLin)&&bgms.some(t=>selected.includes(segmentComposite(t,1,una)[0])))issues.push({severity:'error',blocking:true,code:'PRODAT_SELECTED_ACK_SCOPE_UNQUALIFIED',title:'PRODAT kräver intern granskning',description:'Selected incoming ACK requires one unique own message and BGM before LIN',prodatDiagnostic:prodatLocalDiagnostic('internal','PRODAT26A:own-message','Multiple or ambiguous message ownership')})
 for(const issue of [...issues]){
  const d=issue.prodatDiagnostic
  if(d?.kind==='field'&&d.occurrence.ownReferences&&Object.values(d.occurrence.ownReferences).some(ref=>ref.kind==='unavailable'))issues.push({severity:'error',blocking:true,code:'PRODAT_SELECTED_ACK_REFERENCE_UNQUALIFIED',title:'PRODAT kräver intern granskning',description:'Selected field has ambiguous own reference identity',prodatDiagnostic:prodatLocalDiagnostic('internal',d.sourceRule,'Own reference identity is ambiguous')})
 }
 const filtered=input.selectedFields?issues.filter(i=>i.prodatDiagnostic?.kind!=='field'||input.selectedFields!.includes(i.prodatDiagnostic.fieldNumber)):issues
 const projected=projectProdatDiagnostics(filtered)
 // Different source findings for the same field/physical occurrence are retained
 // in observations; wire errors are identical only when all typed data agree.
 const seen=new Set<string>();projected.applicationErrors=projected.applicationErrors.filter(e=>{const key=JSON.stringify(e);if(seen.has(key))return false;seen.add(key);return true})
 return {code,issues:filtered,...projected}
}
export function selectedProdatAckFromPayload(rawPayload:string|null|undefined,facts?:ProdatDependentConditionFacts){const wire=tokenizeEdifact(rawPayload??'');return evaluateIncomingSelectedProdatAck({rawSegments:wire.segments.map(t=>t.raw),una:wire.una,facts})}
export function assertSelectedProdatAckReady(assessment:ReturnType<typeof evaluateIncomingSelectedProdatAck>):void{if(assessment.disposition.kind==='internal_review')throw Object.assign(new Error('PRODAT_SELECTED_ACK_REVIEW_REQUIRED'),{assessment})}
