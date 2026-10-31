// Syntetiskt, ägt fakturaunderlag + PDF i Storage för CUSTODY01.04 (invoice-file retention). Lokal stack, syntetisk data.
// Härkomst (kopierad, ändrad): scripts/ediel-invoice-file-retention-native.test.ts på 6454d540 (seedQualifiedSyntheticInvoicePdfGiven, policy(),
//   invoicePdfCore(), invoicePdfEffects(), invoicePdfExactBytes(), invoicePdfPhysical404()) samt scripts/helpers/ediel-invoice-file-retention-native-fixture.ts.
// Ändringar: retainUntil kan sättas i framtiden (negativt fall); inga vi.mock här; expect ersatt av kastande kontroller i vissa hjälpare.
// Ersättningssteg (samma som repots native-test): den juridiska utfärdarkompetensen (gridex_ediel_retention.issuers med HMAC-nyckel) och
// billing-/pricing-/export-raderna är explicit syntetiska GIVEN; ingen produktions-signeringsnyckel finns i appens env (inget "app signing helper" hittades).
import { createHash, createHmac, randomUUID } from 'node:crypto'
import { expect } from 'vitest'
import { z } from 'zod'
import { supabaseService } from '@/lib/supabase/service'
import { INVOICE_FILE_CLASSES } from '@/lib/ediel/retention/invoiceFiles.catalog'
import { createCustomerRecordRetentionNativeUser } from '../../../../helpers/ediel-customer-record-retention-native-fixture'
import { nativeSql as sql, literal, seedNormalSwitchNativeFixture } from '../../../../helpers/ediel-normal-switch-native-fixture'

/**
 * HARNESSKOPIA av seedInvoiceFileRetentionNativeFixture() (scripts/helpers/ediel-invoice-file-retention-native-fixture.ts, 6454d540/caf74e395).
 * Skillnad: ett överflödigt ')' sist i SQL-satsen (`... SET status='archived' WHERE id=<company>)`) är borttaget. Originalet ger
 * `ERROR: syntax error at or near ")"` mot psql, så hjälparen kan inte köras; kandidatfynd i testhjälpen, ej produktkod.
 */
const user = createCustomerRecordRetentionNativeUser
async function seedInvoiceFileRetentionNativeFixtureFixed(password?:string){
 const f=await seedNormalSwitchNativeFixture({deferOriginal:true})
 const grants=['ediel.retention.invoice_copy_evidence','ediel.retention.read'],writer=await user(f.companyId,[...grants,'ediel.retention.submit','ediel.retention.review','ediel.retention.purge'],password),readonly=await user(f.companyId,grants,password)
 const invoiceId=randomUUID(),documentId=randomUUID(),path=`companies/${f.companyId}/invoices/${invoiceId}.pdf`
 const original=sql<{path:string}>(`SELECT jsonb_build_object('path',storage_path) FROM public.customer_contract_documents WHERE company_id=${literal(f.companyId)} AND customer_contract_id=${literal(f.contractId)} AND document_sha256=${literal(f.documentSha256)} ORDER BY created_at LIMIT 1`)
 const read=await supabaseService.storage.from('customer-contract-documents').download(original.path);expect(read.error).toBeNull();const pdf=Buffer.from(await read.data!.arrayBuffer());expect(createHash('sha256').update(pdf).digest('hex')).toBe(f.documentSha256)
 const upload=await supabaseService.storage.from('billing-exports').upload(path,pdf,{contentType:'application/pdf',upsert:false});expect(upload.error).toBeNull()
 sql(`INSERT INTO public.customer_invoices(id,company_id,customer_id,status,period_start,period_end,pdf_path,source_system,raw_payload,metadata) VALUES(${literal(invoiceId)},${literal(f.companyId)},${literal(f.customerId)},'draft','2020-01-01','2020-02-01',${literal('billing-exports/'+path)},'SYNTHETIC_UNQUALIFIED_NATIVE_COPY','{}','{}');INSERT INTO public.customer_invoice_documents(id,company_id,invoice_id,customer_id,storage_bucket,file_path,mime_type,document_type,source_system) VALUES(${literal(documentId)},${literal(f.companyId)},${literal(invoiceId)},${literal(f.customerId)},'billing-exports',${literal(path)},'application/pdf','invoice_pdf','SYNTHETIC_UNQUALIFIED_NATIVE_COPY');UPDATE public.customers SET status='archived' WHERE id=${literal(f.customerId)};UPDATE public.companies SET status='archived' WHERE id=${literal(f.companyId)}`)
 const foreignCompanyId=randomUUID();sql(`INSERT INTO public.companies(id,name,status) VALUES(${literal(foreignCompanyId)},'Synthetic foreign PDF copy','archived')`);const foreign=await user(foreignCompanyId,grants,password)
 return {...f,writer,readonly,foreign,foreignCompanyId,invoiceId,documentId,path,sourceHash:createHash('sha256').update(pdf).digest('hex'),byteLength:pdf.length,pdf}
}

export const invoicePdfHash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const uuid = z.string().uuid(), digest = z.string().regex(/^[a-f0-9]{64}$/)
export const capture = z.object({ sourceId: uuid, sourceHash: digest, byteLength: z.number().int().positive(), retentionClass: z.enum(INVOICE_FILE_CLASSES), targetId: uuid, authority: z.literal('none') })
export const basisSchema = z.object({ retentionClass: z.enum(INVOICE_FILE_CLASSES), targetId: uuid, sourceId: uuid, sourceHash: digest, targetHash: digest, scopeHash: digest, storageBucket: z.literal('billing-exports'), storagePath: z.string(), byteLength: z.number().int().positive(), periodStart: z.string(), periodEnd: z.string(), allIncludedScopesClosed: z.literal(true), complete: z.literal(false), authority: z.literal('none') })
export const submitted = z.object({ status: z.literal('submitted'), decisionId: uuid, sourceId: uuid, documentHash: digest, issuerQualified: z.literal(true) })
export const approved = z.object({ status: z.literal('approved'), decisionId: uuid, reviewId: uuid })
export const purged = z.object({ status: z.literal('purged'), sourceId: uuid, sourceHash: digest, byteLength: z.number().int().positive(), bytesAvailable: z.literal(false), replay: z.boolean() })
export const sourceView = z.object({ sourceId: uuid, sourceHash: digest, byteLength: z.number().int().positive(), bytesAvailable: z.literal(false) })

export type InvoicePdfFixture = Awaited<ReturnType<typeof seedQualifiedSyntheticInvoicePdfGiven>>

/** retainUntilOffsetSql: SQL-intervall relativt DB-klockan, t.ex. "-1 minute" (förfallen, tillåter radering) eller "+1 day" (framtida, nekar). */
export async function seedQualifiedSyntheticInvoicePdfGiven(retainUntilOffsetSql = '-1 minute') {
  const f = await seedInvoiceFileRetentionNativeFixtureFixed()
  const reviewer = await createCustomerRecordRetentionNativeUser(f.companyId, ['ediel.retention.invoice_copy_evidence', 'ediel.retention.read', 'ediel.retention.review'])
  const underlayId = randomUUID(), pricingRunId = randomUUID(), exportRunId = randomUUID(), exportItemId = randomUUID(), exportDocumentId = randomUUID(), issuerId = randomUUID()
  const sourceBasis = { kind: 'SYNTHETIC_STORAGE_RETENTION_GIVEN', companyId: f.companyId, customerId: f.customerId, periodStart: '2020-01-01', periodEnd: '2020-02-01', totalKwh: 100, provenance: 'Explicit data GIVEN; no canonical billing/UTILTS/pricing/provider execution claimed' }
  sql(`BEGIN;
 INSERT INTO public.billing_underlays(id,company_id,customer_id,underlay_year,underlay_month,billing_period_start,billing_period_end,status,readiness_status,total_kwh,total_sek_ex_vat,currency,source_system,payload,pricing_snapshot,metadata,created_by)
 VALUES(${literal(underlayId)},${literal(f.companyId)},${literal(f.customerId)},2020,1,'2020-01-01','2020-02-01','validated','ready',100,100,'SEK','SYNTHETIC_STORAGE_RETENTION_GIVEN',${literal(sourceBasis)}::jsonb,'{}',${literal({ synthetic: true, purpose: 'invoice PDF physical-mechanism integration only' })}::jsonb,${literal(f.writer.id)});
 INSERT INTO gridex_billing_source.underlay_bindings(underlay_id,company_id,source_basis,source_basis_hash,exact_total_kwh,actor_user_id)
 VALUES(${literal(underlayId)},${literal(f.companyId)},${literal(sourceBasis)}::jsonb,encode(sha256(convert_to((${literal(sourceBasis)}::jsonb)::text,'UTF8')),'hex'),100,${literal(f.writer.id)});
 INSERT INTO public.pricing_runs(id,company_id,billing_underlay_id,customer_id,billing_period_start,billing_period_end,status,total_ex_vat,vat_amount,total_inc_vat,locked_at,metadata,created_by)
 VALUES(${literal(pricingRunId)},${literal(f.companyId)},${literal(underlayId)},${literal(f.customerId)},'2020-01-01','2020-02-01','locked',100,25,125,clock_timestamp(),${literal({ synthetic: true, purpose: 'locked pricing data GIVEN, not pricing-producer proof' })}::jsonb,${literal(f.writer.id)});
 INSERT INTO public.invoice_export_runs(id,company_id,provider,environment,billing_month,financing_mode,status,total_items,sent_items,total_ex_vat,vat_amount,total_inc_vat,requested_by,finished_at,metadata)
 VALUES(${literal(exportRunId)},${literal(f.companyId)},'manual','test','2020-01','manual','sent',1,1,100,25,125,${literal(f.writer.id)},clock_timestamp(),${literal({ synthetic: true, providerExecuted: false })}::jsonb);
 INSERT INTO public.invoice_export_items(id,company_id,export_run_id,customer_id,billing_underlay_id,pricing_run_id,provider,environment,financing_mode,status,amount_ex_vat,vat_amount,amount_inc_vat,total_kwh,currency,period_start,period_end,metadata)
 VALUES(${literal(exportItemId)},${literal(f.companyId)},${literal(exportRunId)},${literal(f.customerId)},${literal(underlayId)},${literal(pricingRunId)},'manual','test','manual','credited',100,25,125,100,'SEK','2020-01-01','2020-02-01',${literal({ synthetic: true, providerExecuted: false })}::jsonb);
 INSERT INTO public.invoice_documents(id,company_id,invoice_export_item_id,document_type,storage_path,provider_payload)
 VALUES(${literal(exportDocumentId)},${literal(f.companyId)},${literal(exportItemId)},'invoice_pdf',${literal('billing-exports/' + f.path)},${literal({ synthetic: true, providerExecuted: false })}::jsonb);
 UPDATE public.customer_invoices SET billing_underlay_id=${literal(underlayId)},status='paid',amount_ex_vat=100,vat_amount=25,amount_inc_vat=125,total_kwh=100,currency='SEK' WHERE id=${literal(f.invoiceId)} AND company_id=${literal(f.companyId)};
 COMMIT;`)
  const key = Buffer.from('SYNTHETIC invoice PDF competence only ' + randomUUID()), legal = Buffer.from('SYNTHETIC invoice PDF CODE policy competence; no actual legal issuer or fiscal year asserted')
  sql(`BEGIN;SET LOCAL ROLE gridex_ediel_retention_owner;
 INSERT INTO gridex_ediel_retention.issuers(id,company_id,legal_reference,legal_evidence,legal_hash,signing_key,valid_from,valid_to)
 VALUES(${literal(issuerId)},${literal(f.companyId)},'SYNTHETIC invoice PDF competence only',decode(${literal(legal.toString('hex'))},'hex'),${literal(invoicePdfHash(legal))},decode(${literal(key.toString('hex'))},'hex'),clock_timestamp()-interval '1 day',clock_timestamp()+interval '1 day');COMMIT;`)
  const siblingPath = `companies/${f.companyId}/invoices/sibling-${randomUUID()}.pdf`
  const siblingUpload = await supabaseService.storage.from('billing-exports').upload(siblingPath, f.pdf, { contentType: 'application/pdf', upsert: false })
  if (siblingUpload.error) throw siblingUpload.error
  const original = sql<{ path: string }>(`SELECT jsonb_build_object('path',storage_path) FROM public.customer_contract_documents WHERE company_id=${literal(f.companyId)} AND customer_contract_id=${literal(f.contractId)} AND document_sha256=${literal(f.documentSha256)} ORDER BY created_at LIMIT 1`)
  const targets = [
    { retentionClass: 'customer_invoice_document_pdf_bytes', targetId: f.documentId },
    { retentionClass: 'invoice_export_document_pdf_bytes', targetId: exportDocumentId },
    { retentionClass: 'customer_invoice_pdf_bytes', targetId: f.invoiceId },
  ] satisfies { retentionClass: typeof INVOICE_FILE_CLASSES[number]; targetId: string }[]
  const policy = (basis: z.infer<typeof basisSchema>, document: Buffer) => {
    // DB-klockan, inte väggklockan. retainUntil styr om raderingen är tillåten.
    const times = sql<{ issuedAt: string; expiresAt: string; retainUntil: string; journalRetainUntil: string }>(`SELECT jsonb_build_object('issuedAt',clock_timestamp()-interval '1 minute','expiresAt',clock_timestamp()+interval '1 hour','retainUntil',clock_timestamp()+interval '${retainUntilOffsetSql}','journalRetainUntil',clock_timestamp()+interval '1 hour')`)
    const payload = Buffer.from(JSON.stringify({ format: 'ediel_invoice_file_retention_policy_v1', ...basis, companyId: f.companyId, operation: 'delete_storage_pdf', documentHash: invoicePdfHash(document), issuerLegalReference: 'SYNTHETIC invoice PDF competence only', legalBasisReference: 'SYNTHETIC exact copy CODE workflow', journalPurposeReference: 'SYNTHETIC finite continuity of exact source hash', accessRevocationRequired: true, ...times }))
    return { issuerId, payloadBase64: payload.toString('base64'), signatureHex: createHmac('sha256', key).update(payload).digest('hex') }
  }
  return { ...f, reviewer, underlayId, pricingRunId, exportRunId, exportItemId, exportDocumentId, siblingPath, originalPath: original.path, targets, policy }
}

/** Fullständiga finansrader (belopp, perioder, status, hashar) som måste vara oförändrade av raderingen. */
export function invoicePdfCore(f: InvoicePdfFixture) {
  return sql<Record<string, unknown>>(`SELECT jsonb_build_object(
 'invoice',(SELECT to_jsonb(x) FROM public.customer_invoices x WHERE id=${literal(f.invoiceId)} AND company_id=${literal(f.companyId)}),
 'customerDocument',(SELECT to_jsonb(x) FROM public.customer_invoice_documents x WHERE id=${literal(f.documentId)} AND company_id=${literal(f.companyId)}),
 'underlay',(SELECT to_jsonb(x) FROM public.billing_underlays x WHERE id=${literal(f.underlayId)} AND company_id=${literal(f.companyId)}),
 'binding',(SELECT to_jsonb(x) FROM gridex_billing_source.underlay_bindings x WHERE underlay_id=${literal(f.underlayId)} AND company_id=${literal(f.companyId)}),
 'pricing',(SELECT to_jsonb(x) FROM public.pricing_runs x WHERE id=${literal(f.pricingRunId)} AND company_id=${literal(f.companyId)}),
 'exportRun',(SELECT to_jsonb(x) FROM public.invoice_export_runs x WHERE id=${literal(f.exportRunId)} AND company_id=${literal(f.companyId)}),
 'exportItem',(SELECT to_jsonb(x) FROM public.invoice_export_items x WHERE id=${literal(f.exportItemId)} AND company_id=${literal(f.companyId)}),
 'exportDocument',(SELECT to_jsonb(x) FROM public.invoice_documents x WHERE id=${literal(f.exportDocumentId)} AND company_id=${literal(f.companyId)}))`)
}

export function invoicePdfEffects(f: InvoicePdfFixture) {
  return sql<{ tombstones: { sourceId: string; decisionId: string; actorId: string }[]; events: { sourceId: string; kind: string; actorId: string }[] }>(`SELECT jsonb_build_object(
 'tombstones',(SELECT coalesce(jsonb_agg(jsonb_build_object('sourceId',source_id,'decisionId',decision_id,'actorId',actor_user_id) ORDER BY source_id),'[]') FROM gridex_ediel_retention.invoice_file_tombstones WHERE company_id=${literal(f.companyId)}),
 'events',(SELECT coalesce(jsonb_agg(jsonb_build_object('sourceId',e.source_id,'kind',e.kind,'actorId',e.actor_user_id) ORDER BY e.source_id,e.kind),'[]') FROM gridex_ediel_retention.invoice_file_events e JOIN gridex_ediel_retention.invoice_file_sources s ON s.id=e.source_id WHERE s.company_id=${literal(f.companyId)}))`)
}

export async function storageBytes(path: string, bucket = 'billing-exports'): Promise<Buffer | null> {
  const read = await supabaseService.storage.from(bucket).download(path)
  if (read.error || !read.data) return null
  return Buffer.from(await read.data.arrayBuffer())
}
export async function expectExactBytes(path: string, expected: Buffer, bucket = 'billing-exports') {
  const bytes = await storageBytes(path, bucket)
  expect(bytes, `objektet ${bucket}/${path} finns`).not.toBeNull()
  expect(invoicePdfHash(bytes!)).toBe(invoicePdfHash(expected))
}
export async function expectPhysical404(path: string, bucket = 'billing-exports') {
  const read = await supabaseService.storage.from(bucket).download(path)
  expect(read.data).toBeNull()
  expect(read.error).not.toBeNull()
  expect(read.error !== null && 'statusCode' in read.error && String(read.error.statusCode)).toBe('404')
}
export const storageObjectCount = (path: string, bucket = 'billing-exports') => sql<number>(`SELECT to_jsonb(count(*)) FROM storage.objects WHERE bucket_id=${literal(bucket)} AND name=${literal(path)}`)
