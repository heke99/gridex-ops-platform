// lib/ediel/safeApplyReview.ts

import { createEdielMessageEvent } from '@/lib/ediel/db'
import type { EdielMessageEventRow, EdielMessageRow } from '@/lib/ediel/types'
import { buildSafeMasterdataProposal, type EdielMasterdataChangeProposal } from '@/lib/ediel/operationalVerification'
import { supabaseService } from '@/lib/supabase/service'
import { assertEdielTenantActor } from '@/lib/ediel/services/authorization'

export type EdielSafeApplyReviewStatus = 'pending' | 'applied' | 'rejected' | 'no_changes'

export type EdielSafeApplyReviewItem = {
  message: EdielMessageRow
  status: EdielSafeApplyReviewStatus
  changes: EdielMasterdataChangeProposal[]
  latestEvent: EdielMessageEventRow | null
  decisionEvent: EdielMessageEventRow | null
  summary: string
}

export type EdielSafeApplyDecisionResult = {
  messageId: string
  status: 'applied' | 'rejected' | 'skipped'
  appliedCount: number
  skippedCount: number
  summary: string
}

const SAFE_APPLY_CODES = ['Z06', 'Z10'] as const
const SAFE_APPLY_EVENT_MESSAGE = 'Safe apply-förslag'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function getProposalChangesFromEvent(event: EdielMessageEventRow | null): EdielMasterdataChangeProposal[] {
  if (!event) return []
  const payload = isRecord(event.payload) ? event.payload : {}
  const raw = payload.proposedChanges
  if (!Array.isArray(raw)) return []

  return raw.filter((item): item is EdielMasterdataChangeProposal => {
    if (!isRecord(item)) return false
    return (
      (item.entityType === 'customer_site' || item.entityType === 'metering_point') &&
      typeof item.entityId === 'string' &&
      typeof item.label === 'string'
    )
  })
}

function eventDecision(event: EdielMessageEventRow): 'applied' | 'rejected' | null {
  const payload = isRecord(event.payload) ? event.payload : {}
  const decision = stringOrNull(payload.safeApplyDecision)
  if (decision === 'applied' || decision === 'rejected') return decision
  return null
}

function isSafeApplyEvent(event: EdielMessageEventRow): boolean {
  const payload = isRecord(event.payload) ? event.payload : {}
  return payload.safeApply === true || String(event.message ?? '').includes(SAFE_APPLY_EVENT_MESSAGE)
}

function isSafeApplyCandidate(message: EdielMessageRow): boolean {
  return (
    message.direction === 'inbound' &&
    message.message_family === 'PRODAT' &&
    (SAFE_APPLY_CODES as readonly string[]).includes(String(message.message_code))
  )
}

async function listEventsForMessages(messageIds: string[]): Promise<Map<string, EdielMessageEventRow[]>> {
  const map = new Map<string, EdielMessageEventRow[]>()
  if (messageIds.length === 0) return map

  const { data, error } = await supabaseService
    .from('ediel_message_events')
    .select('*')
    .in('ediel_message_id', messageIds)
    .order('created_at', { ascending: false })

  if (error) throw error

  for (const row of (data ?? []) as EdielMessageEventRow[]) {
    const existing = map.get(row.ediel_message_id) ?? []
    existing.push(row)
    map.set(row.ediel_message_id, existing)
  }

  return map
}

export async function listSafeApplyReviewItems(messages: EdielMessageRow[]): Promise<EdielSafeApplyReviewItem[]> {
  const candidates = messages.filter(isSafeApplyCandidate)
  const eventMap = await listEventsForMessages(candidates.map((row) => row.id))
  const items: EdielSafeApplyReviewItem[] = []

  for (const message of candidates) {
    const events = eventMap.get(message.id) ?? []
    const decisionEvent = events.find((event) => Boolean(eventDecision(event))) ?? null
    const latestProposalEvent = events.find(isSafeApplyEvent) ?? null
    const decision = decisionEvent ? eventDecision(decisionEvent) : null
    const eventChanges = getProposalChangesFromEvent(latestProposalEvent)
    const changes = eventChanges.length > 0 ? eventChanges : await buildSafeMasterdataProposal(message)
    const status: EdielSafeApplyReviewStatus = decision ?? (changes.length > 0 ? 'pending' : 'no_changes')

    items.push({
      message,
      status,
      changes,
      latestEvent: latestProposalEvent,
      decisionEvent,
      summary:
        status === 'applied'
          ? 'Ändringen är redan godkänd och applicerad.'
          : status === 'rejected'
            ? 'Ändringen är avvisad av admin.'
            : status === 'no_changes'
              ? 'Inga skillnader mot nuvarande masterdata hittades.'
              : `${changes.length} masterdataändringar väntar på granskning.`,
    })
  }

  return items
}

/** Approval consumes the original source owner, never mutable proposal labels
 * or parsed values. The native boundary commits the entire source atomically
 * and preserves its original receipt on retry. */
export async function approveSafeMasterdataChanges(params: {
  actorUserId: string
  edielMessageId: string
}): Promise<EdielSafeApplyDecisionResult> {
  const { getEdielMessageById } = await import('@/lib/ediel/db')
  const message = await getEdielMessageById(params.edielMessageId)
  if (!message?.company_id || !isSafeApplyCandidate(message)) throw new Error('structural_apply_source_required')
  await assertEdielTenantActor({ companyId: message.company_id, actorUserId: params.actorUserId, permission: 'metering.write' })
  const { data, error } = await supabaseService.rpc('ediel_apply_reviewed_structure_v1', {
    p_company_id: message.company_id, p_source_message_id: message.id, p_actor_user_id: params.actorUserId,
  })
  if (error) throw error
  if (!isRecord(data) || typeof data.applied !== 'boolean') throw new Error('structural_apply_receipt_invalid')
  // Actual admin actions await this function without reading its return value;
  // a held source must surface its blocker, never look like a successful apply.
  if (!data.applied) throw new Error(typeof data.reason === 'string' ? data.reason : 'structural_apply_original_review_required')
  if (data.sourceMessageId !== message.id || !Number.isSafeInteger(data.appliedCount) || Number(data.appliedCount) < 1
    || !Array.isArray(data.objects) || !data.objects.length) throw new Error('structural_apply_receipt_invalid')
  return { messageId: message.id, status: 'applied', appliedCount: Number(data.appliedCount), skippedCount: 0,
    summary: `${data.appliedCount} registerversioner har källbunden strukturhistorik.` }
}

export async function rejectSafeMasterdataChanges(params: {
  actorUserId: string
  edielMessageId: string
  reason?: string | null
}): Promise<EdielSafeApplyDecisionResult> {
  const { getEdielMessageById } = await import('@/lib/ediel/db')
  const message = await getEdielMessageById(params.edielMessageId)
  if (!message?.company_id || !isSafeApplyCandidate(message)) throw new Error('structural_apply_source_required')
  await assertEdielTenantActor({ companyId: message.company_id, actorUserId: params.actorUserId, permission: 'metering.write' })

  const changes = await buildSafeMasterdataProposal(message)

  await createEdielMessageEvent({
    actorUserId: params.actorUserId,
    edielMessageId: params.edielMessageId,
    eventType: 'manual_note',
    eventStatus: 'warning',
    message: 'Safe apply-förslag avvisades av admin. Masterdata ändrades inte.',
    payload: {
      batch: '6C',
      safeApply: true,
      safeApplyDecision: 'rejected',
      reason: params.reason ?? null,
      appliedAutomatically: false,
      proposedChanges: changes,
    },
  })

  return {
    messageId: params.edielMessageId,
    status: 'rejected',
    appliedCount: 0,
    skippedCount: changes.length,
    summary: 'Förslaget avvisades. Masterdata är oförändrad.',
  }
}

export type EdielUtiltsBillingReviewItem = {
  message: EdielMessageRow
  hasMeteringValue: boolean
  hasBillingUnderlay: boolean
  meteringValueId: string | null
  billingUnderlayId: string | null
  normalizedPayload: Record<string, unknown> | null
  status: 'ready' | 'processed' | 'needs_link'
  summary: string
}

function parsedPayload(message: EdielMessageRow): Record<string, unknown> {
  return isRecord(message.parsed_payload) ? message.parsed_payload : {}
}

export function listUtiltsBillingReviewItems(messages: EdielMessageRow[]): EdielUtiltsBillingReviewItem[] {
  return messages
    .filter((message) => message.direction === 'inbound' && message.message_family === 'UTILTS' && ['E66', 'E30'].includes(String(message.message_code)))
    .map((message) => {
      const payload = parsedPayload(message)
      const meteringValueId = stringOrNull(payload.ingestedMeterValueId)
      const billingUnderlayId = stringOrNull(payload.billingUnderlayId)
      const normalizedPayload = isRecord(payload.normalizedMeteringPayload)
        ? payload.normalizedMeteringPayload
        : null
      const hasStrongLink = Boolean(message.grid_owner_data_request_id || message.customer_id || message.metering_point_id)
      const processed = Boolean(meteringValueId || billingUnderlayId)

      return {
        message,
        hasMeteringValue: Boolean(meteringValueId),
        hasBillingUnderlay: Boolean(billingUnderlayId),
        meteringValueId,
        billingUnderlayId,
        normalizedPayload,
        status: processed ? 'processed' : hasStrongLink ? 'ready' : 'needs_link',
        summary: processed
          ? 'Meddelandet har redan skapat mätvärde och/eller fakturaunderlag.'
          : hasStrongLink
            ? 'Meddelandet är länkat och kan processas till mätvärde/faktureringsunderlag.'
            : 'Meddelandet saknar stark koppling till data request/kund/mätpunkt.',
      }
    })
}
