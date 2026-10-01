'use server'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { requireRetentionScope } from '@/lib/ediel/retention/retentionHttp'
import { inspectFinanceCopyRetention,financeRetentionCall,financeRetentionSelector,purgeFinanceCopyRetention,reviewFinanceCopyRetention,submitFinanceCopyRetention } from '@/lib/ediel/retention/financeCopyRetention'
export type FinanceRetentionState={status:string;message:string;decisionId?:string;documentBase64?:string;documentHash?:string;basis?:string}
export async function financeCopyRetentionAction(_state:FinanceRetentionState,form:FormData):Promise<FinanceRetentionState>{
 try{
  const action=z.enum(['basis','submit','read','review','revoke','purge']).parse(form.get('action'))
  const keys=action==='basis'?['action','retention_class','target_id']:action==='submit'?['action','retention_class','target_id','document','issuer_receipt']:action==='review'?['action','decision_id','outcome','reason']:action==='revoke'?['action','decision_id','reason']:['action','decision_id']
  for(const key of form.keys())if(!keys.includes(key)&&!key.startsWith('$ACTION_'))throw Error('unknown_field');for(const key of keys)if(form.getAll(key).length>1)throw Error('duplicate_field')
  const scope=await requireRetentionScope(),key=action==='submit'?'ediel.retention.submit':action==='purge'?'ediel.retention.purge':'ediel.retention.review'
  if(!scope.permissions.some(key=>['ediel.retention.billing_source_evidence','ediel.retention.invoice_copy_evidence','ediel.retention.settlement_copy_evidence'].includes(key))||(action==='basis'||action==='read'?!scope.permissions.some(p=>p==='ediel.retention.read'||p==='ediel.retention.review'):!scope.permissions.includes(key)))throw Error('finance_retention_current_grants_required')
  let result:unknown
  if(action==='basis'||action==='submit'){
   const selector=financeRetentionSelector.parse({retentionClass:form.get('retention_class'),targetId:form.get('target_id')})
   if(action==='basis')return {status:'inspected',message:'Den sparade källans hash och samtliga inkluderade kundomfattningar är prövade. Detta styrker inte historisk fullständighet eller juridisk behörighet.',basis:JSON.stringify(await inspectFinanceCopyRetention({companyId:scope.companyId,...selector}))}
   const file=form.get('document'),token=form.get('issuer_receipt');if(!(file instanceof File)||file.size<1||file.size>768000||typeof token!=='string'||token.length>32768)throw Error('policy_document_limit')
   result=await submitFinanceCopyRetention({companyId:scope.companyId,...selector,document:Buffer.from(await file.arrayBuffer()),issuerReceipt:token.trim()?z.record(z.string(),z.unknown()).parse(JSON.parse(token)):null})
  }else{
   const decisionId=z.string().uuid().parse(form.get('decision_id'))
   if(action==='read'){
    const data=z.object({decisionId:z.string().uuid(),documentBase64:z.string(),documentHash:z.string().regex(/^[a-f0-9]{64}$/)}).parse(await financeRetentionCall(scope.companyId,'ediel_read_finance_copy_retention_v1',{p_decision_id:decisionId}))
    return {status:'read',message:'Den egna klassens arkiverade beslutsfil är hämtad för aktuell granskning.',...data}
   }else if(action==='review')result=await reviewFinanceCopyRetention({companyId:scope.companyId,decisionId,outcome:z.enum(['approve','hold','reject']).parse(form.get('outcome')),reason:z.string().trim().min(1).max(4000).parse(form.get('reason'))})
   else if(action==='revoke'){await financeRetentionCall(scope.companyId,'ediel_revoke_finance_copy_retention_v1',{p_decision_id:decisionId,p_reason:z.string().trim().min(1).max(4000).parse(form.get('reason'))});result={status:'revoked',decisionId}}
   else result=await purgeFinanceCopyRetention({companyId:scope.companyId,decisionId})
  }
  revalidatePath('/retention/finance-copies')
  const row=result as {status:string;decisionId?:string}
  return {status:row.status,decisionId:row.decisionId,message:row.status==='redacted'?'Just den valda kopians kropp är gallrad. Ursprunglig hash, identitet, version och det separata journaländamålet är bevarade.':row.status==='held'?'Ingreppet är spärrat tills den oförändrade källans alla omfattningar är avvecklade och aktuellt separat juridiskt beslut, granskning och tidsvillkor är styrkta.':row.status==='submitted'?'Beslutsfilen är arkiverad. En annan behörig granskare måste pröva samma källa.':'Den källbundna prövningen är registrerad.'}
 }catch{return {status:'unavailable',message:'Aktuell bolags-, klass- eller källbehörighet saknas, eller källan och beslutsfilen kunde inte kvalificeras.'}}
}
