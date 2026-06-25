// lib/ediel/intent/dispatchState.ts
//
// Single source of truth for the outbound dispatch state of a business object.
//
// The ONLY way to know whether an outbound Ediel message is queued/sent/waiting
// is the intent → outbox → message chain:
//   - ediel_message_intents (validation + render + outbox lifecycle)
//   - ediel_outbox          (transport queue: prepared/queued/sent/blocked/failed)
//   - ediel_messages        (rendered message: draft/queued/sent/failed)
//
// Legacy outbound_requests is read ONLY as diagnostic context and can never
// upgrade the state to queued/sent. A legacy `queued` row with attempts_count = 0
// and sent_at = null is explicitly NOT sent and NOT waiting for the counterparty.
//
// This resolver fetches only lightweight status columns (no JSONB payloads / raw
// EDIFACT) so it is safe to call from list/card views (PART 14 performance).

import { supabaseService } from '@/lib/supabase/service'
import {
  isLegacyOutboundActuallySent,
  type LegacyOutboundRow,
} from '@/lib/ediel/outbox/legacyOutboundBridge'

type JsonRecord = Record<string, unknown>

export type EdielDispatchState =
  | 'none' // no intent created yet
  | 'intent_created' // intent exists, not yet validated
  | 'validated' // validated, not rendered/queued yet
  | 'blocked' // controlled blocker (validation/render failed in a controlled way)
  | 'rendered' // message rendered, not yet queued
  | 'queued' // real ediel_outbox row queued (or intent.outbox_status = queued)
  | 'sent' // message/outbox dispatched
  | 'failed' // render/outbox failure

export type EdielDispatchStateResult = {
  state: EdielDispatchState
  // True only when a real queued/sent outbox/message state exists. This is the
  // ONLY signal the UI may use to claim "waiting for grid owner".
  waitingForCounterparty: boolean
  intentId: string | null
  edielMessageId: string | null
  outboxId: string | null
  businessProcess: string | null
  messageFamily: string | null
  messageCode: string | null
  blockingReasons: Array<{ code: string; message: string }>
  // Plain Swedish, tenant-safe (PART 13). Never exposes BGM/UNB/route ids.
  tenantLabel: string
  // Compact technical summary for superadmin diagnostics.
  technical: {
    validationStatus: string | null
    renderStatus: string | null
    outboxStatus: string | null
    outboxRowStatus: string | null
    messageStatus: string | null
    messageSentAt: string | null
    legacyOutboundStatus: string | null
    legacyActuallySent: boolean
  }
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function isMissingSchema(error: unknown): boolean {
  const code = String((error as { code?: unknown } | null)?.code ?? '')
  const message = String((error as { message?: unknown } | null)?.message ?? '')
  return (
    ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code) ||
    /schema cache|does not exist|column .* does not exist/i.test(message)
  )
}

function blockingReasonsFrom(value: unknown): Array<{ code: string; message: string }> {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      const rec = (item && typeof item === 'object' ? item : {}) as JsonRecord
      const code = clean(rec.code)
      const message = clean(rec.message)
      if (!code && !message) return null
      return { code: code ?? 'blocked', message: message ?? 'Blockerad.' }
    })
    .filter((x): x is { code: string; message: string } => Boolean(x))
}

const NONE_RESULT = (): EdielDispatchStateResult => ({
  state: 'none',
  waitingForCounterparty: false,
  intentId: null,
  edielMessageId: null,
  outboxId: null,
  businessProcess: null,
  messageFamily: null,
  messageCode: null,
  blockingReasons: [],
  tenantLabel: 'Anläggningsuppgifter saknas',
  technical: {
    validationStatus: null,
    renderStatus: null,
    outboxStatus: null,
    outboxRowStatus: null,
    messageStatus: null,
    messageSentAt: null,
    legacyOutboundStatus: null,
    legacyActuallySent: false,
  },
})

function tenantLabelForState(state: EdielDispatchState, businessProcess: string | null): string {
  switch (state) {
    case 'none':
      return 'Anläggningsuppgifter saknas'
    case 'intent_created':
      return 'Begäran är skapad'
    case 'validated':
      return 'Förbereds för sändning'
    case 'rendered':
      return 'Förbereds för sändning'
    case 'queued':
      return 'Köad för Ediel-sändning'
    case 'sent':
      if (businessProcess === 'supplier_switch') return 'Leverantörsbyte skickat – väntar på bekräftelse'
      return 'Väntar på svar från nätägare'
    case 'blocked':
      return 'Leverantörsbyte väntar på kontroller'
    case 'failed':
      return 'Sändningen behöver ses över'
    default:
      return 'Begäran är skapad'
  }
}

type IntentStatusRow = {
  id: string
  business_process?: string | null
  message_family?: string | null
  message_code?: string | null
  validation_status?: string | null
  render_status?: string | null
  outbox_status?: string | null
  ediel_message_id?: string | null
  blocking_reasons?: unknown
}

async function loadIntent(input: {
  companyId: string
  intentId?: string | null
  gridOwnerInformationRequestId?: string | null
  supplierSwitchRequestId?: string | null
  customerId?: string | null
  customerSiteId?: string | null
}): Promise<IntentStatusRow | null> {
  const columns =
    'id,business_process,message_family,message_code,validation_status,render_status,outbox_status,ediel_message_id,blocking_reasons'
  let query = supabaseService
    .from('ediel_message_intents')
    .select(columns)
    .eq('company_id', input.companyId)

  if (clean(input.intentId)) {
    query = query.eq('id', input.intentId)
  } else if (clean(input.gridOwnerInformationRequestId)) {
    query = query.eq('grid_owner_information_request_id', input.gridOwnerInformationRequestId)
  } else if (clean(input.supplierSwitchRequestId)) {
    query = query.eq('supplier_switch_request_id', input.supplierSwitchRequestId)
  } else if (clean(input.customerId)) {
    query = query.eq('customer_id', input.customerId)
    if (clean(input.customerSiteId)) query = query.eq('customer_site_id', input.customerSiteId)
    // Facility lookup is the most relevant outbound for the customer card today.
    query = query.in('business_process', ['facility_lookup', 'customer_masterdata'])
  } else {
    return null
  }

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    if (isMissingSchema(error)) return null
    throw error
  }
  return (data as IntentStatusRow | null) ?? null
}

async function loadOutbox(input: {
  companyId: string
  intentId: string
  edielMessageId: string | null
}): Promise<{ id: string; status: string | null; sent_at: string | null } | null> {
  let query = supabaseService
    .from('ediel_outbox')
    .select('id,status,sent_at')
    .eq('company_id', input.companyId)

  if (clean(input.edielMessageId)) {
    query = query.or(`intent_id.eq.${input.intentId},ediel_message_id.eq.${input.edielMessageId}`)
  } else {
    query = query.eq('intent_id', input.intentId)
  }

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    if (isMissingSchema(error)) return null
    throw error
  }
  return (data as { id: string; status: string | null; sent_at: string | null } | null) ?? null
}

async function loadMessage(input: {
  companyId: string
  edielMessageId: string
}): Promise<{ status: string | null; sent_at: string | null } | null> {
  const { data, error } = await supabaseService
    .from('ediel_messages')
    .select('status,sent_at')
    .eq('company_id', input.companyId)
    .eq('id', input.edielMessageId)
    .maybeSingle()
  if (error) {
    if (isMissingSchema(error)) return null
    throw error
  }
  return (data as { status: string | null; sent_at: string | null } | null) ?? null
}

async function loadLegacyOutbound(input: {
  companyId: string
  gridOwnerInformationRequestId?: string | null
}): Promise<LegacyOutboundRow | null> {
  const sourceId = clean(input.gridOwnerInformationRequestId)
  if (!sourceId) return null
  const { data, error } = await supabaseService
    .from('outbound_requests')
    .select('id,status,attempts_count,sent_at')
    .eq('company_id', input.companyId)
    .eq('source_id', sourceId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    if (isMissingSchema(error)) return null
    throw error
  }
  return (data as LegacyOutboundRow | null) ?? null
}

// Resolves the canonical dispatch state of a business object from the intent /
// outbox / message chain. Legacy outbound_requests is diagnostic only.
export async function resolveEdielDispatchState(input: {
  companyId: string
  intentId?: string | null
  gridOwnerInformationRequestId?: string | null
  supplierSwitchRequestId?: string | null
  customerId?: string | null
  customerSiteId?: string | null
}): Promise<EdielDispatchStateResult> {
  const companyId = clean(input.companyId)
  if (!companyId) return NONE_RESULT()

  const intent = await loadIntent({
    companyId,
    intentId: input.intentId,
    gridOwnerInformationRequestId: input.gridOwnerInformationRequestId,
    supplierSwitchRequestId: input.supplierSwitchRequestId,
    customerId: input.customerId,
    customerSiteId: input.customerSiteId,
  })
  const legacy = await loadLegacyOutbound({
    companyId,
    gridOwnerInformationRequestId: input.gridOwnerInformationRequestId,
  })
  const legacyActuallySent = isLegacyOutboundActuallySent(legacy)

  if (!intent) {
    const base = NONE_RESULT()
    return {
      ...base,
      technical: {
        ...base.technical,
        legacyOutboundStatus: clean(legacy?.status),
        legacyActuallySent,
      },
    }
  }

  const edielMessageId = clean(intent.ediel_message_id)
  const outbox = await loadOutbox({ companyId, intentId: intent.id, edielMessageId })
  const message = edielMessageId ? await loadMessage({ companyId, edielMessageId }) : null

  const outboxRowStatus = clean(outbox?.status)
  const messageStatus = clean(message?.status)
  const messageSentAt = clean(message?.sent_at)
  const outboxSentAt = clean(outbox?.sent_at)

  let state: EdielDispatchState
  if (intent.validation_status === 'blocked') {
    state = 'blocked'
  } else if (
    messageStatus === 'sent' ||
    messageSentAt ||
    outboxRowStatus === 'sent' ||
    outboxSentAt
  ) {
    state = 'sent'
  } else if (
    intent.outbox_status === 'queued' ||
    outboxRowStatus === 'queued' ||
    outboxRowStatus === 'prepared'
  ) {
    state = 'queued'
  } else if (intent.render_status === 'failed' || outboxRowStatus === 'failed' || outboxRowStatus === 'blocked') {
    state = 'failed'
  } else if (intent.render_status === 'rendered') {
    state = 'rendered'
  } else if (intent.validation_status === 'validated') {
    state = 'validated'
  } else {
    state = 'intent_created'
  }

  // A legacy queued/attempts=0/sent_at=null row can NEVER move us to sent/waiting.
  // It is recorded as diagnostic context only and never overrides the chain above.

  // "Waiting for counterparty" requires a real dispatch (message sent). A merely
  // queued outbox row is pre-send ("Köad för Ediel-sändning"), not waiting.
  const waitingForCounterparty = state === 'sent'

  return {
    state,
    waitingForCounterparty,
    intentId: intent.id,
    edielMessageId,
    outboxId: clean(outbox?.id),
    businessProcess: clean(intent.business_process),
    messageFamily: clean(intent.message_family),
    messageCode: clean(intent.message_code),
    blockingReasons: blockingReasonsFrom(intent.blocking_reasons),
    tenantLabel: tenantLabelForState(state, clean(intent.business_process)),
    technical: {
      validationStatus: clean(intent.validation_status),
      renderStatus: clean(intent.render_status),
      outboxStatus: clean(intent.outbox_status),
      outboxRowStatus,
      messageStatus,
      messageSentAt,
      legacyOutboundStatus: clean(legacy?.status),
      legacyActuallySent,
    },
  }
}
