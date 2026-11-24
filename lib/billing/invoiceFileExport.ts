import { createHash, randomUUID } from 'node:crypto'
import {
  approval,
  assertItemStillReady,
  loadItemContext,
} from '@/lib/billing/invoiceApprovedDispatch'
import { renderNordfinInvoiceXml } from '@/lib/billing/nordfinInvoiceXml'
import { InvoiceProviderConfigError, isFileProvider, loadNordfinClientId, requireTenantInvoiceProvider, rpcError, type FileProvider, type InvoiceProviderEnvironment } from '@/lib/billing/providers/registry'
import { buildXlsxWorkbook } from '@/lib/billing/xlsx'
import { isVariableOrSpotContractType } from '@/lib/customer-contracts/commitment'
import { assertOutboundAllowed } from '@/lib/platform/outboundFreeze'
import { supabaseService } from '@/lib/supabase/service'
import { tenantDb } from '@/lib/supabase/tenantDb'
import { tenantSelect } from '@/lib/supabase/tenantQuery'
import { requireCompanyOperationalForWrites } from '@/lib/tenant/governance'

/**
 * Invoice file export: for tenants whose invoice provider reads a file instead of an API.
 * Approved invoices pass the same readiness checks as an API send, are written as rows into one
 * immutable file and remain reserved pending verified handoff. The
 * archive keeps the original rows. New versioned exports also keep the exact rendered bytes.
 */
export const INVOICE_FILE_FORMAT_VERSION = 'gridex_invoice_file_v1'
const LEGACY_ARTIFACT_RENDERER_VERSION = 'gridex_invoice_file_bytes_v1'
const NEUTRAL_ARTIFACT_RENDERER_VERSION = 'gridex_neutral_invoice_file_bytes_v2'
type InvoiceFileRendererVersion = typeof LEGACY_ARTIFACT_RENDERER_VERSION | typeof NEUTRAL_ARTIFACT_RENDERER_VERSION
export type InvoiceFileFormat = 'csv' | 'xlsx' | 'json' | 'nordfin_xml'

type Row = Record<string, unknown>

export type InvoiceFileRow = {
  invoice_export_item_id: string
  invoice_number: string | null
  invoice_reference?: string | null
  customer_number: string | null
  customer_name: string
  customer_type: 'private' | 'business'
  identity_number: string | null
  recipient: string | null
  email: string | null
  delivery_method?: 'paper' | 'email'
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

function approvedCustomerIdentity(item: Row, invoice: Row, customer: Row) {
  const itemIdentity = approval(item.metadata).customer_identity
  const invoiceIdentity = approval(invoice.metadata).customer_identity
  if (itemIdentity === undefined && invoiceIdentity === undefined) {
    return { number: text(customer.customer_number), name: customerName(customer) }
  }

  const snapshot = itemIdentity as Row | null | undefined
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)
      || snapshot.version !== 1
      || typeof snapshot.customer_id !== 'string' || !snapshot.customer_id
      || snapshot.customer_id !== item.customer_id || snapshot.customer_id !== invoice.customer_id
      || snapshot.customer_id !== customer.id
      || typeof snapshot.name !== 'string' || text(snapshot.name) !== snapshot.name
      || (snapshot.number !== null && (typeof snapshot.number !== 'string' || text(snapshot.number) !== snapshot.number))
      || stableJson(snapshot) !== stableJson(invoiceIdentity)) {
    throw staleSelection()
  }
  return { number: snapshot.number, name: snapshot.name }
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
  provider?: FileProvider
  qualifiedLegacyDeliveryMethod?: InvoiceFileRow['delivery_method']
}): InvoiceFileRow {
  const itemId = text(input.item.id)
  if (!itemId) throw new Error('Fakturaposten saknar ID.')
  const business = text(input.customer.customer_type) === 'business' || Boolean(text(input.customer.org_number))
  const address = (input.legacyItem?.invoice_address_snapshot ?? {}) as Row
  const selectedMethod = input.qualifiedLegacyDeliveryMethod ?? (input.invoice.calculation_snapshot as Row | null)?.invoice_delivery_method
  const deliveryMethod = selectedMethod === 'paper' || selectedMethod === 'email' ? selectedMethod : null
  const email = deliveryMethod ? text(address.email) : text(address.email) ?? text(input.legacyItem?.invoice_email)
  const country = text(address.country)
  const { invoiceDate, dueDate } = invoiceDates(input.now)
  const neutral = input.provider === 'file_export'
  const invoiceReference = text(input.invoice.invoice_reference)
  if (neutral && !invoiceReference) throw staleSelection()
  const invoiceNumber = text(input.invoice.invoice_number)
  const identity = approvedCustomerIdentity(input.item, input.invoice, input.customer)
  return {
    invoice_export_item_id: itemId,
    invoice_number: neutral ? invoiceNumber : invoiceNumber ?? `GX-${input.billingMonth.replace('-', '')}-${itemId.slice(0, 8).toUpperCase()}`,
    ...(neutral ? { invoice_reference: invoiceReference } : {}),
    customer_number: identity.number,
    customer_name: identity.name,
    customer_type: business ? 'business' : 'private',
    identity_number: business ? text(input.customer.org_number) : text(input.customer.personal_number),
    recipient: text(address.recipient) ?? text(input.legacyItem?.invoice_recipient),
    email: deliveryMethod === 'paper' ? null : email,
    ...(deliveryMethod ? { delivery_method: deliveryMethod } : {}),
    reference: text(address.reference) ?? text(input.legacyItem?.invoice_reference),
    street: text(address.street),
    postal_code: text(address.postal_code),
    city: text(address.city),
    country: deliveryMethod === 'paper' ? country : country ?? 'SE',
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
  const type = text(contract.contract_type)
  const bindingMonths = num(contract.binding_months)
  const explicitEnd = text(contract.ends_at)?.slice(0, 10) ?? null
  let bindingEnd = explicitEnd
  if (bindingMonths && bindingMonths > 0 && start) {
    bindingEnd = addMonths(start, bindingMonths)
  } else if (isVariableOrSpotContractType(type) && (bindingMonths ?? 0) <= 0) {
    bindingEnd = null
  }
  return {
    name: text(contract.contract_name),
    number: text(contract.contract_number),
    type,
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

export type InvoiceFileSelectionItem = { itemId: string; reviewHash: string; approvedAt: string; approvedBy: string }
export type InvoiceFileIntentScope = {
  provider: FileProvider
  environment: InvoiceProviderEnvironment
  selection: InvoiceFileSelectionItem[]
  groups?: InvoiceFileGroupSelectionItem[]
}

export type InvoiceFileGroupSelectionItem = { invoiceId: string; reviewHash: string }

export function isInvoiceFileGroupSelectionItem(value: unknown): value is InvoiceFileGroupSelectionItem {
  if (!value || typeof value !== 'object') return false
  const { invoiceId, reviewHash } = value as Row
  return typeof invoiceId === 'string' && ARCHIVE_UUID.test(invoiceId) &&
    typeof reviewHash === 'string' && ARCHIVE_SHA256.test(reviewHash)
}

function typedSelection(scope: InvoiceFileIntentScope) {
  const groups = scope.groups ?? []
  if (!groups.length) return scope.selection
  return [
    ...scope.selection.map(item => ({ kind:'individual', ...item })),
    ...groups.map(group => ({ kind:'group', ...group })),
  ]
}

const ARCHIVE_SHA256 = /^[0-9a-f]{64}$/
const ARCHIVE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_ARTIFACT_BYTES = 16 * 1024 * 1024
const MAX_ARTIFACT_SET_BYTES = 24 * 1024 * 1024

export type InvoiceFileArtifact = {
  format: InvoiceFileFormat
  fileName: string
  contentType: string
  bodyBase64: string
  byteLength: number
  sha256: string
  rendererVersion: string
}

type CreateInvoiceFileInput = {
  companyId: string
  billingMonth: string
  actorUserId: string
  exportIntentId?: string
  exportIntentScope?: InvoiceFileIntentScope
  now?: Date
}

type InvoiceFileIntentReceipt = { fileId: string; rowCount: number; sha256: string; replayed: boolean }
type InvoiceFileArtifactManifest = Omit<InvoiceFileArtifact, 'bodyBase64'>
type FrozenInvoiceFileReceipt = InvoiceFileIntentReceipt & {
  createdAt: string
  artifacts: InvoiceFileArtifactManifest[]
}

export function isInvoiceFileSelectionItem(value: unknown): value is InvoiceFileSelectionItem {
  if (!value || typeof value !== 'object') return false
  const { itemId, reviewHash, approvedAt, approvedBy } = value as Row
  return typeof itemId === 'string' && ARCHIVE_UUID.test(itemId) &&
    typeof reviewHash === 'string' && ARCHIVE_SHA256.test(reviewHash) &&
    typeof approvedBy === 'string' && ARCHIVE_UUID.test(approvedBy) &&
    typeof approvedAt === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(approvedAt) && Number.isFinite(Date.parse(approvedAt))
}

function staleSelection() {
  return new InvoiceProviderConfigError('invoice_file_selection_changed', 'Det godkända fakturaunderlaget har ändrats. Ladda om sidan och kontrollera urvalet.')
}

function differentIntentScope() {
  return new InvoiceProviderConfigError('invoice_file_intent_scope_mismatch', 'Begäran hör till en annan fakturaperiod, leverantör eller miljö.')
}

function intentError(error: { code?: string; message: string }) {
  if (error.code === '22023' && error.message === 'invoice_file_intent_scope_mismatch') {
    return differentIntentScope()
  }
  if (error.code === '23514' && error.message === 'invoice_file_contract_case_hold') {
    return new InvoiceProviderConfigError(error.message, 'En faktura i urvalet omfattas av ett aktivt avtalsstopp. Ingen fil skapades.')
  }
  if ((error.code === '40001' || error.code === '23514') && error.message === 'invoice_file_selection_changed') return staleSelection()
  if (error.code === '23514' &&
      (error.message === 'billing_finalized_supply_basis_changed' || error.message === 'ended_supply_pricing_basis_changed')) {
    return staleSelection()
  }
  if (error.code === '55P03' && error.message === 'invoice_file_finance_lock_busy') {
    return new InvoiceProviderConfigError('invoice_file_finance_lock_busy', 'Fakturaarkivet är tillfälligt upptaget. Försök igen om en stund.')
  }
  if (error.code === '22023' && error.message === 'invoice_file_selection_too_large') {
    return new InvoiceProviderConfigError('invoice_file_selection_too_large', 'Urvalet är större än vad en fakturafil får innehålla.')
  }
  if (error.code === '22023' && error.message === 'invoice_file_artifacts_too_large') {
    return new InvoiceProviderConfigError('invoice_file_artifacts_too_large', 'Fakturafilen överskrider storleksgränsen.')
  }
  return rpcError(error)
}

function decodeInvoiceFileIntent(value: unknown): InvoiceFileIntentReceipt {
  const fields = value && typeof value === 'object' ? value as Row : {}
  const { fileId, rowCount, rowsSha256, replayed } = fields
  if (typeof fileId !== 'string' || typeof rowCount !== 'number' || !Number.isSafeInteger(rowCount) || rowCount < 1 ||
      typeof rowsSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(rowsSha256) || typeof replayed !== 'boolean') {
    throw new Error('invoice_file_invalid_intent_receipt')
  }
  return { fileId, rowCount, sha256: rowsSha256, replayed }
}

function invoiceFileIntentArgs(input: CreateInvoiceFileInput) {
  return {
    p_company_id: input.companyId,
    p_billing_month: input.billingMonth,
    p_actor_user_id: input.actorUserId,
    p_intent_id: input.exportIntentId,
  }
}

function archiveFormats(provider: FileProvider): InvoiceFileFormat[] {
  return provider === 'nordfin' ? ['csv', 'xlsx', 'json', 'nordfin_xml'] : ['csv', 'xlsx', 'json']
}

function renderInvoiceFileArtifacts(
  file: Parameters<typeof renderInvoiceFile>[0],
  provider: FileProvider,
) {
  const rendererVersion = provider === 'file_export' ? NEUTRAL_ARTIFACT_RENDERER_VERSION : LEGACY_ARTIFACT_RENDERER_VERSION
  let totalBytes = 0
  return archiveFormats(provider).map(format => {
    const rendered = renderInvoiceFile(file, format, rendererVersion)
    const body = Buffer.from(rendered.body)
    totalBytes += body.byteLength
    if (body.byteLength > MAX_ARTIFACT_BYTES || totalBytes > MAX_ARTIFACT_SET_BYTES) {
      throw new InvoiceProviderConfigError('invoice_file_artifacts_too_large', 'Fakturafilen överskrider storleksgränsen.')
    }
    return {
      format, fileName: rendered.fileName, contentType: rendered.contentType,
      bodyBase64: body.toString('base64'), byteLength: body.byteLength,
      sha256: createHash('sha256').update(body).digest('hex'), rendererVersion,
    }
  })
}

function frozenInvoiceFileArgs(input: CreateInvoiceFileInput, scope: InvoiceFileIntentScope) {
  return {
    ...invoiceFileIntentArgs(input),
    p_provider: scope.provider,
    p_environment: scope.environment,
    p_selection: typedSelection(scope),
  }
}

function decodeFrozenInvoiceFileReceipt(value: unknown, scope: InvoiceFileIntentScope): FrozenInvoiceFileReceipt {
  const core = decodeInvoiceFileIntent(value)
  const { provider, environment, createdAt, artifacts } = value as Row
  const expectedFormats: InvoiceFileFormat[] = scope.groups?.length ? ['json'] : archiveFormats(scope.provider)
  if (provider !== scope.provider || environment !== scope.environment || !ARCHIVE_UUID.test(core.fileId) ||
      core.rowCount !== scope.selection.length + (scope.groups?.length ?? 0) || typeof createdAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(createdAt) || !Number.isFinite(Date.parse(createdAt)) ||
      !Array.isArray(artifacts) || artifacts.length !== expectedFormats.length) {
    throw new Error('invoice_file_invalid_intent_receipt')
  }
  for (const artifact of artifacts as Row[]) {
    const formatIndex = expectedFormats.indexOf(artifact?.format as InvoiceFileFormat)
    if (formatIndex === -1 || typeof artifact.fileName !== 'string' || typeof artifact.contentType !== 'string' ||
        typeof artifact.byteLength !== 'number' || !Number.isSafeInteger(artifact.byteLength) ||
        artifact.byteLength < 1 || artifact.byteLength > MAX_ARTIFACT_BYTES ||
        typeof artifact.sha256 !== 'string' || !ARCHIVE_SHA256.test(artifact.sha256) ||
        typeof artifact.rendererVersion !== 'string' || !artifact.rendererVersion ||
        Object.hasOwn(artifact, 'bodyBase64')) {
      throw new Error('invoice_file_invalid_intent_receipt')
    }
    expectedFormats.splice(formatIndex, 1)
  }
  return { ...core, createdAt, artifacts: artifacts as InvoiceFileArtifactManifest[] }
}

export async function readFrozenInvoiceFileIntent(input: CreateInvoiceFileInput) {
  const scope = input.exportIntentScope
  if (!scope || !input.exportIntentId) return null
  const { data, error } = await supabaseService.rpc('gridex_read_invoice_file_intent_v2', frozenInvoiceFileArgs(input, scope))
  if (error) throw intentError(error)
  if (data === null) return null
  const receipt = decodeFrozenInvoiceFileReceipt(data, scope)
  if (!receipt.replayed) throw new Error('invoice_file_invalid_intent_receipt')
  return receipt
}

export async function previewInvoiceFileSelection(input: {
  companyId: string; billingMonth: string; provider: FileProvider; environment: InvoiceProviderEnvironment
}) {
  const { data, error } = await supabaseService.rpc('gridex_preview_invoice_file_selection_v2', {
    p_company_id: input.companyId,
    p_billing_month: input.billingMonth,
    p_provider: input.provider,
    p_environment: input.environment,
  })
  if (error) throw intentError(error)
  if (!Array.isArray(data) || data.length > 1000 || !data.every(isInvoiceFileSelectionItem) ||
      new Set(data.map(item => item.itemId.toLowerCase())).size !== data.length) {
    throw staleSelection()
  }
  return data.map(({ itemId, reviewHash, approvedAt, approvedBy }) => ({ itemId, reviewHash, approvedAt, approvedBy }))
}

export async function previewInvoiceFileGroups(input: {
  companyId: string; billingMonth: string; environment: InvoiceProviderEnvironment; actorUserId: string
}): Promise<InvoiceFileGroupSelectionItem[]> {
  const { data, error } = await supabaseService.rpc('gridex_preview_mixed_invoice_group_selection_v1', {
    p_company_id: input.companyId, p_billing_month: input.billingMonth,
    p_environment: input.environment, p_actor_user_id: input.actorUserId,
  })
  if (error || !Array.isArray(data) || data.length > 1000 || !data.every(isInvoiceFileGroupSelectionItem)) throw staleSelection()
  return data.map(({ invoiceId, reviewHash }) => ({ invoiceId, reviewHash }))
}

function unverifiedInvoiceFileDelivery() {
  return new InvoiceProviderConfigError('invoice_file_delivery_unverified', 'Det valda leveranssättet kan inte verifieras i det godkända fakturaunderlaget.')
}

async function qualifyLegacyInvoiceFileDelivery(
  companyId: string,
  context: Awaited<ReturnType<typeof loadItemContext>>,
): Promise<InvoiceFileRow['delivery_method']> {
  const calculation = context.invoice.calculation_snapshot as Row | null
  if (calculation?.schema !== 'gridex_invoice_calculation_v1' || calculation.invoice_delivery_method !== undefined) return
  const snapshotId = text(calculation.contract_price_snapshot_id)
  if (!snapshotId) return

  const sourceHash = text(calculation.contract_price_snapshot_hash)
  const contractId = text(context.item.customer_contract_id)
  if (!sourceHash || !contractId || contractId !== calculation.customer_contract_id) throw unverifiedInvoiceFileDelivery()

  const { data, error } = await tenantSelect(companyId, 'contract_price_snapshots', 'invoice_delivery_method,snapshot_json')
    .eq('id', snapshotId)
    .eq('contract_id', contractId)
    .eq('snapshot_hash', sourceHash)
    .maybeSingle()
  if (error) throw error
  if (!data) throw unverifiedInvoiceFileDelivery()

  const snapshot = data as Row
  const columnMethod = text(snapshot.invoice_delivery_method)
  const snapshotMethod = text((snapshot.snapshot_json as Row | null)?.invoice_delivery_method)
  if (columnMethod && snapshotMethod && columnMethod !== snapshotMethod) throw unverifiedInvoiceFileDelivery()
  const method = snapshotMethod ?? columnMethod
  if (!method) return
  const calculationHash = context.invoice.calculation_snapshot_sha256
  const selectedApproval = approval(context.item.metadata)
  const mirrorApproval = approval(context.invoice.metadata)
  // Historic approval hashed the JavaScript payload. Only accept exact stored JSON
  // that reproduces the same hash and agrees with both retained approval copies.
  if (context.invoice.status !== 'draft' ||
      selectedApproval.calculation_snapshot_sha256 !== calculationHash ||
      stableJson(selectedApproval) !== stableJson(mirrorApproval) ||
      createHash('sha256').update(stableJson(calculation)).digest('hex') !== calculationHash) {
    throw unverifiedInvoiceFileDelivery()
  }
  if (method !== 'paper' && method !== 'email') {
    throw new InvoiceProviderConfigError('invoice_file_delivery_unsupported', 'Filexporten stöder inte fakturans valda leveranssätt.')
  }
  return method
}

async function prepareInvoiceFileRows(
  input: CreateInvoiceFileInput,
  selected: Awaited<ReturnType<typeof loadSelection>>,
  candidates: InvoiceFileSelectionItem[],
) {
  if (candidates.length === 0) throw new InvoiceProviderConfigError('invoice_file_empty', 'Det finns inga godkända fakturor att lägga i en fil.')
  const nordfinClientId = selected.provider === 'nordfin' ? await loadNordfinClientId(input.companyId, selected.environment) : null
  if (selected.provider === 'nordfin' && !nordfinClientId) {
    throw new InvoiceProviderConfigError('nordfin_client_id_missing', 'Nordfins ClientId saknas för bolaget. Ange det under Fakturering → Integrationer.')
  }

  const now = input.now ?? new Date()
  const rows: InvoiceFileRow[] = []
  for (const candidate of candidates) {
    const { itemId } = candidate
    const context = await loadItemContext(input.companyId, itemId)
    const currentApproval = approval(context.item.metadata)
    if (context.item.status !== 'pending' || context.item.export_file_id ||
        currentApproval.status !== 'approved' || currentApproval.review_hash !== candidate.reviewHash ||
        currentApproval.approved_at !== candidate.approvedAt || currentApproval.approved_by !== candidate.approvedBy ||
        context.run.provider !== selected.provider ||
        context.run.environment !== selected.environment || context.run.billing_month !== input.billingMonth) {
      throw staleSelection()
    }
    // Same checks as an API send: the invoice must still match its underlay and locked pricing.
    await assertItemStillReady(context)
    const legacy = await tenantSelect(input.companyId, 'billing_export_run_items', 'invoice_recipient,invoice_email,invoice_reference,invoice_address_snapshot')
      .eq('id', itemId)
      .maybeSingle()
    if (legacy.error) throw legacy.error
    const qualifiedLegacyDeliveryMethod = await qualifyLegacyInvoiceFileDelivery(input.companyId, context)
    const facility = await loadFacility(input.companyId, context.underlay)
    const row = buildInvoiceFileRow({
      ...facility,
      provider: selected.provider,
      qualifiedLegacyDeliveryMethod,
      nordfinClientId,
      item: context.item,
      invoice: context.invoice,
      customer: context.customer,
      underlay: context.underlay,
      lines: context.lines,
      legacyItem: (legacy.data ?? null) as Row | null,
      billingMonth: input.billingMonth,
      now,
    })
    // Use only the chosen transport in the approved draft. Historical drafts may lack that choice.
    const completePostalAddress = row.street && row.postal_code && row.city && row.country
    if (row.delivery_method === 'paper' && !completePostalAddress) {
      throw new InvoiceProviderConfigError('invoice_distribution_paper_address_missing', 'Pappersfaktura har valts men den frysta fakturaadressen är ofullständig.')
    }
    if (row.delivery_method === 'email' && !row.email) {
      throw new InvoiceProviderConfigError('invoice_distribution_email_missing', 'Faktura via e-post har valts men en bekräftad fryst faktura-e-post saknas.')
    }
    if (!row.delivery_method && !row.email && !completePostalAddress) {
      throw new InvoiceProviderConfigError('invoice_distribution_missing', 'Fakturan saknar bekräftad faktura-e-post eller komplett fryst fakturaadress.')
    }
    rows.push(row)
  }

  return rows
}

export async function createInvoiceFile(input: CreateInvoiceFileInput) {
  const intentScope = input.exportIntentScope
  if (!intentScope || !input.exportIntentId || intentScope.selection.some(item => !isInvoiceFileSelectionItem(item)) ||
      new Set(intentScope.selection.map(item => item.itemId.toLowerCase())).size !== intentScope.selection.length) {
    throw new InvoiceProviderConfigError('invoice_file_intent_invalid', 'Begäran att skapa fakturafil är ogiltig.')
  }
  const previous = await readFrozenInvoiceFileIntent(input)
  if (previous) return previous

  await requireCompanyOperationalForWrites(input.companyId)

  const now = input.now ?? new Date()
  let selected: Awaited<ReturnType<typeof loadSelection>>
  let prepared: Awaited<ReturnType<typeof prepareInvoiceFileRows>>
  try {
    await assertOutboundAllowed({ companyId: input.companyId, channel: 'invoice_export' })
    selected = await loadSelection(input.companyId)
    if (selected.provider !== intentScope.provider || selected.environment !== intentScope.environment) {
      throw differentIntentScope()
    }
    if (intentScope.groups?.length) {
      if (intentScope.provider !== 'file_export') throw differentIntentScope()
      if (intentScope.selection.length) await prepareInvoiceFileRows({ ...input, now }, selected, intentScope.selection)
      const { p_provider: _provider, ...args } = frozenInvoiceFileArgs(input, intentScope)
      const { data, error } = await supabaseService.rpc('gridex_prepare_mixed_invoice_month_file_v1', args)
      if (error?.code === '23514' && error.message === 'invoice_file_contract_case_hold') throw intentError(error)
      if (error?.code === '40001' || error?.code === '23514') throw staleSelection()
      if (error) throw intentError(error)
      return decodeFrozenInvoiceFileReceipt(data, intentScope)
    }
    prepared = await prepareInvoiceFileRows({ ...input, now }, selected, intentScope.selection)
  } catch (error) {
    // A concurrent copy could have committed while this request qualified its rows.
    const committed = await readFrozenInvoiceFileIntent(input)
    if (committed) return committed
    throw error
  }
  const rows = prepared
  const sha = rowsSha256(rows)
  const proposedFileId = randomUUID()
  const createdAt = now.toISOString()
  const artifacts = renderInvoiceFileArtifacts({
    id: proposedFileId, billing_month: input.billingMonth, rows, rows_sha256: sha, created_at: createdAt,
  }, selected.provider)
  const { data, error } = await supabaseService.rpc('gridex_write_invoice_file_intent_v2', {
    ...frozenInvoiceFileArgs(input, intentScope),
    p_file_id: proposedFileId,
    p_created_at: createdAt,
    p_rows: rows,
    p_rows_sha256: sha,
    p_artifacts: artifacts,
  })
  if (error) {
    const committed = await readFrozenInvoiceFileIntent(input)
    if (committed) return committed
    throw intentError(error)
  }
  const receipt = decodeFrozenInvoiceFileReceipt(data, intentScope)
  if (receipt.replayed) return receipt
  if (receipt.fileId !== proposedFileId || receipt.createdAt !== createdAt || receipt.sha256 !== sha ||
      artifacts.some(expected => !receipt.artifacts.some(actual =>
        actual.format === expected.format && actual.sha256 === expected.sha256 && actual.byteLength === expected.byteLength &&
        actual.fileName === expected.fileName && actual.contentType === expected.contentType && actual.rendererVersion === expected.rendererVersion))) {
    throw new Error('invoice_file_invalid_intent_receipt')
  }
  return receipt
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
  preparation_kind?: 'mixed_neutral_v1' | null
  handoff_phase?: 'legacy_unverified' | 'created'
  handoff_recipient?: string | null
}

const INVOICE_FILE_METADATA_COLUMNS = 'id,billing_month,environment,provider,row_count,total_inc_vat,rows_sha256,created_at,preparation_kind,handoff_phase,handoff_recipient'

export async function listInvoiceFiles(companyId: string, limit = 24) {
  const { data, error } = await tenantSelect(companyId, 'invoice_export_files', INVOICE_FILE_METADATA_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as unknown as InvoiceFileRecord[]
}

export async function loadInvoiceFileReceipt(companyId: string, fileId: unknown) {
  if (typeof fileId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(fileId)) return null

  const { data, error } = await tenantSelect(companyId, 'invoice_export_files', `${INVOICE_FILE_METADATA_COLUMNS},artifact_archive_version`)
    .eq('id', fileId)
    .maybeSingle()
  if (error) throw error
  if (data === null) return null
  const receipt = data as unknown as InvoiceFileRecord & { artifact_archive_version: number | null }
  if (typeof receipt.rows_sha256 !== 'string' || !ARCHIVE_SHA256.test(receipt.rows_sha256)) {
    throw new Error('invoice_file_invalid_receipt_digest')
  }
  return receipt
}

const PERIOD_RECONCILIATION_STATUSES = ['pending', 'locked', 'incomplete', 'superseded', 'already_locked'] as const
const CURRENT_PERIOD_STATUSES = ['open', 'locked', 'exported', 'closed', 'reopened'] as const
type PeriodReconciliationStatus = (typeof PERIOD_RECONCILIATION_STATUSES)[number]
type CurrentPeriodStatus = (typeof CURRENT_PERIOD_STATUSES)[number]

export async function loadInvoiceFilePeriodReconciliation(companyId: string, file: InvoiceFileRecord) {
  const { data, error } = await supabaseService.rpc('gridex_read_invoice_export_period_reconciliation_v1', {
    p_company_id: companyId,
    p_file_id: file.id,
  })
  if (error) throw error
  const receipt = data && typeof data === 'object' ? data as Row : {}
  const status = receipt.status as PeriodReconciliationStatus
  const currentPeriodStatus = receipt.currentPeriodStatus as CurrentPeriodStatus
  if (receipt.fileId !== file.id || receipt.billingMonth !== file.billing_month ||
      !PERIOD_RECONCILIATION_STATUSES.includes(status) || !CURRENT_PERIOD_STATUSES.includes(currentPeriodStatus)) {
    throw new Error('invoice_file_invalid_period_reconciliation')
  }
  return { status, currentPeriodStatus, retryingAfterFailure: status === 'pending' && receipt.reason === 'reconcile_failed',
    awaitingHandoff: status === 'pending' && receipt.reason === 'awaiting_verified_handoff' }
}

export async function loadInvoiceFile(companyId: string, fileId: string) {
  const { data, error } = await tenantSelect(companyId, 'invoice_export_files', 'id,billing_month,environment,provider,row_count,total_inc_vat,rows,rows_sha256,created_at,preparation_kind,handoff_phase,handoff_recipient')
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

function nordfinXmlDownload(file: { billing_month: string; id: string }, body: string) {
  return {
    fileName: `nordfin-fakturor-${file.billing_month}-${file.id.slice(0, 8)}.xml`,
    contentType: 'application/xml; charset=utf-8',
    body,
  }
}

export function renderInvoiceFile(
  file: { id: string; billing_month: string; rows: InvoiceFileRow[]; rows_sha256: string; created_at: string },
  format: InvoiceFileFormat,
  rendererVersion: InvoiceFileRendererVersion = LEGACY_ARTIFACT_RENDERER_VERSION,
) {
  const base = `fakturor-${file.billing_month}-${file.id.slice(0, 8)}`
  if (format === 'nordfin_xml') {
    return nordfinXmlDownload(file, renderNordfinInvoiceXml(file.rows))
  }
  const neutral = rendererVersion === NEUTRAL_ARTIFACT_RENDERER_VERSION
  if (format === 'json') {
    return {
      fileName: `${base}.json`,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({
        format: INVOICE_FILE_FORMAT_VERSION,
        ...(neutral ? { renderer_version: rendererVersion } : {}),
        file_id: file.id, billing_month: file.billing_month, created_at: file.created_at, rows_sha256: file.rows_sha256, invoices: file.rows,
      }, null, 2),
    }
  }
  const columns: Array<[keyof InvoiceFileRow, string]> = neutral
    ? [...CSV_COLUMNS, ['invoice_reference', 'Fakturareferens']]
    : CSV_COLUMNS
  if (format === 'xlsx') {
    const headers = columns.map(([, label]) => label)
    const rows = file.rows.map((row) => Object.fromEntries(columns.map(([key, label]) => [label, row[key] as unknown])))
    return {
      fileName: `${base}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      body: buildXlsxWorkbook(headers, rows),
    }
  }
  const lines = [
    columns.map(([, label]) => csvCell(label)).join(';'),
    ...file.rows.map((row) => columns.map(([key]) => csvCell(row[key])).join(';')),
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
