import { segmentComposite, tokenizeEdifact, type EdifactTokenizedSegment } from '@/lib/ediel/core/edifactTokenizer'
import type { EdifactServiceStringAdvice } from '@/lib/ediel/core/una'
import type { UtiltsFieldRule } from '@/lib/ediel/rulebook/utiltsFieldMatrix'
import { canonicalUtiltsTransactions } from './canonicalObservationScope'

/** Observation only: these scopes grant no grammar, guide or business authority. */
export type UtiltsPhysicalScope = {
  kind: 'header' | 'transaction' | 'observation'
  messageIndex: number
  transactionIndex?: number
  observationIndex?: number
  referenceNumber: string | null
  messageCode: string | null
  segments: EdifactTokenizedSegment[]
  observations: UtiltsPhysicalScope[]
  directReferenceIndices?: readonly number[]
}
export type UtiltsFieldOccurrence = {
  value: string
  supplied: true
  messageIndex: number
  transactionIndex?: number
  observationIndex?: number
  referenceNumber: string | null
  segmentIndex: number
  elementIndex: number
  componentIndex: number
}
type Selector = {
  tag: string
  element: number
  component: number
  qualifier?: string
  quantity?: string
  characteristic?: string
  directReference?: boolean
  priceWindow?: boolean
}

/** Explicit component descriptors, not a parser for printed SG/path prose.
 * Requirement values are always read from the original source row elsewhere. */
function selector(rule: Pick<UtiltsFieldRule, 'semanticKey'>): Selector | null {
  const semantic = rule.semanticKey
  const direct: Record<string, Selector> = {
    application_reference: { tag: 'UNB', element: 7, component: 0 },
    association_assigned_code: { tag: 'UNH', element: 2, component: 4 },
    document_name_code: { tag: 'BGM', element: 1, component: 0 },
    document_identifier: { tag: 'BGM', element: 2, component: 0 },
    message_function: { tag: 'BGM', element: 3, component: 0 },
    request_acknowledgement: { tag: 'BGM', element: 4, component: 0 },
    message_date: { tag: 'DTM', qualifier: '137', element: 1, component: 1 },
    timezone_offset: { tag: 'DTM', qualifier: '735', element: 1, component: 1 },
    sector_area: { tag: 'MKS', element: 1, component: 0 },
    phase_domain: { tag: 'MKS', element: 2, component: 0 },
    sender_ediel_id: { tag: 'NAD', qualifier: 'MS', element: 2, component: 0 },
    receiver_ediel_id: { tag: 'NAD', qualifier: 'MR', element: 2, component: 0 },
    transaction_id: { tag: 'IDE', qualifier: '24', element: 2, component: 0 },
    metering_point_id: { tag: 'LOC', qualifier: '172', element: 2, component: 0 },
    station_group_id: { tag: 'LOC', qualifier: '175', element: 2, component: 0 },
    grid_area_id: { tag: 'LOC', qualifier: '239', element: 2, component: 0 },
    grid_area_source_id: { tag: 'LOC', qualifier: '232', element: 2, component: 0 },
    grid_area_sink_id: { tag: 'LOC', qualifier: '233', element: 2, component: 0 },
    balance_responsible_id: { tag: 'NAD', qualifier: 'DDK', element: 2, component: 0 },
    balance_supplier_id: { tag: 'NAD', qualifier: 'DDQ', element: 2, component: 0 },
    buyer_id: { tag: 'NAD', qualifier: 'BY', element: 2, component: 0 },
    seller_id: { tag: 'NAD', qualifier: 'SE', element: 2, component: 0 },
    system_operator_id: { tag: 'NAD', qualifier: 'EZ', element: 2, component: 0 },
    product_id: { tag: 'LIN', element: 3, component: 0 },
    time_series_product: { tag: 'PIA', qualifier: '1', element: 2, component: 0 },
    delivery_period: { tag: 'DTM', qualifier: '324', element: 1, component: 1 },
    registration_date: { tag: 'DTM', qualifier: '597', element: 1, component: 1 },
    latest_update_date: { tag: 'DTM', qualifier: '368', element: 1, component: 1 },
    resolution: { tag: 'DTM', qualifier: '354', element: 1, component: 1 },
    reason_for_transaction: { tag: 'STS', qualifier: '7', element: 3, component: 0 },
    unit: { tag: 'MEA', qualifier: 'AAZ', element: 3, component: 0 },
    prodat_transaction_reference: { tag: 'RFF', qualifier: 'TN', element: 1, component: 1 },
    settlement_method: { tag: 'CAV', characteristic: 'E02', element: 1, component: 0 },
    metering_point_type: { tag: 'CAV', characteristic: 'E12', element: 1, component: 0 },
    default_metering_point_count: { tag: 'CAV', characteristic: 'Z01', element: 1, component: 3 },
    observation_id: { tag: 'SEQ', element: 2, component: 0 },
    planned_periodic_quantity: { tag: 'QTY', qualifier: '135', element: 1, component: 1 },
    periodic_quantity: { tag: 'QTY', qualifier: '136', element: 1, component: 1 },
    meter_reading: { tag: 'QTY', qualifier: '220', element: 1, component: 1 },
    maximum_power: { tag: 'QTY', qualifier: '42', element: 1, component: 1 },
    planned_quantity_quality: { tag: 'STS', qualifier: '8', quantity: '135', element: 2, component: 0 },
    quantity_quality: { tag: 'STS', qualifier: '8', quantity: '136', element: 2, component: 0 },
    meter_reading_quality: { tag: 'STS', qualifier: '8', quantity: '220', element: 2, component: 0 },
    maximum_power_quality: { tag: 'STS', qualifier: '8', quantity: '42', element: 2, component: 0 },
    meter_reading_date: { tag: 'DTM', qualifier: '597', quantity: '220', element: 1, component: 1 },
    maximum_power_timestamp: { tag: 'DTM', qualifier: '597', quantity: '42', element: 1, component: 1 },
    register_id: { tag: 'RFF', qualifier: 'AES', directReference: true, element: 1, component: 1 },
    monetary_amount: { tag: 'MOA', qualifier: '9', element: 1, component: 1 },
    monetary_currency: { tag: 'MOA', qualifier: '9', element: 1, component: 2 },
    price_amount: { tag: 'PRI', element: 1, component: 1 },
    price_currency: { tag: 'CUX', qualifier: '2', priceWindow: true, element: 1, component: 1 },
    meter_reading_origin: { tag: 'CAV', characteristic: 'E22', quantity: '220', element: 1, component: 0 },
    meter_time_frame: { tag: 'CAV', characteristic: 'E07', quantity: '42', element: 1, component: 0 },
  }
  // Ambiguous printed <role> and unqualified request RFF need their own
  // message/actor/source reader; no generic "any NAD/RFF" fallback is allowed.
  if (semantic === 'meter_number') return { tag: 'RFF', qualifier: 'MG|SE', directReference: true, element: 1, component: 1 }
  if (semantic === 'diverging_metering_point_count') return { tag: 'CAV', characteristic: 'Z01', element: 1, component: 3 }
  return direct[semantic] ?? null
}
export function hasUtiltsFieldReader(rule: Pick<UtiltsFieldRule, 'semanticKey'>): boolean {
  return selector(rule) !== null
}

export function observeUtiltsFieldScopes(raw: string): {
  una: EdifactServiceStringAdvice
  headers: UtiltsPhysicalScope[]
  transactions: UtiltsPhysicalScope[]
} {
  const wire = tokenizeEdifact(raw)
  const headers: UtiltsPhysicalScope[] = [], transactions: UtiltsPhysicalScope[] = []
  let enclosingUnb: EdifactTokenizedSegment | null = null
  let message: EdifactTokenizedSegment[] | null = null
  let messageUnb: EdifactTokenizedSegment | null = null
  let messageIndex = -1
  const finish = () => {
    if (!message?.length) return
    const own = message
    message = null
    if (segmentComposite(own[0], 2, wire.una)[0] !== 'UTILTS') return
    const bgm = own.find(segment => segment.tag === 'BGM')
    const messageCode = bgm ? segmentComposite(bgm, 1, wire.una)[0] || null : null
    const firstIde = own.findIndex(segment => segment.tag === 'IDE')
    headers.push({ kind: 'header', messageIndex, referenceNumber: null, messageCode,
      segments: [...(messageUnb ? [messageUnb] : []), ...own.slice(0, firstIde < 0 ? own.length : firstIde)], observations: [] })
    for (const transaction of canonicalUtiltsTransactions(own, wire.una, messageIndex)) {
      const firstSeq = transaction.segments.findIndex(segment => segment.tag === 'SEQ')
      const observations = transaction.observations.map(observation => ({
        kind: 'observation' as const, messageIndex, transactionIndex: transaction.transactionIndex,
        observationIndex: observation.observationIndex, referenceNumber: transaction.transactionId,
        messageCode, segments: observation.segments, observations: [],
        directReferenceIndices: observation.references.filter(reference => reference.directReferenceSlot).map(reference => reference.segmentIndex),
      }))
      transactions.push({ kind: 'transaction', messageIndex, transactionIndex: transaction.transactionIndex,
        referenceNumber: transaction.transactionId, messageCode,
        segments: transaction.segments.slice(0, firstSeq < 0 ? undefined : firstSeq), observations })
    }
  }
  for (const segment of wire.segments) {
    if (segment.tag === 'UNB') { finish(); enclosingUnb = segment; continue }
    if (segment.tag === 'UNH') { finish(); messageIndex += 1; messageUnb = enclosingUnb; message = [segment]; continue }
    if (segment.tag === 'UNZ') { finish(); enclosingUnb = null; continue }
    message?.push(segment)
    if (segment.tag === 'UNT') finish()
  }
  finish()
  return { una: wire.una, headers, transactions }
}

/** Match the physical parent occurrence before reading its exact component.
 * Empty supplied fields stay observable; no value is borrowed or synthesized. */
export function readUtiltsFieldOccurrences(
  rule: UtiltsFieldRule, scope: UtiltsPhysicalScope, una: EdifactServiceStringAdvice,
): UtiltsFieldOccurrence[] {
  const descriptor = selector(rule)
  if (!descriptor || rule.scope !== scope.kind) return []
  const found: UtiltsFieldOccurrence[] = []
  let quantity: string | null = null, characteristic: string | null = null, priceWindow = false
  for (const segment of scope.segments) {
    if (segment.tag === 'QTY') { quantity = segmentComposite(segment, 1, una)[0] ?? null; priceWindow = false }
    if (segment.tag === 'PRI') { priceWindow = true; quantity = null }
    if (segment.tag === 'MOA') { priceWindow = false; quantity = null }
    if (segment.tag === 'CCI') characteristic = segmentComposite(segment, 3, una)[0] ?? null
    else if (segment.tag !== 'CAV') characteristic = null
    if (segment.tag !== descriptor.tag) continue
    if (descriptor.qualifier && !descriptor.qualifier.split('|').includes(segmentComposite(segment, 1, una)[0])) continue
    if (descriptor.quantity && descriptor.quantity !== quantity) continue
    if (descriptor.characteristic && descriptor.characteristic !== characteristic) continue
    if (descriptor.directReference && !scope.directReferenceIndices?.includes(segment.index)) continue
    if (descriptor.priceWindow && !priceWindow) continue
    found.push({ value: segmentComposite(segment, descriptor.element, una)[descriptor.component] ?? '', supplied: true,
      messageIndex: scope.messageIndex, transactionIndex: scope.transactionIndex, observationIndex: scope.observationIndex,
      referenceNumber: scope.referenceNumber, segmentIndex: segment.index,
      elementIndex: descriptor.element, componentIndex: descriptor.component })
  }
  return found
}

