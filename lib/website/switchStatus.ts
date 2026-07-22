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

export async function loadWebsiteSwitchStatus(input: { companyId: string; applicationNumber: string }) {
  const { data: application, error: applicationError } = await supabaseService
    .from('website_customer_applications')
    .select('id,application_number,status,response_payload,customer_id,customer_site_id,contract_id,created_at,updated_at')
    .eq('company_id', input.companyId)
    .eq('application_number', input.applicationNumber)
    .maybeSingle()
  if (applicationError) throw applicationError
  if (!application) {
    throw new WebsiteSwitchStatusError({ message: 'Kundansökan hittades inte för denna tenant.', code: 'application_not_found', status: 404 })
  }

  const responsePayload = (application.response_payload ?? {}) as Record<string, unknown>
  const responseSwitchId = text(responsePayload.supplier_switch_request_id)
  let switchRow: Record<string, unknown> | null = null

  if (responseSwitchId) {
    const result = await supabaseService
      .from('supplier_switch_requests')
      .select('id,status,requested_start_date,submitted_at,completed_at,failed_at,failure_reason,paused_at,pause_reason,lifecycle_blocked,lifecycle_block_source,created_at,updated_at')
      .eq('company_id', input.companyId)
      .eq('id', responseSwitchId)
      .maybeSingle()
    if (result.error) throw result.error
    switchRow = (result.data as Record<string, unknown> | null) ?? null
  }

  if (!switchRow && application.customer_id) {
    let query = supabaseService
      .from('supplier_switch_requests')
      .select('id,status,requested_start_date,submitted_at,completed_at,failed_at,failure_reason,paused_at,pause_reason,lifecycle_blocked,lifecycle_block_source,created_at,updated_at')
      .eq('company_id', input.companyId)
      .eq('customer_id', application.customer_id)
      .order('created_at', { ascending: false })
      .limit(1)
    if (application.customer_site_id) query = query.eq('site_id', application.customer_site_id)
    const result = await query.maybeSingle()
    if (result.error) throw result.error
    switchRow = (result.data as Record<string, unknown> | null) ?? null
  }

  let events: Array<Record<string, unknown>> = []
  const switchId = text(switchRow?.id)
  if (switchId) {
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
