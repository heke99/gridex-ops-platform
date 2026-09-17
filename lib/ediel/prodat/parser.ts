import { prodatCharacteristicValue } from '@/lib/ediel/prodat/prodatCharacteristicFields'
import { parseUna } from '@/lib/ediel/core/una'
// lib/ediel/prodat/parser.ts

import { parseEdifactMessageFacts } from '@/lib/ediel/core/edifactSegments'
import type { EdielMessageRow } from '@/lib/ediel/types'

export type ParsedProdatLineItem = {
  sourceOrder: number
  meteringPointId: string | null
  lineItemReference: string | null
  gridAreaId: string | null
  agreementReference: string | null
  customerId: string | null
  endUserId: string | null
  endUserIdQualifier: string | null
  endUserName: string | null
  endUserAddress: string | null
  endUserPostcode: string | null
  endUserCity: string | null
  endUserCountry: string | null
  installationId: string | null
  installationAddress: string | null
  installationPostcode: string | null
  installationCity: string | null
  installationCountry: string | null
  balanceResponsibleId: string | null
  reportingFrequency: string | null
  energyProductId: string | null
  installationDirection: string | null
  permissionStatus: string | null
  permissionPurpose: string | null
  permissionEndReason: string | null
  permissionId: string | null
  permissionTimestamp: string | null
  permissionEndTimestamp: string | null
  contractStartDate: string | null
  contractEndDate: string | null
  reportStartDate: string | null
  reportEndDate: string | null
  historicalReportStartDate: string | null
  historicalReportEndDate: string | null
  isHistoricalMeteringRequest: boolean
  reasonForTransaction: string | null
  measuringMethod: string | null
  timeSeriesProduct: string | null
  meterNumber: string | null
  hasAnnualConsumption: boolean
  hasConstant: boolean
  hasDigitCount: boolean
  hasMeterNumber: boolean
  rawSegments: string[]
}

export type ParsedProdatMessage = {
  messageFamily: 'PRODAT'
  messageCode: string
  messageReference: string | null
  interchangeReference: string | null
  transactionReference: string | null
  applicationReference: string | null
  senderEdielId: string | null
  receiverEdielId: string | null
  lineItems: ParsedProdatLineItem[]
  rawPayload: string
}

function segmentFirstValue(raw: string | null | undefined, prefix: string): string | null {
  if (!raw?.startsWith(prefix)) return null
  const value = raw.slice(prefix.length).trim()
  return value.length > 0 ? (value.split(':')[0]?.trim() || value) : null
}

function lineDateTimeValue(segments: { raw: string }[], qualifiers: string[]): string | null {
  for (const qualifier of qualifiers) {
    const segment = segments.find((item) => item.raw.startsWith(`DTM+${qualifier}:`))
    const value = segment?.raw.replace(`DTM+${qualifier}:`, '').split(':')[0]?.trim() ?? ''
    if (value) return value
  }

  return null
}

type ParsedNadParty = {
  id: string | null
  idQualifier: string | null
  name: string | null
  address: string | null
  city: string | null
  postalCode: string | null
  country: string | null
}

function nadText(value: string | null | undefined): string | null {
  const cleaned = String(value ?? '').trim()
  return cleaned || null
}

function partyFromNad(segments: { raw: string; elements: string[] }[], qualifier: string): ParsedNadParty {
  const segment = segments.find((item) => item.raw.startsWith(`NAD+${qualifier}+`))
  const composite = segment?.elements[2] ?? ''
  const parts = composite.split(':').map((part) => part.trim())
  return {
    id: nadText(parts[0]),
    idQualifier: nadText(parts[1]),
    name: nadText(segment?.elements[4]),
    address: nadText(segment?.elements[5]),
    city: nadText(segment?.elements[6]),
    postalCode: nadText(segment?.elements[8]),
    country: nadText(segment?.elements[9]),
  }
}

function partyIdFromNad(segments: { raw: string; elements: string[] }[], qualifier: string): string | null {
  return partyFromNad(segments, qualifier).id
}

export function parseProdatMessage(input: EdielMessageRow | string): ParsedProdatMessage {
  const rawPayload = typeof input === 'string' ? input : (input.raw_payload ?? '')
  const facts = parseEdifactMessageFacts(rawPayload)
  const una = parseUna(rawPayload)

  return {
    messageFamily: 'PRODAT',
    messageCode: String((typeof input === 'string' ? facts.messageCode : input.message_code) ?? facts.messageCode ?? '').toUpperCase(),
    messageReference: typeof input === 'string' ? facts.messageReference : (input.external_reference ?? facts.messageReference ?? null),
    interchangeReference: typeof input === 'string' ? facts.interchangeReference : (input.interchange_reference ?? facts.interchangeReference ?? null),
    transactionReference: typeof input === 'string' ? null : (input.transaction_reference ?? null),
    applicationReference: typeof input === 'string' ? null : (input.application_reference ?? null),
    senderEdielId: typeof input === 'string' ? null : (input.sender_ediel_id ?? null),
    receiverEdielId: typeof input === 'string' ? null : (input.receiver_ediel_id ?? null),
    rawPayload,
    lineItems: facts.lineItems.map((line, index) => ({
      sourceOrder: index,
      meteringPointId: line.itemId ?? null,
      lineItemReference: line.rffLi ?? null,
      gridAreaId: line.rffZ05 ?? null,
      agreementReference: line.segments.map((segment) => segment.raw).find((raw) => raw.startsWith('RFF+ANJ:'))?.replace(/^RFF\+ANJ:/, '').split(':')[0]?.trim() ?? null,
      customerId: partyIdFromNad(line.segments, 'UD') ?? partyIdFromNad(line.segments, 'IV'),
      endUserId: partyFromNad(line.segments, 'UD').id,
      endUserIdQualifier: partyFromNad(line.segments, 'UD').idQualifier,
      endUserName: partyFromNad(line.segments, 'UD').name,
      endUserAddress: partyFromNad(line.segments, 'UD').address,
      endUserPostcode: partyFromNad(line.segments, 'UD').postalCode,
      endUserCity: partyFromNad(line.segments, 'UD').city,
      endUserCountry: partyFromNad(line.segments, 'UD').country,
      installationId: partyFromNad(line.segments, 'IT').id,
      installationAddress: partyFromNad(line.segments, 'IT').address,
      installationPostcode: partyFromNad(line.segments, 'IT').postalCode,
      installationCity: partyFromNad(line.segments, 'IT').city,
      installationCountry: partyFromNad(line.segments, 'IT').country,
      balanceResponsibleId: partyIdFromNad(line.segments, 'Z02'),
      reportingFrequency: prodatCharacteristicValue('222', line.segments, una),
      energyProductId: prodatCharacteristicValue('506', line.segments, una),
      installationDirection: prodatCharacteristicValue('513', line.segments, una),
      permissionStatus: prodatCharacteristicValue('322', line.segments, una),
      permissionPurpose: prodatCharacteristicValue('323', line.segments, una),
      permissionEndReason: prodatCharacteristicValue('324', line.segments, una),
      // P fields325–327: never treat an object reference or an observation
      // timestamp as authority for a permission lifecycle transition.
      permissionId: line.segments.find(segment => segment.raw.startsWith('RFF+Z09:'))
        ?.raw.slice('RFF+Z09:'.length).split(':')[0]?.trim() || null,
      permissionTimestamp: lineDateTimeValue(line.segments, ['693']),
      permissionEndTimestamp: lineDateTimeValue(line.segments, ['164']),
      contractStartDate: lineDateTimeValue(line.segments, ['92', '157']),
      contractEndDate: lineDateTimeValue(line.segments, ['93', '157']),
      reportStartDate: lineDateTimeValue(line.segments, ['90']),
      reportEndDate: lineDateTimeValue(line.segments, ['91']),
      historicalReportStartDate: lineDateTimeValue(line.segments, ['90']),
      historicalReportEndDate: lineDateTimeValue(line.segments, ['91']),
      isHistoricalMeteringRequest: prodatCharacteristicValue('223', line.segments, una) === 'S18' || Boolean(lineDateTimeValue(line.segments, ['90']) || lineDateTimeValue(line.segments, ['91'])),
      reasonForTransaction: prodatCharacteristicValue('223', line.segments, una),
      measuringMethod: prodatCharacteristicValue('217', line.segments, una),
      timeSeriesProduct: prodatCharacteristicValue('242', line.segments, una),
      meterNumber: line.rffMg ?? segmentFirstValue(line.segments.find((item) => item.raw.startsWith('RFF+MG:'))?.raw, 'RFF+MG:'),
      hasAnnualConsumption: line.hasQty31,
      hasConstant: line.hasConstant,
      hasDigitCount: line.hasDigitCount,
      hasMeterNumber: line.hasMeterNumber,
      rawSegments: line.segments.map((segment) => segment.raw),
    })),
  }
}
