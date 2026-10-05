import { createHash } from 'node:crypto'
import { emitDomainEvent } from '@/lib/events/domainEvents'
import {
  approval,
  assertItemStillReady,
  loadItemContext,
  maybeLockCompleteMonth,
  updateLegacyProjection,
} from '@/lib/billing/invoiceApprovedDispatch'
import { InvoiceProviderConfigError, requireTenantInvoiceProvider, rpcError } from '@/lib/billing/providers/registry'
import { buildXlsxWorkbook } from '@/lib/billing/xlsx'
import { assertOutboundAllowed } from '@/lib/platform/outboundFreeze'
import { supabaseService } from '@/lib/supabase/service'
import { tenantDb } from '@/lib/supabase/tenantDb'
import { tenantSelect } from '@/lib/supabase/tenantQuery'
import { requireCompanyOperationalForWrites } from '@/lib/tenant/governance'

/**
 * Invoice file export: for tenants whose invoice provider reads a file instead of an API.
 * Approved invoices pass the same readiness checks as an API send, are written as rows into one
 * immutable file (invoice_export_files) and are marked sent in the same transaction. The file is
 * always rendered from the stored rows, so every download of a file is identical.
 */
export const INVOICE_FILE_FORMAT_VERSION = 'gridex_invoice_file_v1'
export type InvoiceFileFormat = 'csv' | 'xlsx' | 'json'

type Row = Record<string, unknown>

export type InvoiceFileRow = {
  invoice_export_item_id: string
  invoice_number: string
  customer_number: string | null
  customer_name: string
  customer_type: 'private' | 'business'
  identity_number: string | null
  recipient: string | null
  email: string | null
  reference: string | null
  street: string | null
  postal_code: string | null
  city: string | null
  country: string | null
  billing_month: string
  period_start: string | null
  period_end: string | null
  price_area: string | null
  kwh: number
  amount_ex_vat: number
  vat_amount: number
  amount_inc_vat: number
  currency: string
  invoice_date: string
  due_date: string
  lines: Array<{ description: string; quantity: number | null; unit: string | null; unit_price_ex_vat: number | null; amount_ex_vat: number }>
}

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function num(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function money(value: unknown) {
  return Math.round((num(value) ?? 0) * 100) / 100
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Row)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export function rowsSha256(rows: InvoiceFileRow[]) {
  return createHash('sha256').update(stableJson(rows)).digest('hex')
}

function stockholmDate(date: Date) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

/** Same default payment term as the API send (20 days). */
export const INVOICE_FILE_PAYMENT_DAYS = 20

export function invoiceDates(now: Date) {
  const due = new Date(now.getTime() + INVOICE_FILE_PAYMENT_DAYS * 86_400_000)
  return { invoiceDate: stockholmDate(now), dueDate: stockholmDate(due) }
}

function customerName(customer: Row) {
  return text(customer.name)
    ?? text(customer.company_name)
    ?? ([text(customer.first_name), text(customer.last_name)].filter(Boolean).join(' ') || 'Okänd kund')
}

export function buildInvoiceFileRow(input: {
  item: Row
  invoice: Row
  customer: Row
  underlay: Row
  lines: Row[]
  legacyItem: Row | null
  billingMonth: string
  now: Date
}): InvoiceFileRow {
  const itemId = text(input.item.id)
  if (!itemId) throw new Error('Fakturaposten saknar ID.')
  const business = text(input.customer.customer_type) === 'business' || Boolean(text(input.customer.org_number))
  const address = (input.legacyItem?.invoice_address_snapshot ?? {}) as Row
  const { invoiceDate, dueDate } = invoiceDates(input.now)
  return {
    invoice_export_item_id: itemId,
    invoice_number: text(input.invoice.invoice_number) ?? `GX-${input.billingMonth.replace('-', '')}-${itemId.slice(0, 8).toUpperCase()}`,
    customer_number: text(input.customer.customer_number),
    customer_name: customerName(input.customer),
    customer_type: business ? 'business' : 'private',
    identity_number: business ? text(input.customer.org_number) : text(input.customer.personal_number),
    recipient: text(address.recipient) ?? text(input.legacyItem?.invoice_recipient),
    email: text(address.email) ?? text(input.legacyItem?.invoice_email),
    reference: text(address.reference) ?? text(input.legacyItem?.invoice_reference),
    street: text(address.street),
    postal_code: text(address.postal_code),
    city: text(address.city),
    country: text(address.country) ?? 'SE',
    billing_month: input.billingMonth,
    period_start: text(input.item.period_start),
    period_end: text(input.item.period_end),
    price_area: text(input.invoice.price_area_code) ?? text(input.underlay.price_area),
    kwh: num(input.item.total_kwh) ?? 0,
    amount_ex_vat: money(input.item.amount_ex_vat),
    vat_amount: money(input.item.vat_amount),
    amount_inc_vat: money(input.item.amount_inc_vat),
    currency: text(input.item.currency) ?? 'SEK',
    invoice_date: invoiceDate,
    due_date: dueDate,
    lines: input.lines
      .filter((line) => text(line.description))
      .map((line) => ({
        description: text(line.description) as string,
        quantity: num(line.quantity),
        unit: text(line.unit),
        unit_price_ex_vat: num(line.unit_price_ex_vat) ?? num(line.unit_price),
        amount_ex_vat: money(line.amount_ex_vat),
      })),
  }
}

async function loadSelection(companyId: string) {
  const { data, error } = await tenantDb(companyId)
    .unscoped()
    .from('companies')
    .select('invoice_export_target_system,billing_provider_environment,invoice_export_enabled')
    .eq('id', companyId)
    .maybeSingle()
  if (error) throw error
  const row = (data ?? {}) as Row
  const selected = requireTenantInvoiceProvider(row)
  if (selected.provider !== 'file_export') {
    throw new InvoiceProviderConfigError('invoice_file_provider_not_active', 'Bolaget skickar fakturor via API, inte via fil.')
  }
  if (row.invoice_export_enabled !== true) {
    throw new InvoiceProviderConfigError('invoice_file_provider_not_active', 'Filexport är inte aktiverad för bolaget.')
  }
  return selected
}

/** Approved, unsent invoices for the month that belong in the next file. */
export async function listInvoiceFileCandidates(companyId: string, billingMonth: string, environment: string) {
  const runs = await tenantSelect(companyId, 'invoice_export_runs', 'id')
    .eq('billing_month', billingMonth)
    .eq('provider', 'file_export')
    .eq('environment', environment)
  if (runs.error) throw runs.error
  const runIds = ((runs.data ?? []) as unknown as Row[]).map((row) => text(row.id)).filter((id): id is string => Boolean(id))
  const items: Row[] = []
  for (let offset = 0; offset < runIds.length; offset += 200) {
    const result = await tenantSelect(companyId, 'invoice_export_items', 'id,export_run_id,metadata,status,export_file_id')
      .in('export_run_id', runIds.slice(offset, offset + 200))
      .eq('status', 'pending')
      .is('export_file_id', null)
      .order('created_at', { ascending: true })
    if (result.error) throw result.error
    items.push(...((result.data ?? []) as unknown as Row[]))
  }
  return items.filter((item) => approval(item.metadata).status === 'approved')
}

export async function createInvoiceFile(input: { companyId: string; billingMonth: string; actorUserId: string; now?: Date }) {
  await requireCompanyOperationalForWrites(input.companyId)
  await assertOutboundAllowed({ companyId: input.companyId, channel: 'invoice_export' })
  const selected = await loadSelection(input.companyId)
  const candidates = await listInvoiceFileCandidates(input.companyId, input.billingMonth, selected.environment)
  if (candidates.length === 0) throw new InvoiceProviderConfigError('invoice_file_empty', 'Det finns inga godkända fakturor att lägga i en fil.')

  const now = input.now ?? new Date()
  const rows: InvoiceFileRow[] = []
  const runByItem = new Map<string, string>()
  for (const candidate of candidates) {
    const itemId = text(candidate.id) as string
    const context = await loadItemContext(input.companyId, itemId)
    // Same checks as an API send: the invoice must still match its underlay and locked pricing.
    await assertItemStillReady(context)
    const legacy = await tenantSelect(input.companyId, 'billing_export_run_items', 'invoice_recipient,invoice_email,invoice_reference,invoice_address_snapshot')
      .eq('id', itemId)
      .maybeSingle()
    if (legacy.error) throw legacy.error
    rows.push(buildInvoiceFileRow({
      item: context.item,
      invoice: context.invoice,
      customer: context.customer,
      underlay: context.underlay,
      lines: context.lines,
      legacyItem: (legacy.data ?? null) as Row | null,
      billingMonth: input.billingMonth,
      now,
    }))
    runByItem.set(itemId, text(context.run.id) as string)
  }

  const sha = rowsSha256(rows)
  const { data: fileId, error } = await supabaseService.rpc('gridex_create_invoice_export_file_v1', {
    p_company_id: input.companyId,
    p_billing_month: input.billingMonth,
    p_environment: selected.environment,
    p_actor_user_id: input.actorUserId,
    p_rows: rows,
    p_rows_sha256: sha,
  })
  if (error) throw rpcError(error)

  for (const row of rows) {
    const runId = runByItem.get(row.invoice_export_item_id) as string
    await updateLegacyProjection({ companyId: input.companyId, runId, itemId: row.invoice_export_item_id, status: 'sent' })
    await emitDomainEvent({
      companyId: input.companyId,
      eventType: 'invoice.sent',
      aggregateType: 'invoice_export_item',
      aggregateId: row.invoice_export_item_id,
      actorUserId: input.actorUserId,
      source: 'invoice_file_export_v1',
      payload: { invoice_file_id: fileId, billing_month: input.billingMonth, amount_inc_vat: row.amount_inc_vat, due_date: row.due_date },
      idempotencyKey: `invoice-sent:${row.invoice_export_item_id}:file:${fileId}`,
    }).catch(() => null)
  }
  const lastRun = runByItem.get(rows[rows.length - 1].invoice_export_item_id) as string
  await maybeLockCompleteMonth({ companyId: input.companyId, billingMonth: input.billingMonth, actorUserId: input.actorUserId, exportRunId: lastRun })
  return { fileId: String(fileId), rowCount: rows.length, sha256: sha }
}

export type InvoiceFileRecord = {
  id: string
  billing_month: string
  environment: string
  row_count: number
  total_inc_vat: number
  rows_sha256: string
  created_at: string
}

export async function listInvoiceFiles(companyId: string, limit = 24) {
  const { data, error } = await tenantSelect(companyId, 'invoice_export_files', 'id,billing_month,environment,row_count,total_inc_vat,rows_sha256,created_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as unknown as InvoiceFileRecord[]
}

export async function loadInvoiceFile(companyId: string, fileId: string) {
  const { data, error } = await tenantSelect(companyId, 'invoice_export_files', 'id,billing_month,environment,row_count,total_inc_vat,rows,rows_sha256,created_at')
    .eq('id', fileId)
    .maybeSingle()
  if (error) throw error
  return (data ?? null) as unknown as (InvoiceFileRecord & { rows: InvoiceFileRow[] }) | null
}

const CSV_COLUMNS: Array<[keyof InvoiceFileRow, string]> = [
  ['invoice_number', 'Fakturanummer'],
  ['customer_number', 'Kundnummer'],
  ['customer_name', 'Kundnamn'],
  ['customer_type', 'Kundtyp'],
  ['identity_number', 'Person-/organisationsnummer'],
  ['recipient', 'Fakturamottagare'],
  ['email', 'Faktura-e-post'],
  ['reference', 'Referens'],
  ['street', 'Gatuadress'],
  ['postal_code', 'Postnummer'],
  ['city', 'Ort'],
  ['country', 'Land'],
  ['billing_month', 'Fakturamånad'],
  ['period_start', 'Period från'],
  ['period_end', 'Period till'],
  ['price_area', 'Elområde'],
  ['kwh', 'Förbrukning kWh'],
  ['amount_ex_vat', 'Belopp exkl moms'],
  ['vat_amount', 'Moms'],
  ['amount_inc_vat', 'Belopp inkl moms'],
  ['currency', 'Valuta'],
  ['invoice_date', 'Fakturadatum'],
  ['due_date', 'Förfallodatum'],
  ['invoice_export_item_id', 'Gridex-ID'],
]

function csvCell(value: unknown) {
  if (value === null || value === undefined) return ''
  const raw = String(value)
  // Guard against spreadsheet formula injection from customer-entered text.
  const safe = /^[=+\-@\t\r]/.test(raw) && typeof value === 'string' ? `'${raw}` : raw
  return /[;"\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export function renderInvoiceFile(file: { id: string; billing_month: string; rows: InvoiceFileRow[]; rows_sha256: string; created_at: string }, format: InvoiceFileFormat) {
  const base = `fakturor-${file.billing_month}-${file.id.slice(0, 8)}`
  if (format === 'json') {
    return {
      fileName: `${base}.json`,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ format: INVOICE_FILE_FORMAT_VERSION, file_id: file.id, billing_month: file.billing_month, created_at: file.created_at, rows_sha256: file.rows_sha256, invoices: file.rows }, null, 2),
    }
  }
  if (format === 'xlsx') {
    const headers = CSV_COLUMNS.map(([, label]) => label)
    const rows = file.rows.map((row) => Object.fromEntries(CSV_COLUMNS.map(([key, label]) => [label, row[key] as unknown])))
    return {
      fileName: `${base}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      body: buildXlsxWorkbook(headers, rows),
    }
  }
  const lines = [
    CSV_COLUMNS.map(([, label]) => csvCell(label)).join(';'),
    ...file.rows.map((row) => CSV_COLUMNS.map(([key]) => csvCell(row[key])).join(';')),
  ]
  return {
    fileName: `${base}.csv`,
    contentType: 'text/csv; charset=utf-8',
    body: `﻿${lines.join('\r\n')}\r\n`,
  }
}

export function parseInvoiceFileFormat(value: string | null): InvoiceFileFormat {
  return value === 'xlsx' || value === 'json' ? value : 'csv'
}
