import { supabaseService } from '@/lib/supabase/service'
import { createEdielMessageEvent, getEdielMessageById, linkEdielMessage } from '@/lib/ediel/db'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { completeFacilityLookup } from '@/lib/facility/facilityLookupWorkflow'
import { emitInboundFacilityUnmatchedEvent } from '@/lib/customer-operations/customerProcessEvents'

type JsonRecord = Record<string, unknown>

type FacilityDataExtraction = {
  facilityId: string | null
  meteringPointId: string | null
  gridAreaCode: string | null
  priceAreaCode: string | null
  references: string[]
  evidence: JsonRecord
}

type FacilityMatch = {
  requestId: string
  companyId: string
  customerId: string | null
  customerSiteId: string | null
  gridOwnerId: string | null
  confidence: 'high' | 'medium' | 'low'
  reason: string
  row: JsonRecord
}

export type InboundFacilityRecognitionResult = {
  status: 'completed' | 'manual_review' | 'skipped'
  reason: string
  requestId: string | null
  customerId: string | null
  customerSiteId: string | null
  facilityId: string | null
  meteringPointId: string | null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map(text).filter((value): value is string => Boolean(value))))
}

function readDeep(record: JsonRecord, keys: string[]): string | null {
  for (const key of keys) {
    if (key.includes('.')) {
      const parts = key.split('.')
      let current: unknown = record
      for (const part of parts) current = asRecord(current)[part]
      const found = text(current)
      if (found) return found
    } else {
      const found = text(record[key])
      if (found) return found
    }
  }
  return null
}

function flattenRecords(value: unknown, output: JsonRecord[] = []): JsonRecord[] {
  if (Array.isArray(value)) {
    for (const item of value) flattenRecords(item, output)
    return output
  }
  if (value && typeof value === 'object') {
    const record = value as JsonRecord
    output.push(record)
    for (const child of Object.values(record)) {
      if (child && typeof child === 'object') flattenRecords(child, output)
    }
  }
  return output
}

function extractFacilityData(message: EdielMessageRow): FacilityDataExtraction {
  const parsed = asRecord(message.parsed_payload)
  const report = asRecord(message.validation_report)
  const canonical = asRecord(parsed.canonical)
  const records = flattenRecords({ parsed, report, canonical })
  const facilityKeys = ['facility_id', 'facilityId', 'anlaggnings_id', 'anläggnings_id', 'anlage_id', 'meteringFacilityId', 'site.facility_id', 'facility.id']
  const meterKeys = ['metering_point_id', 'meteringPointId', 'meter_point_id', 'meterPointId', 'ediel_reference', 'gsrn', 'metering_point.gsrn', 'meteringPoint.gsrn']
  const gridAreaKeys = ['grid_area_code', 'gridAreaCode', 'net_area', 'networkArea', 'gridArea.id']
  const priceAreaKeys = ['price_area', 'price_area_code', 'priceArea', 'bidding_zone_code', 'biddingZoneCode']

  let facilityId: string | null = null
  let meteringPointId: string | null = null
  let gridAreaCode: string | null = null
  let priceAreaCode: string | null = null

  for (const record of records) {
    facilityId = facilityId ?? readDeep(record, facilityKeys)
    meteringPointId = meteringPointId ?? readDeep(record, meterKeys)
    gridAreaCode = gridAreaCode ?? readDeep(record, gridAreaKeys)
    priceAreaCode = priceAreaCode ?? readDeep(record, priceAreaKeys)
    if (facilityId && meteringPointId && gridAreaCode && priceAreaCode) break
  }

  const references = unique([
    message.grid_owner_data_request_id,
    message.outbound_request_id,
    message.original_message_id,
    message.correlation_reference,
    message.external_reference,
    message.transaction_reference,
    message.bgm_reference,
    message.message_reference,
    readDeep(parsed, ['grid_owner_data_request_id', 'customer_info_request_id', 'outbound_request_id', 'external_reference', 'transaction_reference', 'correlation_reference']),
    readDeep(canonical, ['grid_owner_data_request_id', 'customer_info_request_id', 'outbound_request_id', 'external_reference', 'transaction_reference', 'correlation_reference']),
  ])

  return {
    facilityId,
    meteringPointId,
    gridAreaCode,
    priceAreaCode,
    references,
    evidence: {
      extraction_keys: { facilityKeys, meterKeys, gridAreaKeys, priceAreaKeys },
      references,
      parsed_has_canonical: Boolean(parsed.canonical),
    },
  }
}

async function matchesAlreadyProcessed(edielMessageId: string): Promise<boolean> {
  const { data, error } = await supabaseService
    .from('grid_owner_information_requests')
    .select('id')
    .contains('received_payload', { ediel_message_id: edielMessageId })
    .limit(1)
  if (error) return false
  return (data ?? []).length > 0
}

async function matchPendingFacilityLookup(message: EdielMessageRow, extraction: FacilityDataExtraction): Promise<FacilityMatch | null> {
  const companyId = message.company_id
  if (!companyId) return null

  const references = extraction.references
  const candidates: FacilityMatch[] = []

  const addRows = (rows: JsonRecord[], confidence: FacilityMatch['confidence'], reason: string) => {
    for (const row of rows) {
      const requestId = text(row.id)
      if (!requestId) continue
      candidates.push({
        requestId,
        companyId,
        customerId: text(row.customer_id),
        customerSiteId: text(row.customer_site_id),
        gridOwnerId: text(row.grid_owner_id),
        confidence,
        reason,
        row,
      })
    }
  }

  if (references.length > 0) {
    // grid_owner_information_requests does not consistently have an external_reference
    // column across deployed schemas. Keep this direct lookup to the primary key
    // and use JSON payload scanning below for other references.
    const directIds = references.filter((ref) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref))
    if (directIds.length > 0) {
      const { data } = await supabaseService
        .from('grid_owner_information_requests')
        .select('*')
        .eq('company_id', companyId)
        .eq('request_type', 'facility_lookup')
        .in('status', ['draft', 'ready_to_send', 'sent', 'waiting_response', 'needs_review'])
        .in('id', directIds)
        .limit(20)
      addRows((data ?? []) as JsonRecord[], 'high', 'direct_facility_lookup_reference')
    }
  }

  if (references.length > 0) {
    const { data } = await supabaseService
      .from('grid_owner_information_requests')
      .select('*')
      .eq('company_id', companyId)
      .eq('request_type', 'facility_lookup')
      .in('status', ['draft', 'ready_to_send', 'sent', 'waiting_response', 'needs_review'])
      .limit(100)
    const rows = ((data ?? []) as JsonRecord[]).filter((row) => {
      const payload = JSON.stringify({ metadata: row.metadata ?? {}, received_payload: row.received_payload ?? {}, request_payload: row.request_payload ?? {} })
      return references.some((ref) => payload.includes(ref))
    })
    addRows(rows, 'high', 'facility_lookup_payload_reference')
  }

  if (message.site_id || message.grid_owner_id) {
    let query = supabaseService
      .from('grid_owner_information_requests')
      .select('*')
      .eq('company_id', companyId)
      .eq('request_type', 'facility_lookup')
      .in('status', ['draft', 'ready_to_send', 'sent', 'waiting_response', 'needs_review'])
      .limit(20)
    if (message.site_id) query = query.eq('customer_site_id', message.site_id)
    if (message.grid_owner_id) query = query.eq('grid_owner_id', message.grid_owner_id)
    const { data } = await query
    addRows((data ?? []) as JsonRecord[], message.site_id ? 'high' : 'medium', message.site_id ? 'message_site_grid_owner_match' : 'message_grid_owner_match')
  }

  const unique = new Map<string, FacilityMatch>()
  for (const candidate of candidates) {
    const current = unique.get(candidate.requestId)
    const rank = { high: 3, medium: 2, low: 1 }
    if (!current || rank[candidate.confidence] > rank[current.confidence]) unique.set(candidate.requestId, candidate)
  }
  const matches = [...unique.values()].sort((a, b) => ({ high: 3, medium: 2, low: 1 }[b.confidence] - { high: 3, medium: 2, low: 1 }[a.confidence]))
  if (matches.length === 1 && matches[0].confidence === 'high') return matches[0]
  return null
}

export async function recognizeInboundFacilityData(input: { actorUserId: string; edielMessageId: string }): Promise<InboundFacilityRecognitionResult> {
  const message = await getEdielMessageById(input.edielMessageId)
  if (!message) return { status: 'skipped', reason: 'message_not_found', requestId: null, customerId: null, customerSiteId: null, facilityId: null, meteringPointId: null }
  if (message.direction !== 'inbound' || !message.company_id) return { status: 'skipped', reason: 'not_inbound_or_company_missing', requestId: null, customerId: null, customerSiteId: null, facilityId: null, meteringPointId: null }

  const extraction = extractFacilityData(message)
  if (!extraction.facilityId && !extraction.meteringPointId) return { status: 'skipped', reason: 'no_facility_data_found', requestId: null, customerId: null, customerSiteId: null, facilityId: null, meteringPointId: null }

  if (await matchesAlreadyProcessed(message.id)) {
    return { status: 'skipped', reason: 'already_processed', requestId: null, customerId: message.customer_id, customerSiteId: message.site_id, facilityId: extraction.facilityId, meteringPointId: extraction.meteringPointId }
  }

  const match = await matchPendingFacilityLookup(message, extraction)
  if (!match) {
    await createEdielMessageEvent({
      actorUserId: input.actorUserId,
      edielMessageId: message.id,
      eventType: 'manual_note',
      eventStatus: 'warning',
      message: 'Inbound-meddelandet kan innehålla anläggningsuppgifter men kunde inte kopplas säkert automatiskt.',
      payload: { recognition: 'inbound_facility_data_unmatched', extraction },
    }).catch(() => null)
    await emitInboundFacilityUnmatchedEvent({
      companyId: message.company_id,
      customerId: message.customer_id,
      customerSiteId: message.site_id,
      edielMessageId: message.id,
      actorUserId: input.actorUserId,
      reason: 'no_safe_single_facility_lookup_match',
      payload: extraction.evidence,
    })
    return { status: 'manual_review', reason: 'no_safe_single_match', requestId: null, customerId: message.customer_id, customerSiteId: message.site_id, facilityId: extraction.facilityId, meteringPointId: extraction.meteringPointId }
  }

  const completion = await completeFacilityLookup({
    companyId: match.companyId,
    requestId: match.requestId,
    actorUserId: input.actorUserId,
    source: 'ediel_inbound',
    edielMessageId: message.id,
    facilityId: extraction.facilityId,
    meteringPointId: extraction.meteringPointId,
    gridAreaCode: extraction.gridAreaCode,
    priceAreaCode: extraction.priceAreaCode,
    rawPayload: { extraction, message_id: message.id },
  })

  await linkEdielMessage({
    actorUserId: input.actorUserId,
    edielMessageId: message.id,
    customerId: match.customerId,
    siteId: match.customerSiteId,
    meteringPointId: completion.meteringPointRecordId ?? message.metering_point_id ?? null,
    gridOwnerId: match.gridOwnerId,
    relatedMessageId: null,
  }).catch(() => null)

  await createEdielMessageEvent({
    actorUserId: input.actorUserId,
    edielMessageId: message.id,
    eventType: 'linked',
    eventStatus: 'success',
    message: 'Anläggningsuppgifter identifierades och kopplades till väntande anläggningsbegäran.',
    payload: {
      recognition: 'facility_data_recognized',
      facility_lookup_request_id: match.requestId,
      customer_id: match.customerId,
      site_id: match.customerSiteId,
      facility_id: extraction.facilityId,
      metering_point_id: extraction.meteringPointId,
    },
  })

  return { status: 'completed', reason: match.reason, requestId: match.requestId, customerId: match.customerId, customerSiteId: match.customerSiteId, facilityId: extraction.facilityId, meteringPointId: extraction.meteringPointId }
}
