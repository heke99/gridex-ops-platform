import 'server-only'
import { createHash } from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'
import type { CustomerPortalContext } from '@/lib/customer-portal/types'

const canonicalFormat = 'gridex_customer_group_invoice_v1'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const decimal = /^-?\d+(?:\.\d+)?$/
const date = /^\d{4}-\d{2}-\d{2}$/

type Price = {
  description: string
  quantity: string | null
  unit: string | null
  unitPriceExVat: string | null
  exVat: string
  vat: string
  total: string
}

export type ConsolidatedInvoiceSite = {
  facilityReference: string
  sourceReference: string
  periodStart: string
  periodEnd: string
  priceArea: string
  quantityKwh: string
  amountExVat: string
  vatAmount: string
  amountIncVat: string
  pricing: Price[]
}

type Document = {
  format: typeof canonicalFormat
  invoiceReference: string
  invoiceNumber: string
  issuedDate: string
  dueDate: string
  currency: string
  quantityKwh: string
  amountExVat: string
  vatAmount: string
  amountIncVat: string
  sites: ConsolidatedInvoiceSite[]
}

type Result =
  | { kind: 'ready'; document: Document; bytes: Uint8Array<ArrayBuffer> }
  | { kind: 'retired' | 'missing' | 'unavailable' }

function matches(value: unknown, pattern: RegExp): value is string {
  return typeof value === 'string' && pattern.test(value)
}

function isPrice(value: Partial<Price> | null): value is Price {
  return Boolean(value && typeof value.description === 'string' && value.description.trim() &&
    (value.unit === null || typeof value.unit === 'string') &&
    [value.quantity, value.unitPriceExVat].every(amount => amount === null || matches(amount, decimal)) &&
    [value.exVat, value.vat, value.total].every(amount => matches(amount, decimal)))
}

function isSite(site: Partial<ConsolidatedInvoiceSite> | null): site is ConsolidatedInvoiceSite {
  return Boolean(site && typeof site.facilityReference === 'string' && site.facilityReference.trim() &&
    matches(site.sourceReference, /^invoice_source_[A-Za-z0-9_-]{32}$/) &&
    matches(site.periodStart, date) && matches(site.periodEnd, date) && site.periodStart < site.periodEnd &&
    matches(site.priceArea, /^SE[1-4]$/) &&
    [site.quantityKwh, site.amountExVat, site.vatAmount, site.amountIncVat].every(amount => matches(amount, decimal)) &&
    Array.isArray(site.pricing) && site.pricing.length > 0 && site.pricing.every(isPrice))
}

function isDocument(value: Partial<Document> | null): value is Document {
  return Boolean(value && value.format === canonicalFormat &&
    typeof value.invoiceReference === 'string' && value.invoiceReference.trim() &&
    typeof value.invoiceNumber === 'string' && value.invoiceNumber.trim() &&
    matches(value.issuedDate, date) && matches(value.dueDate, date) && matches(value.currency, /^[A-Z]{3}$/) &&
    [value.quantityKwh, value.amountExVat, value.vatAmount, value.amountIncVat].every(amount => matches(amount, decimal)) &&
    Array.isArray(value.sites) && value.sites.length >= 2 && value.sites.every(isSite) &&
    new Set(value.sites.map(site => site.sourceReference)).size === value.sites.length)
}

export async function readConsolidatedInvoiceDocument(
  context: Pick<CustomerPortalContext, 'companyId' | 'customerIds'>,
  invoiceId: string,
): Promise<Result> {
  if (!context.companyId || context.customerIds.length === 0 || !uuid.test(invoiceId)) return { kind: 'missing' }
  const { data, error } = await supabaseService.rpc('gridex_read_consolidated_invoice_customer_document_v1', {
    p_company_id: context.companyId,
    p_customer_ids: context.customerIds,
    p_invoice_id: invoiceId,
  })
  if (error) {
    return { kind: error.message === 'portal_customer_retention_access_revoked' ? 'missing' : 'unavailable' }
  }
  if (data === null) return { kind: 'missing' }
  const proof = data as { kind?: string; bodyBase64?: string; sha256?: string }
  if (proof?.kind === 'retired') return { kind: 'retired' }
  if (proof?.kind !== 'ready' || !matches(proof.bodyBase64, /^[A-Za-z0-9+/=\n]+$/) ||
      !matches(proof.sha256, /^[a-f0-9]{64}$/)) return { kind: 'unavailable' }
  const bytes = Buffer.from(proof.bodyBase64, 'base64')
  if (createHash('sha256').update(bytes).digest('hex') !== proof.sha256) return { kind: 'unavailable' }
  try {
    const document = JSON.parse(bytes.toString('utf8')) as Partial<Document> | null
    if (isDocument(document)) return { kind: 'ready', document, bytes: new Uint8Array(bytes) }
  } catch {
    return { kind: 'unavailable' }
  }
  return { kind: 'unavailable' }
}
