import {createHash,randomUUID} from 'node:crypto'
import {expect} from 'vitest'
import {supabaseService} from '@/lib/supabase/service'
import {seedNormalSwitchNativeFixture,nativeSql as sql,literal} from './ediel-normal-switch-native-fixture'
import {createCustomerRecordRetentionNativeUser as user} from './ediel-customer-record-retention-native-fixture'

/** Genuine publication/signature/PDF/archive and GoTrue/Storage owners. The
 * public manual invoice fixture is explicitly unqualified: no finalized billing
 * source, approved private invoice/retention row or legal issuer is seeded. */
export async function seedInvoiceFileRetentionNativeFixture(password?:string){
 const f=await seedNormalSwitchNativeFixture({deferOriginal:true})
 const grants=['ediel.retention.invoice_copy_evidence','ediel.retention.read'],writer=await user(f.companyId,[...grants,'ediel.retention.submit','ediel.retention.review','ediel.retention.purge'],password),readonly=await user(f.companyId,grants,password)
 const invoiceId=randomUUID(),documentId=randomUUID(),path=`companies/${f.companyId}/invoices/${invoiceId}.pdf`
 const original=sql<{path:string}>(`SELECT jsonb_build_object('path',storage_path) FROM public.customer_contract_documents WHERE company_id=${literal(f.companyId)} AND customer_contract_id=${literal(f.contractId)} AND document_sha256=${literal(f.documentSha256)} ORDER BY created_at LIMIT 1`)
 const read=await supabaseService.storage.from('customer-contract-documents').download(original.path);expect(read.error).toBeNull();const pdf=Buffer.from(await read.data!.arrayBuffer());expect(createHash('sha256').update(pdf).digest('hex')).toBe(f.documentSha256)
 const upload=await supabaseService.storage.from('billing-exports').upload(path,pdf,{contentType:'application/pdf',upsert:false});expect(upload.error).toBeNull()
 sql(`INSERT INTO public.customer_invoices(id,company_id,customer_id,status,period_start,period_end,pdf_path,source_system,raw_payload,metadata) VALUES(${literal(invoiceId)},${literal(f.companyId)},${literal(f.customerId)},'draft','2020-01-01','2020-02-01',${literal('billing-exports/'+path)},'SYNTHETIC_UNQUALIFIED_NATIVE_COPY','{}','{}');INSERT INTO public.customer_invoice_documents(id,company_id,invoice_id,customer_id,storage_bucket,file_path,mime_type,document_type,source_system) VALUES(${literal(documentId)},${literal(f.companyId)},${literal(invoiceId)},${literal(f.customerId)},'billing-exports',${literal(path)},'application/pdf','invoice_pdf','SYNTHETIC_UNQUALIFIED_NATIVE_COPY');UPDATE public.customers SET status='archived' WHERE id=${literal(f.customerId)};UPDATE public.companies SET status='archived' WHERE id=${literal(f.companyId)})`)
 const foreignCompanyId=randomUUID();sql(`INSERT INTO public.companies(id,name,status) VALUES(${literal(foreignCompanyId)},'Synthetic foreign PDF copy','archived')`);const foreign=await user(foreignCompanyId,grants,password)
 return {...f,writer,readonly,foreign,foreignCompanyId,invoiceId,documentId,path,sourceHash:createHash('sha256').update(pdf).digest('hex'),byteLength:pdf.length,pdf}
}
