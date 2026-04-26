// lib/ediel/operationalVerification.ts

import { createEdielMessageEvent, getEdielMessageById } from '@/lib/ediel/db'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { supabaseService } from '@/lib/supabase/service'
import type { CustomerSiteRow, MeteringPointRow } from '@/lib/masterdata/types'

export type EdielOperationalVerificationStatus = 'ok' | 'warning' | 'blocked'

export type EdielOperationalVerificationIssue = {
  code: string
  severity: EdielOperationalVerificationStatus
  title: string
  description: string
  messageId?: string | null
}

export type EdielMasterdataChangeProposal = {
  entityType: 'customer_site' | 'metering_point'
  entityId: string
  label: string
  currentValue: string | number | boolean | null
  proposedValue: string | number | boolean | null
  source: string
}

export type EdielSafeApplyProposalResult = {
  messageId: string
  created: boolean
  changes: EdielMasterdataChangeProposal[]
  summary: string
}

type SwitchLike = {
  id: string
  status: string
  external_reference?: string | null
}

type OutboundLike = {
  id: string
  status: string
  request_type: string
  source_type: string | null
  source_id: string | null
}

type DataRequestLike = {
  id: string
  status: string
  request_scope: string
  external_reference?: string | null
}

export type EdielOperationalVerificationSummary = {
  status: EdielOperationalVerificationStatus
  score: number
  issues: EdielOperationalVerificationIssue[]
  z03WithSwitchLink: number
  z03MissingSwitchLink: number
  inboundAckLinked: number
  inboundAckUnlinked: number
  inboundProdatLinked: number
  inboundProdatUnlinked: number
  inboundUtiltsLinked: number
  inboundUtiltsUnlinked: number
  safeApplyCandidates: number
  meteringCandidates: number
  fileBasedMode: true
  smtpEcpLive: false
}

const ACK_FAMILIES = ['CONTRL', 'APERAK', 'UTILTS_ERR'] as const
const SAFE_APPLY_CODES = ['Z06', 'Z10'] as const
const UTILTS_METERING_CODES = ['E66', 'E30'] as const

function isAckFamily(value: string): boolean {
  return (ACK_FAMILIES as readonly string[]).includes(value)
}

function isSafeApplyCandidate(row: EdielMessageRow): boolean {
  return row.direction === 'inbound' && row.message_family === 'PRODAT' && (SAFE_APPLY_CODES as readonly string[]).includes(String(row.message_code))
}

function isUtiltsMeteringCandidate(row: EdielMessageRow): boolean {
  return row.direction === 'inbound' && row.message_family === 'UTILTS' && (UTILTS_METERING_CODES as readonly string[]).includes(String(row.message_code))
}

function hasAnyOperationalLink(row: EdielMessageRow): boolean {
  return Boolean(
    row.switch_request_id ||
      row.outbound_request_id ||
      row.grid_owner_data_request_id ||
      row.customer_id ||
      row.site_id ||
      row.metering_point_id ||
      row.related_message_id
  )
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function computeStatus(score: number, issues: EdielOperationalVerificationIssue[]): EdielOperationalVerificationStatus {
  if (issues.some((issue) => issue.severity === 'blocked')) return 'blocked'
  if (score < 80 || issues.some((issue) => issue.severity === 'warning')) return 'warning'
  return 'ok'
}

export function getEdielOperationalVerificationSummary(params: {
  messages: EdielMessageRow[]
  switchRequests: SwitchLike[]
  outboundRequests: OutboundLike[]
  dataRequests: DataRequestLike[]
}): EdielOperationalVerificationSummary {
  const z03Outbound = params.messages.filter(
    (row) => row.direction === 'outbound' && row.message_family === 'PRODAT' && row.message_code === 'Z03'
  )
  const z03WithSwitchLink = z03Outbound.filter((row) => Boolean(row.switch_request_id || row.outbound_request_id)).length
  const z03MissingSwitchLink = z03Outbound.length - z03WithSwitchLink

  const inboundAck = params.messages.filter((row) => row.direction === 'inbound' && isAckFamily(row.message_family))
  const inboundAckLinked = inboundAck.filter((row) => Boolean(row.related_message_id || row.outbound_request_id)).length
  const inboundAckUnlinked = inboundAck.length - inboundAckLinked

  const inboundProdat = params.messages.filter((row) => row.direction === 'inbound' && row.message_family === 'PRODAT')
  const inboundProdatLinked = inboundProdat.filter(hasAnyOperationalLink).length
  const inboundProdatUnlinked = inboundProdat.length - inboundProdatLinked

  const inboundUtilts = params.messages.filter((row) => row.direction === 'inbound' && row.message_family === 'UTILTS')
  const inboundUtiltsLinked = inboundUtilts.filter(hasAnyOperationalLink).length
  const inboundUtiltsUnlinked = inboundUtilts.length - inboundUtiltsLinked

  const safeApplyCandidates = params.messages.filter(isSafeApplyCandidate).length
  const meteringCandidates = params.messages.filter(isUtiltsMeteringCandidate).length

  const issues: EdielOperationalVerificationIssue[] = []

  if (z03MissingSwitchLink > 0) {
    issues.push({
      code: 'z03_missing_switch_link',
      severity: 'warning',
      title: 'Z03 saknar stark switch-koppling',
      description: `${z03MissingSwitchLink} outbound Z03-meddelanden saknar switch/outbound-länk. Kontrollera innan filen används operativt.`,
    })
  }

  if (inboundAckUnlinked > 0) {
    issues.push({
      code: 'ack_unlinked',
      severity: 'warning',
      title: 'Inbound ACK saknar källkoppling',
      description: `${inboundAckUnlinked} inbound ACK-meddelanden saknar related/outbound-koppling. Dessa bör matchas innan status används som facit.`,
    })
  }

  if (inboundProdatUnlinked > 0) {
    issues.push({
      code: 'prodat_unlinked',
      severity: 'warning',
      title: 'Inbound PRODAT saknar verksamhetskoppling',
      description: `${inboundProdatUnlinked} inbound PRODAT-meddelanden saknar stark koppling till switch/kund/anläggning/mätpunkt.`,
    })
  }

  if (inboundUtiltsUnlinked > 0) {
    issues.push({
      code: 'utilts_unlinked',
      severity: 'warning',
      title: 'Inbound UTILTS saknar mätvärdeskoppling',
      description: `${inboundUtiltsUnlinked} inbound UTILTS-meddelanden saknar koppling till data request/kund/anläggning/mätpunkt.`,
    })
  }

  if (safeApplyCandidates > 0) {
    issues.push({
      code: 'safe_apply_review_needed',
      severity: 'warning',
      title: 'Z06/Z10 kräver safe apply-granskning',
      description: `${safeApplyCandidates} Z06/Z10-meddelanden kan innehålla masterdataändringar. De ska föreslås och granskas, inte skrivas över automatiskt.`,
    })
  }

  const totalChecks = Math.max(1, z03Outbound.length + inboundAck.length + inboundProdat.length + inboundUtilts.length)
  const problemCount = z03MissingSwitchLink + inboundAckUnlinked + inboundProdatUnlinked + inboundUtiltsUnlinked
  const score = clampScore(100 - (problemCount / totalChecks) * 100)
  const status = computeStatus(score, issues)

  return {
    status,
    score,
    issues,
    z03WithSwitchLink,
    z03MissingSwitchLink,
    inboundAckLinked,
    inboundAckUnlinked,
    inboundProdatLinked,
    inboundProdatUnlinked,
    inboundUtiltsLinked,
    inboundUtiltsUnlinked,
    safeApplyCandidates,
    meteringCandidates,
    fileBasedMode: true,
    smtpEcpLive: false,
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
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

function boolOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function valueFromPayload(payload: Record<string, unknown>, keys: string[]): string | number | boolean | null {
  for (const key of keys) {
    const value = payload[key]
    const text = stringOrNull(value)
    if (text !== null) return text
    const number = numberOrNull(value)
    if (number !== null) return number
    const bool = boolOrNull(value)
    if (bool !== null) return bool
  }
  return null
}

function addProposalIfChanged(params: {
  proposals: EdielMasterdataChangeProposal[]
  entityType: 'customer_site' | 'metering_point'
  entityId: string | null | undefined
  label: string
  currentValue: string | number | boolean | null | undefined
  proposedValue: string | number | boolean | null | undefined
  source: string
}) {
  if (!params.entityId) return
  const current = params.currentValue ?? null
  const proposed = params.proposedValue ?? null
  if (proposed === null) return
  if (String(current ?? '') === String(proposed ?? '')) return

  params.proposals.push({
    entityType: params.entityType,
    entityId: params.entityId,
    label: params.label,
    currentValue: current,
    proposedValue: proposed,
    source: params.source,
  })
}

async function getCurrentSite(siteId: string | null): Promise<CustomerSiteRow | null> {
  if (!siteId) return null
  const { data, error } = await supabaseService
    .from('customer_sites')
    .select('*')
    .eq('id', siteId)
    .maybeSingle()

  if (error) throw error
  return (data as CustomerSiteRow | null) ?? null
}

async function getCurrentMeteringPoint(meteringPointId: string | null): Promise<MeteringPointRow | null> {
  if (!meteringPointId) return null
  const { data, error } = await supabaseService
    .from('metering_points')
    .select('*')
    .eq('id', meteringPointId)
    .maybeSingle()

  if (error) throw error
  return (data as MeteringPointRow | null) ?? null
}

export async function buildSafeMasterdataProposal(message: EdielMessageRow): Promise<EdielMasterdataChangeProposal[]> {
  const payload = asRecord(message.parsed_payload)
  const site = await getCurrentSite(message.site_id)
  const meteringPoint = await getCurrentMeteringPoint(message.metering_point_id)
  const proposals: EdielMasterdataChangeProposal[] = []

  addProposalIfChanged({
    proposals,
    entityType: 'customer_site',
    entityId: site?.id ?? message.site_id,
    label: 'Anläggnings-ID',
    currentValue: site?.facility_id ?? null,
    proposedValue: valueFromPayload(payload, ['facilityId', 'siteFacilityId', 'anlaggningsId', 'installationId']),
    source: 'PRODAT Z06/Z10',
  })

  addProposalIfChanged({
    proposals,
    entityType: 'customer_site',
    entityId: site?.id ?? message.site_id,
    label: 'Prisområde',
    currentValue: site?.price_area_code ?? null,
    proposedValue: valueFromPayload(payload, ['priceAreaCode', 'priceArea', 'elomrade', 'biddingZone']),
    source: 'PRODAT Z06/Z10',
  })

  addProposalIfChanged({
    proposals,
    entityType: 'customer_site',
    entityId: site?.id ?? message.site_id,
    label: 'Anläggningsadress',
    currentValue: site?.street ?? null,
    proposedValue: valueFromPayload(payload, ['street', 'address', 'siteAddress', 'installationAddress']),
    source: 'PRODAT Z06/Z10',
  })

  addProposalIfChanged({
    proposals,
    entityType: 'customer_site',
    entityId: site?.id ?? message.site_id,
    label: 'Postnummer',
    currentValue: site?.postal_code ?? null,
    proposedValue: valueFromPayload(payload, ['postalCode', 'zipCode', 'sitePostalCode']),
    source: 'PRODAT Z06/Z10',
  })

  addProposalIfChanged({
    proposals,
    entityType: 'customer_site',
    entityId: site?.id ?? message.site_id,
    label: 'Ort',
    currentValue: site?.city ?? null,
    proposedValue: valueFromPayload(payload, ['city', 'siteCity']),
    source: 'PRODAT Z06/Z10',
  })

  addProposalIfChanged({
    proposals,
    entityType: 'customer_site',
    entityId: site?.id ?? message.site_id,
    label: 'Årsförbrukning kWh',
    currentValue: site?.annual_consumption_kwh ?? null,
    proposedValue: valueFromPayload(payload, ['annualConsumptionKwh', 'annualConsumption', 'estimatedAnnualConsumptionKwh']),
    source: 'PRODAT Z06/Z10',
  })

  addProposalIfChanged({
    proposals,
    entityType: 'metering_point',
    entityId: meteringPoint?.id ?? message.metering_point_id,
    label: 'Mätpunkts-ID',
    currentValue: meteringPoint?.meter_point_id ?? null,
    proposedValue: valueFromPayload(payload, ['meterPointId', 'meteringPointId', 'meteringPoint', 'gsrn']),
    source: 'PRODAT Z06/Z10',
  })

  addProposalIfChanged({
    proposals,
    entityType: 'metering_point',
    entityId: meteringPoint?.id ?? message.metering_point_id,
    label: 'Avläsningsfrekvens',
    currentValue: meteringPoint?.reading_frequency ?? null,
    proposedValue: valueFromPayload(payload, ['readingFrequency', 'meterReadingFrequency', 'settlementMethod']),
    source: 'PRODAT Z06/Z10',
  })

  addProposalIfChanged({
    proposals,
    entityType: 'metering_point',
    entityId: meteringPoint?.id ?? message.metering_point_id,
    label: 'Mättyp',
    currentValue: meteringPoint?.measurement_type ?? null,
    proposedValue: valueFromPayload(payload, ['measurementType', 'meteringType', 'siteType']),
    source: 'PRODAT Z06/Z10',
  })

  addProposalIfChanged({
    proposals,
    entityType: 'metering_point',
    entityId: meteringPoint?.id ?? message.metering_point_id,
    label: 'Mätpunktsstatus',
    currentValue: meteringPoint?.status ?? null,
    proposedValue: valueFromPayload(payload, ['meteringPointStatus', 'status', 'meterStatus']),
    source: 'PRODAT Z06/Z10',
  })

  return proposals
}

export async function createSafeMasterdataProposalForMessage(params: {
  actorUserId: string
  edielMessageId: string
}): Promise<EdielSafeApplyProposalResult> {
  const message = await getEdielMessageById(params.edielMessageId)
  if (!message) throw new Error('Ediel-meddelandet hittades inte')

  if (!isSafeApplyCandidate(message)) {
    await createEdielMessageEvent({
      actorUserId: params.actorUserId,
      edielMessageId: message.id,
      eventType: 'manual_note',
      eventStatus: 'warning',
      message: 'Safe apply hoppades över eftersom meddelandet inte är inbound PRODAT Z06/Z10.',
      payload: {
        batch: '6B',
        messageFamily: message.message_family,
        messageCode: message.message_code,
        safeApplyCandidate: false,
      },
    })

    return {
      messageId: message.id,
      created: false,
      changes: [],
      summary: 'Meddelandet är inte ett Z06/Z10-safe-apply-kandidat.',
    }
  }

  const changes = await buildSafeMasterdataProposal(message)

  await createEdielMessageEvent({
    actorUserId: params.actorUserId,
    edielMessageId: message.id,
    eventType: 'manual_note',
    eventStatus: changes.length > 0 ? 'warning' : 'success',
    message:
      changes.length > 0
        ? 'Safe apply-förslag skapat. Masterdata har inte skrivits över automatiskt.'
        : 'Safe apply-granskning körd utan hittade masterdataförändringar.',
    payload: {
      batch: '6B',
      safeApply: true,
      appliedAutomatically: false,
      proposedChanges: changes,
      reviewRequired: changes.length > 0,
    },
  })

  return {
    messageId: message.id,
    created: changes.length > 0,
    changes,
    summary:
      changes.length > 0
        ? `${changes.length} föreslagna masterdataändringar skapades för admin-granskning.`
        : 'Inga masterdataändringar hittades i meddelandet.',
  }
}
