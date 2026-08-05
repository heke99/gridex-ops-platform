import { supabaseService } from '@/lib/supabase/service'
import type { CustomerInvoiceStatus } from '@/lib/customer-portal/types'

type PartnerInvoiceLineInput = {
  lineType?: string | null
  description: string
  quantity?: number | null
  unit?: string | null
  unitPrice?: number | null
  amountExVat?: number | null
  vatRate?: number | null
  vatAmount?: number | null
  amountIncVat?: number | null
  metadata?: Record<string, unknown> | null
  sortOrder?: number | null
}

export type PartnerInvoiceUpsertInput = {
  companyId: string
  customerId: string
  agreementId?: string | null
  billingUnderlayId?: string | null
  partnerExportId?: string | null
  partnerInvoiceReference: string
  invoiceNumber?: string | null
  periodStart?: string | null
  periodEnd?: string | null
  totalKwh?: number | null
  amountExVat?: number | null
  vatAmount?: number | null
  amountIncVat?: number | null
  currency?: string | null
  dueDate?: string | null
  issuedAt?: string | null
  paidAt?: string | null
  status?: CustomerInvoiceStatus | string | null
  pdfPath?: string | null
  pdfUrl?: string | null
  sourceSystem?: string | null
  rawPayload?: Record<string, unknown> | null
  lines?: PartnerInvoiceLineInput[] | null
}

function normalizeStatus(status?: string | null): CustomerInvoiceStatus {
  if (
    status === 'draft' ||
    status === 'issued' ||
    status === 'sent' ||
    status === 'paid' ||
    status === 'overdue' ||
    status === 'cancelled' ||
    status === 'credited' ||
    status === 'failed'
  ) {
    return status
  }

  return 'issued'
}


function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function normalizedPartnerInvoiceLine(
  companyId: string,
  invoiceId: string,
  line: PartnerInvoiceLineInput,
  index: number,
) {
  const amountExVat = line.amountExVat ?? null
  const vatRate = line.vatRate ?? null
  const vatAmount =
    line.vatAmount ??
    (amountExVat !== null && vatRate !== null
      ? roundMoney(amountExVat * vatRate)
      : null)
  const amountIncVat =
    line.amountIncVat ??
    (amountExVat !== null && vatAmount !== null
      ? roundMoney(amountExVat + vatAmount)
      : null)

  return {
    company_id: companyId,
    invoice_id: invoiceId,
    line_type: line.lineType ?? 'energy',
    description: line.description,
    quantity: line.quantity ?? null,
    unit: line.unit ?? null,
    unit_price: line.unitPrice ?? null,
    amount_ex_vat: amountExVat,
    vat_rate: vatRate,
    vat_amount: vatAmount,
    amount_inc_vat: amountIncVat,
    metadata: line.metadata ?? {},
    sort_order: line.sortOrder ?? index + 1,
  }
}

export async function upsertPartnerCustomerInvoice(input: PartnerInvoiceUpsertInput) {
  const { data: invoice, error } = await supabaseService
    .from('customer_invoices')
    .upsert(
      {
        company_id: input.companyId,
        customer_id: input.customerId,
        agreement_id: input.agreementId ?? null,
        billing_underlay_id: input.billingUnderlayId ?? null,
        partner_export_id: input.partnerExportId ?? null,
        partner_invoice_reference: input.partnerInvoiceReference,
        invoice_number: input.invoiceNumber ?? null,
        period_start: input.periodStart ?? null,
        period_end: input.periodEnd ?? null,
        total_kwh: input.totalKwh ?? null,
        amount_ex_vat: input.amountExVat ?? null,
        vat_amount: input.vatAmount ?? null,
        amount_inc_vat: input.amountIncVat ?? null,
        currency: input.currency ?? 'SEK',
        due_date: input.dueDate ?? null,
        issued_at: input.issuedAt ?? null,
        paid_at: input.paidAt ?? null,
        status: normalizeStatus(input.status),
        pdf_path: input.pdfPath ?? null,
        pdf_url: input.pdfUrl ?? null,
        source_system: input.sourceSystem ?? 'partner',
        raw_payload: input.rawPayload ?? {},
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'company_id,partner_invoice_reference' }
    )
    .select('*')
    .single()

  if (error) throw error

  const invoiceId = invoice.id as string

  if (input.lines) {
    const { error: deleteError } = await supabaseService
      .from('customer_invoice_lines')
      .delete()
      .eq('company_id', input.companyId)
      .eq('invoice_id', invoiceId)

    if (deleteError) throw deleteError

    if (input.lines.length > 0) {
      const { error: lineError } = await supabaseService
        .from('customer_invoice_lines')
        .insert(
          input.lines.map((line, index) =>
            normalizedPartnerInvoiceLine(
              input.companyId,
              invoiceId,
              line,
              index,
            ),
          )
        )

      if (lineError) throw lineError
    }
  }

  if (input.pdfPath || input.pdfUrl) {
    const { error: documentError } = await supabaseService
      .from('customer_invoice_documents')
      .upsert(
        {
          invoice_id: invoiceId,
          document_type: 'invoice_pdf',
          title: input.invoiceNumber ? `Faktura ${input.invoiceNumber}` : 'Faktura PDF',
          file_path: input.pdfPath ?? null,
          public_url: input.pdfUrl ?? null,
          source_system: input.sourceSystem ?? 'partner',
        },
        { onConflict: 'invoice_id,document_type' }
      )

    if (documentError) throw documentError
  }

  return invoice
}
