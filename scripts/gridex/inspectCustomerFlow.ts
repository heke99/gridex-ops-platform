/**
 * Schema-aware customer flow inspector.
 *
 * Prints the complete pipeline state for one customer:
 *   customers, customer_sites, metering_points, customer_contracts,
 *   website_customer_applications, customer_legal_acceptances,
 *   powers_of_attorney, customer_authorization_documents,
 *   authorization_scopes, grid_owner_information_requests,
 *   manual_email_outbox, customer_info_requests, grid_owner_data_requests,
 *   outbound_requests, ediel_message_intents, ediel_messages, ediel_outbox,
 *   communication_logs + tenant_email_outbox (the communication source of
 *   truth), supplier_switch_requests, customer_operation_jobs,
 *   customer_operation_events and audit logs.
 *
 * SCHEMA-AWARE BY DESIGN: every read uses select('*') plus existence-tolerant
 * error handling; a missing table or column reports `table_missing` /
 * `column_missing` instead of crashing. It never queries known-nonexistent
 * columns (customer_sites.metering_point_id, powers_of_attorney.externally_sendable,
 * grid_owner_information_requests.site_id, manual_email_outbox.recipient_email)
 * and never reads the nonexistent customer_communication_logs table.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   node --experimental-strip-types scripts/gridex/inspectCustomerFlow.ts \
 *     --customer <uuid> | --customer-number DX-100026 | --email a@b.se \
 *     [--company <uuid>] [--json]
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

type JsonRecord = Record<string, unknown>

const args = process.argv.slice(2)
function argValue(flag: string): string | null {
  const index = args.indexOf(flag)
  return index > -1 ? args[index + 1] ?? null : null
}
const AS_JSON = args.includes('--json')
const CUSTOMER_ID = argValue('--customer')
const CUSTOMER_NUMBER = argValue('--customer-number')
const EMAIL = argValue('--email')
const COMPANY_ID = argValue('--company')

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY are required.')
  process.exit(1)
}
if (!CUSTOMER_ID && !CUSTOMER_NUMBER && !EMAIL) {
  console.error('Provide --customer <uuid>, --customer-number <number> or --email <email>.')
  process.exit(1)
}

const supabase: SupabaseClient = createClient(url, key, { auth: { persistSession: false } })

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function missingSchema(error: unknown): { missing: boolean; kind: 'table_missing' | 'column_missing' | null } {
  const code = String((error as { code?: unknown } | null)?.code ?? '')
  const message = String((error as { message?: unknown } | null)?.message ?? '')
  if (code === '42P01' || code === 'PGRST205' || /relation .* does not exist/i.test(message)) {
    return { missing: true, kind: 'table_missing' }
  }
  if (code === '42703' || code === 'PGRST204' || /column .* does not exist/i.test(message)) {
    return { missing: true, kind: 'column_missing' }
  }
  return { missing: false, kind: null }
}

type SectionResult = {
  table: string
  status: 'ok' | 'table_missing' | 'column_missing' | 'error' | 'skipped'
  rows: JsonRecord[]
  note?: string
}

async function readTable(
  table: string,
  applyFilters: (query: ReturnType<SupabaseClient['from']>['select'] extends never ? never : ReturnType<ReturnType<SupabaseClient['from']>['select']>) => unknown,
  note?: string,
): Promise<SectionResult> {
  try {
    const base = supabase.from(table).select('*').limit(100)
    const query = applyFilters(base as never) as PromiseLike<{ data: unknown; error: unknown }>
    const { data, error } = await query
    if (error) {
      const schema = missingSchema(error)
      if (schema.missing) return { table, status: schema.kind ?? 'table_missing', rows: [], note }
      return { table, status: 'error', rows: [], note: String((error as { message?: unknown }).message ?? error) }
    }
    return { table, status: 'ok', rows: (data as JsonRecord[] | null) ?? [], note }
  } catch (error) {
    const schema = missingSchema(error)
    if (schema.missing) return { table, status: schema.kind ?? 'table_missing', rows: [], note }
    return { table, status: 'error', rows: [], note: String(error) }
  }
}

const DIRTY_MARKERS = ['manual_test_patch', 'manual_sql', 'route_materialized_manually']

function dirtyMarkers(rows: JsonRecord[]): string[] {
  const found = new Set<string>()
  for (const row of rows) {
    const serialized = JSON.stringify(row)
    for (const marker of DIRTY_MARKERS) {
      if (serialized.includes(marker)) found.add(marker)
    }
  }
  return Array.from(found)
}

function summarizeRow(table: string, row: JsonRecord): string {
  const parts: string[] = []
  const push = (label: string, value: unknown) => {
    const cleanValue = text(value) ?? (typeof value === 'boolean' ? String(value) : null)
    if (cleanValue) parts.push(`${label}=${cleanValue}`)
  }
  push('id', row.id)
  push('status', row.status)
  push('validation_status', row.validation_status)
  push('render_status', row.render_status)
  push('outbox_status', row.outbox_status)
  push('request_type', row.request_type)
  push('business_process', row.business_process)
  push('message_code', row.message_code)
  push('event_key', row.event_key)
  push('event_type', row.event_type)
  push('facility_id', row.facility_id)
  push('metering_point_id', row.metering_point_id)
  push('grid_area_code', row.grid_area_code)
  push('price_area_code', row.price_area_code)
  push('grid_owner_id', row.grid_owner_id)
  push('to_email', row.to_email)
  push('recipient_email', row.recipient_email)
  push('provider_message_id', row.provider_message_id)
  push('created_at', row.created_at)
  void table
  return parts.join(' ')
}

async function main() {
  // 1) Resolve the customer.
  let customerQuery = supabase.from('customers').select('*').limit(5)
  if (COMPANY_ID) customerQuery = customerQuery.eq('company_id', COMPANY_ID)
  if (CUSTOMER_ID) customerQuery = customerQuery.eq('id', CUSTOMER_ID)
  else if (CUSTOMER_NUMBER) customerQuery = customerQuery.eq('customer_number', CUSTOMER_NUMBER)
  else if (EMAIL) customerQuery = customerQuery.eq('email', EMAIL)

  const customerResult = await customerQuery
  if (customerResult.error) {
    console.error('customers lookup failed:', customerResult.error.message)
    process.exit(1)
  }
  const customers = (customerResult.data ?? []) as JsonRecord[]
  if (customers.length === 0) {
    console.error('No customer matched the given identifier.')
    process.exit(1)
  }
  if (customers.length > 1) {
    console.error(`Ambiguous identifier: ${customers.length} customers matched. Pass --customer <uuid>.`)
    for (const row of customers) console.error(`  ${row.id} ${row.customer_number ?? ''} ${row.email ?? ''}`)
    process.exit(1)
  }
  const customer = customers[0]
  const customerId = String(customer.id)
  const companyId = text(customer.company_id)

  const scoped = (builder: { eq: (column: string, value: string) => unknown }) => {
    let next = builder.eq('customer_id', customerId) as { eq: (column: string, value: string) => unknown }
    if (companyId) next = next.eq('company_id', companyId) as typeof next
    return next
  }

  const sections: SectionResult[] = []
  sections.push({ table: 'customers', status: 'ok', rows: [customer] })

  const sites = await readTable('customer_sites', (query) => scoped(query as never))
  sections.push(sites)
  const siteIds = sites.rows.map((row) => text(row.id)).filter((value): value is string => Boolean(value))

  sections.push(await readTable('metering_points', (query) => scoped(query as never)))
  sections.push(await readTable('customer_contracts', (query) => scoped(query as never)))
  sections.push(await readTable('website_customer_applications', (query) => scoped(query as never)))
  sections.push(await readTable('customer_legal_acceptances', (query) => scoped(query as never)))
  sections.push(await readTable('powers_of_attorney', (query) => scoped(query as never)))
  sections.push(await readTable('customer_authorization_documents', (query) => scoped(query as never)))
  sections.push(await readTable('authorization_scopes', (query) => scoped(query as never)))

  // grid_owner_information_requests: the site FK column is customer_site_id.
  const gridOwnerRequests = await readTable('grid_owner_information_requests', (query) => scoped(query as never))
  sections.push(gridOwnerRequests)
  const gridOwnerRequestIds = gridOwnerRequests.rows
    .map((row) => text(row.id))
    .filter((value): value is string => Boolean(value))

  // manual_email_outbox has no customer_id: join through request_id (and the
  // recipient column is to_email).
  if (gridOwnerRequestIds.length > 0) {
    sections.push(await readTable('manual_email_outbox', (query) => (query as never as { in: (column: string, values: string[]) => unknown }).in('request_id', gridOwnerRequestIds)))
  } else {
    sections.push({ table: 'manual_email_outbox', status: 'skipped', rows: [], note: 'no grid_owner_information_requests to join on' })
  }

  sections.push(await readTable('customer_info_requests', (query) => scoped(query as never)))
  sections.push(await readTable('grid_owner_data_requests', (query) => scoped(query as never)))

  const outbound = await readTable('outbound_requests', (query) => scoped(query as never))
  sections.push(outbound)
  const outboundIds = outbound.rows.map((row) => text(row.id)).filter((value): value is string => Boolean(value))

  const intents = await readTable('ediel_message_intents', (query) => scoped(query as never))
  sections.push(intents)
  const intentIds = intents.rows.map((row) => text(row.id)).filter((value): value is string => Boolean(value))

  const messages = await readTable('ediel_messages', (query) => scoped(query as never))
  sections.push(messages)
  const messageIds = messages.rows.map((row) => text(row.id)).filter((value): value is string => Boolean(value))

  if (intentIds.length > 0 || messageIds.length > 0) {
    sections.push(await readTable('ediel_outbox', (query) => {
      const builder = query as never as { or: (filters: string) => unknown; in: (column: string, values: string[]) => unknown }
      if (intentIds.length > 0 && messageIds.length > 0) {
        return builder.or(`intent_id.in.(${intentIds.join(',')}),ediel_message_id.in.(${messageIds.join(',')})`)
      }
      return intentIds.length > 0 ? builder.in('intent_id', intentIds) : builder.in('ediel_message_id', messageIds)
    }))
  } else {
    sections.push({ table: 'ediel_outbox', status: 'skipped', rows: [], note: 'no intents/messages to join on' })
  }

  // Communication source of truth: communication_logs (+ tenant_email_outbox).
  // customer_communication_logs does NOT exist and customer_communications is
  // a deprecated orphan table — neither is queried here.
  const communicationLogs = await readTable('communication_logs', (query) => scoped(query as never), 'communication source of truth')
  sections.push(communicationLogs)
  const logIds = communicationLogs.rows.map((row) => text(row.id)).filter((value): value is string => Boolean(value))
  if (logIds.length > 0) {
    sections.push(await readTable('tenant_email_outbox', (query) => (query as never as { in: (column: string, values: string[]) => unknown }).in('communication_log_id', logIds)))
  } else {
    sections.push({ table: 'tenant_email_outbox', status: 'skipped', rows: [], note: 'no communication_logs to join on' })
  }

  sections.push(await readTable('supplier_switch_requests', (query) => scoped(query as never)))
  sections.push(await readTable('customer_operation_jobs', (query) => scoped(query as never)))
  sections.push(await readTable('customer_operation_events', (query) => scoped(query as never)))
  sections.push(await readTable('audit_logs', (query) => {
    const builder = query as never as { in: (column: string, values: string[]) => unknown }
    return builder.in('entity_id', [customerId, ...siteIds, ...outboundIds].slice(0, 50))
  }, 'audit entries for customer/site/outbound entities'))

  // Dirty test data detection across all sections.
  const dirty: Array<{ table: string; markers: string[] }> = []
  for (const section of sections) {
    const markers = dirtyMarkers(section.rows)
    if (markers.length > 0) dirty.push({ table: section.table, markers })
  }
  const isTestData = customer.is_test_data === true

  if (AS_JSON) {
    console.log(JSON.stringify({ customer_id: customerId, company_id: companyId, is_test_data: isTestData, dirty, sections }, null, 2))
    return
  }

  console.log(`Customer flow inspection: ${customerId} (${customer.customer_number ?? 'no number'}) company=${companyId ?? '-'}`)
  if (isTestData) console.log('!! customer is marked is_test_data — rows are NOT production proof')
  if (dirty.length > 0) {
    console.log(`!! dirty test-data markers found: ${dirty.map((entry) => `${entry.table}[${entry.markers.join('+')}]`).join(', ')}`)
  }
  for (const section of sections) {
    const header = `— ${section.table}: ${section.status}${section.status === 'ok' ? ` (${section.rows.length} rows)` : ''}${section.note ? ` [${section.note}]` : ''}`
    console.log(header)
    for (const row of section.rows.slice(0, 20)) {
      console.log(`    ${summarizeRow(section.table, row)}`)
    }
    if (section.rows.length > 20) console.log(`    ... ${section.rows.length - 20} more rows (use --json)`)
  }
}

main().catch((error) => {
  console.error('inspectCustomerFlow failed:', error)
  process.exit(1)
})
