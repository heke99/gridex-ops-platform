'use server'
import {NextRequest} from 'next/server'
import {revalidatePath} from 'next/cache'
import {POST} from '@/app/api/ediel/invoice-file-retention/route'
export type InvoiceFileActionState={status:string;message:string;result?:string}
export async function invoiceFileRetentionAction(_previous:InvoiceFileActionState,form:FormData):Promise<InvoiceFileActionState>{
 try{
  const action=String(form.get('action')??''),body:Record<string,unknown>={action}
  if(['capture','basis','source','submit'].includes(action)){body.retentionClass=form.get('retention_class');body.targetId=form.get('target_id')}else body.decisionId=form.get('decision_id')
  if(action==='submit'){const file=form.get('document');if(!(file instanceof File)||file.size<1||file.size>1048576)throw Error('invoice_policy_limit');body.documentBase64=Buffer.from(await file.arrayBuffer()).toString('base64');const receipt=String(form.get('issuer_receipt')??'').trim();if(receipt.length>32768)throw Error('invoice_receipt_limit');body.issuerReceipt=receipt?JSON.parse(receipt):null}
  if(action==='review'){body.outcome=form.get('outcome');body.reason=form.get('reason')}if(action==='revoke')body.reason=form.get('reason')
  const response=await POST(new NextRequest('http://internal.invalid/api/ediel/invoice-file-retention',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}))
  if(!response.ok)throw Error('invoice_file_operation_held')
  const data=(await response.json()).data as Record<string,unknown>;revalidatePath('/retention/invoice-files')
  return {status:typeof data.status==='string'?data.status:'captured',message:data.status==='purged'?'Den valda kopians Storage-delete och HTTP404 är verifierade. Ursprunglig hash och identitet är bevarade.':data.status==='held'?'Källan, aktuell separat juridisk granskning eller tidsvillkoren håller åtgärden spärrad.':'Det källbundna resultatet är registrerat. Källintag eller arkivering ger inget gallringsgodkännande.',result:JSON.stringify(data,null,2)}
 }catch{return {status:'unavailable',message:'Åtgärden är spärrad: aktuell bolags-, klass-, käll- eller beslutsbehörighet kunde inte kvalificeras.'}}
}
