import {prodatRegisterFieldState} from './prodatRegisterFields'
import {segmentComposite,segmentElementCount} from '@/lib/ediel/core/edifactTokenizer'
import {parseUna} from '@/lib/ediel/core/una'
import {prodatRegisterGroups,prodatRegisterMessageSegments} from './prodatRegisterGroups'
import {prodatFieldDiagnostic,prodatLocalDiagnostic} from './prodatFieldDiagnostic'
import {prodatComponentEvidence} from './prodatFailureEvidence'
import type {ReportingPolicyInput} from '@/lib/ediel/rulebook/prodatReportingPermissionPolicy'
import type {EdielRulebookIssue} from '@/lib/ediel/rulebook/rulebook'

/** P21/74/119/123: supplied content under local U does not establish private
 * classification, requiredness, request correspondence or permission authority. */
export function incomingReportingPurposeIssues(input:ReportingPolicyInput):EdielRulebookIssue[]{
 if(input.code!=='Z14'||input.selectedFields&&!input.selectedFields.includes('323'))return []
 const una=input.una??parseUna(null),tokens=prodatRegisterMessageSegments(input.rawSegments,una),{groups}=prodatRegisterGroups(tokens,una,input.code)
 const issues:EdielRulebookIssue[]=[]
 const internal=(reason:string)=>issues.push({severity:'error',blocking:true,code:'PRODAT_REPORTING_PURPOSE_SCOPE_UNQUALIFIED',title:'Rapporteringssyftet kräver granskning',description:reason,prodatDiagnostic:prodatLocalDiagnostic('internal','PRODAT26A:P21/74/119/123',reason)})
 for(const group of groups){
  const own=group.segments,boundary=own.findIndex(t=>['RFF','NAD'].includes(t.tag)),common=boundary<0?own:own.slice(0,boundary)
  const reasons=own.filter(t=>t.tag==='CCI'&&segmentComposite(t,2,una)[0]==='Z13'),r=reasons[0],rc=r?own[own.indexOf(r)+1]:undefined,rp=rc?.tag==='CAV'?segmentComposite(rc,1,una):[]
  const reason=reasons.length===1&&common.includes(r)&&!rp[1]&&!rp[2]?rp[0]:null
  if(reason==='Z96')continue
  const pairs=own.filter(t=>t.tag==='CCI'&&segmentComposite(t,2,una)[0]?.trim().toUpperCase()==='Z24')
  if(!pairs.length)continue // Receiver-local U absence is not missing323.
  if(!reason||!group.itemId||!['9','89'].includes(group.identityAgency??'')||prodatRegisterFieldState('258',own,una)?.present){internal('Supplied323 has no qualified own process/first object');continue}
  if(!['S17','S18'].includes(reason))continue
  if(pairs.length!==1||pairs.some(t=>!common.includes(t))){internal('Supplied323 has ambiguous own CCI/CAV placement');continue}
  const cci=pairs[0],index=own.indexOf(cci),cav=own[index+1]
  if(cav?.tag!=='CAV'||own[index+2]?.tag==='CAV'){internal('Supplied323 has no unique adjacent CAV');continue}
  const p=segmentComposite(cav,1,una)
  // Optional unused CCI/C889 content is retained. Actual C8891131/3055,
  // national code, and EDIFACT composite/element overflow are controlled.
  const failed=[...(p[0]&&!['B71','B72','B73','B74','B75','B76'].includes(p[0])?[0]:[]),...([1,2].filter(i=>Boolean(p[i])))]
  const overflow=p.length>5||segmentElementCount(cav,una)>1
  if(failed.length||overflow)issues.push({severity:'error',blocking:true,code:'PRODAT_REPORTING_PURPOSE_INVALID',title:'Felaktigt tillståndssyfte',description:'P26.A s.74/119/123: eget syfte kräver B71–B76 och giltig C889',fieldPath:'CCI++Z24/CAV',prodatDiagnostic:prodatFieldDiagnostic('323','invalid',input,own.map(t=>t.raw),'PRODAT26A:P21/74/119/123',group.lineIndex,'object',prodatComponentEvidence(cav.raw,'CAV/C889',overflow?Array.from({length:segmentElementCount(cav,una)},(_,i)=>segmentComposite(cav,i+1,una)).flat():p,overflow?undefined:failed))})
 }
 const first=tokens.findIndex(t=>t.tag==='LIN')
 if((first<0?tokens:tokens.slice(0,first)).some(t=>t.tag==='CCI'&&segmentComposite(t,2,una)[0]==='Z24'))internal('Supplied323 outside an owning object')
 return issues
}
