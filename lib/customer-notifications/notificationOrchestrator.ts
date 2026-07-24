import { triggerEmailEvent } from '@/lib/email/emailEvents'
import { supabaseService } from '@/lib/supabase/service'

type JsonRecord = Record<string, unknown>

export type CustomerLifecycleNotificationEvent =
  | 'supplier_switch.requested'
  | 'supplier_switch.accepted'
  | 'supplier_switch.confirmed'
  | 'supplier_switch.rejected'
  | 'supplier_switch.manual_review_required'
  | 'supply_period.activated'
  | 'supply_period.active'

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function templateForEvent(eventType: string): string | null {
  if (eventType === 'supplier_switch.requested') return 'switch.started'
  if (eventType === 'supplier_switch.accepted' || eventType === 'supplier_switch.confirmed') return 'switch.confirmed'
  if (eventType === 'supplier_switch.rejected' || eventType === 'supplier_switch.manual_review_required') return 'switch.action_required'
  if (eventType === 'supply_period.activated' || eventType === 'supply_period.active') return 'customer.welcome_active'
  return null
}


export async function enqueueCustomerLifecycleNotification(input: {
  companyId: string
  customerId: string
  eventType: CustomerLifecycleNotificationEvent | string
  sourceEventId: string
  siteId?: string | null
  meteringPointId?: string | null
  contractId?: string | null
  payload?: JsonRecord
}): Promise<{ queued: boolean; eventKey: string | null; jobId?: string | null; skippedReason?: string }> {
  const eventKey = templateForEvent(input.eventType)
  if (!eventKey) return { queued: false, eventKey: null, skippedReason: 'event_not_mapped' }

  const idempotencyKey = `lifecycle_notification:${input.sourceEventId}:${eventKey}`
  const { data: existing, error: existingError } = await supabaseService
    .from('customer_operation_jobs')
    .select('id,status')
    .eq('company_id', input.companyId)
    .eq('job_type', 'dispatch_lifecycle_notification')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle()
  if (existingError && !['42P01', '42703', 'PGRST204', 'PGRST205'].includes(existingError.code ?? '')) throw existingError
  if (existing?.id) return { queued: true, eventKey, jobId: String(existing.id) }

  const { data, error } = await supabaseService
    .from('customer_operation_jobs')
    .insert({
      company_id: input.companyId,
      customer_id: input.customerId,
      customer_site_id: input.siteId ?? null,
      metering_point_id: input.meteringPointId ?? null,
      job_type: 'dispatch_lifecycle_notification',
      status: 'queued',
      priority: 40,
      idempotency_key: idempotencyKey,
      payload: {
        event_type: input.eventType,
        source_event_id: input.sourceEventId,
        contract_id: input.contractId ?? null,
        payload: input.payload ?? {},
      },
      request_snapshot: input.payload ?? {},
      run_after: new Date().toISOString(),
    })
    .select('id')
    .single()
  if (error) {
    if (error.code === '23505') {
      const { data: duplicate } = await supabaseService
        .from('customer_operation_jobs')
        .select('id')
        .eq('company_id', input.companyId)
        .eq('job_type', 'dispatch_lifecycle_notification')
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle()
      return { queued: Boolean(duplicate?.id), eventKey, jobId: duplicate?.id ? String(duplicate.id) : null }
    }
    throw error
  }
  return { queued: true, eventKey, jobId: data?.id ? String(data.id) : null }
}

/**
 * Executes a lifecycle-notification job after the business transition has been
 * committed. Call sites enqueue a durable customer_operation_jobs row, so both
 * notification creation and provider delivery can be retried independently.
 */
export async function notifyCustomerForLifecycleEvent(input: {
  companyId: string
  customerId: string
  eventType: CustomerLifecycleNotificationEvent | string
  sourceEventId: string
  siteId?: string | null
  meteringPointId?: string | null
  contractId?: string | null
  payload?: JsonRecord
}): Promise<{ queued: boolean; eventKey: string | null; skippedReason?: string }> {
  const eventKey = templateForEvent(input.eventType)
  if (!eventKey) return { queued: false, eventKey: null, skippedReason: 'event_not_mapped' }

  const { data: customer, error: customerError } = await supabaseService
    .from('customers')
    .select('id,email,full_name,company_name,customer_number')
    .eq('company_id', input.companyId)
    .eq('id', input.customerId)
    .maybeSingle()
  if (customerError) throw customerError
  const email = clean(customer?.email)
  if (!customer?.id || !email) return { queued: false, eventKey, skippedReason: 'customer_email_missing' }

  const [companyResult, siteResult, pointResult, contractResult, periodResult] = await Promise.all([
    supabaseService.from('companies').select('id,name,support_email,primary_contact_email').eq('id', input.companyId).maybeSingle(),
    input.siteId
      ? supabaseService.from('customer_sites').select('id,facility_id,street,postal_code,city').eq('company_id', input.companyId).eq('id', input.siteId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    input.meteringPointId
      ? supabaseService.from('metering_points').select('id,metering_point_id,ediel_metering_point_id,meter_point_id').eq('company_id', input.companyId).eq('id', input.meteringPointId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    input.contractId
      ? supabaseService.from('customer_contracts').select('id,contract_name,contract_number,starts_at').eq('company_id', input.companyId).eq('id', input.contractId).maybeSingle()
      : supabaseService.from('customer_contracts').select('id,contract_name,contract_number,starts_at').eq('company_id', input.companyId).eq('customer_id', input.customerId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabaseService.from('customer_supply_periods').select('id,start_date,status').eq('company_id', input.companyId).eq('customer_id', input.customerId).order('start_date', { ascending: false }).limit(1).maybeSingle(),
  ])
  for (const result of [companyResult, siteResult, pointResult, contractResult, periodResult]) {
    if (result.error && !['42P01', '42703', 'PGRST204', 'PGRST205'].includes(result.error.code ?? '')) throw result.error
  }

  const company = record(companyResult.data)
  const site = record(siteResult.data)
  const point = record(pointResult.data)
  const contract = record(contractResult.data)
  const period = record(periodResult.data)
  const payload = input.payload ?? {}
  const companyName = clean(company.name) ?? 'elbolaget'
  const supportEmail = clean(company.support_email) ?? clean(company.primary_contact_email) ?? ''
  const customerName = clean(customer.full_name) ?? clean(customer.company_name) ?? email
  const startDate = clean(payload.start_date) ?? clean(payload.startDate) ?? clean(period.start_date) ?? clean(contract.starts_at) ?? ''

  const result = await triggerEmailEvent({
    companyId: input.companyId,
    customerId: input.customerId,
    siteId: input.siteId ?? null,
    meteringPointId: input.meteringPointId ?? null,
    eventKey,
    to: email,
    adminTo: supportEmail || null,
    variables: {
      company_name: companyName,
      customer_name: customerName,
      customer_number: clean(customer.customer_number) ?? '',
      facility_id: clean(site.facility_id) ?? clean(payload.facility_id) ?? '',
      metering_point_id: clean(point.metering_point_id) ?? clean(point.ediel_metering_point_id) ?? clean(point.meter_point_id) ?? clean(payload.metering_point_id) ?? '',
      contract_name: clean(contract.contract_name) ?? '',
      contract_number: clean(contract.contract_number) ?? '',
      start_date: startDate,
      support_email: supportEmail,
    },
    idempotencyKey: `customer_lifecycle:${input.sourceEventId}:${eventKey}`,
    metadata: {
      source_event_id: input.sourceEventId,
      source_event_type: input.eventType,
      contract_id: clean(contract.id) ?? input.contractId ?? null,
      supply_period_id: clean(period.id),
      ...payload,
    },
  })

  const rows = Array.isArray(result)
    ? result.filter((item) => Boolean(item) && typeof item === 'object').map((item) => item as unknown as JsonRecord)
    : []
  const queued = rows.some((row) => row.ok === true || row.queued === true || clean(row.status) === 'queued' || clean(row.status) === 'sent')
  const skippedReason = queued
    ? undefined
    : rows.map((row) => clean(row.reason)).find(Boolean) ?? 'notification_not_queued'
  return { queued, eventKey, ...(skippedReason ? { skippedReason } : {}) }
}
