import { createHash } from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'
import { isUuid } from '@/lib/validation/uuid'

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

type WebsiteApplicationLineage = {
  customer_id: string | null
  customer_site_id: string | null
  metering_point_id: string | null
  contract_id: string | null
}

export type WebsiteStatusLineageRow = {
  company_id?: string | null
  customer_id?: string | null
  customer_site_id?: string | null
  site_id?: string | null
  metering_point_id?: string | null
  contract_id?: string | null
  customer_contract_id?: string | null
  created_at?: string | null
  updated_at?: string | null
}

function lineageScore(application: WebsiteApplicationLineage, row: WebsiteStatusLineageRow): number {
  let score = 0
  if (application.contract_id && [text(row.contract_id), text(row.customer_contract_id)].includes(application.contract_id)) score += 100
  if (application.customer_site_id && [text(row.customer_site_id), text(row.site_id)].includes(application.customer_site_id)) score += 50
  if (application.metering_point_id && text(row.metering_point_id) === application.metering_point_id) score += 25
  if (application.customer_id && text(row.customer_id) === application.customer_id) score += 1
  return score
}

export function selectWebsiteStatusLineage<T extends WebsiteStatusLineageRow>(application: WebsiteApplicationLineage, rows: T[]) {
  const scored = rows
    .map((row) => ({ row, score: lineageScore(application, row) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || String(b.row.updated_at ?? b.row.created_at ?? '').localeCompare(String(a.row.updated_at ?? a.row.created_at ?? '')))
  const [first, second] = scored
  if (!first) return { data: null, ambiguous: false }
  if (first.score === 1 && second?.score === 1) return { data: null, ambiguous: true }
  return { data: first.row, ambiguous: false }
}

type WebsiteApplicationSwitch = WebsiteApplicationLineage & { company_id: string; response_payload: unknown }

function switchSite(row: WebsiteStatusLineageRow): string | null {
  return text(row.customer_site_id) ?? text(row.site_id)
}

function matchesSwitchBinding(application: WebsiteApplicationSwitch, row: WebsiteStatusLineageRow): boolean {
  if (row.company_id !== application.company_id || row.customer_id !== application.customer_id) return false
  const bindings = [
    [application.customer_site_id, switchSite(row)],
    [application.contract_id, text(row.customer_contract_id) ?? text(row.contract_id)],
    [application.metering_point_id, text(row.metering_point_id)],
  ]
  return bindings.every(([expected, actual]) => !expected || !actual || expected === actual)
}

export async function loadWebsiteApplicationSwitch(application: WebsiteApplicationSwitch) {
  if (!application.customer_id) return { data: null, error: null, ambiguous: false }
  const selectSwitch = () => supabaseService
    .from('supplier_switch_requests')
    .select('id,company_id,customer_id,customer_site_id,site_id,metering_point_id,contract_id,customer_contract_id,status,requested_start_date,confirmed_start_date,submitted_at,completed_at,failed_at,failure_reason,paused_at,pause_reason,lifecycle_blocked,lifecycle_block_source,created_at,updated_at')
    .eq('company_id', application.company_id)
    .eq('customer_id', application.customer_id)

  const savedId = text((application.response_payload as Record<string, unknown> | null)?.supplier_switch_request_id)
  if (savedId && isUuid(savedId)) {
    const result = await selectSwitch().eq('id', savedId.toLowerCase()).maybeSingle()
    if (result.error) return { data: null, error: result.error, ambiguous: false }
    if (result.data && matchesSwitchBinding(application, result.data)) return { data: result.data, error: null, ambiguous: false }
  }

  // Keep the existing checkout candidate window for applications without a usable saved link.
  const limit = 50
  const result = await selectSwitch().order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit)
  if (result.error) return { data: null, error: result.error, ambiguous: false }
  const rows = (result.data ?? []).filter(row => matchesSwitchBinding(application, row))
  const siteId = application.customer_site_id
  if (siteId && isUuid(siteId) && result.data?.length === limit && !rows.some(row => switchSite(row) === siteId)) {
    // Preserve the older switch-status read that scoped the site before its row limit.
    const atSite = await selectSwitch()
      .or(`customer_site_id.eq.${siteId},and(customer_site_id.is.null,site_id.eq.${siteId})`)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit)
    if (atSite.error) return { data: null, error: atSite.error, ambiguous: false }
    rows.push(...(atSite.data ?? []).filter(row => switchSite(row) === siteId && matchesSwitchBinding(application, row)))
  }
  return { ...selectWebsiteStatusLineage(application, rows), error: null }
}

export async function loadWebsiteSwitchStatus(input: { companyId: string; applicationNumber: string }) {
  const { data: application, error: applicationError } = await supabaseService
    .from('website_customer_applications')
    .select('application_number,status,response_payload,customer_id,customer_site_id,metering_point_id,contract_id')
    .eq('company_id', input.companyId)
    .eq('application_number', input.applicationNumber)
    .maybeSingle()
  if (applicationError) throw applicationError
  if (!application) {
    throw new WebsiteSwitchStatusError({ message: 'The application could not be found.', code: 'application_not_found', status: 404 })
  }

  const responsePayload = (application.response_payload ?? {}) as Record<string, unknown>
  const { data: switchRow, error: switchError } = await loadWebsiteApplicationSwitch({ ...application, company_id: input.companyId })
  if (switchError) throw switchError

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
