import { supabaseService } from '@/lib/supabase/service'
import { OPEN_SUPPLIER_SWITCH_STATUSES } from '@/lib/operations/switchLifecycleBlocks'
import { stockholmLocalToUtc, strictIsoDate } from '@/lib/time/stockholm'
import {
  canonicalProdatSubtypeForMessage,
  canonicalSupplierSwitchSendPolicyProjection,
  type CanonicalSupplierSwitchSendPolicy,
} from '@/lib/ediel/rulebook/canonicalEdielFacade'

export type SupplierSwitchScheduleBlocker = { code: string; message: string }

const LEGACY_ACTIVE_SUPPLIER_SWITCH_STATUSES = [
  'pending', 'ready', 'prepared', 'in_progress', 'sent', 'waiting_response',
  'awaiting_confirmation', 'confirmed',
]

export const ACTIVE_SUPPLIER_SWITCH_STATUSES = Array.from(new Set<string>([
  ...OPEN_SUPPLIER_SWITCH_STATUSES,
  ...LEGACY_ACTIVE_SUPPLIER_SWITCH_STATUSES,
]))

export type SupplierSwitchPolicy = CanonicalSupplierSwitchSendPolicy

export function loadSupplierSwitchPolicy(input: {
  subtype?: 'L' | 'LK' | 'C' | null
  cancellationOfSubtype?: 'L' | 'LK' | null
} = {}): SupplierSwitchPolicy {
  return canonicalSupplierSwitchSendPolicyProjection(input)
}

function dateOnlyToStockholmStart(value: string): Date {
  const strict = strictIsoDate(value, 'requested_start_date')
  const [year, month, day] = strict.split('-').map(Number)
  return stockholmLocalToUtc({ year, month, day })
}

function stockholmDateOnly(value: Date): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(value)
}

function dateParts(value: string): { year: number; month: number; day: number } {
  const strict = strictIsoDate(value, 'requested_start_date')
  const [year, month, day] = strict.split('-').map(Number)
  return { year, month, day }
}

function formatDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function addCalendarDaysDateOnly(value: string, days: number): string {
  const { year, month, day } = dateParts(value)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return formatDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
}

function addCalendarMonthsDateOnly(value: string, months: number): string {
  const { year, month, day } = dateParts(value)
  const zeroBased = year * 12 + (month - 1) + months
  const targetYear = Math.floor(zeroBased / 12)
  const targetMonthIndex = ((zeroBased % 12) + 12) % 12
  const targetMonth = targetMonthIndex + 1
  return formatDate(targetYear, targetMonth, Math.min(day, daysInMonth(targetYear, targetMonth)))
}

function stockholmEndOfDate(value: string): Date {
  const next = addCalendarDaysDateOnly(value, 1)
  return new Date(dateOnlyToStockholmStart(next).getTime() - 1)
}

export type SupplierSwitchSendWindow = {
  requestedStartDate: string | null
  transactionSubtype: 'L' | 'LK' | 'C'
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
    return {
      requestedStartDate: null,
      transactionSubtype: input.policy.subtype,
      sendWindowOpensAt: null,
      sendWindowClosesAt: null,
      sendNotBefore: null,
      windowOpen: false,
      reason: 'missing_start_date',
    }
  }

  let startDate: string
  try {
    startDate = strictIsoDate(input.requestedStartDate, 'requested_start_date')
  } catch {
    return {
      requestedStartDate: input.requestedStartDate,
      transactionSubtype: input.policy.subtype,
      sendWindowOpensAt: null,
      sendWindowClosesAt: null,
      sendNotBefore: null,
      windowOpen: false,
      reason: 'invalid_start_date',
    }
  }

  const opensDate = input.policy.maxAdvanceMonths === null
    ? stockholmDateOnly(now)
    : addCalendarMonthsDateOnly(startDate, -input.policy.maxAdvanceMonths)
  const closesDate = addCalendarDaysDateOnly(startDate, input.policy.latestRelativeToStartDays)
  const today = stockholmDateOnly(now)
  const reason = today < opensDate ? 'too_early' : today > closesDate ? 'expired' : 'open'
  const opensAt = dateOnlyToStockholmStart(opensDate)
  const closesAt = stockholmEndOfDate(closesDate)

  return {
    requestedStartDate: startDate,
    transactionSubtype: input.policy.subtype,
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
  requestType?: string | null
  transactionSubtype?: string | null
  cancellationOfSubtype?: 'L' | 'LK' | null
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

function resolveSwitchSubtype(input: SupplierSwitchScheduleInput): 'L' | 'LK' | 'C' {
  if (String(input.status ?? '').trim().toLowerCase() === 'cancellation_requested') return 'C'
  const canonical = canonicalProdatSubtypeForMessage('Z03', input.transactionSubtype)
  if (canonical === 'C' || canonical === 'LK' || canonical === 'L') return canonical
  if (String(input.requestType ?? '').trim().toLowerCase() === 'move_in') return 'LK'
  return 'L'
}

function cancellationContext(input: SupplierSwitchScheduleInput, subtype: 'L' | 'LK' | 'C'): 'L' | 'LK' | null {
  if (subtype !== 'C') return null
  if (input.cancellationOfSubtype) return input.cancellationOfSubtype
  return String(input.requestType ?? '').trim().toLowerCase() === 'move_in' ? 'LK' : 'L'
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
  const subtype = resolveSwitchSubtype(input)
  let policy: SupplierSwitchPolicy | null = null
  try {
    policy = loadSupplierSwitchPolicy({
      subtype,
      cancellationOfSubtype: cancellationContext(input, subtype),
    })
  } catch (error) {
    blockers.push({
      code: 'supplier_switch_policy_unavailable',
      message: error instanceof Error ? error.message : 'Leverantörsbytets canonical marknadspolicy kunde inte läsas.',
    })
  }

  const window = policy
    ? evaluateSupplierSwitchSendWindow({ requestedStartDate: input.requestedStartDate, policy, now: input.now })
    : {
        requestedStartDate: input.requestedStartDate,
        transactionSubtype: subtype,
        sendWindowOpensAt: null,
        sendWindowClosesAt: null,
        sendNotBefore: null,
        windowOpen: false,
        reason: 'invalid_start_date' as const,
      }

  if (!window.windowOpen) {
    blockers.push({
      code: `supplier_switch_send_window_${window.reason}`,
      message: window.reason === 'missing_start_date'
        ? 'Startdatum saknas och leverantörsbytet får inte skickas.'
        : window.reason === 'expired'
          ? 'Handbokens senaste sänddag har passerat. Ange ett nytt giltigt startdatum.'
          : window.reason === 'too_early'
            ? `Handbokens sändfönster öppnar ${window.sendNotBefore?.slice(0, 10)}.`
            : 'Startdatumet eller det canonical sändfönstret är ogiltigt.',
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
