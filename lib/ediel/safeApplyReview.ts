// lib/ediel/safeApplyReview.ts

import { createEdielMessageEvent } from '@/lib/ediel/db'
import type { EdielMessageEventRow, EdielMessageRow } from '@/lib/ediel/types'
import { buildSafeMasterdataProposal, type EdielMasterdataChangeProposal } from '@/lib/ediel/operationalVerification'
import { supabaseService } from '@/lib/supabase/service'

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

type EntityType = EdielMasterdataChangeProposal['entityType']
type Patch = Record<string, string | number | boolean | null>

type PreparedChange = {
  change: EdielMasterdataChangeProposal
  column: string | null
  value: string | number | boolean | null
  skipReason: string | null
}

const SAFE_APPLY_CODES = ['Z06', 'Z10'] as const
const SAFE_APPLY_EVENT_MESSAGE = 'Safe apply-förslag'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(',', '.'))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function normalizeText(value: unknown): string | null {
  return stringOrNull(value)
}

function normalizePriceArea(value: unknown): 'SE1' | 'SE2' | 'SE3' | 'SE4' | null {
  const normalized = stringOrNull(value)?.toUpperCase() ?? null
  return normalized === 'SE1' || normalized === 'SE2' || normalized === 'SE3' || normalized === 'SE4'
    ? normalized
    : null
}

function normalizeReadingFrequency(value: unknown): 'hourly' | 'daily' | 'monthly' | 'manual' | null {
  const normalized = stringOrNull(value)?.toLowerCase().replace(/[-\s]/g, '_') ?? null
  if (!normalized) return null
  if (normalized === 'hourly' || normalized === 'tim' || normalized === 'hour' || normalized === 'quarter_hourly' || normalized === 'quarterhourly') return 'hourly'
  if (normalized === 'daily' || normalized === 'day' || normalized === 'dygn') return 'daily'
  if (normalized === 'monthly' || normalized === 'month' || normalized === 'månad' || normalized === 'manad') return 'monthly'
  if (normalized === 'manual') return 'manual'
  return null
}

function normalizeMeasurementType(value: unknown): 'consumption' | 'production' | 'mixed' | null {
  const normalized = stringOrNull(value)?.toLowerCase() ?? null
  if (!normalized) return null
  if (normalized.includes('production') || normalized.includes('producerad')) return 'production'
  if (normalized.includes('mixed') || normalized.includes('both') || normalized.includes('komb')) return 'mixed'
  if (normalized.includes('consumption') || normalized.includes('förbruk') || normalized.includes('forbruk')) return 'consumption'
  return null
}

function normalizeMeteringPointStatus(value: unknown): 'draft' | 'active' | 'pending_validation' | 'inactive' | 'closed' | null {
  const normalized = stringOrNull(value)?.toLowerCase().replace(/[-\s]/g, '_') ?? null
  if (!normalized) return null
  if (normalized === 'draft') return 'draft'
  if (normalized === 'active' || normalized === 'aktiv') return 'active'
  if (normalized === 'pending_validation' || normalized === 'pending') return 'pending_validation'
  if (normalized === 'inactive' || normalized === 'inaktiv') return 'inactive'
  if (normalized === 'closed' || normalized === 'stängd' || normalized === 'stangd') return 'closed'
  return null
}

function mapChangeToColumn(change: EdielMasterdataChangeProposal): PreparedChange {
  const label = change.label.toLowerCase()

  if (change.entityType === 'customer_site') {
    if (label.includes('anläggnings-id')) return { change, column: 'facility_id', value: normalizeText(change.proposedValue), skipReason: null }
    if (label.includes('prisområde')) return { change, column: 'price_area_code', value: normalizePriceArea(change.proposedValue), skipReason: normalizePriceArea(change.proposedValue) ? null : 'Ogiltigt prisområde.' }
    if (label.includes('anläggningsadress')) return { change, column: 'street', value: normalizeText(change.proposedValue), skipReason: null }
    if (label.includes('postnummer')) return { change, column: 'postal_code', value: normalizeText(change.proposedValue), skipReason: null }
    if (label.includes('ort')) return { change, column: 'city', value: normalizeText(change.proposedValue), skipReason: null }
    if (label.includes('årsförbrukning')) {
      const value = numberOrNull(change.proposedValue)
      return { change, column: 'annual_consumption_kwh', value, skipReason: value === null ? 'Ogiltig årsförbrukning.' : null }
    }
  }

  if (change.entityType === 'metering_point') {
    if (label.includes('mätpunkts-id')) return { change, column: 'meter_point_id', value: normalizeText(change.proposedValue), skipReason: null }
    if (label.includes('avläsningsfrekvens')) {
      const value = normalizeReadingFrequency(change.proposedValue)
      return { change, column: 'reading_frequency', value, skipReason: value ? null : 'Ogiltig avläsningsfrekvens.' }
    }
    if (label.includes('mättyp')) {
      const value = normalizeMeasurementType(change.proposedValue)
      return { change, column: 'measurement_type', value, skipReason: value ? null : 'Ogiltig mättyp.' }
    }
    if (label.includes('mätpunktsstatus')) {
      const value = normalizeMeteringPointStatus(change.proposedValue)
      return { change, column: 'status', value, skipReason: value ? null : 'Ogiltig mätpunktsstatus.' }
    }
  }

  return { change, column: null, value: null, skipReason: 'Fältet är inte mappat till en säker DB-kolumn.' }
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

async function fetchEntitySnapshot(entityType: EntityType, entityId: string): Promise<Record<string, unknown> | null> {
  const table = entityType === 'customer_site' ? 'customer_sites' : 'metering_points'
  const { data, error } = await supabaseService
    .from(table)
    .select('*')
    .eq('id', entityId)
    .maybeSingle()

  if (error) throw error
  return (data as Record<string, unknown> | null) ?? null
}

async function updateEntity(params: {
  actorUserId: string
  entityType: EntityType
  entityId: string
  patch: Patch
  edielMessageId: string
}) {
  const table = params.entityType === 'customer_site' ? 'customer_sites' : 'metering_points'
  const before = await fetchEntitySnapshot(params.entityType, params.entityId)
  if (!before) return { applied: false, before: null, after: null }

  const { data, error } = await supabaseService
    .from(table)
    .update({
      ...params.patch,
      updated_by: params.actorUserId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.entityId)
    .select('*')
    .single()

  if (error) throw error

  await supabaseService.from('audit_logs').insert({
    actor_user_id: params.actorUserId,
    entity_type: params.entityType,
    entity_id: params.entityId,
    action: 'ediel_safe_apply_approved',
    old_values: before,
    new_values: data as Record<string, unknown>,
    metadata: {
      edielMessageId: params.edielMessageId,
      batch: '6C',
      source: 'ediel_safe_apply_review',
      changedColumns: Object.keys(params.patch),
    },
  })

  return { applied: true, before, after: data as Record<string, unknown> }
}

export async function approveSafeMasterdataChanges(params: {
  actorUserId: string
  edielMessageId: string
}): Promise<EdielSafeApplyDecisionResult> {
  const { getEdielMessageById } = await import('@/lib/ediel/db')
  const message = await getEdielMessageById(params.edielMessageId)
  if (!message) throw new Error('Ediel-meddelandet hittades inte.')
  if (!isSafeApplyCandidate(message)) throw new Error('Meddelandet är inte en Z06/Z10-safe-apply-kandidat.')

  const changes = await buildSafeMasterdataProposal(message)
  const prepared = changes.map(mapChangeToColumn)
  const skipped = prepared.filter((item) => item.skipReason || !item.column || item.value === null)
  const applicable = prepared.filter((item) => !item.skipReason && item.column && item.value !== null)

  const grouped = new Map<string, { entityType: EntityType; entityId: string; patch: Patch }>()
  for (const item of applicable) {
    const column = item.column
    if (!column) continue
    const key = `${item.change.entityType}:${item.change.entityId}`
    const existing = grouped.get(key) ?? {
      entityType: item.change.entityType,
      entityId: item.change.entityId,
      patch: {},
    }
    existing.patch[column] = item.value
    grouped.set(key, existing)
  }

  let appliedCount = 0
  const appliedEntities: Array<Record<string, unknown>> = []

  for (const group of grouped.values()) {
    if (Object.keys(group.patch).length === 0) continue
    const result = await updateEntity({
      actorUserId: params.actorUserId,
      entityType: group.entityType,
      entityId: group.entityId,
      patch: group.patch,
      edielMessageId: params.edielMessageId,
    })
    if (result.applied) {
      appliedCount += Object.keys(group.patch).length
      appliedEntities.push({ entityType: group.entityType, entityId: group.entityId, patch: group.patch })
    }
  }

  await createEdielMessageEvent({
    actorUserId: params.actorUserId,
    edielMessageId: params.edielMessageId,
    eventType: 'manual_note',
    eventStatus: appliedCount > 0 ? 'success' : 'warning',
    message: appliedCount > 0 ? 'Safe apply godkändes och applicerades av admin.' : 'Safe apply godkändes men inga säkra ändringar kunde appliceras.',
    payload: {
      batch: '6C',
      safeApply: true,
      safeApplyDecision: 'applied',
      appliedAutomatically: false,
      appliedCount,
      skippedCount: skipped.length,
      appliedEntities,
      skippedChanges: skipped.map((item) => ({ change: item.change, reason: item.skipReason })),
      proposedChanges: changes,
    },
  })

  return {
    messageId: params.edielMessageId,
    status: appliedCount > 0 ? 'applied' : 'skipped',
    appliedCount,
    skippedCount: skipped.length,
    summary:
      appliedCount > 0
        ? `${appliedCount} fält applicerades. ${skipped.length} ändringar hoppades över.`
        : `Inga säkra ändringar applicerades. ${skipped.length} ändringar kräver manuell hantering.`,
  }
}

export async function rejectSafeMasterdataChanges(params: {
  actorUserId: string
  edielMessageId: string
  reason?: string | null
}): Promise<EdielSafeApplyDecisionResult> {
  const { getEdielMessageById } = await import('@/lib/ediel/db')
  const message = await getEdielMessageById(params.edielMessageId)
  if (!message) throw new Error('Ediel-meddelandet hittades inte.')

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
