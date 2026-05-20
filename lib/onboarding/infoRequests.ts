import { supabaseService } from '@/lib/supabase/service'
import { requireCompanyOperationalForWrites } from '@/lib/tenant/governance'
import { createGridOwnerDataRequest } from '@/lib/cis/db-data'
import { createOutboundRequest } from '@/lib/cis/db-outbound'

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


export type InfoRequestDispatchResult = {
  customerInfoRequest: CustomerInfoRequestRow
  gridOwnerDataRequestId: string | null
  outboundRequestId: string | null
  status: string
  blockerReason: string | null
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10)
}

function isDateBeforeToday(value: string | null | undefined): boolean {
  if (!value) return false
  return value < todayDate()
}

function requestNeedsGridOwnerAuthorization(request: Pick<CustomerInfoRequestRow, 'target_party_type' | 'request_type' | 'requested_data_categories'>): boolean {
  return (
    request.target_party_type === 'grid_owner' ||
    request.request_type === 'z01_customer_masterdata' ||
    request.requested_data_categories.includes('facility_id') ||
    request.requested_data_categories.includes('grid_area') ||
    request.requested_data_categories.includes('annual_consumption') ||
    request.requested_data_categories.includes('customer_masterdata')
  )
}

function requestNeedsSupplierContractAuthorization(request: Pick<CustomerInfoRequestRow, 'target_party_type' | 'requested_data_categories'>): boolean {
  return (
    request.target_party_type === 'current_supplier' ||
    request.requested_data_categories.includes('binding_period') ||
    request.requested_data_categories.includes('termination_notice') ||
    request.requested_data_categories.includes('contract_end_date') ||
    request.requested_data_categories.includes('break_fee')
  )
}

async function listActiveAuthorizationScopesForCustomer(params: {
  companyId: string
  customerId: string
}): Promise<AuthorizationScopeRow[]> {
  const { data, error } = await supabaseService
    .from('authorization_scopes')
    .select('*')
    .eq('company_id', params.companyId)
    .eq('customer_id', params.customerId)
    .eq('status', 'active')
    .is('revoked_at', null)
    .order('created_at', { ascending: false })

  if (error) throw error

  return ((data ?? []) as AuthorizationScopeRow[]).filter((scopeRow) => !isDateBeforeToday(scopeRow.valid_to))
}

function hasAuthorizationForRequest(request: CustomerInfoRequestRow, scopes: AuthorizationScopeRow[]): { ok: boolean; reason: string | null } {
  const needsGridOwner = requestNeedsGridOwnerAuthorization(request)
  const needsSupplier = requestNeedsSupplierContractAuthorization(request)

  if (!needsGridOwner && !needsSupplier) return { ok: true, reason: null }

  if (needsGridOwner && !scopes.some((scopeRow) => scopeRow.covers_grid_owner_data)) {
    return {
      ok: false,
      reason: 'Fullmakt/avtal måste täcka nätägarens anläggnings- och kunduppgifter innan begäran kan skickas.',
    }
  }

  if (needsSupplier && !scopes.some((scopeRow) => scopeRow.covers_current_supplier_contract)) {
    return {
      ok: false,
      reason: 'Fullmakt/avtal måste täcka bindning, uppsägning och uppgifter från nuvarande elhandlare.',
    }
  }

  return { ok: true, reason: null }
}

async function getCustomerInfoRequestById(params: {
  companyId: string
  requestId: string
}): Promise<CustomerInfoRequestRow | null> {
  const { data, error } = await supabaseService
    .from('customer_info_requests')
    .select('*')
    .eq('company_id', params.companyId)
    .eq('id', params.requestId)
    .maybeSingle()

  if (error) throw error
  return (data as CustomerInfoRequestRow | null) ?? null
}

export async function listCustomerInfoRequestsByCustomerId(params: {
  companyId: string
  customerId: string
}): Promise<CustomerInfoRequestRow[]> {
  try {
    const { data, error } = await supabaseService
      .from('customer_info_requests')
      .select('*')
      .eq('company_id', params.companyId)
      .eq('customer_id', params.customerId)
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

export async function listAuthorizationScopesByCustomerId(params: {
  companyId: string
  customerId: string
}): Promise<AuthorizationScopeRow[]> {
  try {
    const { data, error } = await supabaseService
      .from('authorization_scopes')
      .select('*')
      .eq('company_id', params.companyId)
      .eq('customer_id', params.customerId)
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

export async function listMeteringPermissionsByCustomerId(params: {
  companyId: string
  customerId: string
}): Promise<MeteringPermissionRow[]> {
  try {
    const { data, error } = await supabaseService
      .from('metering_permissions')
      .select('*')
      .eq('company_id', params.companyId)
      .eq('customer_id', params.customerId)
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

async function addCustomerInfoRequestEvent(input: {
  companyId: string
  requestId: string
  customerId: string
  actorUserId: string
  eventType: string
  message: string
  payload?: Record<string, unknown>
}) {
  const { error } = await supabaseService.from('customer_info_request_events').insert({
    company_id: input.companyId,
    customer_info_request_id: input.requestId,
    customer_id: input.customerId,
    event_type: input.eventType,
    message: input.message,
    payload: input.payload ?? {},
    created_by: input.actorUserId,
  })

  if (error && !isMissingRelationError(error)) throw error
}

export async function queueCustomerInfoRequestForDispatch(input: {
  companyId: string
  actorUserId: string
  requestId: string
}): Promise<InfoRequestDispatchResult> {
  await requireCompanyOperationalForWrites(input.companyId)

  const request = await getCustomerInfoRequestById({
    companyId: input.companyId,
    requestId: input.requestId,
  })

  if (!request) throw new Error('Uppgiftsbegäran hittades inte för valt bolag.')
  await assertCustomerBelongsToCompany(request.customer_id, input.companyId)

  const scopes = await listActiveAuthorizationScopesForCustomer({
    companyId: input.companyId,
    customerId: request.customer_id,
  })
  const authorization = hasAuthorizationForRequest(request, scopes)

  if (!authorization.ok) {
    const { data, error } = await supabaseService
      .from('customer_info_requests')
      .update({
        status: 'missing_authorization',
        blocker_reason: authorization.reason,
        updated_by: input.actorUserId,
        updated_at: new Date().toISOString(),
      })
      .eq('company_id', input.companyId)
      .eq('id', request.id)
      .select('*')
      .single()

    if (error) throw error

    await addCustomerInfoRequestEvent({
      companyId: input.companyId,
      requestId: request.id,
      customerId: request.customer_id,
      actorUserId: input.actorUserId,
      eventType: 'blocked_missing_authorization',
      message: authorization.reason ?? 'Begäran blockerades av fullmaktskontroll.',
    })

    return {
      customerInfoRequest: data as CustomerInfoRequestRow,
      gridOwnerDataRequestId: null,
      outboundRequestId: null,
      status: 'missing_authorization',
      blockerReason: authorization.reason,
    }
  }

  if (requestNeedsSupplierContractAuthorization(request) && !requestNeedsGridOwnerAuthorization(request)) {
    const { data, error } = await supabaseService
      .from('customer_info_requests')
      .update({
        status: 'manual_review_required',
        blocker_reason: 'Bindningstid, uppsägningstid och avtalsvillkor ska bekräftas från kund eller nuvarande elhandlare. Ingen nätägarroute används för detta.',
        requested_at: new Date().toISOString(),
        updated_by: input.actorUserId,
        updated_at: new Date().toISOString(),
      })
      .eq('company_id', input.companyId)
      .eq('id', request.id)
      .select('*')
      .single()

    if (error) throw error

    await addCustomerInfoRequestEvent({
      companyId: input.companyId,
      requestId: request.id,
      customerId: request.customer_id,
      actorUserId: input.actorUserId,
      eventType: 'manual_supplier_contract_check',
      message: 'Begäran markerades för manuell kontroll mot kund eller nuvarande elhandlare.',
    })

    return {
      customerInfoRequest: data as CustomerInfoRequestRow,
      gridOwnerDataRequestId: null,
      outboundRequestId: null,
      status: 'manual_review_required',
      blockerReason: null,
    }
  }

  const automationKey = `customer-info-request:${request.id}:z01`
  const gridOwnerDataRequest = await createGridOwnerDataRequest({
    actorUserId: input.actorUserId,
    customerId: request.customer_id,
    siteId: request.site_id,
    meteringPointId: request.metering_point_id,
    gridOwnerId: request.grid_owner_id,
    requestScope: 'customer_masterdata',
    externalReference: request.verified_payload?.externalReference as string | null ?? `Z01-${request.id.slice(0, 8).toUpperCase()}`,
    notes: request.notes,
    automationOrigin: 'customer_info_request',
    automationKey,
  })

  const { data, error } = await supabaseService
    .from('customer_info_requests')
    .update({
      status: 'sent_to_grid_owner',
      requested_at: new Date().toISOString(),
      sent_at: new Date().toISOString(),
      blocker_reason: null,
      verified_payload: {
        ...(request.verified_payload ?? {}),
        gridOwnerDataRequestId: gridOwnerDataRequest.id,
        expectedResponse: 'PRODAT Z02 eller negativ APERAK',
        prodatCode: 'Z01',
      },
      updated_by: input.actorUserId,
      updated_at: new Date().toISOString(),
    })
    .eq('company_id', input.companyId)
    .eq('id', request.id)
    .select('*')
    .single()

  if (error) throw error

  await addCustomerInfoRequestEvent({
    companyId: input.companyId,
    requestId: request.id,
    customerId: request.customer_id,
    actorUserId: input.actorUserId,
    eventType: 'z01_ready_for_dispatch',
    message: 'Z01-kontroll är kopplad till nätägarbegäran. Nästa steg är Ediel/route-dispatch eller manuell sändning enligt route.',
    payload: {
      gridOwnerDataRequestId: gridOwnerDataRequest.id,
      prodatCode: 'Z01',
    },
  })

  return {
    customerInfoRequest: data as CustomerInfoRequestRow,
    gridOwnerDataRequestId: gridOwnerDataRequest.id,
    outboundRequestId: null,
    status: 'sent_to_grid_owner',
    blockerReason: null,
  }
}

async function getMeteringPermissionById(params: {
  companyId: string
  permissionId: string
}): Promise<MeteringPermissionRow | null> {
  const { data, error } = await supabaseService
    .from('metering_permissions')
    .select('*')
    .eq('company_id', params.companyId)
    .eq('id', params.permissionId)
    .maybeSingle()

  if (error) throw error
  return (data as MeteringPermissionRow | null) ?? null
}

export async function queueMeteringPermissionForZ13(input: {
  companyId: string
  actorUserId: string
  permissionId: string
}): Promise<{ permission: MeteringPermissionRow; gridOwnerDataRequestId: string | null; outboundRequestId: string | null }> {
  await requireCompanyOperationalForWrites(input.companyId)

  const permission = await getMeteringPermissionById({
    companyId: input.companyId,
    permissionId: input.permissionId,
  })

  if (!permission) throw new Error('Mätvärdestillstånd hittades inte för valt bolag.')
  await assertCustomerBelongsToCompany(permission.customer_id, input.companyId)

  const scopes = await listActiveAuthorizationScopesForCustomer({
    companyId: input.companyId,
    customerId: permission.customer_id,
  })

  if (!scopes.some((scopeRow) => scopeRow.covers_metering_data)) {
    const { data, error } = await supabaseService
      .from('metering_permissions')
      .update({
        status: 'missing_authorization',
        last_blocker: 'Fullmakt/avtal måste täcka mätvärden innan PRODAT Z13 kan skickas.',
        updated_by: input.actorUserId,
        updated_at: new Date().toISOString(),
      })
      .eq('company_id', input.companyId)
      .eq('id', permission.id)
      .select('*')
      .single()

    if (error) throw error
    return { permission: data as MeteringPermissionRow, gridOwnerDataRequestId: null, outboundRequestId: null }
  }

  const automationKey = `metering-permission:${permission.id}:z13`
  const gridOwnerDataRequest = await createGridOwnerDataRequest({
    actorUserId: input.actorUserId,
    customerId: permission.customer_id,
    siteId: permission.site_id,
    meteringPointId: permission.metering_point_id,
    gridOwnerId: permission.grid_owner_id,
    requestScope: 'meter_values',
    requestedPeriodStart: permission.requested_start_date,
    requestedPeriodEnd: permission.requested_end_date,
    externalReference: permission.case_reference ?? `Z13-${permission.id.slice(0, 8).toUpperCase()}`,
    notes: 'Skapad från mätvärdestillstånd/Z13-flöde.',
    automationOrigin: 'metering_permission',
    automationKey,
  })

  const outbound = await createOutboundRequest({
    actorUserId: input.actorUserId,
    customerId: permission.customer_id,
    siteId: permission.site_id,
    meteringPointId: permission.metering_point_id,
    gridOwnerId: permission.grid_owner_id,
    requestType: 'meter_values',
    sourceType: 'grid_owner_data_request',
    sourceId: gridOwnerDataRequest.id,
    periodStart: permission.requested_start_date,
    periodEnd: permission.requested_end_date,
    externalReference: permission.case_reference ?? gridOwnerDataRequest.external_reference,
    automationOrigin: 'metering_permission_z13',
    automationKey: `outbound:${automationKey}`,
    payload: {
      prodatCode: 'Z13',
      expectedResponse: 'PRODAT Z14 V/VH eller Z14N',
      meteringPermissionId: permission.id,
      gridOwnerDataRequestId: gridOwnerDataRequest.id,
    },
  })

  const metadata = {
    ...(permission as unknown as { metadata?: Record<string, unknown> }).metadata ?? {},
    z13: {
      gridOwnerDataRequestId: gridOwnerDataRequest.id,
      outboundRequestId: outbound.id,
      queuedAt: new Date().toISOString(),
    },
  }

  const { data, error } = await supabaseService
    .from('metering_permissions')
    .update({
      status: 'z13_sent',
      case_reference: permission.case_reference ?? gridOwnerDataRequest.external_reference,
      last_blocker: null,
      metadata,
      updated_by: input.actorUserId,
      updated_at: new Date().toISOString(),
    })
    .eq('company_id', input.companyId)
    .eq('id', permission.id)
    .select('*')
    .single()

  if (error) throw error

  return {
    permission: data as MeteringPermissionRow,
    gridOwnerDataRequestId: gridOwnerDataRequest.id,
    outboundRequestId: outbound.id,
  }
}

export async function applyZ14SnapshotToMeteringPermission(input: {
  companyId: string
  actorUserId: string
  permissionId: string
  permissionReference?: string | null
  approvedStartDate?: string | null
  approvedEndDate?: string | null
  resolutionCode?: string | null
  reportFrequency?: string | null
  approvedSites?: Array<{ siteId?: string | null; meteringPointId?: string | null; facilityId?: string | null; gridAreaCode?: string | null; status?: string | null }>
}) {
  await requireCompanyOperationalForWrites(input.companyId)

  const permission = await getMeteringPermissionById({ companyId: input.companyId, permissionId: input.permissionId })
  if (!permission) throw new Error('Mätvärdestillstånd hittades inte för valt bolag.')

  const approvedSites = input.approvedSites ?? []
  const status = approvedSites.some((site) => (site.status ?? 'approved') === 'approved')
    ? approvedSites.length > 1
      ? 'partially_approved'
      : 'z14_received'
    : 'rejected_active'

  const { data, error } = await supabaseService
    .from('metering_permissions')
    .update({
      status,
      permission_reference: input.permissionReference ?? permission.permission_reference,
      approved_start_date: input.approvedStartDate ?? permission.approved_start_date,
      approved_end_date: input.approvedEndDate ?? permission.approved_end_date,
      resolution_code: input.resolutionCode ?? permission.resolution_code,
      report_frequency: input.reportFrequency ?? permission.report_frequency,
      last_blocker: status === 'rejected_active' ? 'Z14 markerade begäran som nekad.' : null,
      metadata: {
        ...(permission as unknown as { metadata?: Record<string, unknown> }).metadata ?? {},
        z14: {
          appliedAt: new Date().toISOString(),
          approvedSites,
        },
      },
      updated_by: input.actorUserId,
      updated_at: new Date().toISOString(),
    })
    .eq('company_id', input.companyId)
    .eq('id', permission.id)
    .select('*')
    .single()

  if (error) throw error

  if (approvedSites.length > 0) {
    const rows = approvedSites.map((site) => ({
      company_id: input.companyId,
      metering_permission_id: permission.id,
      customer_id: permission.customer_id,
      site_id: site.siteId ?? permission.site_id,
      metering_point_id: site.meteringPointId ?? permission.metering_point_id,
      facility_id: site.facilityId ?? null,
      grid_area_code: site.gridAreaCode ?? null,
      status: site.status ?? 'approved',
      start_date: input.approvedStartDate ?? permission.approved_start_date,
      end_date: input.approvedEndDate ?? permission.approved_end_date,
      metadata: { source: 'z14_snapshot' },
    }))

    const { error: siteError } = await supabaseService
      .from('metering_permission_sites')
      .insert(rows)

    if (siteError && !isMissingRelationError(siteError)) throw siteError
  }

  return data as MeteringPermissionRow
}
