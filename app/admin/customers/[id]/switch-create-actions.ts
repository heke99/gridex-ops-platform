'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import {
  findElectricitySupplierMatch,
  saveElectricitySupplier,
} from '@/lib/masterdata/db'
import {
  resolveOwnElectricitySupplier,
  setOwnElectricitySupplier,
} from '@/lib/masterdata/selfSupplier'
import { evaluateSiteSwitchReadiness } from '@/lib/operations/readiness'
import {
  createSupplierSwitchEvent,
  findCustomerSiteById,
  findOpenSupplierSwitchRequestForSite,
  listMeteringPointsForSite,
  listPowersOfAttorneyByCustomerId,
  syncOperationTasksFromReadiness,
} from '@/lib/operations/db'

type SwitchRequestType = 'switch' | 'move_in' | 'move_out_takeover'
type SwitchDirection = 'to_us' | 'from_us' | 'manual'

type RouteRow = {
  id: string
  route_type: string | null
  route_name: string | null
  target_system: string | null
  target_email: string | null
  is_active: boolean
}

function formValue(formData: FormData, key: string): string | null {
  const value = formData.get(key)
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function checkboxValue(formData: FormData, key: string): boolean {
  const value = formData.get(key)
  return value === 'on' || value === 'true' || value === '1'
}

function normalizeDate(value: string | null): string | null {
  if (!value) return null
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
}

function normalizeSwitchRequestType(value: string | null): SwitchRequestType {
  if (value === 'move_in' || value === 'move_out_takeover') return value
  return 'switch'
}

function normalizeSwitchDirection(value: string | null): SwitchDirection {
  if (value === 'from_us' || value === 'manual') return value
  return 'to_us'
}

function mapRouteTypeToChannelType(routeType: string | null): string {
  switch (routeType) {
    case 'partner_api':
      return 'partner_api'
    case 'ediel_partner':
      return 'ediel_partner'
    case 'file_export':
      return 'file_export'
    case 'email_manual':
      return 'email_manual'
    default:
      return 'unresolved'
  }
}

async function getActor() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error('Du måste vara inloggad.')
  }

  return {
    supabase,
    user,
  }
}

async function insertAuditLog(params: {
  actorUserId: string
  entityType: string
  entityId: string
  action: string
  metadata?: unknown
  newValues?: unknown
}) {
  const { error } = await supabaseService.from('audit_logs').insert({
    actor_user_id: params.actorUserId,
    entity_type: params.entityType,
    entity_id: params.entityId,
    action: params.action,
    metadata: params.metadata ?? null,
    new_values: params.newValues ?? null,
  })

  if (error) throw error
}

async function findBestSupplierSwitchRoute(params: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>
  gridOwnerId: string | null
}): Promise<RouteRow | null> {
  const { supabase, gridOwnerId } = params

  if (!gridOwnerId) return null

  const preferred = await supabase
    .from('communication_routes')
    .select('id, route_type, route_name, target_system, target_email, is_active')
    .eq('is_active', true)
    .eq('route_scope', 'supplier_switch')
    .eq('grid_owner_id', gridOwnerId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (preferred.error) throw preferred.error
  if (preferred.data) return preferred.data as RouteRow

  const fallback = await supabase
    .from('communication_routes')
    .select('id, route_type, route_name, target_system, target_email, is_active')
    .eq('is_active', true)
    .eq('route_scope', 'supplier_switch')
    .is('grid_owner_id', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (fallback.error) throw fallback.error
  return (fallback.data as RouteRow | null) ?? null
}

async function ensureOutboundForSwitch(params: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>
  userId: string
  requestRow: Record<string, unknown> & {
    id: string
    customer_id: string
    site_id: string
    metering_point_id: string
    grid_owner_id: string | null
    request_type: string
    requested_start_date: string | null
    current_supplier_name: string | null
    current_supplier_org_number: string | null
    incoming_supplier_name: string | null
    incoming_supplier_org_number: string | null
    price_area_code: string | null
  }
}): Promise<{
  outboundId: string | null
  routeResolved: boolean
  channelType: string
}> {
  const { supabase, userId, requestRow } = params

  const existingOutbound = await supabase
    .from('outbound_requests')
    .select('id, status, channel_type')
    .eq('source_type', 'supplier_switch_request')
    .eq('source_id', requestRow.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existingOutbound.error) throw existingOutbound.error

  if (existingOutbound.data) {
    return {
      outboundId: existingOutbound.data.id,
      routeResolved: existingOutbound.data.channel_type !== 'unresolved',
      channelType: existingOutbound.data.channel_type,
    }
  }

  const route = await findBestSupplierSwitchRoute({
    supabase,
    gridOwnerId: requestRow.grid_owner_id,
  })

  const channelType = route
    ? mapRouteTypeToChannelType(route.route_type)
    : 'unresolved'

  const outboundPayload = {
    switch_request_id: requestRow.id,
    request_type: requestRow.request_type,
    current_supplier_name: requestRow.current_supplier_name,
    current_supplier_org_number: requestRow.current_supplier_org_number,
    incoming_supplier_name: requestRow.incoming_supplier_name,
    incoming_supplier_org_number: requestRow.incoming_supplier_org_number,
    requested_start_date: requestRow.requested_start_date,
    grid_owner_id: requestRow.grid_owner_id,
    price_area_code: requestRow.price_area_code,
  }

  const { data: outboundRow, error: outboundError } = await supabase
    .from('outbound_requests')
    .insert({
      customer_id: requestRow.customer_id,
      site_id: requestRow.site_id,
      metering_point_id: requestRow.metering_point_id,
      grid_owner_id: requestRow.grid_owner_id,
      communication_route_id: route?.id ?? null,
      request_type: 'supplier_switch',
      source_type: 'supplier_switch_request',
      source_id: requestRow.id,
      status: 'queued',
      channel_type: channelType,
      payload: outboundPayload,
      period_start: requestRow.requested_start_date,
      queued_at: new Date().toISOString(),
      attempts_count: 0,
      created_by: userId,
      updated_by: userId,
    })
    .select('id, status, channel_type')
    .single()

  if (outboundError) throw outboundError

  const { error: eventError } = await supabase
    .from('outbound_dispatch_events')
    .insert({
      outbound_request_id: outboundRow.id,
      event_type: route ? 'queued' : 'unresolved',
      event_status: route ? 'queued' : 'missing_route',
      message: route
        ? `Outbound köad automatiskt via route ${route.route_name ?? route.id}.`
        : 'Outbound skapad utan route. Kräver manuell route-resolution.',
      payload: {
        routeResolved: Boolean(route),
        communicationRouteId: route?.id ?? null,
        channelType,
      },
      created_by: userId,
      updated_by: userId,
    })

  if (eventError) throw eventError

  await createSupplierSwitchEvent(supabase, {
    switchRequestId: requestRow.id,
    eventType: route ? 'outbound_queued' : 'outbound_unresolved',
    eventStatus: route ? 'queued' : 'missing_route',
    message: route
      ? 'Outbound skapades automatiskt efter switchskapande.'
      : 'Switch skapades men saknar communication route mot nätägare.',
    payload: {
      outboundRequestId: outboundRow.id,
      communicationRouteId: route?.id ?? null,
      channelType,
    },
  })

  return {
    outboundId: outboundRow.id,
    routeResolved: Boolean(route),
    channelType,
  }
}

async function getSupplierById(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  supplierId: string
): Promise<{
  id: string
  name: string | null
  org_number: string | null
} | null> {
  const { data, error } = await supabase
    .from('electricity_suppliers')
    .select('id, name, org_number')
    .eq('id', supplierId)
    .maybeSingle()

  if (error) throw error
  return data ?? null
}

async function ensureSupplierRecord(params: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>
  supplierId: string | null
  supplierName: string | null
  supplierOrgNumber: string | null
  supplierEmail: string | null
  supplierPhone: string | null
  saveIfMissing: boolean
  forceCreateIfMarkedAsOwn: boolean
}): Promise<{
  resolvedSupplierId: string | null
  resolvedSupplierName: string | null
  resolvedSupplierOrgNumber: string | null
}> {
  const {
    supabase,
    supplierId,
    supplierName,
    supplierOrgNumber,
    supplierEmail,
    supplierPhone,
    saveIfMissing,
    forceCreateIfMarkedAsOwn,
  } = params

  let resolvedSupplierId = supplierId
  let resolvedSupplierName = supplierName
  let resolvedSupplierOrgNumber = supplierOrgNumber

  if (resolvedSupplierId) {
    const supplier = await getSupplierById(supabase, resolvedSupplierId)
    if (supplier) {
      resolvedSupplierName = resolvedSupplierName ?? supplier.name ?? null
      resolvedSupplierOrgNumber =
        resolvedSupplierOrgNumber ?? supplier.org_number ?? null
      return {
        resolvedSupplierId,
        resolvedSupplierName,
        resolvedSupplierOrgNumber,
      }
    }
  }

  if (!resolvedSupplierName) {
    return {
      resolvedSupplierId: null,
      resolvedSupplierName: null,
      resolvedSupplierOrgNumber: resolvedSupplierOrgNumber ?? null,
    }
  }

  const existing = await findElectricitySupplierMatch(supabase, {
    name: resolvedSupplierName,
    orgNumber: resolvedSupplierOrgNumber,
  })

  if (existing) {
    return {
      resolvedSupplierId: existing.id,
      resolvedSupplierName: existing.name,
      resolvedSupplierOrgNumber: existing.org_number,
    }
  }

  if (!saveIfMissing && !forceCreateIfMarkedAsOwn) {
    return {
      resolvedSupplierId: null,
      resolvedSupplierName,
      resolvedSupplierOrgNumber,
    }
  }

  const saved = await saveElectricitySupplier(supabase, {
    name: resolvedSupplierName,
    org_number: resolvedSupplierOrgNumber ?? null,
    market_actor_code: null,
    ediel_id: null,
    contact_name: null,
    email: supplierEmail,
    phone: supplierPhone,
    notes: 'Skapad direkt från kundkortets switchflöde.',
    is_active: true,
  })

  return {
    resolvedSupplierId: saved.id,
    resolvedSupplierName: saved.name,
    resolvedSupplierOrgNumber: saved.org_number,
  }
}

export async function createDynamicSupplierSwitchRequestAction(
  formData: FormData
): Promise<void> {
  await requireAdminActionAccess(['switching.write', 'masterdata.write'])

  const { supabase, user } = await getActor()

  const customerId = formValue(formData, 'customer_id')
  const siteId = formValue(formData, 'site_id')
  const requestType = normalizeSwitchRequestType(formValue(formData, 'request_type'))
  const switchDirection = normalizeSwitchDirection(
    formValue(formData, 'switch_direction')
  )
  const requestedStartDate = normalizeDate(formValue(formData, 'requested_start_date'))

  if (!customerId || !siteId) {
    throw new Error('Customer ID eller site ID saknas')
  }

  const site = await findCustomerSiteById(supabase, siteId)

  if (!site) {
    throw new Error('Anläggningen kunde inte hittas')
  }

  const currentSupplierId = formValue(formData, 'current_supplier_id')
  const incomingSupplierId = formValue(formData, 'incoming_supplier_id')

  const currentSupplierEmail = formValue(formData, 'current_supplier_email')
  const currentSupplierPhone = formValue(formData, 'current_supplier_phone')
  const incomingSupplierEmail = formValue(formData, 'incoming_supplier_email')
  const incomingSupplierPhone = formValue(formData, 'incoming_supplier_phone')

  const saveNewCurrentSupplier = checkboxValue(formData, 'save_new_current_supplier')
  const saveNewIncomingSupplier = checkboxValue(formData, 'save_new_incoming_supplier')
  const markCurrentSupplierAsOwn = checkboxValue(
    formData,
    'mark_current_supplier_as_own'
  )
  const markIncomingSupplierAsOwn = checkboxValue(
    formData,
    'mark_incoming_supplier_as_own'
  )

  let currentSupplierName = formValue(formData, 'current_supplier_name')
  let currentSupplierOrgNumber = formValue(formData, 'current_supplier_org_number')

  let incomingSupplierName = formValue(formData, 'incoming_supplier_name')
  let incomingSupplierOrgNumber = formValue(formData, 'incoming_supplier_org_number')

  const ownSupplierLookup = await resolveOwnElectricitySupplier(supabase)
  const ownSupplier = ownSupplierLookup.supplier

  if (switchDirection === 'to_us' && ownSupplier) {
    incomingSupplierName = incomingSupplierName ?? ownSupplier.name
    incomingSupplierOrgNumber =
      incomingSupplierOrgNumber ?? ownSupplier.org_number ?? null
  }

  if (switchDirection === 'from_us' && ownSupplier) {
    currentSupplierName = currentSupplierName ?? ownSupplier.name
    currentSupplierOrgNumber =
      currentSupplierOrgNumber ?? ownSupplier.org_number ?? null
  }

  const currentSupplierResult = await ensureSupplierRecord({
    supabase,
    supplierId: currentSupplierId,
    supplierName: currentSupplierName,
    supplierOrgNumber: currentSupplierOrgNumber,
    supplierEmail: currentSupplierEmail,
    supplierPhone: currentSupplierPhone,
    saveIfMissing: saveNewCurrentSupplier,
    forceCreateIfMarkedAsOwn: markCurrentSupplierAsOwn,
  })

  currentSupplierName = currentSupplierResult.resolvedSupplierName
  currentSupplierOrgNumber = currentSupplierResult.resolvedSupplierOrgNumber

  const incomingSupplierResult = await ensureSupplierRecord({
    supabase,
    supplierId: incomingSupplierId,
    supplierName: incomingSupplierName,
    supplierOrgNumber: incomingSupplierOrgNumber,
    supplierEmail: incomingSupplierEmail,
    supplierPhone: incomingSupplierPhone,
    saveIfMissing: saveNewIncomingSupplier,
    forceCreateIfMarkedAsOwn: markIncomingSupplierAsOwn,
  })

  incomingSupplierName = incomingSupplierResult.resolvedSupplierName
  incomingSupplierOrgNumber = incomingSupplierResult.resolvedSupplierOrgNumber

  if (switchDirection === 'to_us' && !incomingSupplierName) {
    throw new Error(
      ownSupplier
        ? 'Inkommande leverantör saknas trots att riktningen är till oss.'
        : 'Ingen egen leverantör kunde identifieras automatiskt. Välj eller skriv inkommande leverantör manuellt.'
    )
  }

  if (switchDirection === 'from_us' && !currentSupplierName) {
    throw new Error(
      ownSupplier
        ? 'Nuvarande leverantör saknas trots att riktningen är från oss.'
        : 'Ingen egen leverantör kunde identifieras automatiskt. Välj eller skriv nuvarande leverantör manuellt.'
    )
  }

  if (switchDirection === 'from_us' && !incomingSupplierName) {
    throw new Error('Vid byte från oss måste ny/incoming leverantör anges.')
  }

  if (markCurrentSupplierAsOwn) {
    if (!currentSupplierResult.resolvedSupplierId) {
      throw new Error(
        'Nuvarande leverantör kunde inte markeras som vår egen eftersom posten inte kunde kopplas eller sparas i leverantörsregistret.'
      )
    }
    await setOwnElectricitySupplier(supabase, currentSupplierResult.resolvedSupplierId)
  }

  if (markIncomingSupplierAsOwn) {
    if (!incomingSupplierResult.resolvedSupplierId) {
      throw new Error(
        'Inkommande leverantör kunde inte markeras som vår egen eftersom posten inte kunde kopplas eller sparas i leverantörsregistret.'
      )
    }
    await setOwnElectricitySupplier(supabase, incomingSupplierResult.resolvedSupplierId)
  }

  await supabase
    .from('customer_sites')
    .update({
      current_supplier_name: currentSupplierName ?? site.current_supplier_name,
      current_supplier_org_number:
        currentSupplierOrgNumber ?? site.current_supplier_org_number,
      updated_by: user.id,
    })
    .eq('id', site.id)

  const refreshedSite = await findCustomerSiteById(supabase, siteId)

  if (!refreshedSite) {
    throw new Error('Kunde inte läsa uppdaterad anläggning')
  }

  const existingOpenRequest = await findOpenSupplierSwitchRequestForSite(supabase, {
    customerId,
    siteId,
  })

  if (existingOpenRequest) {
    revalidatePath(`/admin/customers/${customerId}`)
    return
  }

  const [meteringPoints, powersOfAttorney] = await Promise.all([
    listMeteringPointsForSite(supabase, siteId),
    listPowersOfAttorneyByCustomerId(supabase, customerId),
  ])

  const readiness = evaluateSiteSwitchReadiness({
    site: refreshedSite,
    meteringPoints,
    powersOfAttorney,
  })

  await syncOperationTasksFromReadiness(supabase, readiness)

  if (!readiness.isReady || !readiness.candidateMeteringPointId) {
    await insertAuditLog({
      actorUserId: user.id,
      entityType: 'customer_site',
      entityId: siteId,
      action: 'dynamic_switch_request_blocked',
      metadata: {
        customerId,
        siteId,
        requestType,
        readiness,
        switchDirection,
        ownSupplierResolution: ownSupplierLookup.resolution,
        currentSupplierName,
        incomingSupplierName,
        markedCurrentAsOwn: markCurrentSupplierAsOwn,
        markedIncomingAsOwn: markIncomingSupplierAsOwn,
      },
    })

    revalidatePath(`/admin/customers/${customerId}`)
    revalidatePath('/admin/operations')
    revalidatePath('/admin/operations/tasks')
    return
  }

  const meteringPoint =
    meteringPoints.find((point) => point.id === readiness.candidateMeteringPointId) ??
    null

  if (!meteringPoint) {
    throw new Error('Kunde inte hitta kandidat-mätpunkt för switchärendet')
  }

  const validationSnapshot = {
    isReady: readiness.isReady,
    issueCount: readiness.issues.length,
    issues: readiness.issues,
    issueCodes: readiness.issues.map((issue) => issue.code),
    candidateMeteringPointId: readiness.candidateMeteringPointId,
    latestPowerOfAttorneyId: readiness.latestPowerOfAttorneyId,
    validatedAt: new Date().toISOString(),
  }

  const { data: requestRow, error: requestError } = await supabase
    .from('supplier_switch_requests')
    .insert({
      customer_id: customerId,
      site_id: refreshedSite.id,
      metering_point_id: meteringPoint.id,
      power_of_attorney_id: readiness.latestPowerOfAttorneyId,
      request_type: requestType,
      status: 'queued',
      requested_start_date: requestedStartDate,
      current_supplier_name: currentSupplierName ?? refreshedSite.current_supplier_name,
      current_supplier_org_number:
        currentSupplierOrgNumber ?? refreshedSite.current_supplier_org_number,
      incoming_supplier_name: incomingSupplierName,
      incoming_supplier_org_number: incomingSupplierOrgNumber ?? null,
      grid_owner_id: meteringPoint.grid_owner_id ?? refreshedSite.grid_owner_id ?? null,
      price_area_code:
        meteringPoint.price_area_code ?? refreshedSite.price_area_code ?? null,
      validation_snapshot: validationSnapshot,
      created_by: user.id,
      updated_by: user.id,
    })
    .select('*')
    .single()

  if (requestError) throw requestError

  await createSupplierSwitchEvent(supabase, {
    switchRequestId: requestRow.id,
    eventType: 'created',
    eventStatus: 'success',
    message: 'Switchärende skapat från kundkortets dynamiska switchpanel.',
    payload: {
      requestType,
      switchDirection,
      ownSupplierResolution: ownSupplierLookup.resolution,
      requestedStartDate,
      currentSupplierName,
      currentSupplierOrgNumber,
      incomingSupplierName,
      incomingSupplierOrgNumber,
      markedCurrentAsOwn: markCurrentSupplierAsOwn,
      markedIncomingAsOwn: markIncomingSupplierAsOwn,
    },
  })

  const outboundResult = await ensureOutboundForSwitch({
    supabase,
    userId: user.id,
    requestRow: {
      ...requestRow,
      request_type: requestType,
    },
  })

  await insertAuditLog({
    actorUserId: user.id,
    entityType: 'supplier_switch_request',
    entityId: requestRow.id,
    action: 'dynamic_supplier_switch_request_created',
    newValues: requestRow,
    metadata: {
      customerId,
      siteId,
      requestType,
      switchDirection,
      validationSnapshot,
      outbound: outboundResult,
      ownSupplierResolution: ownSupplierLookup.resolution,
      markedCurrentAsOwn: markCurrentSupplierAsOwn,
      markedIncomingAsOwn: markIncomingSupplierAsOwn,
    },
  })

  revalidatePath(`/admin/customers/${customerId}`)
  revalidatePath('/admin/operations')
  revalidatePath('/admin/operations/tasks')
  revalidatePath('/admin/operations/switches')
  revalidatePath('/admin/outbound')
  revalidatePath('/admin/outbound/unresolved')
}