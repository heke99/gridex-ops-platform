import { prodatRegisterFieldValue } from '@/lib/ediel/prodat/prodatRegisterFields'
import { prodatDateState, prodatDateValue } from '@/lib/ediel/prodat/prodatDateFields'
import { readProdatParty } from '@/lib/ediel/prodat/prodatPartyFields'
import { prodatReferenceValue } from '@/lib/ediel/prodat/prodatReferenceFields'
import { prodatCharacteristicValue } from '@/lib/ediel/prodat/prodatCharacteristicFields'
import { parseUna } from '@/lib/ediel/core/una'
// lib/ediel/prodat/parser.ts

import { parseEdifactMessageFacts } from '@/lib/ediel/core/edifactSegments'
import type { EdielMessageRow } from '@/lib/ediel/types'

export type ParsedProdatLineItem = {
  lineSequenceNumber: string | null
  registerIndex: string | null
  registerCount: number
  firstRegisterSourceOrder: number | null
  validRegisterChain: boolean
  identityAgency: string | null
  annualConsumption: string | null
  meterConstant: string | null
  meterDigitCount: string | null
  meterTimeFrame: string | null
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
  validityStartDate?: string | null
  firstMeterReadingDate?: string | null
  birthDate?: string | null
  observationLength?: string | null
  observationLengthFormat?: string | null
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
  messageDate?: string | null
  timezoneOffset?: string | null
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

export function parseProdatMessage(input: EdielMessageRow | string): ParsedProdatMessage {
  const rawPayload = typeof input === 'string' ? input : (input.raw_payload ?? '')
  const facts = parseEdifactMessageFacts(rawPayload)
  const una = parseUna(rawPayload)
  const hasWire = facts.segments.some(segment => ['UNH', 'BGM'].includes(segment.tag))

  return {
    messageFamily: 'PRODAT',
    messageDate: prodatDateValue('205', facts.segments, una),
    timezoneOffset: prodatDateValue('206', facts.segments, una),
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
      const semantic = line.effectiveSegments
      const ud = readProdatParty('UD', semantic, una)
      const it = readProdatParty('IT', semantic, una)
      const iv = readProdatParty('IV', semantic, una)
      return {
      sourceOrder: index,
      lineSequenceNumber: line.lineNo,
      registerIndex: line.registerIndex,
      registerCount: line.registerCount,
      firstRegisterSourceOrder: line.firstLineIndex,
      validRegisterChain: line.validRegisterChain,
      identityAgency: line.identityAgency,
      annualConsumption: prodatRegisterFieldValue('213', line.segments, una),
      meterConstant: prodatRegisterFieldValue('214', line.segments, una),
      meterDigitCount: prodatRegisterFieldValue('218', line.segments, una),
      meterTimeFrame: prodatRegisterFieldValue('259', line.segments, una),
      meteringPointId: line.itemId ?? null,
      lineItemReference: line.rffLi ?? null,
      gridAreaId: line.rffZ05 ?? null,
      agreementReference: prodatReferenceValue('261', semantic, una),
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
      balanceResponsibleId: readProdatParty('Z02', semantic, una).id,
      reportingFrequency: prodatCharacteristicValue('222', semantic, una),
      energyProductId: prodatCharacteristicValue('506', semantic, una),
      installationDirection: prodatCharacteristicValue('513', semantic, una),
      permissionStatus: prodatCharacteristicValue('322', semantic, una),
      permissionPurpose: prodatCharacteristicValue('323', semantic, una),
      permissionEndReason: prodatCharacteristicValue('324', semantic, una),
      // P fields325–327: never treat an object reference or an observation
      // timestamp as authority for a permission lifecycle transition.
      permissionId: prodatReferenceValue('325', semantic, una),
      permissionTimestamp: prodatDateValue('326', semantic, una),
      permissionEndTimestamp: prodatDateValue('327', semantic, una),
      validityStartDate: prodatDateValue('216', semantic, una),
      firstMeterReadingDate: prodatDateValue('212', semantic, una),
      birthDate: prodatDateValue('249', semantic, una),
      observationLength: prodatDateValue('508', semantic, una),
      observationLengthFormat: prodatDateState('508', semantic, una).format,
      contractStartDate: prodatDateValue('210', semantic, una),
      contractEndDate: prodatDateValue('211', semantic, una),
      reportStartDate: prodatDateValue('302', semantic, una),
      reportEndDate: prodatDateValue('321', semantic, una),
      historicalReportStartDate: prodatDateValue('302', semantic, una),
      historicalReportEndDate: prodatDateValue('321', semantic, una),
      isHistoricalMeteringRequest: prodatCharacteristicValue('223', semantic, una) === 'S18',
      reasonForTransaction: prodatCharacteristicValue('223', semantic, una),
      measuringMethod: prodatCharacteristicValue('217', semantic, una),
      timeSeriesProduct: prodatCharacteristicValue('242', semantic, una),
      meterNumber: prodatReferenceValue('224', semantic, una),
      oldMeterNumber: prodatReferenceValue('225', semantic, una),
      supplierContractNumber: prodatReferenceValue('308', semantic, una),
      relatedMeteringPointId: prodatReferenceValue('319', semantic, una),
      calorificValueArea: prodatReferenceValue('320', semantic, una),
      serialId: prodatReferenceValue('240', semantic, una),
      hasAnnualConsumption: line.hasQty31,
      hasConstant: line.hasConstant,
      hasDigitCount: line.hasDigitCount,
      hasMeterNumber: line.hasMeterNumber,
      rawSegments: line.segments.map((segment) => segment.raw),
      }
    }),
  }
}

/** Lossless object projection for consumers. Invalid chains stay separate;
 * they are never merged into an apparent first-register authority. */
export function parsedProdatObjects(parsed: ParsedProdatMessage) {
  const objects = new Map<number, {meteringPointId:string | null; identityAgency:string | null; validRegisterChain:boolean; registers:ParsedProdatLineItem[]}>()
  for (const line of parsed.lineItems) {
    const key = line.validRegisterChain ? line.firstRegisterSourceOrder ?? line.sourceOrder : line.sourceOrder
    const object = objects.get(key) ?? {meteringPointId:line.meteringPointId,identityAgency:line.identityAgency,validRegisterChain:line.validRegisterChain,registers:[]}
    object.registers.push(line)
    objects.set(key,object)
  }
  return [...objects.values()]
}
