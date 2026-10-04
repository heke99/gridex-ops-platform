import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { CUSTOMER_RECORD_RETENTION_CLASSES } from '@/lib/ediel/retention/recordClasses.catalog'
import { beginCustomerRecordRetention, reviewCustomerRecordRetention, revokeCustomerRecordRetention, submitCustomerRecordRetention } from '@/lib/ediel/retention/customerRecordClasses'
import { purgeRetainedContractDocument } from '@/lib/ediel/retention/contractDocumentPurge'
import { readRetentionJson, retentionHeaders, retentionHttp } from '@/lib/ediel/retention/retentionHttp'
export const runtime='nodejs'
export const dynamic='force-dynamic'
const uuid=z.string().uuid(),reason=z.string().trim().min(1).max(4000)
const command=z.discriminatedUnion('action',[
 z.object({action:z.literal('submit'),retentionClass:z.enum(CUSTOMER_RECORD_RETENTION_CLASSES),targetId:uuid,documentBase64:z.string().min(1).max(1398104),issuerReceipt:z.record(z.string(),z.unknown()).nullable()}).strict(),
 z.object({action:z.literal('read'),decisionId:uuid}).strict(),
 z.object({action:z.literal('review'),decisionId:uuid,outcome:z.enum(['approve','hold','reject']),reason}).strict(),
 z.object({action:z.literal('revoke'),decisionId:uuid,reason}).strict(),
 z.object({action:z.literal('purge'),decisionId:uuid}).strict(),
])
export async function POST(request:NextRequest){
 return retentionHttp([],async scope=>{
  const input=command.parse(await readRetentionJson(request,1500000)),companyId=scope.companyId
  const required=input.action==='submit'?'ediel.retention.submit':input.action==='purge'?'ediel.retention.purge':'ediel.retention.review'
  if(input.action==='read'?!scope.permissions.some(p=>p==='ediel.retention.read'||p==='ediel.retention.review'):!scope.permissions.includes(required))throw Error('retention_current_operation_required')
  let result:unknown
  if(input.action==='submit'){
   const document=Buffer.from(input.documentBase64,'base64')
   if(document.toString('base64')!==input.documentBase64)throw new SyntaxError('canonical_document_base64_required')
   result=await submitCustomerRecordRetention({companyId,retentionClass:input.retentionClass,targetId:input.targetId,document,issuerReceipt:input.issuerReceipt})
  }else if(input.action==='read'){
   const reply=await scope.client.rpc('ediel_read_customer_record_retention_v1',{p_company_id:companyId,p_actor_user_id:scope.userId,p_decision_id:input.decisionId})
   if(reply.error)throw reply.error;result=reply.data
  }else if(input.action==='review')result=await reviewCustomerRecordRetention({companyId,...input})
  else if(input.action==='revoke'){await revokeCustomerRecordRetention({companyId,...input});result={status:'revoked'}}
  else{
   const first=await beginCustomerRecordRetention({companyId,decisionId:input.decisionId})
   result=first.status==='storage_purge_pending'?await purgeRetainedContractDocument({companyId,decisionId:input.decisionId}):first
  }
  const held=Boolean(result&&typeof result==='object'&&'status'in result&&result.status==='held')
  return NextResponse.json(result,{status:held?409:200,headers:retentionHeaders})
 })
}
