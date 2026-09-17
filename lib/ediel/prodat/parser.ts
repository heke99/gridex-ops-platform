import { readProdatParty } from '@/lib/ediel/prodat/prodatPartyFields'
import { prodatReferenceValue } from '@/lib/ediel/prodat/prodatReferenceFields'
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
  endUserNameLines?: string[]
  endUserAddressLines?: string[]
  invoiceeId?: string | null
  invoiceeName?: string | null
  invoiceeAddress?: string | null
  invoiceePostcode?: string | null
  invoiceeCity?: string | null
  invoiceeCountry?: string | null
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
  oldMeterNumber?: string | null
  supplierContractNumber?: string | null
  relatedMeteringPointId?: string | null
  calorificValueArea?: string | null
  serialId?: string | null
  hasAnnualConsumption: boolean
  hasConstant: boolean
  hasDigitCount: boolean
  hasMeterNumber: boolean
  rawSegments: string[]
}

export type ParsedProdatMessage = {
  messageFamily: 'PRODAT'
  messageCode: string
  /** BGM/1004 document identity; never the UNH0062 technical reference. */
  messageReference: string | null
  unhMessageReference?: string | null
  interchangeReference: string | null
  transactionReference: string | null
  applicationReference: string | null
  legalSenderId?: string | null
  legalReceiverId?: string | null
  senderEdielId: string | null
  receiverEdielId: string | null
  lineItems: ParsedProdatLineItem[]
  rawPayload: string
}

function lineDateTimeValue(segments: { raw: string }[], qualifiers: string[]): string | null {
  for (const qualifier of qualifiers) {
    const segment = segments.find((item) => item.raw.startsWith(`DTM+${qualifier}:`))
    const value = segment?.raw.replace(`DTM+${qualifier}:`, '').split(':')[0]?.trim() ?? ''
    if (value) return value
  }

  return null
}

export function parseProdatMessage(input: EdielMessageRow | string): ParsedProdatMessage {
  const rawPayload = typeof input === 'string' ? input : (input.raw_payload ?? '')
  const facts = parseEdifactMessageFacts(rawPayload)
  const una = parseUna(rawPayload)
  const hasWire = facts.segments.some(segment => ['UNH', 'BGM'].includes(segment.tag))

  return {
    messageFamily: 'PRODAT',
    messageCode: String(hasWire ? facts.messageCode ?? '' : typeof input === 'string' ? '' : input.message_code ?? '').toUpperCase(),
    messageReference: hasWire ? facts.documentReference : typeof input === 'string' ? null : input.external_reference ?? null,
    unhMessageReference: facts.messageReference,
    interchangeReference: typeof input === 'string' ? facts.interchangeReference : (input.interchange_reference ?? facts.interchangeReference ?? null),
    transactionReference: typeof input === 'string' ? null : (input.transaction_reference ?? null),
    applicationReference: typeof input === 'string' ? null : (input.application_reference ?? null),
    senderEdielId: typeof input === 'string' ? null : (input.sender_ediel_id ?? null),
    receiverEdielId: typeof input === 'string' ? null : (input.receiver_ediel_id ?? null),
    legalSenderId: readProdatParty('FR', facts.segments, una).id,
    legalReceiverId: readProdatParty('DO', facts.segments, una).id,
    rawPayload,
    lineItems: facts.lineItems.map((line, index) => {
      const ud = readProdatParty('UD', line.segments, una)
      const it = readProdatParty('IT', line.segments, una)
      const iv = readProdatParty('IV', line.segments, una)
      return {
      sourceOrder: index,
      meteringPointId: line.itemId ?? null,
      lineItemReference: line.rffLi ?? null,
      gridAreaId: line.rffZ05 ?? null,
      agreementReference: prodatReferenceValue('261', line.segments, una),
      customerId: ud.id,
      endUserId: ud.id,
      endUserIdQualifier: ud.idQualifier,
      endUserName: ud.name,
      endUserNameLines: ud.nameLines,
      endUserAddressLines: ud.addressLines,
      invoiceeId: iv.id, invoiceeName: iv.name, invoiceeAddress: iv.address,
      invoiceePostcode: iv.postalCode, invoiceeCity: iv.city, invoiceeCountry: iv.country,
      endUserAddress: ud.address,
      endUserPostcode: ud.postalCode,
      endUserCity: ud.city,
      endUserCountry: ud.country,
      installationId: it.id,
      installationAddress: it.address,
      installationPostcode: it.postalCode,
      installationCity: it.city,
      installationCountry: it.country,
      balanceResponsibleId: readProdatParty('Z02', line.segments, una).id,
      reportingFrequency: prodatCharacteristicValue('222', line.segments, una),
      energyProductId: prodatCharacteristicValue('506', line.segments, una),
      installationDirection: prodatCharacteristicValue('513', line.segments, una),
      permissionStatus: prodatCharacteristicValue('322', line.segments, una),
      permissionPurpose: prodatCharacteristicValue('323', line.segments, una),
      permissionEndReason: prodatCharacteristicValue('324', line.segments, una),
      // P fields325–327: never treat an object reference or an observation
      // timestamp as authority for a permission lifecycle transition.
      permissionId: prodatReferenceValue('325', line.segments, una),
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
      meterNumber: prodatReferenceValue('224', line.segments, una),
      oldMeterNumber: prodatReferenceValue('225', line.segments, una),
      supplierContractNumber: prodatReferenceValue('308', line.segments, una),
      relatedMeteringPointId: prodatReferenceValue('319', line.segments, una),
      calorificValueArea: prodatReferenceValue('320', line.segments, una),
      serialId: prodatReferenceValue('240', line.segments, una),
      hasAnnualConsumption: line.hasQty31,
      hasConstant: line.hasConstant,
      hasDigitCount: line.hasDigitCount,
      hasMeterNumber: line.hasMeterNumber,
      rawSegments: line.segments.map((segment) => segment.raw),
      }
    }),
  }
}
