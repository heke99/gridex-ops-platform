import type { SupabaseClient } from '@supabase/supabase-js'
import type { CustomerSiteRow, MeteringPointRow } from '@/lib/masterdata/types'
import { evaluateSiteSwitchReadiness } from '@/lib/operations/readiness'
import { resolveOwnElectricitySupplier } from '@/lib/masterdata/selfSupplier'
import type {
  CustomerAuthorizationDocumentRow,
  CustomerOperationTaskRow,
  CustomerOperationTaskStatus,
  PowerOfAttorneyRow,
  SupplierSwitchEventRow,
  SupplierSwitchRequestRow,
  SupplierSwitchRequestStatus,
  SupplierSwitchRequestType,
  SwitchReadinessResult,
} from '@/lib/operations/types'

async function getActorId(supabase: SupabaseClient): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return user?.id ?? null
}

function appendNote(
  existing: string | null | undefined,
  extra: string
): string {
  const base = (existing ?? '').trim()
  if (!base) return extra
  if (base.includes(extra)) return base
  return `${base}\n\n${extra}`
}

export async function listPowersOfAttorneyByCustomerId(
  supabase: SupabaseClient,
  customerId: string
): Promise<PowerOfAttorneyRow[]> {
  const { data, error } = await supabase
    .from('powers_of_attorney')
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as PowerOfAttorneyRow[]
}

export async function getPowerOfAttorneyById(
  supabase: SupabaseClient,
  powerOfAttorneyId: string
): Promise<PowerOfAttorneyRow | null> {
  const { data, error } = await supabase
    .from('powers_of_attorney')
    .select('*')
    .eq('id', powerOfAttorneyId)
    .maybeSingle()

  if (error) throw error
  return (data as PowerOfAttorneyRow | null) ?? null
}

export async function savePowerOfAttorney(
  supabase: SupabaseClient,
  input: {
    id?: string
    customer_id: string
    site_id?: string | null
    scope: 'supplier_switch' | 'meter_data' | 'billing_handoff'
    status: 'draft' | 'sent' | 'signed' | 'expired' | 'revoked'
    signed_at?: string | null
    valid_from?: string | null
    valid_to?: string | null
    document_path?: string | null
    reference?: string | null
    notes?: string | null
  }
): Promise<PowerOfAttorneyRow> {
  const actorId = await getActorId(supabase)

  const payload = {
    customer_id: input.customer_id,
    site_id: input.site_id ?? null,
    scope: input.scope,
    status: input.status,
    signed_at: input.signed_at ?? null,
    valid_from: input.valid_from ?? null,
    valid_to: input.valid_to ?? null,
    document_path: input.document_path ?? null,
    reference: input.reference ?? null,
    notes: input.notes ?? null,
    updated_by: actorId,
  }

  if (input.id) {
    const { data, error } = await supabase
      .from('powers_of_attorney')
      .update(payload)
      .eq('id', input.id)
      .select('*')
      .single()

    if (error) throw error
    return data as PowerOfAttorneyRow
  }

  const { data, error } = await supabase
    .from('powers_of_attorney')
    .insert({
      ...payload,
      created_by: actorId,
    })
    .select('*')
    .single()

  if (error) throw error
  return data as PowerOfAttorneyRow
}

export async function revokePowerOfAttorney(
  supabase: SupabaseClient,
  params: {
    powerOfAttorneyId: string
    reason?: string | null
  }
): Promise<PowerOfAttorneyRow> {
  const actorId = await getActorId(supabase)
  const existing = await getPowerOfAttorneyById(supabase, params.powerOfAttorneyId)

  if (!existing) {
    throw new Error('Fullmakten hittades inte')
  }

  const { data, error } = await supabase
    .from('powers_of_attorney')
    .update({
      status: 'revoked',
      notes: params.reason
        ? appendNote(existing.notes, params.reason)
        : existing.notes ?? null,
      updated_by: actorId,
    })
    .eq('id', params.powerOfAttorneyId)
    .select('*')
    .single()

  if (error) throw error
  return data as PowerOfAttorneyRow
}

export async function restorePowerOfAttorneyIfRevoked(
  supabase: SupabaseClient,
  params: {
    powerOfAttorneyId: string
    note?: string | null
  }
): Promise<PowerOfAttorneyRow> {
  const actorId = await getActorId(supabase)
  const existing = await getPowerOfAttorneyById(supabase, params.powerOfAttorneyId)

  if (!existing) {
    throw new Error('Fullmakten hittades inte')
  }

  if (existing.status !== 'revoked') {
    return existing
  }

  const restoredStatus: PowerOfAttorneyRow['status'] =
    existing.signed_at ? 'signed' : 'sent'

  const { data, error } = await supabase
    .from('powers_of_attorney')
    .update({
      status: restoredStatus,
      notes: params.note ? appendNote(existing.notes, params.note) : existing.notes ?? null,
      updated_by: actorId,
    })
    .eq('id', params.powerOfAttorneyId)
    .select('*')
    .single()

  if (error) throw error
  return data as PowerOfAttorneyRow
}

export async function listCustomerAuthorizationDocumentsByCustomerId(
  supabase: SupabaseClient,
  customerId: string
): Promise<CustomerAuthorizationDocumentRow[]> {
  const { data, error } = await supabase
    .from('customer_authorization_documents')
    .select('*')
    .eq('customer_id', customerId)
    .order('uploaded_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as CustomerAuthorizationDocumentRow[]
}

export async function getCustomerAuthorizationDocumentById(
  supabase: SupabaseClient,
  documentId: string
): Promise<CustomerAuthorizationDocumentRow | null> {
  const { data, error } = await supabase
    .from('customer_authorization_documents')
    .select('*')
    .eq('id', documentId)
    .maybeSingle()

  if (error) throw error
  return (data as CustomerAuthorizationDocumentRow | null) ?? null
}

export async function listActiveCustomerAuthorizationDocumentsByScope(
  supabase: SupabaseClient,
  params: {
    customerId: string
    siteId?: string | null
    documentType: 'power_of_attorney' | 'complete_agreement'
    excludeDocumentId?: string | null
  }
): Promise<CustomerAuthorizationDocumentRow[]> {
  let query = supabase
    .from('customer_authorization_documents')
    .select('*')
    .eq('customer_id', params.customerId)
    .eq('document_type', params.documentType)
    .eq('status', 'active')

  query = params.siteId ? query.eq('site_id', params.siteId) : query.is('site_id', null)

  const { data, error } = await query.order('uploaded_at', { ascending: false })

  if (error) throw error

  const rows = (data ?? []) as CustomerAuthorizationDocumentRow[]
  const excludedId = params.excludeDocumentId ?? null

  return excludedId ? rows.filter((row) => row.id !== excludedId) : rows
}

export async function saveCustomerAuthorizationDocument(
  supabase: SupabaseClient,
  input: {
    id?: string
    customer_id: string
    site_id?: string | null
    power_of_attorney_id?: string | null
    document_type: 'power_of_attorney' | 'complete_agreement'
    status?: 'uploaded' | 'active' | 'archived'
    title?: string | null
    file_name?: string | null
    mime_type?: string | null
    file_size_bytes?: number | null
    storage_bucket?: string | null
    file_path: string
    reference?: string | null
    notes?: string | null
    uploaded_at?: string | null
  }
): Promise<CustomerAuthorizationDocumentRow> {
  const actorId = await getActorId(supabase)

  const payload = {
    customer_id: input.customer_id,
    site_id: input.site_id ?? null,
    power_of_attorney_id: input.power_of_attorney_id ?? null,
    document_type: input.document_type,
    status: input.status ?? 'uploaded',
    title: input.title ?? null,
    file_name: input.file_name ?? null,
    mime_type: input.mime_type ?? null,
    file_size_bytes: input.file_size_bytes ?? null,
    storage_bucket: input.storage_bucket ?? null,
    file_path: input.file_path,
    reference: input.reference ?? null,
    notes: input.notes ?? null,
    uploaded_at: input.uploaded_at ?? new Date().toISOString(),
    updated_by: actorId,
  }

  if (input.id) {
    const { data, error } = await supabase
      .from('customer_authorization_documents')
      .update(payload)
      .eq('id', input.id)
      .select('*')
      .single()

    if (error) throw error
    return data as CustomerAuthorizationDocumentRow
  }

  const { data, error } = await supabase
    .from('customer_authorization_documents')
    .insert({
      ...payload,
      created_by: actorId,
    })
    .select('*')
    .single()

  if (error) throw error
  return data as CustomerAuthorizationDocumentRow
}

export async function updateCustomerAuthorizationDocumentStatus(
  supabase: SupabaseClient,
  params: {
    documentId: string
    status: 'uploaded' | 'active' | 'archived'
    notesAppend?: string | null
  }
): Promise<CustomerAuthorizationDocumentRow> {
  const actorId = await getActorId(supabase)
  const existing = await getCustomerAuthorizationDocumentById(supabase, params.documentId)

  if (!existing) {
    throw new Error('Dokumentet hittades inte')
  }

  const { data, error } = await supabase
    .from('customer_authorization_documents')
    .update({
      status: params.status,
      notes: params.notesAppend
        ? appendNote(existing.notes, params.notesAppend)
        : existing.notes ?? null,
      updated_by: actorId,
    })
    .eq('id', params.documentId)
    .select('*')
    .single()

  if (error) throw error
  return data as CustomerAuthorizationDocumentRow
}

export async function archiveCustomerAuthorizationDocument(
  supabase: SupabaseClient,
  params: {
    documentId: string
    reason?: string | null
    revokeLinkedPowerOfAttorney?: boolean
  }
): Promise<{
  documentBefore: CustomerAuthorizationDocumentRow
  documentAfter: CustomerAuthorizationDocumentRow
  revokedPowerOfAttorney: PowerOfAttorneyRow | null
}> {
  const documentBefore = await getCustomerAuthorizationDocumentById(
    supabase,
    params.documentId
  )

  if (!documentBefore) {
    throw new Error('Dokumentet hittades inte')
  }

  const documentAfter = await updateCustomerAuthorizationDocumentStatus(supabase, {
    documentId: params.documentId,
    status: 'archived',
    notesAppend: params.reason ?? 'Dokumentet arkiverades.',
  })

  let revokedPowerOfAttorney: PowerOfAttorneyRow | null = null

  if (
    params.revokeLinkedPowerOfAttorney !== false &&
    documentAfter.power_of_attorney_id
  ) {
    revokedPowerOfAttorney = await revokePowerOfAttorney(supabase, {
      powerOfAttorneyId: documentAfter.power_of_attorney_id,
      reason:
        params.reason
          ? `Fullmakten revokerades eftersom dokumentet arkiverades. Orsak: ${params.reason}`
          : 'Fullmakten revokerades eftersom dokumentet arkiverades.',
    })
  }

  return {
    documentBefore,
    documentAfter,
    revokedPowerOfAttorney,
  }
}

export async function setCustomerAuthorizationDocumentAsActive(
  supabase: SupabaseClient,
  params: {
    documentId: string
    archiveOtherActiveDocuments?: boolean
  }
): Promise<{
  targetBefore: CustomerAuthorizationDocumentRow
  targetAfter: CustomerAuthorizationDocumentRow
  archivedDocuments: CustomerAuthorizationDocumentRow[]
  revokedPowerOfAttorneyIds: string[]
  restoredPowerOfAttorney: PowerOfAttorneyRow | null
}> {
  const targetBefore = await getCustomerAuthorizationDocumentById(
    supabase,
    params.documentId
  )

  if (!targetBefore) {
    throw new Error('Dokumentet hittades inte')
  }

  const archivedDocuments: CustomerAuthorizationDocumentRow[] = []
  const revokedPowerOfAttorneyIds: string[] = []

  if (params.archiveOtherActiveDocuments !== false) {
    const activeConflicts = await listActiveCustomerAuthorizationDocumentsByScope(
      supabase,
      {
        customerId: targetBefore.customer_id,
        siteId: targetBefore.site_id,
        documentType: targetBefore.document_type,
        excludeDocumentId: targetBefore.id,
      }
    )

    for (const conflict of activeConflicts) {
      const archived = await archiveCustomerAuthorizationDocument(supabase, {
        documentId: conflict.id,
        reason: `Arkiverat automatiskt eftersom dokument ${targetBefore.id} sattes som aktivt standarddokument.`,
        revokeLinkedPowerOfAttorney: true,
      })

      archivedDocuments.push(archived.documentAfter)

      if (archived.revokedPowerOfAttorney?.id) {
        revokedPowerOfAttorneyIds.push(archived.revokedPowerOfAttorney.id)
      }
    }
  }

  const targetAfter = await updateCustomerAuthorizationDocumentStatus(supabase, {
    documentId: targetBefore.id,
    status: 'active',
    notesAppend: 'Satt som aktivt standarddokument.',
  })

  let restoredPowerOfAttorney: PowerOfAttorneyRow | null = null

  if (targetAfter.power_of_attorney_id) {
    restoredPowerOfAttorney = await restorePowerOfAttorneyIfRevoked(supabase, {
      powerOfAttorneyId: targetAfter.power_of_attorney_id,
      note:
        'Fullmakten återaktiverades eftersom dokumentet sattes som aktivt standarddokument.',
    })
  }

  return {
    targetBefore,
    targetAfter,
    archivedDocuments,
    revokedPowerOfAttorneyIds,
    restoredPowerOfAttorney,
  }
}

export async function listCustomerOperationTasks(
  supabase: SupabaseClient,
  customerId: string
): Promise<CustomerOperationTaskRow[]> {
  const { data, error } = await supabase
    .from('customer_operation_tasks')
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as CustomerOperationTaskRow[]
}

export async function listAllOperationTasks(
  supabase: SupabaseClient,
  options: {
    status?: string | null
    priority?: string | null
    query?: string | null
  } = {}
): Promise<CustomerOperationTaskRow[]> {
  let taskQuery = supabase
    .from('customer_operation_tasks')
    .select('*')
    .order('created_at', { ascending: false })

  if (options.status && options.status !== 'all') {
    taskQuery = taskQuery.eq('status', options.status)
  }

  if (options.priority && options.priority !== 'all') {
    taskQuery = taskQuery.eq('priority', options.priority)
  }

  const { data, error } = await taskQuery

  if (error) throw error

  let tasks = (data ?? []) as CustomerOperationTaskRow[]

  const normalizedQuery = (options.query ?? '').trim().toLowerCase()

  if (!normalizedQuery) {
    return tasks
  }

  tasks = tasks.filter((task) => {
    const haystack = [
      task.title,
      task.description,
      task.task_type,
      task.status,
      task.priority,
      task.site_id,
      task.customer_id,
      task.metering_point_id,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()

    return haystack.includes(normalizedQuery)
  })

  return tasks
}

export async function listSupplierSwitchRequestsByCustomerId(
  supabase: SupabaseClient,
  customerId: string
): Promise<SupplierSwitchRequestRow[]> {
  const { data, error } = await supabase
    .from('supplier_switch_requests')
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as SupplierSwitchRequestRow[]
}

export async function getSupplierSwitchRequestById(
  supabase: SupabaseClient,
  requestId: string
): Promise<SupplierSwitchRequestRow | null> {
  const { data, error } = await supabase
    .from('supplier_switch_requests')
    .select('*')
    .eq('id', requestId)
    .maybeSingle()

  if (error) throw error
  return (data as SupplierSwitchRequestRow | null) ?? null
}

export async function listAllSupplierSwitchRequests(
  supabase: SupabaseClient,
  options: {
    status?: string | null
    requestType?: string | null
    query?: string | null
  } = {}
): Promise<SupplierSwitchRequestRow[]> {
  let requestQuery = supabase
    .from('supplier_switch_requests')
    .select('*')
    .order('created_at', { ascending: false })

  if (options.status && options.status !== 'all') {
    requestQuery = requestQuery.eq('status', options.status)
  }

  if (options.requestType && options.requestType !== 'all') {
    requestQuery = requestQuery.eq('request_type', options.requestType)
  }

  const { data, error } = await requestQuery

  if (error) throw error

  let requests = (data ?? []) as SupplierSwitchRequestRow[]
  const normalizedQuery = (options.query ?? '').trim().toLowerCase()

  if (!normalizedQuery) {
    return requests
  }

  requests = requests.filter((request) => {
    const haystack = [
      request.id,
      request.customer_id,
      request.site_id,
      request.metering_point_id,
      request.request_type,
      request.status,
      request.current_supplier_name,
      request.incoming_supplier_name,
      request.external_reference,
      request.failure_reason,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()

    return haystack.includes(normalizedQuery)
  })

  return requests
}

export async function listSupplierSwitchEventsByRequestIds(
  supabase: SupabaseClient,
  requestIds: string[]
): Promise<SupplierSwitchEventRow[]> {
  if (requestIds.length === 0) return []

  const { data, error } = await supabase
    .from('supplier_switch_events')
    .select('*')
    .in('switch_request_id', requestIds)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as SupplierSwitchEventRow[]
}

export async function listRecentSupplierSwitchEvents(
  supabase: SupabaseClient,
  limit = 50
): Promise<SupplierSwitchEventRow[]> {
  const { data, error } = await supabase
    .from('supplier_switch_events')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  return (data ?? []) as SupplierSwitchEventRow[]
}

async function findExistingOpenTask(
  supabase: SupabaseClient,
  params: {
    customerId: string
    siteId: string
    taskType: string
  }
): Promise<CustomerOperationTaskRow | null> {
  const { data, error } = await supabase
    .from('customer_operation_tasks')
    .select('*')
    .eq('customer_id', params.customerId)
    .eq('site_id', params.siteId)
    .eq('task_type', params.taskType)
    .in('status', ['open', 'in_progress', 'blocked'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return (data as CustomerOperationTaskRow | null) ?? null
}

export async function syncOperationTasksFromReadiness(
  supabase: SupabaseClient,
  readiness: SwitchReadinessResult
): Promise<void> {
  const actorId = await getActorId(supabase)
  const activeTaskTypes = new Set<string>(
    readiness.issues.map((issue) => issue.taskType)
  )

  for (const issue of readiness.issues) {
    const existing = await findExistingOpenTask(supabase, {
      customerId: readiness.customerId,
      siteId: readiness.siteId,
      taskType: issue.taskType,
    })

    if (existing) {
      continue
    }

    const { error } = await supabase.from('customer_operation_tasks').insert({
      customer_id: readiness.customerId,
      site_id: readiness.siteId,
      metering_point_id: readiness.candidateMeteringPointId,
      task_type: issue.taskType,
      status: issue.priority === 'critical' ? 'blocked' : 'open',
      priority: issue.priority,
      title: issue.title,
      description: issue.description,
      metadata: {
        readinessCode: issue.code,
      },
      created_by: actorId,
      updated_by: actorId,
    })

    if (error) throw error
  }

  const { data: existingOpenTasks, error: fetchOpenTasksError } = await supabase
    .from('customer_operation_tasks')
    .select('*')
    .eq('customer_id', readiness.customerId)
    .eq('site_id', readiness.siteId)
    .in('status', ['open', 'in_progress', 'blocked'])

  if (fetchOpenTasksError) throw fetchOpenTasksError

  const tasks = (existingOpenTasks ?? []) as CustomerOperationTaskRow[]

  for (const task of tasks) {
    if (activeTaskTypes.has(task.task_type)) {
      continue
    }

    const { error } = await supabase
      .from('customer_operation_tasks')
      .update({
        status: 'done',
        resolved_at: new Date().toISOString(),
        updated_by: actorId,
      })
      .eq('id', task.id)

    if (error) throw error
  }
}

export async function syncCustomerOperationsForSite(
  supabase: SupabaseClient,
  params: {
    customerId: string
    siteId: string
  }
): Promise<SwitchReadinessResult> {
  const site = await findCustomerSiteById(supabase, params.siteId)

  if (!site || site.customer_id !== params.customerId) {
    throw new Error('Kunde inte hitta anläggningen för operations-sync')
  }

  const [meteringPoints, powersOfAttorney] = await Promise.all([
    listMeteringPointsForSite(supabase, params.siteId),
    listPowersOfAttorneyByCustomerId(supabase, params.customerId),
  ])

  const readiness = evaluateSiteSwitchReadiness({
    site,
    meteringPoints,
    powersOfAttorney,
  })

  await syncOperationTasksFromReadiness(supabase, readiness)
  return readiness
}

export async function syncCustomerOperationsForCustomer(
  supabase: SupabaseClient,
  customerId: string
): Promise<{
  siteCount: number
  readyCount: number
  blockedCount: number
  results: SwitchReadinessResult[]
}> {
  const { data, error } = await supabase
    .from('customer_sites')
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })

  if (error) throw error

  const sites = (data ?? []) as CustomerSiteRow[]
  const results: SwitchReadinessResult[] = []

  for (const site of sites) {
    const readiness = await syncCustomerOperationsForSite(supabase, {
      customerId,
      siteId: site.id,
    })

    results.push(readiness)
  }

  return {
    siteCount: sites.length,
    readyCount: results.filter((row) => row.isReady).length,
    blockedCount: results.filter((row) => !row.isReady).length,
    results,
  }
}

export async function updateOperationTaskStatus(
  supabase: SupabaseClient,
  params: {
    taskId: string
    status: CustomerOperationTaskStatus
  }
): Promise<CustomerOperationTaskRow> {
  const actorId = await getActorId(supabase)

  const updatePayload: {
    status: CustomerOperationTaskStatus
    updated_by: string | null
    resolved_at?: string | null
  } = {
    status: params.status,
    updated_by: actorId,
  }

  if (params.status === 'done') {
    updatePayload.resolved_at = new Date().toISOString()
  } else {
    updatePayload.resolved_at = null
  }

  const { data, error } = await supabase
    .from('customer_operation_tasks')
    .update(updatePayload)
    .eq('id', params.taskId)
    .select('*')
    .single()

  if (error) throw error
  return data as CustomerOperationTaskRow
}

export async function findCustomerSiteById(
  supabase: SupabaseClient,
  siteId: string
): Promise<CustomerSiteRow | null> {
  const { data, error } = await supabase
    .from('customer_sites')
    .select('*')
    .eq('id', siteId)
    .maybeSingle()

  if (error) throw error
  return (data as CustomerSiteRow | null) ?? null
}

export async function listMeteringPointsForSite(
  supabase: SupabaseClient,
  siteId: string
): Promise<MeteringPointRow[]> {
  const { data, error } = await supabase
    .from('metering_points')
    .select('*')
    .eq('site_id', siteId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as MeteringPointRow[]
}

export async function findOpenSupplierSwitchRequestForSite(
  supabase: SupabaseClient,
  params: {
    customerId: string
    siteId: string
  }
): Promise<SupplierSwitchRequestRow | null> {
  const { data, error } = await supabase
    .from('supplier_switch_requests')
    .select('*')
    .eq('customer_id', params.customerId)
    .eq('site_id', params.siteId)
    .in('status', ['draft', 'queued', 'submitted', 'accepted'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return (data as SupplierSwitchRequestRow | null) ?? null
}

export async function createSupplierSwitchRequest(
  supabase: SupabaseClient,
  params: {
    readiness: SwitchReadinessResult
    site: CustomerSiteRow
    meteringPoint: MeteringPointRow
    requestType: SupplierSwitchRequestType
    requestedStartDate: string | null
  }
): Promise<SupplierSwitchRequestRow> {
  const actorId = await getActorId(supabase)
  const ownSupplierLookup = await resolveOwnElectricitySupplier(supabase)
  const ownSupplier = ownSupplierLookup.supplier

  const incomingSupplierName = ownSupplier?.name ?? 'Gridex'
  const incomingSupplierOrgNumber = ownSupplier?.org_number ?? null

  const { data, error } = await supabase
    .from('supplier_switch_requests')
    .insert({
      customer_id: params.readiness.customerId,
      site_id: params.site.id,
      metering_point_id: params.meteringPoint.id,
      power_of_attorney_id: params.readiness.latestPowerOfAttorneyId,
      request_type: params.requestType,
      status: 'queued',
      requested_start_date: params.requestedStartDate,
      current_supplier_name: params.site.current_supplier_name,
      current_supplier_org_number: params.site.current_supplier_org_number,
      incoming_supplier_name: incomingSupplierName,
      incoming_supplier_org_number: incomingSupplierOrgNumber,
      grid_owner_id:
        params.meteringPoint.grid_owner_id ?? params.site.grid_owner_id ?? null,
      price_area_code:
        params.meteringPoint.price_area_code ?? params.site.price_area_code ?? null,
      validation_snapshot: {
        isReady: params.readiness.isReady,
        issues: params.readiness.issues,
        candidateMeteringPointId: params.readiness.candidateMeteringPointId,
        latestPowerOfAttorneyId: params.readiness.latestPowerOfAttorneyId,
        ownSupplierResolution: ownSupplierLookup.resolution,
      },
      created_by: actorId,
      updated_by: actorId,
    })
    .select('*')
    .single()

  if (error) throw error

  const request = data as SupplierSwitchRequestRow

  await createSupplierSwitchEvent(supabase, {
    switchRequestId: request.id,
    eventType: 'created',
    eventStatus: 'success',
    message: 'Switchärende skapat och köat för vidare handläggning.',
    payload: {
      requestType: params.requestType,
      requestedStartDate: params.requestedStartDate,
      incomingSupplierName,
      incomingSupplierOrgNumber,
      ownSupplierResolution: ownSupplierLookup.resolution,
    },
  })

  return request
}

export async function updateSupplierSwitchValidationSnapshot(
  supabase: SupabaseClient,
  params: {
    requestId: string
    validationSnapshot: Record<string, unknown>
  }
): Promise<SupplierSwitchRequestRow> {
  const actorId = await getActorId(supabase)

  const { data, error } = await supabase
    .from('supplier_switch_requests')
    .update({
      validation_snapshot: params.validationSnapshot,
      updated_by: actorId,
    })
    .eq('id', params.requestId)
    .select('*')
    .single()

  if (error) throw error

  return data as SupplierSwitchRequestRow
}

export async function updateSupplierSwitchRequestStatus(
  supabase: SupabaseClient,
  params: {
    requestId: string
    status: SupplierSwitchRequestStatus
    failureReason?: string | null
    externalReference?: string | null
  }
): Promise<SupplierSwitchRequestRow> {
  const actorId = await getActorId(supabase)
  const nowIso = new Date().toISOString()

  const updatePayload: {
    status: SupplierSwitchRequestStatus
    updated_by: string | null
    submitted_at?: string | null
    completed_at?: string | null
    failed_at?: string | null
    failure_reason?: string | null
    external_reference?: string | null
  } = {
    status: params.status,
    updated_by: actorId,
    failure_reason: params.failureReason ?? null,
    external_reference: params.externalReference ?? null,
  }

  if (params.status === 'submitted') {
    updatePayload.submitted_at = nowIso
  }

  if (params.status === 'completed') {
    updatePayload.completed_at = nowIso
  }

  if (params.status === 'failed' || params.status === 'rejected') {
    updatePayload.failed_at = nowIso
  }

  const { data, error } = await supabase
    .from('supplier_switch_requests')
    .update(updatePayload)
    .eq('id', params.requestId)
    .select('*')
    .single()

  if (error) throw error

  const saved = data as SupplierSwitchRequestRow

  await createSupplierSwitchEvent(supabase, {
    switchRequestId: saved.id,
    eventType: 'status_updated',
    eventStatus: saved.status,
    message:
      saved.status === 'failed' || saved.status === 'rejected'
        ? params.failureReason ?? 'Status uppdaterad med felorsak.'
        : `Switchärende uppdaterat till status ${saved.status}.`,
    payload: {
      status: saved.status,
      externalReference: saved.external_reference,
      failureReason: saved.failure_reason,
    },
  })

  return saved
}

export async function createSupplierSwitchEvent(
  supabase: SupabaseClient,
  params: {
    switchRequestId: string
    eventType: string
    eventStatus: string
    message?: string | null
    payload?: Record<string, unknown>
  }
): Promise<SupplierSwitchEventRow> {
  const actorId = await getActorId(supabase)

  const { data, error } = await supabase
    .from('supplier_switch_events')
    .insert({
      switch_request_id: params.switchRequestId,
      event_type: params.eventType,
      event_status: params.eventStatus,
      message: params.message ?? null,
      payload: params.payload ?? {},
      created_by: actorId,
    })
    .select('*')
    .single()

  if (error) throw error
  return data as SupplierSwitchEventRow
}

export async function finalizeSupplierSwitchExecution(
  supabase: SupabaseClient,
  params: {
    requestId: string
    actorUserId: string
    executionSource:
      | 'manual_admin'
      | 'automation_sweep'
      | 'bulk_admin_ready_queue'
    executionNotes?: string | null
  }
): Promise<{
  requestBefore: SupplierSwitchRequestRow
  request: SupplierSwitchRequestRow
  siteBefore: CustomerSiteRow
  siteAfter: CustomerSiteRow
  meteringPointBefore: MeteringPointRow | null
  meteringPointAfter: MeteringPointRow | null
}> {
  const requestBefore = await getSupplierSwitchRequestById(
    supabase,
    params.requestId
  )

  if (!requestBefore) {
    throw new Error('Switchärendet hittades inte')
  }

  const siteBefore = await findCustomerSiteById(supabase, requestBefore.site_id)

  if (!siteBefore) {
    throw new Error('Anläggningen för switchärendet hittades inte')
  }

  const pointQuery = requestBefore.metering_point_id
    ? await supabase
        .from('metering_points')
        .select('*')
        .eq('id', requestBefore.metering_point_id)
        .maybeSingle()
    : null

  if (pointQuery?.error) {
    throw pointQuery.error
  }

  const meteringPointBefore =
    (pointQuery?.data as MeteringPointRow | null | undefined) ?? null

  if (requestBefore.status === 'completed') {
    return {
      requestBefore,
      request: requestBefore,
      siteBefore,
      siteAfter: siteBefore,
      meteringPointBefore,
      meteringPointAfter: meteringPointBefore,
    }
  }

  if (requestBefore.status !== 'accepted') {
    throw new Error('Switchärendet måste vara accepted innan det kan slutföras')
  }

  const siteUpdatePayload = {
    current_supplier_name: requestBefore.incoming_supplier_name,
    current_supplier_org_number: requestBefore.incoming_supplier_org_number,
    status: siteBefore.status === 'closed' ? 'closed' : 'active',
    grid_owner_id: siteBefore.grid_owner_id ?? requestBefore.grid_owner_id ?? null,
    price_area_code:
      siteBefore.price_area_code ?? requestBefore.price_area_code ?? null,
    updated_by: params.actorUserId,
  }

  const siteUpdate = await supabase
    .from('customer_sites')
    .update(siteUpdatePayload)
    .eq('id', siteBefore.id)
    .select('*')
    .single()

  if (siteUpdate.error) throw siteUpdate.error
  const siteAfter = siteUpdate.data as CustomerSiteRow

  let meteringPointAfter: MeteringPointRow | null = meteringPointBefore

  if (meteringPointBefore) {
    const pointUpdate = await supabase
      .from('metering_points')
      .update({
        status: meteringPointBefore.status === 'closed' ? 'closed' : 'active',
        grid_owner_id:
          meteringPointBefore.grid_owner_id ?? requestBefore.grid_owner_id ?? null,
        price_area_code:
          meteringPointBefore.price_area_code ??
          requestBefore.price_area_code ??
          null,
        updated_by: params.actorUserId,
      })
      .eq('id', meteringPointBefore.id)
      .select('*')
      .single()

    if (pointUpdate.error) throw pointUpdate.error
    meteringPointAfter = pointUpdate.data as MeteringPointRow
  }

  const request = await updateSupplierSwitchRequestStatus(supabase, {
    requestId: requestBefore.id,
    status: 'completed',
    externalReference: requestBefore.external_reference,
  })

  await createSupplierSwitchEvent(supabase, {
    switchRequestId: request.id,
    eventType: 'execution_completed',
    eventStatus: 'completed',
    message:
      params.executionSource === 'automation_sweep'
        ? 'Switchen slutfördes automatiskt efter kvitterad outbound.'
        : params.executionSource === 'bulk_admin_ready_queue'
          ? 'Switchen slutfördes från bulk-kön för ready-to-execute.'
          : 'Switchen slutfördes manuellt från operations.',
    payload: {
      executionSource: params.executionSource,
      executionNotes: params.executionNotes ?? null,
      previousSupplierName: requestBefore.current_supplier_name,
      newSupplierName: request.incoming_supplier_name,
      siteStatusBefore: siteBefore.status,
      siteStatusAfter: siteAfter.status,
      meteringPointStatusBefore: meteringPointBefore?.status ?? null,
      meteringPointStatusAfter: meteringPointAfter?.status ?? null,
    },
  })

  return {
    requestBefore,
    request,
    siteBefore,
    siteAfter,
    meteringPointBefore,
    meteringPointAfter,
  }
}