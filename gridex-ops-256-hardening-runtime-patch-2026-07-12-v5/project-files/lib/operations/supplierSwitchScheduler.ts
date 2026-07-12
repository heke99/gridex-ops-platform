import { supabaseService } from '@/lib/supabase/service'
import { OPEN_SUPPLIER_SWITCH_STATUSES } from '@/lib/operations/switchLifecycleBlocks'
import { assertPlatformSchemaReady } from '@/lib/platform/schemaReadiness'
import { stockholmLocalToUtc, strictIsoDate } from '@/lib/time/stockholm'

export type SupplierSwitchScheduleBlocker = { code: string; message: string }

const LEGACY_ACTIVE_SUPPLIER_SWITCH_STATUSES = [
  'pending', 'ready', 'prepared', 'in_progress', 'sent', 'waiting_response',
  'awaiting_confirmation', 'confirmed',
]

export const ACTIVE_SUPPLIER_SWITCH_STATUSES = Array.from(new Set<string>([
  ...OPEN_SUPPLIER_SWITCH_STATUSES,
  ...LEGACY_ACTIVE_SUPPLIER_SWITCH_STATUSES,
]))

export type SupplierSwitchPolicy = {
  version: string
  sendWindowOpenLeadDays: number
  sendWindowCloseOffsetDays: number
  marketLeadDays: number
  calendar: 'Europe/Stockholm'
}

function positiveInteger(value: unknown, name: string, allowZero = true): number {
  const number = Number(value)
  if (!Number.isInteger(number) || number < (allowZero ? 0 : 1) || number > 3650) {
    throw new Error(`invalid_supplier_switch_policy_${name}`)
  }
  return number
}

export async function loadSupplierSwitchPolicy(companyId: string, environment = 'production', onDate = new Date()): Promise<SupplierSwitchPolicy> {
  await assertPlatformSchemaReady()
  const localDate = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(onDate)
  const { data, error } = await supabaseService
    .from('market_process_policies')
    .select('id,company_id,policy_version,policy,valid_from,valid_to')
    .eq('process_code', 'supplier_switch')
    .eq('environment', environment)
    .eq('is_active', true)
    .lte('valid_from', localDate)
    .or(`valid_to.is.null,valid_to.gte.${localDate}`)
    .or(`company_id.is.null,company_id.eq.${companyId}`)
    .order('valid_from', { ascending: false })
    .limit(20)
  if (error) throw error
  const rows = (data ?? []) as Array<{ id: string; company_id: string | null; policy_version: string; policy: Record<string, unknown> }>
  const tenant = rows.filter((row) => row.company_id === companyId)
  const global = rows.filter((row) => row.company_id === null)
  const tier = tenant.length > 0 ? tenant : global
  if (tier.length !== 1) throw new Error(tier.length === 0 ? 'supplier_switch_policy_missing' : 'supplier_switch_policy_ambiguous')
  const row = tier[0]
  return {
    version: row.policy_version,
    sendWindowOpenLeadDays: positiveInteger(row.policy.send_window_open_lead_days, 'open_lead_days'),
    sendWindowCloseOffsetDays: positiveInteger(row.policy.send_window_close_offset_days, 'close_offset_days'),
    marketLeadDays: positiveInteger(row.policy.market_lead_days, 'market_lead_days'),
    calendar: row.policy.calendar === 'Europe/Stockholm' ? 'Europe/Stockholm' : (() => { throw new Error('invalid_supplier_switch_policy_calendar') })(),
  }
}

function dateOnlyToStockholmStart(value: string): Date {
  const strict = strictIsoDate(value, 'requested_start_date')
  const [year, month, day] = strict.split('-').map(Number)
  return stockholmLocalToUtc({ year, month, day })
}

function addCalendarDays(date: Date, days: number): Date {
  const local = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date)
  const [year, month, day] = local.split('-').map(Number)
  const utcCalendar = new Date(Date.UTC(year, month - 1, day + days))
  return stockholmLocalToUtc({ year: utcCalendar.getUTCFullYear(), month: utcCalendar.getUTCMonth() + 1, day: utcCalendar.getUTCDate() })
}

export type SupplierSwitchSendWindow = {
  requestedStartDate: string | null
  sendWindowOpensAt: string | null
  sendWindowClosesAt: string | null
  sendNotBefore: string | null
  windowOpen: boolean
  reason: 'open' | 'missing_start_date' | 'too_early' | 'expired' | 'invalid_start_date'
}

export function evaluateSupplierSwitchSendWindow(input: {
  requestedStartDate: string | null | undefined
  policy: SupplierSwitchPolicy
  now?: Date
}): SupplierSwitchSendWindow {
  const now = input.now ?? new Date()
  if (!input.requestedStartDate) {
    return { requestedStartDate: null, sendWindowOpensAt: null, sendWindowClosesAt: null, sendNotBefore: null, windowOpen: false, reason: 'missing_start_date' }
  }
  let start: Date
  try {
    start = dateOnlyToStockholmStart(input.requestedStartDate)
  } catch {
    return { requestedStartDate: input.requestedStartDate, sendWindowOpensAt: null, sendWindowClosesAt: null, sendNotBefore: null, windowOpen: false, reason: 'invalid_start_date' }
  }
  const opensAt = addCalendarDays(start, -input.policy.sendWindowOpenLeadDays)
  const closesAt = addCalendarDays(start, input.policy.sendWindowCloseOffsetDays)
  const reason = now < opensAt ? 'too_early' : now >= closesAt ? 'expired' : 'open'
  return {
    requestedStartDate: input.requestedStartDate,
    sendWindowOpensAt: opensAt.toISOString(),
    sendWindowClosesAt: closesAt.toISOString(),
    sendNotBefore: opensAt.toISOString(),
    windowOpen: reason === 'open',
    reason,
  }
}

export type SupplierSwitchScheduleInput = {
  switchRequestId: string
  companyId: string | null
  requestedStartDate: string | null
  environment?: 'test' | 'production'
  status?: string | null
  siteId?: string | null
  meteringPointId?: string | null
  now?: Date
}

export type SupplierSwitchScheduleResult = {
  ok: boolean
  window: SupplierSwitchSendWindow
  blockers: SupplierSwitchScheduleBlocker[]
  policyVersion: string | null
}

async function findDuplicateActiveSwitch(input: SupplierSwitchScheduleInput): Promise<boolean> {
  if (!input.companyId) throw new Error('supplier_switch_company_missing')
  if (!input.meteringPointId && !input.siteId) throw new Error('supplier_switch_identity_missing')
  let query = supabaseService
    .from('supplier_switch_requests')
    .select('id,status,metering_point_id,site_id')
    .eq('company_id', input.companyId)
    .neq('id', input.switchRequestId)
    .in('status', ACTIVE_SUPPLIER_SWITCH_STATUSES)
    .limit(2)
  query = input.meteringPointId ? query.eq('metering_point_id', input.meteringPointId) : query.eq('site_id', input.siteId)
  const { data, error } = await query
  if (error) throw error
  return (data ?? []).length > 0
}

async function hasUnresolvedNegativeAck(input: SupplierSwitchScheduleInput): Promise<boolean> {
  if (!input.companyId) throw new Error('supplier_switch_company_missing')
  const { data, error } = await supabaseService
    .from('supplier_switch_requests')
    .select('rejection_reason_code,lifecycle_blocked,outbound_z03_message_id')
    .eq('id', input.switchRequestId)
    .eq('company_id', input.companyId)
    .limit(2)
  if (error) throw error
  if ((data ?? []).length !== 1) throw new Error('supplier_switch_request_missing_or_ambiguous')
  const row = data[0] as { rejection_reason_code?: string | null; lifecycle_blocked?: boolean | null; outbound_z03_message_id?: string | null }
  if (row.lifecycle_blocked || row.rejection_reason_code) return true
  if (!row.outbound_z03_message_id) return false
  const message = await supabaseService
    .from('ediel_messages')
    .select('ack_outcome,aperak_status,contrl_status,utilts_err_status')
    .eq('id', row.outbound_z03_message_id)
    .eq('company_id', input.companyId)
    .limit(2)
  if (message.error) throw message.error
  if ((message.data ?? []).length !== 1) throw new Error('supplier_switch_outbound_message_missing_or_ambiguous')
  const current = message.data[0] as Record<string, unknown>
  return [current.ack_outcome, current.aperak_status, current.contrl_status, current.utilts_err_status]
    .some((value) => String(value ?? '').toLowerCase() === 'negative')
}

export async function evaluateSupplierSwitchSchedule(input: SupplierSwitchScheduleInput): Promise<SupplierSwitchScheduleResult> {
  const blockers: SupplierSwitchScheduleBlocker[] = []
  let policy: SupplierSwitchPolicy | null = null
  try {
    if (!input.companyId) throw new Error('supplier_switch_company_missing')
    policy = await loadSupplierSwitchPolicy(input.companyId, input.environment ?? 'production', input.now)
  } catch (error) {
    blockers.push({ code: 'supplier_switch_policy_unavailable', message: error instanceof Error ? error.message : 'Leverantörsbytets marknadspolicy kunde inte läsas.' })
  }
  const window = policy
    ? evaluateSupplierSwitchSendWindow({ requestedStartDate: input.requestedStartDate, policy, now: input.now })
    : { requestedStartDate: input.requestedStartDate, sendWindowOpensAt: null, sendWindowClosesAt: null, sendNotBefore: null, windowOpen: false, reason: 'invalid_start_date' as const }
  if (!window.windowOpen) {
    blockers.push({
      code: `supplier_switch_send_window_${window.reason}`,
      message: window.reason === 'missing_start_date'
        ? 'Startdatum saknas och leverantörsbytet får inte skickas.'
        : window.reason === 'expired'
          ? 'Sändfönstret har passerat. Ange ett nytt giltigt startdatum.'
          : window.reason === 'too_early'
            ? `Leverantörsbytet kan skickas tidigast ${window.sendNotBefore?.slice(0, 10)}.`
            : 'Startdatumet eller sändfönstret är ogiltigt.',
    })
  }
  try {
    if (await findDuplicateActiveSwitch(input)) blockers.push({ code: 'duplicate_active_supplier_switch', message: 'Det finns redan ett pågående leverantörsbyte för anläggningen.' })
  } catch (error) {
    blockers.push({ code: 'duplicate_switch_check_failed', message: error instanceof Error ? error.message : 'Dublettkontrollen misslyckades.' })
  }
  try {
    if (await hasUnresolvedNegativeAck(input)) blockers.push({ code: 'unresolved_negative_ack', message: 'Det finns en olöst negativ kvittens/avvisning.' })
  } catch (error) {
    blockers.push({ code: 'negative_ack_check_failed', message: error instanceof Error ? error.message : 'Kvittensläget kunde inte verifieras.' })
  }
  return { ok: blockers.length === 0, window, blockers, policyVersion: policy?.version ?? null }
}
