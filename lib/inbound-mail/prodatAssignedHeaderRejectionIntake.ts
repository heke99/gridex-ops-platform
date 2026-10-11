import {supabaseService} from '@/lib/supabase/service'
import {assertEdielTenantActor} from '@/lib/ediel/services/authorization'
import {segmentComposite,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {validateEdifactEnvelope} from '@/lib/ediel/core/edifactValidation'
import {prodatRegisterGroups} from '@/lib/ediel/prodat/prodatRegisterGroups'
import {evidenceHash,isEvidenceRecord,isEvidenceUuid} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {parseSourceReceiptInstant} from '@/lib/ediel/utilts/receivedSourceInventory'

export type AssignedProdatHeaderNegativeField='202'|'311'|'223'
/** Observation selects the protected intake command only. It grants no guide,
 * legal role, operational profile, response or business authority. */
export function observeAssignedProdatHeaderNegativeField(raw:unknown):AssignedProdatHeaderNegativeField|null {
 if(typeof raw!=='string'||Buffer.byteLength(raw,'utf8')>262144||!validateEdifactEnvelope(raw).syntaxOk)return null
 try{
  const wire=tokenizeEdifact(raw),{segments,una}=wire
  const unb=segments.filter(row=>row.tag==='UNB'),unh=segments.filter(row=>row.tag==='UNH'),bgm=segments.filter(row=>row.tag==='BGM')
  if(unb.length!==1||unh.length!==1||bgm.length!==1||segmentComposite(unh[0],2,una).join(':')!=='PRODAT:D:97A:UN:E2SE6A')return null
  const code=segmentComposite(bgm[0],1,una),app=segmentComposite(unb[0],7,una),document=segmentComposite(bgm[0],2,una)
  if(code.length!==1||app.length!==1||document.length!==1||!document[0]||document[0].length>35)return null
  const groups=prodatRegisterGroups(segments,una,code[0]||undefined)
  if(groups.problems.length||groups.groups.length!==1||!groups.groups[0].validRegisterChain
   ||groups.groups[0].registerPosition!==1||groups.groups[0].messageIndex!==0||!groups.groups[0].itemId
   ||segments.indexOf(bgm[0])>=segments.indexOf(groups.groups[0].segments[0]))return null
  const selectors=segments.filter(row=>row.tag==='CCI'&&segmentComposite(row,2,una)[0]?.trim().toUpperCase()==='Z13')
  const absent=[!code[0]?'202':null,!app[0]?'311':null,!selectors.length?'223':null].filter(Boolean)
  if(absent.length!==1)return null
  const field=absent[0] as AssignedProdatHeaderNegativeField
  if(field==='223')return code[0]==='Z04'&&app[0]==='23-DDQ-PRODAT'?field:null
  if(field==='202'&&app[0]!=='23-DDQ-PRODAT'||field==='311'&&code[0]!=='Z04'||selectors.length!==1)return null
  const own=groups.groups[0].segments,index=own.indexOf(selectors[0]),cav=own[index+1]
  if(index<0||!cav||cav.tag!=='CAV'||segmentComposite(selectors[0],2,una).join(':')!=='Z13'
   ||segmentComposite(cav,1,una).join(':')!=='Z25'||own[index+2]?.tag==='CAV')return null
  return field
 }catch{return null}
}

/** SQL owns the actual retained assigned mail/parse, current actor, source UUID,
 * receipt clock and one-use negative birth. Caller fields cannot fill a missing
 * APP/reason/code or six-column operational profile. */
export async function createAssignedProdatHeaderNegativeSource(input:{companyId:string;environment:'test'|'production';actorUserId:string;
 inboundEmailMessageId:string;parseResultId:string;rawPayload:string}):Promise<string|null> {
 const companyId=input.companyId,actorUserId=input.actorUserId
 let principal:{environment:'test'|'production';mailId:string;parseId:string;raw:string}|null=null,captureError:unknown
 try{principal={environment:input.environment,mailId:input.inboundEmailMessageId,parseId:input.parseResultId,raw:input.rawPayload}}
 catch(error){captureError=error}
 await assertEdielTenantActor({companyId,actorUserId,permission:'communication.write'})
 if(!principal)throw captureError
 const {environment,mailId,parseId,raw}=principal,field=observeAssignedProdatHeaderNegativeField(raw)
 if(!field)return null
 if(!isEvidenceUuid(companyId)||!isEvidenceUuid(actorUserId)||!isEvidenceUuid(mailId)||!isEvidenceUuid(parseId)
  ||!['test','production'].includes(environment))throw Error('ediel_assigned_header_negative_scope_required')
 const hash=evidenceHash(raw)
 const rpc=supabaseService.rpc.bind(supabaseService) as unknown as (name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>
 const {data,error}=await rpc('ediel_create_assigned_prodat_header_negative_v1',{p_company_id:companyId,p_environment:environment,
  p_actor_user_id:actorUserId,p_inbound_email_message_id:mailId,p_parse_result_id:parseId,p_expected_raw_payload:raw,p_expected_payload_hash:hash})
 if(error)throw error
 if(!isEvidenceRecord(data)||data.version!==1||data.disposition!=='assigned_header_negative'||data.permanentNegative!==true
  ||data.authorizesBusinessEffect!==false||data.companyId!==companyId||data.environment!==environment||!isEvidenceUuid(data.sourceMessageId)
  ||data.sourcePayloadHash!==hash||data.inboundEmailMessageId!==mailId||data.parseResultId!==parseId||data.fieldCode!==field
  ||parseSourceReceiptInstant(data.sourceReceivedAt)===null)throw Error('ediel_assigned_header_negative_birth_required')
 return data.sourceMessageId
}
