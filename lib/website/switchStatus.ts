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

type WebsiteStatusLineageRow = {
  company_id?: string | null
  customer_id?: string | null
  customer_site_id?: string | null
  site_id?: string | null
  metering_point_id?: string | null
  contract_id?: string | null
  customer_contract_id?: string | null
}

// Try each exact binding before a weaker one so a REST row cap cannot change its rank.
export async function readWebsiteStatusLineage<T, E>(
  application: Pick<WebsiteApplicationLineage, 'contract_id' | 'metering_point_id'>,
  siteBound: boolean,
  read: (filter: string | null, limit: number) => PromiseLike<{ data: T[] | null; error: E | null }>,
): Promise<{ data: T | null; error: E | null; ambiguous: boolean }> {
  const absent = { data: null, error: null, ambiguous: false }
  const { contract_id: contractId, metering_point_id: meterId } = application
  if ((contractId && !isUuid(contractId)) || (meterId && !isUuid(meterId))) return absent

  // With no strong key, distinguish one historical customer hit from an ambiguous set.
  if (!contractId && !meterId) {
    const result = await read(null, siteBound ? 1 : 2)
    if (result.error) return { ...absent, error: result.error }
    const [first = null, second] = result.data ?? []
    return second ? { ...absent, ambiguous: true } : { ...absent, data: first }
  }

  const contractMatch = contractId
    ? `or(customer_contract_id.eq.${contractId},and(customer_contract_id.is.null,contract_id.eq.${contractId}))`
    : null
  const meterMatch = meterId ? `metering_point_id.eq.${meterId}` : null
  const missingContract = 'and(customer_contract_id.is.null,contract_id.is.null)'
  const missingMeter = 'metering_point_id.is.null'
  const filters = contractMatch && meterMatch
    ? [`and(${contractMatch},${meterMatch})`, `and(${contractMatch},${missingMeter})`, `and(${missingContract},${meterMatch})`]
    : [contractMatch ?? meterMatch]
  if (siteBound) {
    filters.push(contractMatch && meterMatch ? `and(${missingContract},${missingMeter})` : contractMatch ? missingContract : missingMeter)
  }
  for (const filter of filters) {
    const result = await read(filter, 1)
    if (result.error) return { ...absent, error: result.error }
    const row = result.data?.[0]
    if (row) return { ...absent, data: row }
  }
  return absent
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

  const siteId = application.customer_site_id
  if (siteId && !isUuid(siteId)) return { data: null, error: null, ambiguous: false }
  return readWebsiteStatusLineage(application, Boolean(siteId), (filter, limit) => {
    const query = selectSwitch()
    if (siteId) query.or(`customer_site_id.eq.${siteId},and(customer_site_id.is.null,site_id.eq.${siteId})`)
    if (filter) query.or(filter)
    return query.order('updated_at', { ascending: false }).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit)
  })
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
