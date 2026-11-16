import { NextResponse,type NextRequest } from 'next/server'
import { z } from 'zod'
import { readRetentionJson,retentionHeaders,retentionHttp } from '@/lib/ediel/retention/retentionHttp'
import { inspectProcessJournalRetention,processRetentionCall,PROCESS_JOURNAL_RETENTION_CLASSES,purgeProcessJournalRetention,reviewProcessJournalRetention,submitProcessJournalRetention } from '@/lib/ediel/retention/processJournalRetention'
const uuid=z.string().uuid(),reason=z.string().trim().min(1).max(4000)
const selector={retentionClass:z.enum(PROCESS_JOURNAL_RETENTION_CLASSES),targetId:z.string().min(1).max(36)}
const command=z.discriminatedUnion('action',[
 z.object({action:z.literal('basis'),...selector}).strict(),
 z.object({action:z.literal('submit'),...selector,documentBase64:z.string().min(4).max(1398104),issuerReceipt:z.record(z.string(),z.unknown()).nullable()}).strict(),
 z.object({action:z.literal('read'),decisionId:uuid}).strict(),
 z.object({action:z.literal('review'),decisionId:uuid,outcome:z.enum(['approve','hold','reject']),reason}).strict(),
 z.object({action:z.literal('revoke'),decisionId:uuid,reason}).strict(),
 z.object({action:z.literal('purge'),decisionId:uuid}).strict(),
])
export async function POST(request:NextRequest){
 return retentionHttp([],async scope=>{
  const input=command.parse(await readRetentionJson(request,1500000)),key=input.action==='submit'?'ediel.retention.submit':input.action==='purge'?'ediel.retention.purge':'ediel.retention.review'
  if(!scope.permissions.includes('ediel.retention.legal_history')||(input.action==='basis'||input.action==='read'?!scope.permissions.some(p=>p==='ediel.retention.read'||p==='ediel.retention.review'):!scope.permissions.includes(key)))throw Error('process_retention_current_operation_and_class_required')
  let result:unknown
  if(input.action==='basis')result=await inspectProcessJournalRetention({companyId:scope.companyId,...input})
  else if(input.action==='submit'){
   if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.documentBase64))throw new SyntaxError('canonical_base64_required')
   const document=Buffer.from(input.documentBase64,'base64');if(document.toString('base64')!==input.documentBase64)throw new SyntaxError('canonical_base64_required')
   result=await submitProcessJournalRetention({companyId:scope.companyId,...input,document})
  }else if(input.action==='review')result=await reviewProcessJournalRetention({companyId:scope.companyId,...input})
  else if(input.action==='purge')result=await purgeProcessJournalRetention({companyId:scope.companyId,...input})
  else if(input.action==='read')result=await processRetentionCall(scope.companyId,'ediel_read_process_journal_retention_v1',{p_decision_id:input.decisionId})
  else{await processRetentionCall(scope.companyId,'ediel_revoke_process_journal_retention_v1',{p_decision_id:input.decisionId,p_reason:input.reason});result={status:'revoked',decisionId:input.decisionId}}
  const held=Boolean(result&&typeof result==='object'&&'status'in result&&result.status==='held')
  return NextResponse.json(result,{status:held?409:200,headers:retentionHeaders})
 })
}
