import {createHash} from 'node:crypto'
import {tokenizeEdifact,segmentComposite,type EdifactTokenizedSegment} from '@/lib/ediel/core/edifactTokenizer'
import {prodatRegisterMessageSegments,prodatRegisterGroups} from './prodatRegisterGroups'
import type {EdielMessageRow} from '@/lib/ediel/types'

export type PriorReviewReason='scope_unavailable'|'history_unavailable'|'search_incomplete'|'unmatched'|'ambiguous'|'wire_conflict'|'state_authority_unavailable'
export type PriorScopeRow=Record<string,unknown>
export type PriorScopeRecords={profiles:PriorScopeRow[];identifiers:PriorScopeRow[];roles:PriorScopeRow[];relations:PriorScopeRow[];actors:PriorScopeRow[]}
type Occurrence={lineIndex:number;lineNumber:string|null;li:string|null;permission:string|null;object:string|null;grid:string|null;customer:string|null;end:string|null;mode:string|null;conflict:boolean}
export type PriorWire=ReturnType<typeof priorPermissionWire>
export type PriorPermissionContext={kind:'not_applicable'|'correlated'|'internal_review';reason?:PriorReviewReason;source:{id:string;hash:string;companyId:string|null;environment:string|null};objects:{source:Occurrence;kind:'correlated_request'|'correlated_cancellation'|'internal_review';reason?:PriorReviewReason;candidate?:{id:string;hash:string;messageReference:string;lineIndex:number;lineNumber:string|null}}[];provenance:PriorScopeRecords|null}
const issued=new WeakMap<object,{source:string;evidence:string}>()
const evidenceHash=(context:PriorPermissionContext)=>createHash('sha256').update(JSON.stringify(context)).digest('hex')
const fingerprint=(m:EdielMessageRow)=>createHash('sha256').update(JSON.stringify([m.id,m.company_id,m.environment,m.direction,m.raw_payload,m.sender_ediel_id,m.receiver_ediel_id,m.application_reference,m.message_received_at])).digest('hex')
const hash=(s:string|null)=>createHash('sha256').update(s??'').digest('hex')
/** Exact decoded selected UNH and physical LIN evidence. No cached references. */
export function priorPermissionWire(message:EdielMessageRow){
 const t=tokenizeEdifact(message.raw_payload??''),rows=prodatRegisterMessageSegments(t.segments,t.una),first=rows.findIndex(r=>r.tag==='LIN'),header=first<0?rows:rows.slice(0,first)
 const parts=(r:EdifactTokenizedSegment|undefined,n:number)=>r?segmentComposite(r,n,t.una):[]
 const unique=(rs:EdifactTokenizedSegment[],n:number)=>rs.length===1?JSON.stringify(parts(rs[0],n)):null
 const bgm=header.filter(r=>r.tag==='BGM'),unh=header.filter(r=>r.tag==='UNH'),unb=t.segments.filter(r=>r.tag==='UNB')
 const party=(role:string)=>unique(header.filter(r=>r.tag==='NAD'&&parts(r,1)[0]===role),2)
 const groups=prodatRegisterGroups(rows,t.una).groups
 const objects=groups.map(g=>{
  const s=g.segments,partyStart=s.findIndex(r=>r.tag==='NAD'),own=partyStart<0?s:s.slice(0,partyStart)
  let conflict=false
  const value=(tag:string,q:string,n=1)=>{const found=own.filter(r=>r.tag===tag&&parts(r,n)[0]===q);if(found.length>1)conflict=true;return found.length===1?parts(found[0],n)[1]??null:null}
  const modeRows=own.filter(r=>r.tag==='CCI'&&parts(r,2)[0]==='Z13'),cav=modeRows.length===1?own[own.indexOf(modeRows[0])+1]:undefined
  if(modeRows.length>1||cav&&cav.tag!=='CAV')conflict=true
  const ud=s.filter(r=>r.tag==='NAD'&&parts(r,1)[0]==='UD');if(ud.length>1)conflict=true
  const lin=parts(s[0],3),customer=unique(ud,2)
  return {lineIndex:g.lineIndex,lineNumber:g.lineNumber,li:value('RFF','LI'),permission:value('RFF','Z09'),object:lin[0]?JSON.stringify(lin):null,grid:value('RFF','Z05'),customer,end:(()=>{const end=value('DTM','164'),dtm=own.find(r=>r.tag==='DTM'&&parts(r,1)[0]==='164');return end&&dtm?JSON.stringify(parts(dtm,1).slice(1)):null})(),mode:cav?.tag==='CAV'?parts(cav,1)[0]??null:null,conflict}
 })
 const dtm=header.filter(r=>r.tag==='DTM'&&parts(r,1)[0]==='137'),date=dtm.length===1?parts(dtm[0],1):[]
 // National 203 timestamps use fixed UTC+1. Keep dispatch/receipt separate.
 const dateValue=date[2]==='203'&&/^\d{12}$/.test(date[1]??'')?`${date[1].slice(0,4)}-${date[1].slice(4,6)}-${date[1].slice(6,8)}T${date[1].slice(8,10)}:${date[1].slice(10,12)}:00+01:00`:null
 return {code:bgm.length===1?parts(bgm[0],1)[0]??'':'',messageReference:unh.length===1?parts(unh[0],1)[0]??'':'',sender:party('FR'),receiver:party('DO'),transportSender:unb.length===1?parts(unb[0],2)[0]??null:null,transportReceiver:unb.length===1?parts(unb[0],3)[0]??null:null,application:unb.length===1?parts(unb[0],7)[0]??null:null,testFlag:unb.length===1?parts(unb[0],11)[0]??'':null,businessAt:dateValue,transportNamespacesValid:unb.length===1&&[2,3].every(n=>{const p=parts(unb[0],n);return p[1]==='ZZ'&&!p.slice(2).some(Boolean)}),objects}
}
const active=(r:PriorScopeRow,at:string)=>{const n=Date.parse(at),from=typeof r.valid_from==='string'?Date.parse(r.valid_from):NaN,to=r.valid_to===null||r.valid_to===undefined?Infinity:Date.parse(String(r.valid_to));return Number.isFinite(n)&&Number.isFinite(from)&&from<=n&&n<to}
const legalId=(tuple:string|null)=>{if(!tuple)return null;const p=JSON.parse(tuple) as string[];return p.length===3&&p[1]==='160'&&p[2]==='SVK'?p[0]:null}
/** Revalidate real temporal rows; stored snapshots and caller tags confer no authority. */
export function priorPermissionScope(message:EdielMessageRow,wire:PriorWire,records:PriorScopeRecords,at:string){
 const company=message.company_id,env=message.environment
 if(!company||!wire.transportNamespacesValid||!wire.businessAt||Date.parse(wire.businessAt)>Date.parse(at)||!['test','production'].includes(env)||!wire.messageReference||!wire.businessAt||!wire.objects.length||!['23-DGI-PRODAT','23-DDQ-PRODAT'].includes(wire.application??'')||message.application_reference!==wire.application||message.message_family!=='PRODAT'||wire.transportSender!==message.sender_ediel_id||wire.transportReceiver!==message.receiver_ediel_id||wire.testFlag!==(env==='test'?'1':''))return false
 const own=legalId(message.direction==='inbound'?wire.receiver:wire.sender),other=legalId(message.direction==='inbound'?wire.sender:wire.receiver),transport=message.direction==='inbound'?wire.transportReceiver:wire.transportSender,counterTransport=message.direction==='inbound'?wire.transportSender:wire.transportReceiver
 if(!own||!other||own===other||other!==counterTransport)return false
 for(const instant of [at,wire.businessAt]){
  const scoped=(rs:PriorScopeRow[])=>rs.filter(r=>r.company_id===company&&r.environment===env&&active(r,instant))
  if(scoped(records.profiles).filter(r=>r.market==='electricity'&&r.is_enabled===true).length!==1)return false
  const ids=scoped(records.identifiers).filter(r=>r.identifier_type==='EdielId');if(ids.length!==1||ids[0].identifier_value!==own)return false
  if(!scoped(records.roles).some(r=>r.actor_id===ids[0].actor_id&&r.role_code==='energy_service_company'))return false
  const relations=scoped(records.relations).filter(r=>r.relation_type==='ediel_transport_agent'&&r.is_enabled===true)
  if(own===transport){if(relations.length)return false}else{
   if(relations.length!==1)return false
   const ids=records.actors.filter(r=>r.actor_id===relations[0].counterparty_actor_id&&r.identifier_type==='EdielId'&&r.is_verified===true&&active(r,instant))
   if(ids.length!==1||ids[0].identifier_value!==transport)return false
  }
  const counterparties=records.actors.filter(r=>r.identifier_type==='EdielId'&&r.identifier_value===other&&r.is_verified===true&&active(r,instant));if(counterparties.length!==1)return false
 }
 return true
}
function seal(message:EdielMessageRow,context:PriorPermissionContext){issued.set(context,{source:fingerprint(message),evidence:evidenceHash(context)});return context}
export function assessPriorPermissionFlow(message:EdielMessageRow,records:PriorScopeRecords|null,candidates:EdielMessageRow[],history:'complete'|'history_unavailable'|'search_incomplete'='complete'):PriorPermissionContext{
 const wire=priorPermissionWire(message),base={source:{id:message.id,hash:hash(message.raw_payload),companyId:message.company_id??null,environment:message.environment??null},provenance:records}
 if(!['Z14','Z15'].includes(wire.code))return seal(message,{...base,kind:'not_applicable',objects:[]})
 const hold=(reason:PriorReviewReason)=>seal(message,{...base,kind:'internal_review',reason,objects:wire.objects.map(source=>({source,kind:'internal_review',reason}))})
 if(!records||!message.message_received_at||!priorPermissionScope(message,wire,records,message.message_received_at)||message.direction!=='inbound')return hold('scope_unavailable')
 if(history!=='complete')return hold(history)
 const objects:PriorPermissionContext['objects']=wire.objects.map(source=>{
  const fail=(reason:PriorReviewReason)=>({source,kind:'internal_review' as const,reason})
  if(!source.li||source.conflict)return fail('wire_conflict')
  const cancellation=wire.code==='Z15'&&source.mode==='Z24',code=wire.code==='Z14'?'Z13':cancellation?'Z15':'Z18',matches:NonNullable<PriorPermissionContext['objects'][number]['candidate']>[]= []
  let conflict=false
  for(const candidate of candidates){
   const cw=priorPermissionWire(candidate),direction=cancellation?'inbound':'outbound',stamp=cancellation?candidate.message_received_at:candidate.message_sent_at
   if(candidate.id===message.id||candidate.company_id!==message.company_id||candidate.environment!==message.environment||candidate.direction!==direction||candidate.message_family!=='PRODAT'||candidate.message_code!==code||cw.code!==code||!stamp||Date.parse(stamp)>Date.parse(message.message_received_at!)||!Number.isFinite(Date.parse(stamp))||!priorPermissionScope(candidate,cw,records,stamp)||cw.sender!==(cancellation?wire.sender:wire.receiver)||cw.receiver!==(cancellation?wire.receiver:wire.sender))continue
   if(!cancellation&&!['provider_accepted','sent','delivered','acknowledged'].includes(candidate.status))continue
   if(cancellation&&['draft','prepared','queued','failed','cancelled'].includes(candidate.status))continue
   for(const obj of cw.objects){
    if(obj.li!==source.li)continue
    const tuple=wire.code==='Z14'?(!source.customer||source.customer===obj.customer)&&(source.mode==='Z96'||!['S17','S18'].includes(source.mode??'')||source.mode===obj.mode):['permission','object','grid','customer','end'].every(key=>Boolean(source[key as keyof Occurrence])&&source[key as keyof Occurrence]===obj[key as keyof Occurrence])&&(!['S17','S18'].includes(source.mode??'')||source.mode===obj.mode)
    if(obj.conflict||!tuple){conflict=true;continue}
    matches.push({id:candidate.id,hash:hash(candidate.raw_payload),messageReference:cw.messageReference,lineIndex:obj.lineIndex,lineNumber:obj.lineNumber})
   }
  }
  if(matches.length>1)return fail('ambiguous')
  if(conflict)return fail('wire_conflict')
  if(!matches.length)return fail(wire.code==='Z15'&&!cancellation?'state_authority_unavailable':'unmatched')
  return {source,kind:cancellation?'correlated_cancellation':'correlated_request',candidate:matches[0]}
 })
 const reason=objects.find(o=>o.kind==='internal_review')?.reason
 return seal(message,{...base,kind:reason?'internal_review':'correlated',...(reason?{reason}:{}),objects})
}
export function assertPriorPermissionContext(message:EdielMessageRow,context:unknown,permissionFieldAssessment:unknown){
 const wire=priorPermissionWire(message);if(!['Z14','Z15'].includes(wire.code))return
 const c=context as PriorPermissionContext|null
 if(!c||issued.get(c)?.source!==fingerprint(message)||issued.get(c)?.evidence!==evidenceHash(c)||c.kind!=='correlated')throw Object.assign(new Error('PRODAT_PERMISSION_PRIOR_REVIEW_REQUIRED'),{reason:c?.reason??'scope_unavailable',permissionContext:c,permissionFieldAssessment})
}
