import 'server-only'
import { createHash } from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'
import { strictIsoDate } from '@/lib/time/stockholm'
import type { CustomerPortalContext } from '@/lib/customer-portal/types'

const canonicalFormat = 'gridex_customer_group_invoice_v1'
const priceSeriesFormat = 'gridex_customer_price_series_invoice_test_v1'
const utcInstant = /^(\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d)(?:\.(\d{1,6}))?(?:Z|\+00:00)$/
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

type InvoiceDocumentFields = {
  invoiceReference: string
  invoiceNumber: string
  issuedDate: string
  dueDate: string
  currency: string
  quantityKwh: string
  amountExVat: string
  vatAmount: string
  amountIncVat: string
}

type Document = InvoiceDocumentFields & { format: typeof canonicalFormat; sites: ConsolidatedInvoiceSite[] }

type PriceSeriesPeriod = Omit<ConsolidatedInvoiceSite, 'periodStart' | 'periodEnd'> & {
  periodStartAt: string
  periodEndExclusiveAt: string
  periodStartDate: string
  periodEndExclusiveDate: string
  lastIncludedDate: string
}

type PriceSeriesDocument = InvoiceDocumentFields & {
  format: typeof priceSeriesFormat
  environment: 'test'
  periods: PriceSeriesPeriod[]
}

type Result<D> =
  | { kind: 'ready'; document: D; bytes: Uint8Array<ArrayBuffer> }
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

function isCivilDate(value: unknown): value is string {
  if (!matches(value, date)) return false
  try {
    return strictIsoDate(value) === value
  } catch {
    return false
  }
}

function utcOrderKey(value: unknown): string | null {
  const match = typeof value === 'string' ? utcInstant.exec(value) : null
  if (!match || !isCivilDate(match[1].slice(0, 10))) return null
  return `${match[1]}.${(match[2] ?? '').padEnd(6, '0')}`
}

function isPriceSeriesPeriod(period: Partial<PriceSeriesPeriod> | null): period is PriceSeriesPeriod {
  const start = utcOrderKey(period?.periodStartAt)
  const end = utcOrderKey(period?.periodEndExclusiveAt)
  return Boolean(period && start && end && start < end &&
    isCivilDate(period.periodStartDate) && isCivilDate(period.periodEndExclusiveDate) && isCivilDate(period.lastIncludedDate) &&
    period.periodStartDate <= period.lastIncludedDate && period.lastIncludedDate <= period.periodEndExclusiveDate &&
    typeof period.facilityReference === 'string' && period.facilityReference.trim() &&
    matches(period.sourceReference, /^invoice_source_[A-Za-z0-9_-]{32}$/) && matches(period.priceArea, /^SE[1-4]$/) &&
    [period.quantityKwh, period.amountExVat, period.vatAmount, period.amountIncVat].every(amount => matches(amount, decimal)) &&
    Array.isArray(period.pricing) && period.pricing.length > 0 && period.pricing.every(isPrice))
}

function isPriceSeriesDocument(value: Partial<PriceSeriesDocument> | null): value is PriceSeriesDocument {
  if (!value || value.format !== priceSeriesFormat || value.environment !== 'test' ||
    typeof value.invoiceReference !== 'string' || !value.invoiceReference.trim() ||
    typeof value.invoiceNumber !== 'string' || !value.invoiceNumber.trim() ||
    !isCivilDate(value.issuedDate) || !isCivilDate(value.dueDate) || !matches(value.currency, /^[A-Z]{3}$/) ||
    ![value.quantityKwh, value.amountExVat, value.vatAmount, value.amountIncVat].every(amount => matches(amount, decimal)) ||
    !Array.isArray(value.periods) || value.periods.length < 2 || !value.periods.every(isPriceSeriesPeriod)) return false
  if (new Set(value.periods.map(period => period.facilityReference)).size !== 1 ||
    new Set(value.periods.map(period => period.sourceReference)).size !== value.periods.length) return false
  return value.periods.every((period, index, periods) => index === 0 ||
    utcOrderKey(periods[index - 1].periodEndExclusiveAt)! <= utcOrderKey(period.periodStartAt)!)
}

type InvoiceDocumentContext = Pick<CustomerPortalContext, 'companyId' | 'customerIds'>

async function readInvoiceDocument<D>(
  context: InvoiceDocumentContext,
  invoiceId: string,
  decode: (value: unknown) => D | null,
): Promise<Result<D>> {
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
    const document = decode(JSON.parse(bytes.toString('utf8')))
    if (document) return { kind: 'ready', document, bytes: new Uint8Array(bytes) }
  } catch {
    return { kind: 'unavailable' }
  }
  return { kind: 'unavailable' }
}

function decodeGroup(value: unknown): Document | null {
  return isDocument(value as Partial<Document> | null) ? value as Document : null
}

function decodePriceSeries(value: unknown): PriceSeriesDocument | null {
  return isPriceSeriesDocument(value as Partial<PriceSeriesDocument> | null) ? value as PriceSeriesDocument : null
}

export function readConsolidatedInvoiceDocument(context: InvoiceDocumentContext, invoiceId: string) {
  return readInvoiceDocument(context, invoiceId, decodeGroup)
}

export function readPriceSeriesInvoiceDocument(context: InvoiceDocumentContext, invoiceId: string) {
  return readInvoiceDocument(context, invoiceId, decodePriceSeries)
}

export function readIssuedInvoiceUnderlay(context: InvoiceDocumentContext, invoiceId: string) {
  return readInvoiceDocument(context, invoiceId, value => decodeGroup(value) ?? decodePriceSeries(value))
}
