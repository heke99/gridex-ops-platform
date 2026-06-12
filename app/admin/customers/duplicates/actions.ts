'use server'

import { revalidatePath } from 'next/cache'
import { requireAdminActionAccess, requireCompanyScopedActionAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'

type Json = Record<string, unknown>

type CustomerForMerge = {
  id: string
  company_id: string | null
  customer_number: string | null
  full_name: string | null
  company_name: string | null
  email: string | null
  status: string | null
}

function getString(formData: FormData, key: string): string {
  return String(formData.get(key) ?? '').trim()
}

function getStrings(formData: FormData, key: string): string[] {
  return formData
    .getAll(key)
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
}

function isDatabaseShapeError(error: unknown): boolean {
  const maybe = error as { code?: string; message?: string } | null
  return Boolean(
    maybe &&
      (maybe.code === '42P01' ||
        maybe.code === '42703' ||
        maybe.code === 'PGRST205' ||
        /does not exist|schema cache|relation .* does not exist/i.test(maybe.message ?? ''))
  )
}

async function loadCustomer(customerId: string): Promise<CustomerForMerge> {
  const { data, error } = await supabaseService
    .from('customers')
    .select('id, company_id, customer_number, full_name, company_name, email, status')
    .eq('id', customerId)
    .maybeSingle()

  if (error) throw error
  if (!data) throw new Error('Kunden hittades inte.')
  return data as CustomerForMerge
}

async function countRows(table: string, customerId: string): Promise<number | null> {
  try {
    const { count, error } = await supabaseService
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', customerId)

    if (error) {
      if (isDatabaseShapeError(error)) return null
      throw error
    }
    return count ?? 0
  } catch (error) {
    if (isDatabaseShapeError(error)) return null
    throw error
  }
}

async function moveCustomerScopedRows(params: {
  table: string
  fromCustomerId: string
  toCustomerId: string
  companyId: string | null
  actorUserId: string
}): Promise<number | null> {
  try {
    const before = await countRows(params.table, params.fromCustomerId)
    const updatePayload: Json = {
      customer_id: params.toCustomerId,
    }

    if (params.table !== 'customer_import_rows') {
      updatePayload.updated_by = params.actorUserId
    }

    let query = supabaseService
      .from(params.table)
      .update(updatePayload)
      .eq('customer_id', params.fromCustomerId)

    if (params.companyId) {
      query = query.eq('company_id', params.companyId)
    }

    const { error } = await query
    if (error) {
      if (isDatabaseShapeError(error)) return null
      throw error
    }

    return before
  } catch (error) {
    if (isDatabaseShapeError(error)) return null
    throw error
  }
}

async function mergeSingleCustomer(params: {
  primary: CustomerForMerge
  source: CustomerForMerge
  actorUserId: string
  reason: string | null
}) {
  if (!params.primary.company_id || !params.source.company_id) {
    throw new Error('Båda kunderna måste ha bolagskoppling för säker merge.')
  }

  if (params.primary.company_id !== params.source.company_id) {
    throw new Error('Merge mellan olika bolag/tenants är blockerad.')
  }

  const tables = [
    'customer_sites',
    'metering_points',
    'customer_contacts',
    'customer_addresses',
    'customer_contracts',
    'customer_contract_events',
    'powers_of_attorney',
    'power_of_attorney_scopes',
    'authorization_scopes',
    'customer_authorization_documents',
    'customer_cases',
    'customer_case_events',
    'customer_info_requests',
    'customer_info_request_events',
    'customer_internal_notes',
    'customer_operation_tasks',
    'customer_lifecycle_decisions',
    'customer_lifecycle_events',
    'customer_duplicate_resolution_events',
    'customer_readiness_snapshots',
    'document_ai_extractions',
    'supplier_switch_requests',
    'supplier_switch_events',
    'grid_owner_data_requests',
    'outbound_requests',
    'outbound_dispatch_events',
    'billing_underlays',
    'billing_export_run_items',
    'partner_exports',
    'tenant_email_outbox',
    'ediel_messages',
    'customer_import_rows',
  ]

  const moved: Record<string, number | null> = {}
  for (const table of tables) {
    moved[table] = await moveCustomerScopedRows({
      table,
      fromCustomerId: params.source.id,
      toCustomerId: params.primary.id,
      companyId: params.primary.company_id,
      actorUserId: params.actorUserId,
    })
  }

  const sourceSnapshot = {
    id: params.source.id,
    customer_number: params.source.customer_number,
    full_name: params.source.full_name,
    company_name: params.source.company_name,
    email: params.source.email,
    status: params.source.status,
  }

  const { error: customerUpdateError } = await supabaseService
    .from('customers')
    .update({
      status: 'inactive',
      merge_status: 'merged',
      merged_into_customer_id: params.primary.id,
      merged_at: new Date().toISOString(),
      merged_by: params.actorUserId,
      duplicate_review_status: 'merged',
      possible_duplicate: false,
      updated_by: params.actorUserId,
    })
    .eq('company_id', params.primary.company_id)
    .eq('id', params.source.id)

  if (customerUpdateError && !isDatabaseShapeError(customerUpdateError)) {
    throw customerUpdateError
  }

  await supabaseService
    .from('customer_merge_events')
    .insert({
      company_id: params.primary.company_id,
      primary_customer_id: params.primary.id,
      merged_customer_id: params.source.id,
      reason: params.reason,
      moved_counts: moved,
      source_snapshot: sourceSnapshot,
      created_by: params.actorUserId,
    })
    .then(({ error }) => {
      if (error && !isDatabaseShapeError(error)) throw error
    })

  await supabaseService
    .from('audit_logs')
    .insert({
      actor_user_id: params.actorUserId,
      company_id: params.primary.company_id,
      entity_type: 'customer_merge',
      entity_id: params.primary.id,
      action: 'customers_merged',
      old_values: { source: sourceSnapshot },
      new_values: {
        primaryCustomerId: params.primary.id,
        mergedCustomerId: params.source.id,
        moved,
      },
      metadata: {
        reason: params.reason,
        crossTenantBlocked: false,
      },
    })
}

export async function mergeCustomersAction(formData: FormData) {
  await requireAdminActionAccess({ allOf: ['customers.write'] })
  const primaryCustomerId = getString(formData, 'primaryCustomerId')
  const reason = getString(formData, 'reason') || null
  const rawSourceIds = getStrings(formData, 'sourceCustomerIds')
  const sourceCustomerIds = Array.from(new Set(rawSourceIds)).filter(
    (id) => id && id !== primaryCustomerId
  )

  if (!primaryCustomerId) throw new Error('Välj huvudkund innan merge körs.')
  if (sourceCustomerIds.length === 0) throw new Error('Välj minst en kund som ska slås ihop till huvudkunden.')
  if (!reason) throw new Error('Ange orsak. Merge påverkar avtal, anläggningar, fullmakter, driftuppgifter och fakturering.')

  const primary = await loadCustomer(primaryCustomerId)
  if (!primary.company_id) throw new Error('Huvudkunden saknar bolagskoppling och kan inte användas för säker merge.')

  const admin = await requireCompanyScopedActionAccess(primary.company_id, { allOf: ['customers.write'] })
  const actorUserId = admin.userId
  const sources = await Promise.all(sourceCustomerIds.map((id) => loadCustomer(id)))

  for (const source of sources) {
    if (source.company_id !== primary.company_id) {
      throw new Error('Merge mellan olika bolag/tenants är blockerad.')
    }
  }

  for (const source of sources) {
    await mergeSingleCustomer({ primary, source, actorUserId, reason })
  }

  revalidatePath('/admin/customers')
  revalidatePath('/admin/customers/duplicates')
  revalidatePath(`/admin/customers/${primaryCustomerId}`)
  for (const sourceId of sourceCustomerIds) revalidatePath(`/admin/customers/${sourceId}`)
}
