import { supabaseService } from '@/lib/supabase/service'

export const INVOICE_TEST_CUSTOMER_SOURCE = 'invoice_test_center'
export const INVOICE_TEST_CUSTOMER_KIND = 'invoice_test_customer'

type Row = Record<string, unknown>

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function objectValue(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
}

function marker(metadata: unknown): Row {
  return objectValue(objectValue(metadata).test_center)
}

export function isInvoiceTestCustomerRow(row: Row | null | undefined): boolean {
  if (!row) return false
  return row.is_test_data === true
    && text(row.source) === INVOICE_TEST_CUSTOMER_SOURCE
    && text(marker(row.metadata).kind) === INVOICE_TEST_CUSTOMER_KIND
}

export async function assertInvoiceTestCustomer(input: {
  companyId: string
  customerId: string
  allowArchived?: boolean
}) {
  const result = await supabaseService
    .from('customers')
    .select('id,company_id,customer_number,full_name,email,source,is_test_data,metadata,archived_at')
    .eq('company_id', input.companyId)
    .eq('id', input.customerId)
    .maybeSingle()
  if (result.error) throw result.error
  const row = result.data as Row | null
  if (!isInvoiceTestCustomerRow(row)) {
    throw new Error('Fakturatest blockerad: vald kund är inte en explicit Fakturatest-kund.')
  }
  if (!input.allowArchived && text(row?.archived_at)) {
    throw new Error('Fakturatest blockerad: testkunden är arkiverad.')
  }
  return row as Row
}

async function mergeMarker(input: {
  table: 'customers' | 'customer_sites' | 'metering_points' | 'customer_contracts'
  companyId: string
  id: string
  actorUserId: string
  extra?: Row
}) {
  const current = await supabaseService
    .from(input.table)
    .select('id,metadata')
    .eq('company_id', input.companyId)
    .eq('id', input.id)
    .maybeSingle()
  if (current.error) throw current.error
  if (!current.data) throw new Error(`Fakturatest kunde inte markera ${input.table}; posten saknas.`)
  const now = new Date().toISOString()
  const metadata = {
    ...objectValue((current.data as Row).metadata),
    test_center: {
      kind: INVOICE_TEST_CUSTOMER_KIND,
      version: 1,
      created_by: input.actorUserId,
      marked_at: now,
    },
  }
  const update: Row = { metadata, updated_at: now, ...(input.extra ?? {}) }
  const saved = await supabaseService
    .from(input.table)
    .update(update)
    .eq('company_id', input.companyId)
    .eq('id', input.id)
    .select('id')
    .maybeSingle()
  if (saved.error) throw saved.error
  if (!saved.data) throw new Error(`Fakturatest kunde inte verifiera markering på ${input.table}.`)
}

export async function markInvoiceTestCustomerGraph(input: {
  companyId: string
  customerId: string
  siteId: string | null
  meteringPointId: string | null
  contractId: string | null
  actorUserId: string
}) {
  await mergeMarker({
    table: 'customers',
    companyId: input.companyId,
    id: input.customerId,
    actorUserId: input.actorUserId,
    extra: {
      source: INVOICE_TEST_CUSTOMER_SOURCE,
      is_test_data: true,
      updated_by: input.actorUserId,
    },
  })
  if (input.siteId) {
    await mergeMarker({
      table: 'customer_sites',
      companyId: input.companyId,
      id: input.siteId,
      actorUserId: input.actorUserId,
      extra: { is_test_data: true, updated_by: input.actorUserId },
    })
  }
  if (input.meteringPointId) {
    await mergeMarker({
      table: 'metering_points',
      companyId: input.companyId,
      id: input.meteringPointId,
      actorUserId: input.actorUserId,
      extra: { is_test_data: true, updated_by: input.actorUserId },
    })
  }
  if (input.contractId) {
    await mergeMarker({
      table: 'customer_contracts',
      companyId: input.companyId,
      id: input.contractId,
      actorUserId: input.actorUserId,
      extra: { updated_by: input.actorUserId },
    })
  }
  return assertInvoiceTestCustomer({ companyId: input.companyId, customerId: input.customerId })
}

export async function resetInvoiceTestCustomerRun(input: {
  companyId: string
  customerId: string
  actorUserId: string
}) {
  await assertInvoiceTestCustomer(input)
  const items = await supabaseService
    .from('invoice_export_items')
    .select('id,status')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .eq('environment', 'test')
  if (items.error) throw items.error
  const cancellable = (items.data ?? [])
    .filter((row) => !['sent', 'credited'].includes(String(row.status)))
    .map((row) => String(row.id))
  if (cancellable.length > 0) {
    const now = new Date().toISOString()
    const itemUpdate = await supabaseService
      .from('invoice_export_items')
      .update({ status: 'cancelled', updated_at: now })
      .eq('company_id', input.companyId)
      .eq('environment', 'test')
      .in('id', cancellable)
    if (itemUpdate.error) throw itemUpdate.error
    const invoiceUpdate = await supabaseService
      .from('customer_invoices')
      .update({ status: 'cancelled', updated_at: now })
      .eq('company_id', input.companyId)
      .eq('customer_id', input.customerId)
      .in('invoice_export_item_id', cancellable)
    if (invoiceUpdate.error) throw invoiceUpdate.error
  }
  return { cancelledDrafts: cancellable.length }
}

export async function archiveInvoiceTestCustomer(input: {
  companyId: string
  customerId: string
  actorUserId: string
}) {
  await assertInvoiceTestCustomer(input)
  await resetInvoiceTestCustomerRun(input)
  const now = new Date().toISOString()
  const reason = 'Arkiverad från Fakturatest. Provider-/auditspår bevaras.'
  const customer = await supabaseService
    .from('customers')
    .update({ archived_at: now, archived_by: input.actorUserId, archive_reason: reason, updated_by: input.actorUserId, updated_at: now })
    .eq('company_id', input.companyId)
    .eq('id', input.customerId)
    .eq('is_test_data', true)
    .eq('source', INVOICE_TEST_CUSTOMER_SOURCE)
    .select('id')
    .maybeSingle()
  if (customer.error) throw customer.error
  if (!customer.data) throw new Error('Fakturatest vägrade arkivera kunden eftersom testmarkören ändrades.')
  await supabaseService
    .from('customer_sites')
    .update({ archived_at: now, archived_by: input.actorUserId, archive_reason: reason, is_active: false, updated_by: input.actorUserId, updated_at: now })
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .eq('is_test_data', true)
  await supabaseService
    .from('metering_points')
    .update({ archived_at: now, archived_by: input.actorUserId, archive_reason: reason, updated_by: input.actorUserId, updated_at: now })
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .eq('is_test_data', true)
  return { customerId: input.customerId, archivedAt: now }
}

export async function loadInvoiceTestCenterWorkspace() {
  const [companies, offers, customers, providerConnections] = await Promise.all([
    supabaseService.from('companies').select('id,name').order('name', { ascending: true }).limit(100),
    supabaseService
      .from('canonical_internal_contract_offers_v')
      .select('id,company_id,name,contract_type,currently_sellable,internal_publication_ready')
      .eq('currently_sellable', true)
      .order('name', { ascending: true })
      .limit(300),
    supabaseService
      .from('customers')
      .select('id,company_id,customer_number,full_name,email,source,is_test_data,metadata,created_at,archived_at')
      .eq('source', INVOICE_TEST_CUSTOMER_SOURCE)
      .eq('is_test_data', true)
      .is('archived_at', null)
      .order('created_at', { ascending: false })
      .limit(100),
    supabaseService
      .from('billing_provider_connections')
      .select('company_id,provider,environment,status,updated_at')
      .eq('provider', 'capway_aptic')
      .eq('environment', 'test'),
  ])
  const baseErrors = [companies.error, offers.error, customers.error, providerConnections.error]
    .filter(Boolean)
    .map((error) => error?.message ?? 'Okänt databasfel')
  const testCustomers = ((customers.data ?? []) as Row[]).filter(isInvoiceTestCustomerRow)
  const customerIds = testCustomers.map((row) => String(row.id))
  if (customerIds.length === 0) {
    return {
      companies: companies.data ?? [],
      offers: offers.data ?? [],
      customers: [],
      meteringPoints: [],
      messages: [],
      invoiceItems: [],
      invoices: [],
      pricingLines: [],
      providerConnections: providerConnections.data ?? [],
      error: baseErrors.length ? baseErrors.join(' | ') : null,
    }
  }
  const [meteringPoints, messages, invoiceItems, invoices] = await Promise.all([
    supabaseService
      .from('metering_points')
      .select('id,company_id,customer_id,metering_point_id,price_area_code,status,is_test_data,archived_at')
      .in('customer_id', customerIds)
      .eq('is_test_data', true)
      .is('archived_at', null),
    supabaseService
      .from('ediel_messages')
      .select('id,company_id,customer_id,message_code,status,created_at,file_name')
      .in('customer_id', customerIds)
      .eq('environment', 'test')
      .eq('direction', 'inbound')
      .eq('message_family', 'UTILTS')
      .order('created_at', { ascending: false })
      .limit(200),
    supabaseService
      .from('invoice_export_items')
      .select('id,company_id,export_run_id,customer_id,billing_underlay_id,pricing_run_id,environment,status,provider,amount_ex_vat,vat_amount,amount_inc_vat,total_kwh,currency,provider_invoice_guid,provider_invoice_number,provider_confirmed_at,request_payload,response_payload,error_code,error_payload,metadata,created_at,updated_at')
      .in('customer_id', customerIds)
      .eq('environment', 'test')
      .order('created_at', { ascending: false })
      .limit(200),
    supabaseService
      .from('customer_invoices')
      .select('id,company_id,customer_id,invoice_export_item_id,status,invoice_reference,invoice_number,period_start,period_end,total_kwh,amount_ex_vat,vat_amount,amount_inc_vat,currency,due_date,issued_at,partner_invoice_reference,price_area_code,consumption_kwh,calculation_snapshot_sha256,created_at,updated_at')
      .in('customer_id', customerIds)
      .order('created_at', { ascending: false })
      .limit(200),
  ])
  const pricingRunIds = ((invoiceItems.data ?? []) as Row[])
    .map((row) => text(row.pricing_run_id))
    .filter((value): value is string => Boolean(value))
  const pricingLines = pricingRunIds.length > 0
    ? await supabaseService
        .from('pricing_preview_lines')
        .select('id,company_id,pricing_run_id,line_type,description,quantity,unit,unit_price_ex_vat,amount_ex_vat,vat_rate,vat_amount,amount_inc_vat,sort_order')
        .in('pricing_run_id', pricingRunIds)
        .order('sort_order', { ascending: true })
    : { data: [], error: null }
  const errors = [
    ...baseErrors,
    meteringPoints.error?.message,
    messages.error?.message,
    invoiceItems.error?.message,
    invoices.error?.message,
    pricingLines.error?.message,
  ].filter((value): value is string => Boolean(value))
  return {
    companies: companies.data ?? [],
    offers: offers.data ?? [],
    customers: testCustomers,
    meteringPoints: meteringPoints.data ?? [],
    messages: messages.data ?? [],
    invoiceItems: invoiceItems.data ?? [],
    invoices: invoices.data ?? [],
    pricingLines: pricingLines.data ?? [],
    providerConnections: providerConnections.data ?? [],
    error: errors.length ? errors.join(' | ') : null,
  }
}
