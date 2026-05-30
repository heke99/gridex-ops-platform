// lib/ediel/flows/inboundAckProcessing.ts

import { supabaseService } from '@/lib/supabase/service'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { EdielAckStatus, EdielMessageFamily, EdielMessageRow } from '@/lib/ediel/types'
import {
  createEdielMessageEvent,
  getEdielMessageById,
  linkEdielMessage,
  updateEdielMessageStatus,
} from '@/lib/ediel/db'
import {
  getGridOwnerDataRequestById,
  ensureActorUserId,
} from '@/lib/ediel/flows/shared'
import {
  getOutboundRequestById,
  updateGridOwnerDataRequestStatus,
  updateOutboundRequestStatus,
} from '@/lib/cis/db'
import type { GridOwnerDataRequestRow, OutboundRequestRow } from '@/lib/cis/types'
import {
  createSupplierSwitchEvent,
  updateSupplierSwitchRequestStatus,
} from '@/lib/operations/db'
import type { SupplierSwitchRequestRow } from '@/lib/operations/types'
import { syncCustomerCaseCancellationAck } from '@/lib/customer-cases/db'
import { syncActorTestingForMessage } from '@/lib/ediel/actorTestingEngine'
import { EDIEL_AGT_PORTAL_EDIEL_ID } from '@/lib/ediel/agtRegistry'

type InboundAckFamily = Extract<EdielMessageFamily, 'CONTRL' | 'APERAK' | 'UTILTS_ERR'>
type InboundAckOutcome = 'positive' | 'negative'

type AckProcessResult = {
  ackMessage: EdielMessageRow
  sourceMessage: EdielMessageRow | null
  outcome: InboundAckOutcome
  finalAckReached: boolean
  outboundRequestId: string | null
  switchRequestId: string | null
  gridOwnerDataRequestId: string | null
}

const ACK_FAMILIES: readonly InboundAckFamily[] = ['CONTRL', 'APERAK', 'UTILTS_ERR']
const SOURCE_EXCLUDED_FAMILIES: readonly string[] = ['CONTRL', 'APERAK', 'UTILTS_ERR']

function isInboundAckFamily(value: string | null | undefined): value is InboundAckFamily {
  return Boolean(value && (ACK_FAMILIES as readonly string[]).includes(value))
}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function isUuidLike(value: string | null): value is string {
  return Boolean(
    value &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value
      )
  )
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value && value.trim())))]
}

function payloadString(message: EdielMessageRow, ...keys: string[]): string[] {
  const payload = message.parsed_payload ?? {}
  return uniqueStrings(keys.map((key) => stringOrNull(payload[key])))
}

function hasPayloadErrorSignal(message: EdielMessageRow): boolean {
  const payload = message.parsed_payload ?? {}
  const report = message.validation_report ?? {}

  const errorLikeKeys = [
    'error',
    'hasError',
    'hasErrors',
    'rejected',
    'syntaxError',
    'functionalError',
    'applicationError',
  ]

  if (errorLikeKeys.some((key) => payload[key] === true || report[key] === true)) return true

  const arrays = [
    payload.errors,
    payload.errorCodes,
    payload.aperakErrors,
    payload.contrlErrors,
    report.errors,
    report.errorCodes,
    report.aperakErrors,
    report.contrlErrors,
  ]

  return arrays.some((value) => Array.isArray(value) && value.length > 0)
}

function inferInboundAckOutcome(message: EdielMessageRow): InboundAckOutcome {
  const payload = message.parsed_payload ?? {}

  if (payload.ackOutcome === 'negative') return 'negative'
  if (payload.ackOutcome === 'positive') return 'positive'

  const statusValues = [
    stringOrNull(payload.status),
    stringOrNull(payload.outcome),
    stringOrNull(payload.result),
    stringOrNull(payload.ackStatus),
    stringOrNull(payload.acknowledgementStatus),
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase())

  if (
    statusValues.some((value) =>
      ['negative', 'rejected', 'failed', 'error', 'not_accepted', 'not accepted'].includes(value)
    )
  ) {
    return 'negative'
  }

  if (
    statusValues.some((value) =>
      ['positive', 'accepted', 'ok', 'success', 'acknowledged'].includes(value)
    )
  ) {
    return 'positive'
  }

  if (message.message_family === 'CONTRL') {
    if (message.syntax_check_status === 'rejected' || message.syntax_check_status === 'failed') {
      return 'negative'
    }
    if (message.syntax_check_status === 'accepted') return 'positive'
  }

  if (message.message_family === 'APERAK' || message.message_family === 'UTILTS_ERR') {
    if (
      message.functional_check_status === 'rejected' ||
      message.functional_check_status === 'failed'
    ) {
      return 'negative'
    }
    if (message.functional_check_status === 'accepted') return 'positive'
  }

  return hasPayloadErrorSignal(message) ? 'negative' : 'positive'
}

function ackStatusForOutcome(outcome: InboundAckOutcome): EdielAckStatus {
  return outcome === 'positive' ? 'received' : 'failed'
}

function buildAckFailureReason(message: EdielMessageRow, outcome: InboundAckOutcome): string | null {
  if (outcome === 'positive') return null

  const payload = message.parsed_payload ?? {}

  return (
    stringOrNull(payload.errorText) ??
    stringOrNull(payload.errorMessage) ??
    stringOrNull(payload.messageText) ??
    stringOrNull(payload.reason) ??
    stringOrNull(message.failure_reason) ??
    `${message.message_family} mottagen med negativ kvittens.`
  )
}

function isAckComplete(status: EdielAckStatus | null | undefined): boolean {
  return status === 'received' || status === 'sent' || status === 'not_required'
}

function computeFinalAckReached(params: {
  source: EdielMessageRow
  nextContrlStatus: EdielAckStatus | null
  nextAperakStatus: EdielAckStatus | null
  nextUtiltsErrStatus: EdielAckStatus | null
}): boolean {
  const contrlDone = !params.source.requires_contrl || isAckComplete(params.nextContrlStatus)
  const aperakDone = !params.source.requires_aperak || isAckComplete(params.nextAperakStatus)
  const utiltsErrBlocking = params.nextUtiltsErrStatus === 'pending'

  return contrlDone && aperakDone && !utiltsErrBlocking
}

function readReferenceCandidates(message: EdielMessageRow): string[] {
  return uniqueStrings([
    message.related_message_id,
    message.original_message_id,
    message.original_transaction_id,
    message.correlation_reference,
    message.external_reference,
    message.transaction_reference,
    message.interchange_reference,
    ...payloadString(
      message,
      'sourceMessageId',
      'relatedMessageId',
      'referencedMessageId',
      'originalMessageId',
      'originalTransactionId',
      'sourceMessageReference',
      'sourceTransactionReference',
      'referencedTransactionReference',
      'externalReference',
      'transactionReference',
      'correlationReference',
      'interchangeReference',
      'bgmReference',
      'messageReference'
    ),
  ])
}

function isActorTestingAckCandidate(message: EdielMessageRow): boolean {
  const sender = String(message.sender_ediel_id ?? '').trim()
  const receiver = String(message.receiver_ediel_id ?? '').trim()
  const parsed = message.parsed_payload ?? {}
  const report = message.validation_report ?? {}
  const fileEngine = parsed.fileEngine as { mode?: unknown } | undefined

  return (
    message.direction === 'inbound' &&
    message.environment === 'test' &&
    (
      sender === EDIEL_AGT_PORTAL_EDIEL_ID ||
      receiver === EDIEL_AGT_PORTAL_EDIEL_ID ||
      fileEngine?.mode === 'agt' ||
      report.fileEngineMode === 'agt'
    )
  )
}

async function syncActorTestingAckSafely(params: {
  actorUserId: string
  message: EdielMessageRow
  phase: 'unmatched_ack' | 'matched_ack'
}) {
  if (!isActorTestingAckCandidate(params.message)) return null

  try {
    const synced = await syncActorTestingForMessage({
      actorUserId: params.actorUserId,
      edielMessage: params.message,
      autoRespond: false,
      autoSend: false,
    })

    if (synced) {
      await createEdielMessageEvent({
        actorUserId: params.actorUserId,
        edielMessageId: params.message.id,
        eventType: 'linked',
        eventStatus: 'success',
        message: 'Inbound kvittens synkades automatiskt till Aktörstest & Produktionssättning.',
        payload: {
          actorTestingGlobalHook: true,
          phase: params.phase,
          companyId: synced.companyId,
          testKey: synced.testKey,
          status: synced.status,
        },
      })
    }

    return synced
  } catch (error) {
    await createEdielMessageEvent({
      actorUserId: params.actorUserId,
      edielMessageId: params.message.id,
      eventType: 'manual_note',
      eventStatus: 'warning',
      message: 'Aktörstest-synk kunde inte köras automatiskt för inbound kvittens.',
      payload: {
        actorTestingGlobalHook: true,
        phase: params.phase,
        error: error instanceof Error ? error.message : String(error),
      },
    }).catch(() => null)

    return null
  }
}

async function findOutboundSourceByColumn(params: {
  companyId: string
  column: keyof Pick<
    EdielMessageRow,
    | 'external_reference'
    | 'transaction_reference'
    | 'correlation_reference'
    | 'interchange_reference'
    | 'original_message_id'
    | 'original_transaction_id'
  >
  values: string[]
}): Promise<EdielMessageRow | null> {
  if (params.values.length === 0) return null

  const { data, error } = await supabaseService
    .from('ediel_messages')
    .select('*')
    .eq('company_id', params.companyId)
    .eq('direction', 'outbound')
    .not('message_family', 'in', `(${SOURCE_EXCLUDED_FAMILIES.join(',')})`)
    .in(params.column, params.values)
    .order('message_sent_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return (data as EdielMessageRow | null) ?? null
}

async function findSourceMessageViaBusinessReferences(params: {
  companyId: string
  values: string[]
}): Promise<EdielMessageRow | null> {
  if (params.values.length === 0) return null

  const { data, error } = await supabaseService
    .from('ediel_business_references')
    .select('source_message_id,reference_type,reference_value')
    .eq('company_id', params.companyId)
    .in('reference_value', params.values)
    .order('created_at', { ascending: false })
    .limit(10)

  if (error) throw error

  for (const row of (data ?? []) as Array<{ source_message_id?: string | null }>) {
    if (!row.source_message_id) continue
    const source = await getEdielMessageById(row.source_message_id, { companyId: params.companyId })
    if (source && source.direction === 'outbound' && !SOURCE_EXCLUDED_FAMILIES.includes(source.message_family)) {
      return source
    }
  }

  return null
}

async function findSourceMessageForInboundAck(message: EdielMessageRow): Promise<EdielMessageRow | null> {
  const companyId = stringOrNull(message.company_id)
  if (!companyId) return null

  if (message.related_message_id) {
    const direct = await getEdielMessageById(message.related_message_id, { companyId })
    if (direct && direct.direction === 'outbound') return direct
  }

  const candidates = readReferenceCandidates(message)
  const uuidCandidate = candidates.find(isUuidLike)
  if (uuidCandidate) {
    const direct = await getEdielMessageById(uuidCandidate, { companyId })
    if (direct && direct.direction === 'outbound') return direct
  }

  const businessReferenceHit = await findSourceMessageViaBusinessReferences({
    companyId,
    values: candidates,
  })
  if (businessReferenceHit) return businessReferenceHit

  const sourceColumns: Array<Parameters<typeof findOutboundSourceByColumn>[0]['column']> = [
    'external_reference',
    'transaction_reference',
    'correlation_reference',
    'interchange_reference',
    'original_message_id',
    'original_transaction_id',
  ]

  for (const column of sourceColumns) {
    const hit = await findOutboundSourceByColumn({ companyId, column, values: candidates })
    if (hit) return hit
  }

  return null
}

async function createAckChainIfMissing(params: {
  sourceMessage: EdielMessageRow
  ackMessage: EdielMessageRow
  outcome: InboundAckOutcome
}) {
  const companyId = stringOrNull(params.sourceMessage.company_id)
  if (!companyId) return

  const parsed = params.ackMessage.parsed_payload ?? {}
  const ackScope = stringOrNull(parsed.ackScope) ?? 'message'
  const transactionReference =
    stringOrNull(parsed.relatedTransactionReference) ??
    stringOrNull(params.ackMessage.transaction_reference)

  let existing = supabaseService
    .from('ediel_ack_chains')
    .select('id')
    .eq('company_id', companyId)
    .eq('source_message_id', params.sourceMessage.id)
    .eq('ack_family', params.ackMessage.message_family)
    .eq('ack_scope', ackScope)
    .eq('outcome', params.outcome)
    .limit(1)

  if (transactionReference) {
    existing = existing.eq('transaction_reference', transactionReference)
  } else {
    existing = existing.is('transaction_reference', null)
  }

  const existingResult = await existing.maybeSingle()
  if (existingResult.error) throw existingResult.error
  if (existingResult.data) return

  const { error } = await supabaseService
    .from('ediel_ack_chains')
    .insert({
      company_id: companyId,
      source_message_id: params.sourceMessage.id,
      ack_message_id: params.ackMessage.id,
      ack_family: params.ackMessage.message_family,
      ack_scope: ackScope,
      transaction_reference: transactionReference,
      outcome: params.outcome,
    })

  if (error && error.code !== '23505') throw error
}

async function patchSourceMessageFromAck(params: {
  actorUserId: string
  sourceMessage: EdielMessageRow
  ackMessage: EdielMessageRow
  outcome: InboundAckOutcome
}) {
  const nextContrlStatus =
    params.ackMessage.message_family === 'CONTRL'
      ? ackStatusForOutcome(params.outcome)
      : params.sourceMessage.contrl_status

  const nextAperakStatus =
    params.ackMessage.message_family === 'APERAK'
      ? ackStatusForOutcome(params.outcome)
      : params.sourceMessage.aperak_status

  const nextUtiltsErrStatus =
    params.ackMessage.message_family === 'UTILTS_ERR'
      ? ackStatusForOutcome(params.outcome)
      : params.sourceMessage.utilts_err_status

  const failureReason = buildAckFailureReason(params.ackMessage, params.outcome)
  const finalAckReached = computeFinalAckReached({
    source: params.sourceMessage,
    nextContrlStatus,
    nextAperakStatus,
    nextUtiltsErrStatus,
  })

  const now = new Date().toISOString()
  const nextStatus =
    params.outcome === 'negative'
      ? 'failed'
      : finalAckReached
        ? 'acknowledged'
        : params.sourceMessage.status

  const patch: Record<string, unknown> = {
    contrl_status: nextContrlStatus,
    aperak_status: nextAperakStatus,
    utilts_err_status: nextUtiltsErrStatus,
    status: nextStatus,
    failure_reason: failureReason ?? params.sourceMessage.failure_reason,
    updated_by: params.actorUserId,
    updated_at: now,
  }

  if (params.outcome === 'negative') {
    patch.failed_at = now
    patch.ack_due_at = null
  }

  if (params.outcome === 'positive' && finalAckReached) {
    patch.acknowledged_at = now
    patch.ack_due_at = null
  }

  const { data, error } = await supabaseService
    .from('ediel_messages')
    .update(patch)
    .eq('id', params.sourceMessage.id)
    .eq('company_id', params.sourceMessage.company_id ?? '')
    .select('*')
    .single()

  if (error) throw error

  const updated = data as EdielMessageRow

  await createEdielMessageEvent({
    actorUserId: params.actorUserId,
    edielMessageId: params.sourceMessage.id,
    eventType:
      params.ackMessage.message_family === 'CONTRL'
        ? 'contrl_received'
        : params.ackMessage.message_family === 'APERAK'
          ? 'aperak_received'
          : 'utilts_err_received',
    eventStatus: params.outcome === 'negative' ? 'error' : finalAckReached ? 'success' : 'info',
    message:
      params.outcome === 'negative'
        ? `${params.ackMessage.message_family} mottagen med negativ kvittens.`
        : finalAckReached
          ? `${params.ackMessage.message_family} mottagen och ackkedjan är klar.`
          : `${params.ackMessage.message_family} mottagen. Väntar fortfarande på resterande kvittens.`,
    payload: {
      ackMessageId: params.ackMessage.id,
      ackFamily: params.ackMessage.message_family,
      outcome: params.outcome,
      finalAckReached,
      nextContrlStatus,
      nextAperakStatus,
      nextUtiltsErrStatus,
      clearedAckDueAt: params.outcome === 'negative' || finalAckReached,
    },
  })

  return { updated, finalAckReached, failureReason }
}

async function getSwitchRequestById(
  id: string,
  companyId?: string | null
): Promise<SupplierSwitchRequestRow | null> {
  if (!companyId) return null

  const { data, error } = await supabaseService
    .from('supplier_switch_requests')
    .select('*')
    .eq('id', id)
    .eq('company_id', companyId)
    .maybeSingle()

  if (error) throw error
  return (data as SupplierSwitchRequestRow | null) ?? null
}

function resolveSwitchRequestId(params: {
  sourceMessage: EdielMessageRow
  outboundRequest: OutboundRequestRow | null
}): string | null {
  if (params.sourceMessage.switch_request_id) return params.sourceMessage.switch_request_id
  if (
    params.outboundRequest?.source_type === 'supplier_switch_request' &&
    params.outboundRequest.source_id
  ) {
    return params.outboundRequest.source_id
  }
  return null
}

function resolveGridOwnerDataRequestId(params: {
  sourceMessage: EdielMessageRow
  outboundRequest: OutboundRequestRow | null
}): string | null {
  if (params.sourceMessage.grid_owner_data_request_id) return params.sourceMessage.grid_owner_data_request_id
  if (
    params.outboundRequest?.source_type === 'grid_owner_data_request' &&
    params.outboundRequest.source_id
  ) {
    return params.outboundRequest.source_id
  }
  return null
}

async function ensureOutboundRequestHasSentTimestamp(params: {
  actorUserId: string
  outboundRequest: OutboundRequestRow
  sourceMessage: EdielMessageRow
  ackMessage: EdielMessageRow
}): Promise<OutboundRequestRow> {
  if (params.outboundRequest.sent_at) return params.outboundRequest

  const sentAt =
    params.sourceMessage.message_sent_at ??
    params.sourceMessage.updated_at ??
    params.sourceMessage.created_at ??
    new Date().toISOString()

  const nextStatus =
    params.outboundRequest.status === 'queued' || params.outboundRequest.status === 'prepared'
      ? 'sent'
      : params.outboundRequest.status

  const responsePayload = {
    ...(params.outboundRequest.response_payload ?? {}),
    sentAtBackfilledFrom: 'ediel_inbound_ack_processing',
    sentAtBackfilledViaAckMessageId: params.ackMessage.id,
    sentAtBackfilledSourceMessageId: params.sourceMessage.id,
  }

  const { data, error } = await supabaseService
    .from('outbound_requests')
    .update({
      status: nextStatus,
      sent_at: sentAt,
      response_payload: responsePayload,
      updated_by: params.actorUserId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.outboundRequest.id)
    .select('*')
    .single()

  if (error) throw error

  const updated = data as OutboundRequestRow

  await createEdielMessageEvent({
    actorUserId: params.actorUserId,
    edielMessageId: params.sourceMessage.id,
    eventType: 'manual_note',
    eventStatus: 'warning',
    message: 'Outbound request saknade sent_at vid inbound kvittens. sent_at backfillades innan acknowledgment.',
    payload: {
      outboundRequestId: updated.id,
      previousStatus: params.outboundRequest.status,
      nextStatus: updated.status,
      sentAt,
      ackMessageId: params.ackMessage.id,
    },
  })

  return updated
}

async function syncOutboundRequestFromInboundAck(params: {
  actorUserId: string
  sourceMessage: EdielMessageRow
  ackMessage: EdielMessageRow
  outcome: InboundAckOutcome
  finalAckReached: boolean
  failureReason: string | null
}): Promise<OutboundRequestRow | null> {
  if (!params.sourceMessage.outbound_request_id) return null

  const outbound = await getOutboundRequestById(params.sourceMessage.outbound_request_id)
  if (!outbound) return null

  if (params.outcome === 'negative') {
    return updateOutboundRequestStatus({
      actorUserId: params.actorUserId,
      outboundRequestId: outbound.id,
      status: 'failed',
      externalReference: params.ackMessage.external_reference ?? outbound.external_reference ?? null,
      failureReason: params.failureReason ?? `${params.ackMessage.message_family} negativ kvittens.`,
      responsePayload: {
        ...(outbound.response_payload ?? {}),
        inboundAckMessageId: params.ackMessage.id,
        inboundAckFamily: params.ackMessage.message_family,
        inboundAckOutcome: params.outcome,
      },
    })
  }

  if (!params.finalAckReached) return outbound

  const ackReadyOutbound = await ensureOutboundRequestHasSentTimestamp({
    actorUserId: params.actorUserId,
    outboundRequest: outbound,
    sourceMessage: params.sourceMessage,
    ackMessage: params.ackMessage,
  })

  return updateOutboundRequestStatus({
    actorUserId: params.actorUserId,
    outboundRequestId: ackReadyOutbound.id,
    status: 'acknowledged',
    externalReference: params.ackMessage.external_reference ?? ackReadyOutbound.external_reference ?? null,
    responsePayload: {
      ...(ackReadyOutbound.response_payload ?? {}),
      inboundAckMessageId: params.ackMessage.id,
      inboundAckFamily: params.ackMessage.message_family,
      inboundAckOutcome: params.outcome,
      acknowledgedVia: 'inbound_ediel_ack',
    },
  })
}

async function syncSwitchFromInboundAck(params: {
  actorUserId: string
  sourceMessage: EdielMessageRow
  ackMessage: EdielMessageRow
  outboundRequest: OutboundRequestRow | null
  outcome: InboundAckOutcome
  finalAckReached: boolean
  failureReason: string | null
}) {
  const switchRequestId = resolveSwitchRequestId({
    sourceMessage: params.sourceMessage,
    outboundRequest: params.outboundRequest,
  })

  if (!switchRequestId) return null

  const current = await getSwitchRequestById(switchRequestId, params.sourceMessage.company_id ?? null)
  if (!current) return null

  const supabase = await createSupabaseServerClient()

  if (params.outcome === 'negative') {
    const updated = await updateSupplierSwitchRequestStatus(supabase, {
      requestId: current.id,
      status: 'failed',
      failureReason: params.failureReason ?? `${params.ackMessage.message_family} negativ kvittens.`,
      externalReference: params.ackMessage.external_reference ?? current.external_reference ?? null,
    })

    await createSupplierSwitchEvent(supabase, {
      switchRequestId: current.id,
      eventType: 'ediel_ack_received',
      eventStatus: 'failed',
      message: `${params.ackMessage.message_family} negativ kvittens mottagen. Switch markerad som failed.`,
      payload: {
        sourceEdielMessageId: params.sourceMessage.id,
        ackEdielMessageId: params.ackMessage.id,
        outboundRequestId: params.outboundRequest?.id ?? null,
        outcome: params.outcome,
      },
    })

    return updated
  }

  if (params.finalAckReached && (current.status === 'draft' || current.status === 'queued')) {
    const updated = await updateSupplierSwitchRequestStatus(supabase, {
      requestId: current.id,
      status: 'submitted',
      externalReference: params.ackMessage.external_reference ?? current.external_reference ?? null,
    })

    await createSupplierSwitchEvent(supabase, {
      switchRequestId: current.id,
      eventType: 'ediel_ack_received',
      eventStatus: 'submitted',
      message: 'Ediel-kvittens mottagen. Switch är skickad och tekniskt/applikationsmässigt kvitterad.',
      payload: {
        sourceEdielMessageId: params.sourceMessage.id,
        ackEdielMessageId: params.ackMessage.id,
        outboundRequestId: params.outboundRequest?.id ?? null,
        outcome: params.outcome,
      },
    })

    return updated
  }

  await createSupplierSwitchEvent(supabase, {
    switchRequestId: current.id,
    eventType: 'ediel_ack_received',
    eventStatus: 'success',
    message:
      params.finalAckReached
        ? 'Ediel-kvittens mottagen. Switchstatus behölls eftersom den redan är längre fram i flödet.'
        : 'Ediel-kvittens mottagen. Väntar på resterande kvittens innan switchstatus ändras.',
    payload: {
      sourceEdielMessageId: params.sourceMessage.id,
      ackEdielMessageId: params.ackMessage.id,
      outboundRequestId: params.outboundRequest?.id ?? null,
      outcome: params.outcome,
      finalAckReached: params.finalAckReached,
      currentSwitchStatus: current.status,
    },
  })

  return current
}

async function syncGridOwnerDataRequestFromInboundAck(params: {
  actorUserId: string
  sourceMessage: EdielMessageRow
  ackMessage: EdielMessageRow
  outboundRequest: OutboundRequestRow | null
  outcome: InboundAckOutcome
  finalAckReached: boolean
  failureReason: string | null
}): Promise<GridOwnerDataRequestRow | null> {
  const requestId = resolveGridOwnerDataRequestId({
    sourceMessage: params.sourceMessage,
    outboundRequest: params.outboundRequest,
  })

  if (!requestId) return null

  const current = await getGridOwnerDataRequestById(requestId)
  if (!current) return null

  if (params.outcome === 'negative') {
    return updateGridOwnerDataRequestStatus({
      actorUserId: params.actorUserId,
      requestId: current.id,
      status: 'failed',
      externalReference: params.ackMessage.external_reference ?? current.external_reference ?? null,
      failureReason: params.failureReason ?? `${params.ackMessage.message_family} negativ kvittens.`,
      responsePayload: {
        ...(current.response_payload ?? {}),
        inboundAckMessageId: params.ackMessage.id,
        inboundAckFamily: params.ackMessage.message_family,
        inboundAckOutcome: params.outcome,
      },
      notes: current.notes,
    })
  }

  if (!params.finalAckReached || current.status === 'received') return current

  return updateGridOwnerDataRequestStatus({
    actorUserId: params.actorUserId,
    requestId: current.id,
    status: current.status === 'pending' ? 'sent' : current.status,
    externalReference: params.ackMessage.external_reference ?? current.external_reference ?? null,
    responsePayload: {
      ...(current.response_payload ?? {}),
      inboundAckMessageId: params.ackMessage.id,
      inboundAckFamily: params.ackMessage.message_family,
      inboundAckOutcome: params.outcome,
      acknowledgedVia: 'inbound_ediel_ack',
    },
    notes: current.notes,
  })
}

export async function processInboundAckMessage(params: {
  actorUserId: string
  message: EdielMessageRow
}): Promise<AckProcessResult> {
  const actorUserId = ensureActorUserId(params.actorUserId)
  const ackMessage = params.message

  if (!isInboundAckFamily(ackMessage.message_family)) {
    throw new Error(`Meddelande ${ackMessage.id} är inte inbound ack-family.`)
  }

  const outcome = inferInboundAckOutcome(ackMessage)
  const sourceMessage = await findSourceMessageForInboundAck(ackMessage)

  await updateEdielMessageStatus({
    actorUserId,
    edielMessageId: ackMessage.id,
    status: 'parsed',
    parsedPayload: {
      ...(ackMessage.parsed_payload ?? {}),
      ackOutcome: outcome,
    },
  })

  if (!sourceMessage) {
    await updateEdielMessageStatus({
      actorUserId,
      edielMessageId: ackMessage.id,
      status: outcome === 'negative' ? 'failed' : 'validated',
      failureReason:
        outcome === 'negative'
          ? buildAckFailureReason(ackMessage, outcome) ?? 'Inbound ack saknar matchad outbound-källa.'
          : null,
      validationReport: {
        ...(ackMessage.validation_report ?? {}),
        unmatchedInboundAck: true,
        ackOutcome: outcome,
      },
    })

    await createEdielMessageEvent({
      actorUserId,
      edielMessageId: ackMessage.id,
      eventType: 'manual_note',
      eventStatus: 'warning',
      message:
        'Inbound kvittens kunde inte kopplas till något outbound Ediel-meddelande. Kräver manuell kontroll.',
      payload: {
        ackFamily: ackMessage.message_family,
        ackOutcome: outcome,
        referenceCandidates: readReferenceCandidates(ackMessage),
      },
    })

    await syncActorTestingAckSafely({
      actorUserId,
      message: ackMessage,
      phase: 'unmatched_ack',
    })

    return {
      ackMessage,
      sourceMessage: null,
      outcome,
      finalAckReached: false,
      outboundRequestId: null,
      switchRequestId: null,
      gridOwnerDataRequestId: null,
    }
  }

  await linkEdielMessage({
    actorUserId,
    edielMessageId: ackMessage.id,
    relatedMessageId: sourceMessage.id,
    outboundRequestId: sourceMessage.outbound_request_id,
    switchRequestId: sourceMessage.switch_request_id,
    gridOwnerDataRequestId: sourceMessage.grid_owner_data_request_id,
    partnerExportId: sourceMessage.partner_export_id,
    customerId: sourceMessage.customer_id,
    siteId: sourceMessage.site_id,
    meteringPointId: sourceMessage.metering_point_id,
    gridOwnerId: sourceMessage.grid_owner_id,
    communicationRouteId: sourceMessage.communication_route_id,
  })

  const sourcePatch = await patchSourceMessageFromAck({
    actorUserId,
    sourceMessage,
    ackMessage,
    outcome,
  })

  await createAckChainIfMissing({
    sourceMessage,
    ackMessage,
    outcome,
  })

  const outboundRequest = await syncOutboundRequestFromInboundAck({
    actorUserId,
    sourceMessage,
    ackMessage,
    outcome,
    finalAckReached: sourcePatch.finalAckReached,
    failureReason: sourcePatch.failureReason,
  })

  const switchResult = await syncSwitchFromInboundAck({
    actorUserId,
    sourceMessage,
    ackMessage,
    outboundRequest,
    outcome,
    finalAckReached: sourcePatch.finalAckReached,
    failureReason: sourcePatch.failureReason,
  })

  const gridOwnerDataRequest = await syncGridOwnerDataRequestFromInboundAck({
    actorUserId,
    sourceMessage,
    ackMessage,
    outboundRequest,
    outcome,
    finalAckReached: sourcePatch.finalAckReached,
    failureReason: sourcePatch.failureReason,
  })

  const customerCase = await syncCustomerCaseCancellationAck({
    actorUserId,
    sourceMessage: sourcePatch.updated,
    ackMessage,
    outcome,
    finalAckReached: sourcePatch.finalAckReached,
  })

  await updateEdielMessageStatus({
    actorUserId,
    edielMessageId: ackMessage.id,
    status: outcome === 'negative' ? 'failed' : 'validated',
    failureReason: sourcePatch.failureReason,
    validatedAt: new Date().toISOString(),
    validationReport: {
      ...(ackMessage.validation_report ?? {}),
      ackOutcome: outcome,
      matchedOutboundEdielMessageId: sourceMessage.id,
      finalAckReached: sourcePatch.finalAckReached,
    },
  })

  await createEdielMessageEvent({
    actorUserId,
    edielMessageId: ackMessage.id,
    eventType:
      ackMessage.message_family === 'CONTRL'
        ? 'contrl_received'
        : ackMessage.message_family === 'APERAK'
          ? 'aperak_received'
          : 'utilts_err_received',
    eventStatus: outcome === 'negative' ? 'error' : 'success',
    message:
      outcome === 'negative'
        ? `${ackMessage.message_family} kopplad till outbound men innehåller negativ kvittens.`
        : `${ackMessage.message_family} kopplad till outbound och processad.`,
    payload: {
      sourceEdielMessageId: sourceMessage.id,
      outboundRequestId: outboundRequest?.id ?? sourceMessage.outbound_request_id,
      switchRequestId: switchResult?.id ?? sourceMessage.switch_request_id,
      gridOwnerDataRequestId: gridOwnerDataRequest?.id ?? sourceMessage.grid_owner_data_request_id,
      customerCaseId: customerCase?.id ?? null,
      ackOutcome: outcome,
      finalAckReached: sourcePatch.finalAckReached,
    },
  })

  await syncActorTestingAckSafely({
    actorUserId,
    message: ackMessage,
    phase: 'matched_ack',
  })

  return {
    ackMessage,
    sourceMessage: sourcePatch.updated,
    outcome,
    finalAckReached: sourcePatch.finalAckReached,
    outboundRequestId: outboundRequest?.id ?? sourceMessage.outbound_request_id,
    switchRequestId: switchResult?.id ?? sourceMessage.switch_request_id,
    gridOwnerDataRequestId: gridOwnerDataRequest?.id ?? sourceMessage.grid_owner_data_request_id,
  }
}
