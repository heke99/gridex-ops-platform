'use server'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { CUSTOMER_RECORD_RETENTION_CLASSES } from '@/lib/ediel/retention/recordClasses.catalog'
import { requireRetentionScope } from '@/lib/ediel/retention/retentionHttp'
import { beginCustomerRecordRetention, reviewCustomerRecordRetention, revokeCustomerRecordRetention, submitCustomerRecordRetention } from '@/lib/ediel/retention/customerRecordClasses'
import { purgeRetainedContractDocument } from '@/lib/ediel/retention/contractDocumentPurge'
export type RetentionActionState={message:string;status:'idle'|'submitted'|'held'|'approved'|'rejected'|'revoked'|'completed'|'unavailable';decisionId?:string;documentBase64?:string;documentHash?:string}
const uuid=z.string().uuid()
function only(form:FormData,keys:readonly string[]){for(const key of form.keys())if(!keys.includes(key)&&!key.startsWith('$ACTION_'))throw Error('unknown_field');for(const key of keys)if(form.getAll(key).length>1)throw Error('duplicate_field')}
export async function customerRecordRetentionAction(_state:RetentionActionState,form:FormData):Promise<RetentionActionState>{
 try{
  const action=z.enum(['submit','read','review','revoke','purge']).parse(form.get('action'))
  only(form,action==='submit'?['action','retention_class','target_id','document','issuer_receipt']:action==='review'?['action','decision_id','outcome','reason']:action==='revoke'?['action','decision_id','reason']:['action','decision_id'])
  const key=action==='submit'?'ediel.retention.submit':action==='purge'?'ediel.retention.purge':'ediel.retention.review'
  const scope=await requireRetentionScope(),companyId=scope.companyId
  if(action==='read'?!scope.permissions.some(p=>p==='ediel.retention.read'||p==='ediel.retention.review'):!scope.permissions.includes(key))throw Error('retention_current_operation_required')
  let result:unknown
  if(action==='submit'){
   const file=form.get('document');if(!(file instanceof File)||file.size<1||file.size>768000)throw Error('document_limit')
   const token=form.get('issuer_receipt');if(typeof token!=='string'||token.length>32768)throw Error('receipt_limit')
   const issuerReceipt=token.trim()?z.record(z.string(),z.unknown()).parse(JSON.parse(token)):null
   result=await submitCustomerRecordRetention({companyId,retentionClass:z.enum(CUSTOMER_RECORD_RETENTION_CLASSES).parse(form.get('retention_class')),targetId:uuid.parse(form.get('target_id')),document:Buffer.from(await file.arrayBuffer()),issuerReceipt})
  }else{
   const decisionId=uuid.parse(form.get('decision_id'))
   if(action==='read'){
    const reply=await scope.client.rpc('ediel_read_customer_record_retention_v1',{p_company_id:companyId,p_actor_user_id:scope.userId,p_decision_id:decisionId});if(reply.error)throw reply.error
    const data=z.object({decisionId:uuid,documentBase64:z.string(),documentHash:z.string().regex(/^[a-f0-9]{64}$/)}).parse(reply.data)
    return {status:'submitted',message:'Det arkiverade beslutsunderlaget är hämtat för din aktuella klassbehörighet.',...data}
   }else if(action==='review')result=await reviewCustomerRecordRetention({companyId,decisionId,outcome:z.enum(['approve','hold','reject']).parse(form.get('outcome')),reason:z.string().trim().min(1).max(4000).parse(form.get('reason'))})
   else if(action==='revoke'){await revokeCustomerRecordRetention({companyId,decisionId,reason:z.string().trim().min(1).max(4000).parse(form.get('reason'))});return {status:'revoked',message:'Beslutets behörighet är återkallad.'}}
   else{const first=await beginCustomerRecordRetention({companyId,decisionId});result=first.status==='storage_purge_pending'?await purgeRetainedContractDocument({companyId,decisionId}):first}
  }
  revalidatePath('/admin/ediel/customer-record-retention');revalidatePath('/retention/customer-records')
  const row=result as {status:string;decisionId?:string}
  if(row.status==='held')return {status:'held',message:'Ingreppet är spärrat. Aktuellt källbundet juridiskt beslut, separat granskning, klassbehörighet och operativ avveckling måste vara styrkta.',decisionId:row.decisionId}
  if(row.status==='submitted')return {status:'submitted',message:'Underlaget är arkiverat. En annan behörig granskare måste pröva det innan ingrepp.',decisionId:row.decisionId}
  if(row.status==='approved'||row.status==='rejected')return {status:row.status,message:row.status==='approved'?'Granskningen är registrerad. Ett ingrepp kräver även den egna klassens aktuella prövning.':'Underlaget är avvisat.',decisionId:row.decisionId}
  return {status:'completed',message:row.status==='storage_object_absent'?'Avtalsfilens bytes är verifierat otillgängliga efter faktisk lagringsradering. Källhash och journal är bevarade.':'Klassens personuppgifter är gallrade enligt det specifika beslutet. Källhash, versioner och journaländamål är bevarade.'}
 }catch{return {status:'unavailable',message:'Åtgärden kunde inte genomföras. Kontrollera aktuell bolags- och klassbehörighet, valt källunderlag och beslutsfil.'}}
}
