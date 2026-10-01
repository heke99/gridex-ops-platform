import {NextResponse,type NextRequest} from 'next/server'
import {z} from 'zod'
import {readRetentionJson,retentionHeaders,retentionHttp} from '@/lib/ediel/retention/retentionHttp'
import {INVOICE_FILE_CLASSES,invoiceFileRetentionCall,inspectInvoiceFileRetention,registerInvoiceFileSource,submitInvoiceFileRetention,reviewInvoiceFileRetention,purgeInvoiceFileRetention} from '@/lib/ediel/retention/invoiceFileRetention'
const uuid=z.string().uuid(),selected={retentionClass:z.enum(INVOICE_FILE_CLASSES),targetId:uuid}
const input=z.discriminatedUnion('action',[
 z.object({action:z.literal('capture'),...selected}).strict(),z.object({action:z.literal('basis'),...selected}).strict(),z.object({action:z.literal('source'),...selected}).strict(),
 z.object({action:z.literal('submit'),...selected,documentBase64:z.string().min(4).max(1398104),issuerReceipt:z.record(z.string(),z.unknown()).nullable()}).strict(),
 z.object({action:z.literal('read'),decisionId:uuid}).strict(),z.object({action:z.literal('review'),decisionId:uuid,outcome:z.enum(['approve','hold','reject']),reason:z.string().trim().min(1).max(4000)}).strict(),
 z.object({action:z.literal('revoke'),decisionId:uuid,reason:z.string().trim().min(1).max(4000)}).strict(),z.object({action:z.literal('purge'),decisionId:uuid}).strict(),
])
export async function POST(request:NextRequest){return retentionHttp(['ediel.retention.invoice_copy_evidence'],async scope=>{
 const body=input.parse(await readRetentionJson(request,1500000)),op=body.action==='capture'||body.action==='submit'?'ediel.retention.submit':body.action==='purge'?'ediel.retention.purge':'ediel.retention.review'
 if(['basis','read','source'].includes(body.action)?!scope.permissions.some(p=>p==='ediel.retention.read'||p==='ediel.retention.review'):!scope.permissions.includes(op))throw Error('invoice_file_current_operation_required')
 let result:unknown
 if(body.action==='capture')result=await registerInvoiceFileSource({companyId:scope.companyId,...body})
 else if(body.action==='basis')result=await inspectInvoiceFileRetention({companyId:scope.companyId,...body})
 else if(body.action==='source')result=await invoiceFileRetentionCall(scope.companyId,'ediel_read_invoice_file_source_v1',{p_retention_class:body.retentionClass,p_target_id:body.targetId})
 else if(body.action==='submit'){
  if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body.documentBase64))throw new SyntaxError('canonical_base64_required')
  const document=Buffer.from(body.documentBase64,'base64');if(document.toString('base64')!==body.documentBase64)throw new SyntaxError('canonical_base64_required')
  result=await submitInvoiceFileRetention({companyId:scope.companyId,...body,document})
 }else if(body.action==='review')result=await reviewInvoiceFileRetention({companyId:scope.companyId,...body})
 else if(body.action==='purge')result=await purgeInvoiceFileRetention({companyId:scope.companyId,decisionId:body.decisionId})
 else{result=await invoiceFileRetentionCall(scope.companyId,body.action==='read'?'ediel_read_invoice_file_retention_v1':'ediel_revoke_invoice_file_retention_v1',{p_decision_id:body.decisionId,...(body.action==='revoke'?{p_reason:body.reason}:{})});if(body.action==='revoke')result={status:'revoked',decisionId:body.decisionId}}
 return NextResponse.json({data:result},{headers:retentionHeaders})
})}
