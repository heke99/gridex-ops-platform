export const INVOICE_FILE_CATALOG=[
 {retentionClass:'customer_invoice_document_pdf_bytes',sourceTable:'public.customer_invoice_documents',sourceColumn:'file_path',label:'Kundfakturans dokument-PDF'},
 {retentionClass:'invoice_export_document_pdf_bytes',sourceTable:'public.invoice_documents',sourceColumn:'storage_path',label:'Fakturaexportens dokument-PDF'},
 {retentionClass:'customer_invoice_pdf_bytes',sourceTable:'public.customer_invoices',sourceColumn:'pdf_path',label:'Kundfakturans separata PDF-referens'},
] as const
export const INVOICE_FILE_CLASSES=INVOICE_FILE_CATALOG.map(row=>row.retentionClass) as [typeof INVOICE_FILE_CATALOG[number]['retentionClass'],...typeof INVOICE_FILE_CATALOG[number]['retentionClass'][]]
export type InvoiceFileClass=typeof INVOICE_FILE_CATALOG[number]['retentionClass']
export const INVOICE_FILE_BUCKETS=['customer-documents','customer-contract-documents','contract-pdfs','billing-exports'] as const
