import {segmentComposite,tokenizeEdifact,type EdifactTokenizedSegment} from '@/lib/ediel/core/edifactTokenizer'
import {parseUna,type EdifactServiceStringAdvice} from '@/lib/ediel/core/una'
import type {EdielRulebookIssue} from '@/lib/ediel/rulebook/rulebook'
import {prodatRegisterTokens} from './prodatRegisterFields'
import {prodatRegisterGroups,prodatRegisterMessageSegments} from './prodatRegisterGroups'
import {prodatFieldDiagnostic,prodatLocalDiagnostic} from './prodatFieldDiagnostic'
import {projectProdatDiagnostics} from './prodatDiagnosticProjection'
import {prodatComponentEvidence} from './prodatFailureEvidence'

const sourceRule='PRODAT26A:P21/73/75/119/123'
type PermissionInput={rawSegments:readonly string[];una?:EdifactServiceStringAdvice;code?:string|null;selectedFields?:readonly string[]}
/** Incoming national322/324 only. Every LIN is an independent physical object;
 * cached columns, local flow matching and test scenarios have no field authority. */
export function evaluateIncomingProdatPermissionAckFields(input:PermissionInput){
 const una=input.una??parseUna(null),all=prodatRegisterTokens(input.rawSegments,una)
 const tokens=prodatRegisterMessageSegments(all,una),bgms=tokens.filter(t=>t.tag==='BGM')
 const full=all.some(t=>['UNB','UNH','UNT','UNZ'].includes(t.tag))
 const firstLin=tokens.findIndex(t=>t.tag==='LIN')
 const ownBgm=bgms.length===1&&(firstLin<0||tokens.indexOf(bgms[0])<firstLin)?bgms[0]:undefined
 const code=ownBgm?segmentComposite(ownBgm,1,una)[0]??'':!full&&bgms.length===0?input.code??'':''
 const issues:EdielRulebookIssue[]=[]
 const objects:{lineIndex:number;reason:string|null;status:string|null;endReason:string|null}[]=[]
 const internal=(reason:string,scope:readonly EdifactTokenizedSegment[])=>issues.push({severity:'error',blocking:true,code:'PRODAT_PERMISSION_ACK_SCOPE_UNQUALIFIED',title:'Tillståndsfält kräver intern granskning',description:JSON.stringify({reason,rawSegments:scope.map(t=>t.raw)}),fieldPath:'SG8/SG14',prodatDiagnostic:prodatLocalDiagnostic('internal',sourceRule,JSON.stringify({reason,rawSegments:scope.map(t=>t.raw)}))})
 if(!code&&tokens.some(t=>t.tag==='BGM'&&['Z14','Z15','Z18'].includes(segmentComposite(t,1,una)[0])||t.tag==='CCI'&&['Z23','Z25'].includes(segmentComposite(t,2,una)[0])))internal('Selected message has no unique own BGM function',tokens)
 // Select before assessing field-local ownership/readiness. Full consumers omit
 // selectedFields; shared message/BGM failures above still block partial policies.
 const fields=(code==='Z14'?['322']:code==='Z18'?['324']:code==='Z15'?['322','324']:[]).filter(field=>!input.selectedFields||input.selectedFields.includes(field))
 if(fields.length){
  const {groups}=prodatRegisterGroups(tokens,una,code)
  const pair=(t:EdifactTokenizedSegment,qualifier:string)=>t.tag==='CCI'&&segmentComposite(t,2,una)[0]===qualifier
  const header=firstLin<0?tokens:tokens.slice(0,firstLin)
  if(header.some(t=>fields.some(f=>pair(t,f==='322'?'Z23':'Z25'))))internal('Permission characteristic outside an owning LIN',header)
  if(!groups.length)internal('Permission fields have no owning LIN',tokens)
  for(const group of groups){
   const scope=group.segments,boundary=scope.findIndex(t=>['RFF','NAD'].includes(t.tag)),common=boundary<0?scope:scope.slice(0,boundary)
   const reasons=scope.filter(t=>pair(t,'Z13')),r=reasons[0],cav=r?scope[scope.indexOf(r)+1]:undefined
   const rp=cav?.tag==='CAV'?segmentComposite(cav,1,una):[]
   const reason=reasons.length===1&&common.includes(r)&&![rp[1],rp[2]].some(v=>v?.trim())?rp[0]??null:null
   if(code==='Z14'&&(reasons.length>1||r&&!common.includes(r)))internal('Own223 structure is ambiguous; it cannot establish a322 combination',reasons)
   const object={lineIndex:group.lineIndex,reason,status:null as string|null,endReason:null as string|null};objects.push(object)
   for(const field of fields){
    const qualifier=field==='322'?'Z23':'Z25',pairs=scope.filter(t=>pair(t,qualifier))
    const located=pairs.filter(t=>common.includes(t)),values=located.map(t=>{const next=scope[scope.indexOf(t)+1];return {cci:t,cav:next?.tag==='CAV'?next:undefined,parts:next?.tag==='CAV'?segmentComposite(next,1,una):[]}})
    const ambiguous=pairs.length>1||pairs.some(t=>!common.includes(t))
    if(ambiguous)internal(`Field${field} has ambiguous owning CCI/CAV placement`,scope.filter(t=>pairs.includes(t)||pairs.some(p=>scope.indexOf(t)===scope.indexOf(p)+1)))
    const supplied=values.filter(v=>Boolean(v.parts[0]?.trim()))
    const allowed=field==='324'?['B77','B78','B79','B80','E37']:code==='Z15'?['A74','A75']:reason==='Z96'?['A13','A76']:['S17','S18'].includes(reason??'')?['A74']:['A74','A75','A76','A13']
    const invalid=supplied.filter(v=>!allowed.includes(v.parts[0]))
    // Even an ambiguous placement cannot supply a primary scalar from unused
    // metadata. Keep this independently provable41 beside the internal finding.
    const anyOwnScalar=pairs.some(t=>{const next=scope[scope.indexOf(t)+1];return next?.tag==='CAV'&&Boolean(segmentComposite(next,1,una)[0]?.trim())})
    const kind=invalid.length?'invalid':!supplied.length&&(!ambiguous||!anyOwnScalar)?'missing':null
    if(kind)issues.push({severity:'error',blocking:true,code:`PRODAT_PERMISSION_${field}_${kind.toUpperCase()}`,title:`Tillståndsfält ${field}`,description:`P26.A s.21/73/75/123: ${field} ${kind}`,fieldPath:`SG8[${group.lineIndex}]/CCI++${qualifier}/CAV`,prodatDiagnostic:prodatFieldDiagnostic(field,kind,{...input,code},scope.map(t=>t.raw),sourceRule,group.lineIndex,'object',kind==='invalid'?invalid.flatMap(v=>prodatComponentEvidence(v.cav!.raw,'CAV/C889/7111',v.parts,[0])):undefined)})
    if(!ambiguous&&supplied.length===1&&!invalid.length){if(field==='322')object.status=supplied[0].parts[0];else object.endReason=supplied[0].parts[0]}
   }
  }
 }
 return {code,objects,issues,...projectProdatDiagnostics(issues)}
}
export function permissionAckFieldsFromPayload(rawPayload:string|null|undefined){
 const wire=tokenizeEdifact(rawPayload??'')
 return evaluateIncomingProdatPermissionAckFields({rawSegments:wire.segments.map(t=>t.raw),una:wire.una})
}
/** Local failure carries every observation and independently ready F. Call before
 * event/write/positive fallback, never truncate or guess a national error. */
export function assertPermissionAckFieldsReady(assessment:ReturnType<typeof evaluateIncomingProdatPermissionAckFields>):void{
 if(assessment.disposition.kind==='internal_review')throw Object.assign(new Error('PRODAT_PERMISSION_ACK_REVIEW_REQUIRED'),{assessment})
}
