import { supabaseService } from '@/lib/supabase/service'
import { requireCompanyOperationalForWrites } from '@/lib/tenant/governance'

export type CustomerOption = {
  id: string
  label: string
  sublabel: string | null
}

export type CustomerInfoRequestRow = {
  id: string
  company_id: string
  customer_id: string
  site_id: string | null
  metering_point_id: string | null
  authorization_document_id: string | null
  request_type: string
  target_party_type: string
  target_party_name: string | null
  grid_owner_id: string | null
  current_supplier_name: string | null
  status: string
  requested_data_categories: string[]
  verified_payload: Record<string, unknown>
  blocker_reason: string | null
  notes: string | null
  requested_at: string | null
  sent_at: string | null
  received_at: string | null
  created_at: string
  updated_at: string
  created_by: string | null
}

export type AuthorizationScopeRow = {
  id: string
  company_id: string
  customer_id: string
  authorization_document_id: string | null
  scope_type: string
  status: string
  covers_grid_owner_data: boolean
  covers_current_supplier_contract: boolean
  covers_metering_data: boolean
  valid_from: string | null
  valid_to: string | null
  revoked_at: string | null
  evidence_note: string | null
  created_at: string
}

export type MeteringPermissionRow = {
  id: string
  company_id: string
  customer_id: string
  site_id: string | null
  metering_point_id: string | null
  grid_owner_id: string | null
  authorization_document_id: string | null
  permission_reference: string | null
  case_reference: string | null
  status: string
  requested_start_date: string | null
  requested_end_date: string | null
  approved_start_date: string | null
  approved_end_date: string | null
  resolution_code: string | null
  report_frequency: string | null
  last_blocker: string | null
  created_at: string
  updated_at: string
}

export type PricingCustomerContext = {
  customer_id: string
  site_id: string | null
  metering_point_id: string | null
}

function isMissingRelationError(error: unknown): boolean {
  const maybe = error as { code?: string; message?: string } | null
  return Boolean(
    maybe &&
      (maybe.code === '42P01' ||
        maybe.code === '42703' ||
        maybe.code === 'PGRST205' ||
        /does not exist|schema cache|relation .* does not exist/i.test(maybe.message ?? ''))
  )
}

function customerLabel(row: Record<string, unknown>): string {
  const companyName = String(row.company_name ?? '').trim()
  const fullName = String(row.full_name ?? '').trim()
  const firstName = String(row.first_name ?? '').trim()
  const lastName = String(row.last_name ?? '').trim()
  const personal = String(row.personal_number ?? '').trim()
  const org = String(row.org_number ?? '').trim()
  const base = companyName || fullName || [firstName, lastName].filter(Boolean).join(' ') || personal || org || String(row.id)
  return base
}

export async function listCustomersForInfoRequestSelector(companyId: string): Promise<CustomerOption[]> {
  try {
    const { data, error } = await supabaseService
      .from('customers')
      .select('id, customer_number, first_name, last_name, full_name, company_name, email, personal_number, org_number')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(80)

    if (error) {
      if (isMissingRelationError(error)) return []
      throw error
    }

    return (data ?? []).map((row) => ({
      id: String(row.id),
      label: customerLabel(row as Record<string, unknown>),
      sublabel: [row.customer_number, row.email, row.personal_number, row.org_number].filter(Boolean).join(' · ') || null,
    }))
  } catch (error) {
    if (isMissingRelationError(error)) return []
    throw error
  }
}

export async function listCustomerInfoRequests(companyId: string): Promise<CustomerInfoRequestRow[]> {
  try {
    const { data, error } = await supabaseService
      .from('customer_info_requests')
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(80)

    if (error) {
      if (isMissingRelationError(error)) return []
      throw error
    }

    return (data ?? []) as CustomerInfoRequestRow[]
  } catch (error) {
    if (isMissingRelationError(error)) return []
    throw error
  }
}

export async function listAuthorizationScopes(companyId: string): Promise<AuthorizationScopeRow[]> {
  try {
    const { data, error } = await supabaseService
      .from('authorization_scopes')
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(80)

    if (error) {
      if (isMissingRelationError(error)) return []
      throw error
    }

    return (data ?? []) as AuthorizationScopeRow[]
  } catch (error) {
    if (isMissingRelationError(error)) return []
    throw error
  }
}

export async function listMeteringPermissions(companyId: string): Promise<MeteringPermissionRow[]> {
  try {
    const { data, error } = await supabaseService
      .from('metering_permissions')
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(80)

    if (error) {
      if (isMissingRelationError(error)) return []
      throw error
    }

    return (data ?? []) as MeteringPermissionRow[]
  } catch (error) {
    if (isMissingRelationError(error)) return []
    throw error
  }
}

async function assertCustomerBelongsToCompany(customerId: string, companyId: string) {
  const { data, error } = await supabaseService
    .from('customers')
    .select('id, company_id')
    .eq('id', customerId)
    .eq('company_id', companyId)
    .maybeSingle()

  if (error) throw error
  if (!data?.id) throw new Error('Kunden tillhör inte valt bolag eller saknas.')
}

export async function createCustomerInfoRequest(input: {
  companyId: string
  actorUserId: string
  customerId: string
  requestType: string
  targetPartyType: string
  targetPartyName?: string | null
  gridOwnerId?: string | null
  currentSupplierName?: string | null
  requestedDataCategories: string[]
  notes?: string | null
}) {
  await requireCompanyOperationalForWrites(input.companyId)
  await assertCustomerBelongsToCompany(input.customerId, input.companyId)

  const normalizedCategories = Array.from(new Set(input.requestedDataCategories.map((value) => value.trim()).filter(Boolean)))
  if (normalizedCategories.length === 0) {
    throw new Error('Välj minst en uppgift som ska begäras eller kontrolleras.')
  }

  const { data, error } = await supabaseService
    .from('customer_info_requests')
    .insert({
      company_id: input.companyId,
      customer_id: input.customerId,
      request_type: input.requestType,
      target_party_type: input.targetPartyType,
      target_party_name: input.targetPartyName ?? null,
      grid_owner_id: input.gridOwnerId ?? null,
      current_supplier_name: input.currentSupplierName ?? null,
      status: 'draft',
      requested_data_categories: normalizedCategories,
      verified_payload: {},
      notes: input.notes ?? null,
      created_by: input.actorUserId,
      updated_by: input.actorUserId,
    })
    .select('*')
    .single()

  if (error) throw error

  await supabaseService.from('customer_info_request_events').insert({
    company_id: input.companyId,
    customer_info_request_id: data.id,
    customer_id: input.customerId,
    event_type: 'created',
    message: 'Uppgiftsbegäran skapades.',
    payload: { requested_data_categories: normalizedCategories },
    created_by: input.actorUserId,
  })

  return data as CustomerInfoRequestRow
}

export async function createAuthorizationScope(input: {
  companyId: string
  actorUserId: string
  customerId: string
  scopeType: string
  coversGridOwnerData: boolean
  coversCurrentSupplierContract: boolean
  coversMeteringData: boolean
  validFrom?: string | null
  validTo?: string | null
  evidenceNote?: string | null
}) {
  await requireCompanyOperationalForWrites(input.companyId)
  await assertCustomerBelongsToCompany(input.customerId, input.companyId)

  const { data, error } = await supabaseService
    .from('authorization_scopes')
    .insert({
      company_id: input.companyId,
      customer_id: input.customerId,
      scope_type: input.scopeType,
      status: 'active',
      covers_grid_owner_data: input.coversGridOwnerData,
      covers_current_supplier_contract: input.coversCurrentSupplierContract,
      covers_metering_data: input.coversMeteringData,
      valid_from: input.validFrom ?? null,
      valid_to: input.validTo ?? null,
      evidence_note: input.evidenceNote ?? null,
      created_by: input.actorUserId,
      updated_by: input.actorUserId,
    })
    .select('*')
    .single()

  if (error) throw error
  return data as AuthorizationScopeRow
}

export async function createMeteringPermissionDraft(input: {
  companyId: string
  actorUserId: string
  customerId: string
  siteId?: string | null
  meteringPointId?: string | null
  gridOwnerId?: string | null
  requestedStartDate?: string | null
  requestedEndDate?: string | null
  caseReference?: string | null
  lastBlocker?: string | null
}) {
  await requireCompanyOperationalForWrites(input.companyId)
  await assertCustomerBelongsToCompany(input.customerId, input.companyId)

  const { data, error } = await supabaseService
    .from('metering_permissions')
    .insert({
      company_id: input.companyId,
      customer_id: input.customerId,
      site_id: input.siteId ?? null,
      metering_point_id: input.meteringPointId ?? null,
      grid_owner_id: input.gridOwnerId ?? null,
      status: input.lastBlocker ? 'blocked' : 'draft',
      requested_start_date: input.requestedStartDate ?? null,
      requested_end_date: input.requestedEndDate ?? null,
      case_reference: input.caseReference ?? null,
      last_blocker: input.lastBlocker ?? null,
      created_by: input.actorUserId,
      updated_by: input.actorUserId,
    })
    .select('*')
    .single()

  if (error) throw error
  return data as MeteringPermissionRow
}
