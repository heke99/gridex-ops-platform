import { createHash } from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'

export class WebsiteSwitchStatusError extends Error {
  readonly code: string
  readonly status: number
  readonly field: string

  constructor(input: { message: string; code: string; status?: number; field?: string }) {
    super(input.message)
    this.name = 'WebsiteSwitchStatusError'
    this.code = input.code
    this.status = input.status ?? 422
    this.field = input.field ?? 'application_number'
  }
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function opaqueSwitchReference(companyId: string, switchId: string): string {
  const digest = createHash('sha256').update(`${companyId}:${switchId}`).digest('base64url').slice(0, 30)
  return `switch_${digest}`
}

type ApplicationSwitchLink = {
  company_id: string
  customer_id: string | null
  customer_site_id: string | null
  metering_point_id: string | null
  contract_id: string | null
  response_payload: Record<string, unknown> | null
}

const switchFields = 'id,customer_id,contract_id,customer_contract_id,site_id,customer_site_id,metering_point_id,status,requested_start_date,confirmed_start_date,submitted_at,completed_at,failed_at,failure_reason,paused_at,pause_reason,lifecycle_blocked,lifecycle_block_source,updated_at'

function conflicts(expected: string | null, ...references: unknown[]): boolean {
  return Boolean(expected && references.some(value => {
    const reference = text(value)
    return reference !== null && reference !== expected
  }))
}

export async function loadLinkedWebsiteSwitch(application: ApplicationSwitchLink) {
  const { company_id: companyId, customer_id: customerId, contract_id: contractId,
    customer_site_id: siteId, metering_point_id: meterId } = application
  if (!customerId) return null

  const directId = text(application.response_payload?.supplier_switch_request_id)
  if (!directId && (!contractId || !siteId)) return null
  if (directId && !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(directId)) return null

  const query = supabaseService.from('supplier_switch_requests')
    .select(switchFields)
    .eq('company_id', companyId)
    .eq('customer_id', customerId)

  if (directId) {
    query.eq('id', directId)
  } else {
    query.or(`contract_id.eq.${contractId},customer_contract_id.eq.${contractId}`)
      .or(`site_id.eq.${siteId},customer_site_id.eq.${siteId}`)
    if (meterId) query.or(`metering_point_id.eq.${meterId},metering_point_id.is.null`)
  }

  const { data, error } = await query.limit(2)
  if (error) throw error
  if (data?.length !== 1) return null
  const row = data[0]
  if (conflicts(contractId, row.contract_id, row.customer_contract_id)
    || conflicts(siteId, row.site_id, row.customer_site_id)
    || conflicts(meterId, row.metering_point_id)) return null

  return row
}

export async function loadWebsiteSwitchStatus(input: { companyId: string; applicationNumber: string; includeEvents?: boolean }) {
  const { data: application, error: applicationError } = await supabaseService
    .from('website_customer_applications')
    .select('company_id,application_number,status,response_payload,customer_id,customer_site_id,metering_point_id,contract_id')
    .eq('company_id', input.companyId)
    .eq('application_number', input.applicationNumber)
    .maybeSingle()
  if (applicationError) throw applicationError
  if (!application) {
    throw new WebsiteSwitchStatusError({ message: 'The application could not be found.', code: 'application_not_found', status: 404 })
  }

  const responsePayload = (application.response_payload ?? {}) as Record<string, unknown>
  const switchRow = await loadLinkedWebsiteSwitch(application as ApplicationSwitchLink)

  let events: Array<Record<string, unknown>> = []
  const switchId = text(switchRow?.id)
  if (switchId && input.includeEvents !== false) {
    const eventResult = await supabaseService
      .from('supplier_switch_events')
      .select('event_type,event_status,message,created_at')
      .eq('company_id', input.companyId)
      .eq('switch_request_id', switchId)
      .order('created_at', { ascending: true })
      .limit(100)
    if (eventResult.error) throw eventResult.error
    events = (eventResult.data ?? []) as Array<Record<string, unknown>>
  }

  return {
    application_number: application.application_number,
    application_status: application.status,
    switch: switchId
      ? {
          switch_reference: opaqueSwitchReference(input.companyId, switchId),
          status: text(switchRow?.status),
          requested_start_date: text(switchRow?.requested_start_date),
          submitted_at: text(switchRow?.submitted_at),
          completed_at: text(switchRow?.completed_at),
          failed_at: text(switchRow?.failed_at),
          failure_reason: text(switchRow?.failure_reason),
          paused_at: text(switchRow?.paused_at),
          pause_reason: text(switchRow?.pause_reason),
          lifecycle_blocked: switchRow?.lifecycle_blocked === true,
          lifecycle_block_source: text(switchRow?.lifecycle_block_source),
          updated_at: text(switchRow?.updated_at),
          events: events.map((event) => ({
            event_type: text(event.event_type),
            event_status: text(event.event_status),
            message: text(event.message),
            created_at: text(event.created_at),
          })),
        }
      : null,
    next_step: text(responsePayload.next_step),
    blocking_reasons: Array.isArray(responsePayload.blocking_reasons) ? responsePayload.blocking_reasons : [],
    requested_start_date: text(responsePayload.requested_start_date),
    confirmed_start_date: text(responsePayload.confirmed_start_date),
    actual_start_date: text(responsePayload.actual_start_date),
  }
}
