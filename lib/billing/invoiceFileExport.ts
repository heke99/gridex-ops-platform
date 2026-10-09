import { createHash } from 'node:crypto'
import { emitDomainEvent } from '@/lib/events/domainEvents'
import {
  approval,
  assertItemStillReady,
  loadItemContext,
  maybeLockCompleteMonth,
  updateLegacyProjection,
} from '@/lib/billing/invoiceApprovedDispatch'
import { renderNordfinInvoiceXml } from '@/lib/billing/nordfinInvoiceXml'
import { InvoiceProviderConfigError, isFileProvider, loadNordfinClientId, requireTenantInvoiceProvider, rpcError, type FileProvider } from '@/lib/billing/providers/registry'
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
export type InvoiceFileFormat = 'csv' | 'xlsx' | 'json' | 'nordfin_xml'

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
  lines: Array<{ description: string; quantity: number | null; unit: string | null; unit_price_ex_vat: number | null; amount_ex_vat: number; line_type?: string | null; vat_rate?: number | null; vat_amount?: number | null; amount_inc_vat?: number | null }>
  /** Facility facts for electricity invoices (Nordfin's added fields). */
  electricity?: InvoiceFileElectricity | null
  /** Nordfin client id, fixed when the file is created. */
  nordfin_client_id?: string | null
}

export type InvoiceFileFacility = {
  facility_id: string | null
  metering_point_id: string | null
  site_street: string | null
  site_postal_code: string | null
  site_city: string | null
  price_area: string | null
  grid_area: string | null
  grid_owner: string | null
  period_start: string | null
  period_end: string | null
  consumption_kwh: number
  estimated_annual_kwh: number | null
}

export type InvoiceFileContract = {
  name: string | null
  number: string | null
  type: string | null
  start_date: string | null
  binding_months: number | null
  binding_end_date: string | null
  binding_months_remaining: number | null
  notice_months: number | null
  auto_renew: boolean | null
  fixed_price_ore_per_kwh: number | null
  spot_markup_ore_per_kwh: number | null
  monthly_fee_sek: number | null
}

export type InvoiceFileReconciliation = {
  role: 'credit_preliminary' | 'charge_final'
  reconciled_month: string | null
  preliminary_kwh: number | null
  final_kwh: number | null
  difference_kwh: number | null
}

export type InvoiceFileElectricity = {
  /** credit = the invoice credits an earlier (e.g. preliminary) charge. */
  invoice_type: 'debit' | 'credit'
  /** How the billed consumption was established. */
  consumption_basis: 'measured' | 'estimated' | 'measured_with_estimate' | 'reconciliation'
  reconciliation: InvoiceFileReconciliation | null
  facility_count: number
  facilities: InvoiceFileFacility[]
  contract: InvoiceFileContract | null
  average_price_ore_per_kwh: number | null
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
  site?: Row | null
  meteringPoint?: Row | null
  contract?: Row | null
  nordfinClientId?: string | null
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
        line_type: text(line.line_type),
        vat_rate: num(line.vat_rate),
        vat_amount: num(line.vat_amount) === null ? null : money(line.vat_amount),
        amount_inc_vat: num(line.amount_inc_vat) === null ? null : money(line.amount_inc_vat),
      })),
    electricity: buildElectricity({ ...input, invoiceDate }),
    nordfin_client_id: input.nordfinClientId ?? null,
  }
}

function addMonths(date: string, months: number) {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number)
  const target = new Date(Date.UTC(y, m - 1 + months, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(d, lastDay))
  return target.toISOString().slice(0, 10)
}

/** Whole months left from `from` until `end` (0 when the binding has ended). */
export function monthsRemaining(from: string, end: string) {
  const [fy, fm, fd] = from.slice(0, 10).split('-').map(Number)
  const [ey, em, ed] = end.slice(0, 10).split('-').map(Number)
  const months = (ey - fy) * 12 + (em - fm) - (ed < fd ? 1 : 0)
  return Math.max(0, months)
}

function buildContract(contract: Row | null, invoiceDate: string): InvoiceFileContract | null {
  if (!contract) return null
  const start = text(contract.actual_start_date) ?? text(contract.confirmed_start_date) ?? text(contract.starts_at)?.slice(0, 10) ?? null
  const bindingMonths = num(contract.binding_months)
  const explicitEnd = text(contract.ends_at)?.slice(0, 10) ?? null
  const bindingEnd = bindingMonths && bindingMonths > 0 && start ? addMonths(start, bindingMonths) : explicitEnd
  return {
    name: text(contract.contract_name),
    number: text(contract.contract_number),
    type: text(contract.contract_type),
    start_date: start,
    binding_months: bindingMonths,
    binding_end_date: bindingEnd,
    binding_months_remaining: bindingEnd ? monthsRemaining(invoiceDate, bindingEnd) : null,
    notice_months: num(contract.notice_months),
    auto_renew: typeof contract.auto_renew_enabled === 'boolean' ? contract.auto_renew_enabled : null,
    fixed_price_ore_per_kwh: num(contract.fixed_price_ore_per_kwh),
    spot_markup_ore_per_kwh: num(contract.spot_markup_ore_per_kwh) ?? num(contract.markup_ore_per_kwh),
    monthly_fee_sek: num(contract.monthly_fee_sek),
  }
}

function consumptionBasis(underlay: Row): InvoiceFileElectricity['consumption_basis'] {
  const source = text(underlay.source_system) ?? ''
  if (source === 'consumption_estimate_reconciliation') return 'reconciliation'
  if (source === 'consumption_estimate') return 'estimated'
  if (source.includes('consumption_estimate')) return 'measured_with_estimate'
  return 'measured'
}

function buildReconciliation(underlay: Row): InvoiceFileReconciliation | null {
  const payload = (underlay.payload ?? {}) as Row
  const role = text(payload.reconciliation_role)
  if (role !== 'credit_preliminary' && role !== 'charge_final') return null
  return {
    role,
    reconciled_month: text(payload.reconciled_month),
    preliminary_kwh: num(payload.preliminary_kwh),
    final_kwh: num(payload.final_kwh),
    difference_kwh: num(payload.difference_kwh),
  }
}

function buildElectricity(input: {
  item: Row
  invoice: Row
  underlay: Row
  site?: Row | null
  meteringPoint?: Row | null
  contract?: Row | null
  invoiceDate: string
}): InvoiceFileElectricity {
  const site = input.site ?? null
  const mp = input.meteringPoint ?? null
  const kwh = num(input.item.total_kwh) ?? 0
  const amountExVat = money(input.item.amount_ex_vat)
  const credit = text(input.underlay.settlement_type) === 'credit_invoice' || text(input.underlay.energy_direction) === 'consumption_correction'
  // One invoice covers one billing underlay, i.e. one facility; the list form also carries
  // future consolidated invoices without changing the file layout.
  const facilities: InvoiceFileFacility[] = [{
    facility_id: text(site?.facility_id) ?? text(mp?.site_facility_id),
    metering_point_id: text(mp?.metering_point_id) ?? text(mp?.ediel_metering_point_id),
    site_street: text(site?.street),
    site_postal_code: text(site?.postal_code),
    site_city: text(site?.city),
    price_area: text(input.invoice.price_area_code) ?? text(input.underlay.price_area),
    grid_area: text(mp?.grid_area_code) ?? text(site?.grid_area_code),
    grid_owner: text(mp?.grid_owner_name),
    period_start: text(input.item.period_start) ?? text(input.underlay.billing_period_start),
    period_end: text(input.item.period_end) ?? text(input.underlay.billing_period_end),
    consumption_kwh: kwh,
    estimated_annual_kwh: num(mp?.estimated_annual_consumption_kwh) ?? num(site?.annual_consumption_kwh),
  }]
  return {
    invoice_type: credit ? 'credit' : 'debit',
    consumption_basis: consumptionBasis(input.underlay),
    reconciliation: buildReconciliation(input.underlay),
    facility_count: facilities.length,
    facilities,
    contract: buildContract(input.contract ?? null, input.invoiceDate),
    average_price_ore_per_kwh: kwh !== 0 ? Math.round((amountExVat / kwh) * 10000) / 100 : null,
  }
}

async function loadFacility(companyId: string, underlay: Row) {
  const siteId = text(underlay.customer_site_id) ?? text(underlay.site_id)
  const mpId = text(underlay.metering_point_id)
  const contractId = text(underlay.customer_contract_id) ?? text(underlay.contract_id)
  const [site, mp, contract] = await Promise.all([
    siteId ? tenantSelect(companyId, 'customer_sites', 'facility_id,street,postal_code,city,grid_area_code,annual_consumption_kwh').eq('id', siteId).maybeSingle() : null,
    mpId ? tenantSelect(companyId, 'metering_points', 'metering_point_id,ediel_metering_point_id,site_facility_id,grid_area_code,grid_owner_name,estimated_annual_consumption_kwh').eq('id', mpId).maybeSingle() : null,
    contractId ? tenantSelect(companyId, 'customer_contracts', 'contract_name,contract_number,contract_type,actual_start_date,confirmed_start_date,starts_at,ends_at,binding_months,notice_months,auto_renew_enabled,fixed_price_ore_per_kwh,spot_markup_ore_per_kwh,markup_ore_per_kwh,monthly_fee_sek').eq('id', contractId).maybeSingle() : null,
  ])
  for (const result of [site, mp, contract]) if (result?.error) throw result.error
  return {
    site: (site?.data ?? null) as Row | null,
    meteringPoint: (mp?.data ?? null) as Row | null,
    contract: (contract?.data ?? null) as Row | null,
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
  if (!isFileProvider(selected.provider)) {
    throw new InvoiceProviderConfigError('invoice_file_provider_not_active', 'Bolaget skickar fakturor via API, inte via fil.')
  }
  if (row.invoice_export_enabled !== true) {
    throw new InvoiceProviderConfigError('invoice_file_provider_not_active', 'Filexport är inte aktiverad för bolaget.')
  }
  return { provider: selected.provider as FileProvider, environment: selected.environment }
}

/** Approved, unsent invoices for the month that belong in the next file. */
export async function listInvoiceFileCandidates(companyId: string, billingMonth: string, environment: string, provider: FileProvider = 'file_export') {
  const runs = await tenantSelect(companyId, 'invoice_export_runs', 'id')
    .eq('billing_month', billingMonth)
    .eq('provider', provider)
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
  const candidates = await listInvoiceFileCandidates(input.companyId, input.billingMonth, selected.environment, selected.provider)
  if (candidates.length === 0) throw new InvoiceProviderConfigError('invoice_file_empty', 'Det finns inga godkända fakturor att lägga i en fil.')
  const nordfinClientId = selected.provider === 'nordfin' ? await loadNordfinClientId(input.companyId, selected.environment) : null
  if (selected.provider === 'nordfin' && !nordfinClientId) {
    throw new InvoiceProviderConfigError('nordfin_client_id_missing', 'Nordfins ClientId saknas för bolaget. Ange det under Fakturering → Integrationer.')
  }

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
    const facility = await loadFacility(input.companyId, context.underlay)
    rows.push(buildInvoiceFileRow({
      ...facility,
      nordfinClientId,
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
  provider: FileProvider
  row_count: number
  total_inc_vat: number
  rows_sha256: string
  created_at: string
}

export async function listInvoiceFiles(companyId: string, limit = 24) {
  const { data, error } = await tenantSelect(companyId, 'invoice_export_files', 'id,billing_month,environment,provider,row_count,total_inc_vat,rows_sha256,created_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as unknown as InvoiceFileRecord[]
}

export async function loadInvoiceFile(companyId: string, fileId: string) {
  const { data, error } = await tenantSelect(companyId, 'invoice_export_files', 'id,billing_month,environment,provider,row_count,total_inc_vat,rows,rows_sha256,created_at')
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
  if (format === 'nordfin_xml') {
    return {
      fileName: `nordfin-${base}.xml`,
      contentType: 'application/xml; charset=utf-8',
      body: renderNordfinInvoiceXml(file.rows),
    }
  }
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

/** A Nordfin file defaults to Nordfin XML; csv/xlsx/json stay available for review. */
export function parseInvoiceFileFormat(value: string | null, provider: FileProvider = 'file_export'): InvoiceFileFormat {
  if (value === 'xlsx' || value === 'json' || value === 'csv' || value === 'nordfin_xml') return value
  return provider === 'nordfin' ? 'nordfin_xml' : 'csv'
}
