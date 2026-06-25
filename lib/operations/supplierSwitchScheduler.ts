// lib/operations/supplierSwitchScheduler.ts
//
// Batch 5: SupplierSwitchScheduler. Z03 must only be sent at the correct time and
// within the send window, with no duplicate active switch and no unresolved
// negative ACK. This module computes the send window and the blocking guards that
// gate Z03 dispatch. Exact regulatory lead times are policy/config; the defaults
// here are explicit and conservative (never guessed permissively).

import { supabaseService } from '@/lib/supabase/service'

export type SupplierSwitchScheduleBlocker = { code: string; message: string }

// Default send-window policy. The window opens this many days before the
// requested start date; sending earlier is blocked ("too early"). Sending at or
// after the open boundary (including late) is allowed so the engine never blocks
// a legitimate near-term or overdue switch.
export const SUPPLIER_SWITCH_WINDOW_OPEN_LEAD_DAYS = 45

const DAY_MS = 24 * 60 * 60 * 1000

// Active (in-progress) switch statuses for the duplicate-active-switch guard.
export const ACTIVE_SUPPLIER_SWITCH_STATUSES = [
  'draft',
  'pending',
  'ready',
  'queued',
  'prepared',
  'submitted',
  'in_progress',
  'sent',
  'waiting_response',
  'awaiting_confirmation',
  'confirmed',
]

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

export type SupplierSwitchSendWindow = {
  requestedStartDate: string | null
  sendWindowOpensAt: string | null
  sendWindowClosesAt: string | null
  sendNotBefore: string | null
  windowOpen: boolean
}

// Pure send-window computation.
export function evaluateSupplierSwitchSendWindow(input: {
  requestedStartDate: string | null | undefined
  now?: Date
  windowOpenLeadDays?: number
}): SupplierSwitchSendWindow {
  const now = input.now ?? new Date()
  const start = parseDate(input.requestedStartDate ?? null)
  const leadDays = input.windowOpenLeadDays ?? SUPPLIER_SWITCH_WINDOW_OPEN_LEAD_DAYS

  if (!start) {
    // No requested start date => no timing constraint can be enforced.
    return {
      requestedStartDate: null,
      sendWindowOpensAt: null,
      sendWindowClosesAt: null,
      sendNotBefore: null,
      windowOpen: true,
    }
  }

  const opensAt = new Date(start.getTime() - leadDays * DAY_MS)
  const closesAt = start
  return {
    requestedStartDate: start.toISOString(),
    sendWindowOpensAt: opensAt.toISOString(),
    sendWindowClosesAt: closesAt.toISOString(),
    sendNotBefore: opensAt.toISOString(),
    windowOpen: now.getTime() >= opensAt.getTime(),
  }
}

export type SupplierSwitchScheduleInput = {
  switchRequestId: string
  companyId: string | null
  requestedStartDate: string | null
  status?: string | null
  siteId?: string | null
  meteringPointId?: string | null
  now?: Date
}

export type SupplierSwitchScheduleResult = {
  ok: boolean
  window: SupplierSwitchSendWindow
  blockers: SupplierSwitchScheduleBlocker[]
}

async function findDuplicateActiveSwitch(input: SupplierSwitchScheduleInput): Promise<boolean> {
  if (!input.meteringPointId && !input.siteId) return false
  let query = supabaseService
    .from('supplier_switch_requests')
    .select('id,status,metering_point_id,site_id')
    .neq('id', input.switchRequestId)
    .in('status', ACTIVE_SUPPLIER_SWITCH_STATUSES)
    .limit(1)
  if (input.companyId) query = query.eq('company_id', input.companyId)
  if (input.meteringPointId) query = query.eq('metering_point_id', input.meteringPointId)
  else if (input.siteId) query = query.eq('site_id', input.siteId)

  const { data, error } = await query
  if (error) return false
  return Array.isArray(data) && data.length > 0
}

async function hasUnresolvedNegativeAck(switchRequestId: string): Promise<boolean> {
  const { data, error } = await supabaseService
    .from('supplier_switch_requests')
    .select('rejection_reason_code,lifecycle_blocked,outbound_z03_message_id')
    .eq('id', switchRequestId)
    .maybeSingle()
  if (error || !data) return false
  const row = data as { rejection_reason_code?: string | null; lifecycle_blocked?: boolean | null; outbound_z03_message_id?: string | null }
  if (row.lifecycle_blocked) return true
  if (row.rejection_reason_code) return true

  if (row.outbound_z03_message_id) {
    const { data: msg } = await supabaseService
      .from('ediel_messages')
      .select('ack_outcome,aperak_status,contrl_status,utilts_err_status')
      .eq('id', row.outbound_z03_message_id)
      .maybeSingle()
    const m = (msg ?? {}) as Record<string, unknown>
    if (m.ack_outcome === 'negative') return true
    if (String(m.aperak_status ?? '').toLowerCase() === 'negative') return true
    if (String(m.contrl_status ?? '').toLowerCase() === 'negative') return true
    if (String(m.utilts_err_status ?? '').toLowerCase() === 'negative') return true
  }
  return false
}

// Full schedule evaluation: send-window + duplicate-active-switch + negative-ACK.
export async function evaluateSupplierSwitchSchedule(
  input: SupplierSwitchScheduleInput,
): Promise<SupplierSwitchScheduleResult> {
  const window = evaluateSupplierSwitchSendWindow({
    requestedStartDate: input.requestedStartDate,
    now: input.now,
  })
  const blockers: SupplierSwitchScheduleBlocker[] = []

  if (!window.windowOpen) {
    blockers.push({
      code: 'supplier_switch_send_window_not_open',
      message: `Leverantörsbytet kan skickas tidigast ${window.sendNotBefore?.slice(0, 10)} (sändfönstret öppnar ${SUPPLIER_SWITCH_WINDOW_OPEN_LEAD_DAYS} dagar före startdatum).`,
    })
  }

  if (await findDuplicateActiveSwitch(input)) {
    blockers.push({
      code: 'duplicate_active_supplier_switch',
      message: 'Det finns redan ett pågående leverantörsbyte för anläggningen.',
    })
  }

  if (await hasUnresolvedNegativeAck(input.switchRequestId)) {
    blockers.push({
      code: 'unresolved_negative_ack',
      message: 'Det finns en olöst negativ kvittens/avvisning som måste hanteras innan nytt utskick.',
    })
  }

  return { ok: blockers.length === 0, window, blockers }
}
