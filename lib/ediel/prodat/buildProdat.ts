import { prodatEndUserContexts, validateProdatEndUserPolicy } from '@/lib/ediel/rulebook/prodatEndUserPolicy'
import { isSourceBoundProdatEndUserField } from '@/lib/ediel/prodat/prodatSubtypeRequirement'
import { renderProdatRegisterObject } from '@/lib/ediel/prodat/render/registers'
import { prodatObjectIdentityAgency, type ProdatMeterRegisterInput } from '@/lib/ediel/prodat/prodatRegisterInput'
import type { ProdatDependentConditionFacts } from '@/lib/ediel/prodat/prodatDependentConditionEngine'
import { buildProdatDateSegments, resolveProdatDateInputs } from '@/lib/ediel/prodat/render/dateSegments'
import { isProdatFieldInInapplicableParent } from '@/lib/ediel/prodat/prodatParentApplicability'
import { prodatPartySegment, prodatCustomerNadSegment } from '@/lib/ediel/prodat/render/segments'
import { PRODAT_26A_FIELD_MATRIX, PRODAT_26A_MESSAGE_CODES, canonicalProdat26AFieldRules } from '@/lib/ediel/prodat/prodat26AFieldMatrix'
import { renderProdatDocumentHeader } from '@/lib/ediel/prodat/prodatDocumentFields'
import { serializeEdifact, escapeEdifactValue } from '@/lib/ediel/core/edifactSerializer'
import { generateEdielInterchangeReference } from '@/lib/ediel/core/referenceGenerator'
import { resolveApplicationReference } from '@/lib/ediel/core/applicationReferenceResolver'
import { validateProdat } from '@/lib/ediel/prodat/validateProdat'
import { isSupportedProdatBusinessCode, type SupportedProdatBusinessCode } from '@/lib/ediel/prodat/prodatFieldRules'

export type BuildProdatMessageInput = {
  companyId: string
  role: 'supplier' | 'energy_service_company' | string
  businessCode: string
  transactionSubtype?: string | null
  sender: { edielId: string; subAddress?: string | null }
  receiver: { edielId: string; subAddress?: string | null }
  /** Legal NAD parties may differ from the technical UNB gateway. Omission preserves legacy calls. */
  legalSenderId?: string | null
  legalReceiverId?: string | null
  legalSenderCountry?: string | null
  legalReceiverCountry?: string | null
  meteringPoint?: { id?: string | null; gridArea?: string | null; identityAgency?: '9' | '89' } | null
  registers?: readonly ProdatMeterRegisterInput[]
  objects?: readonly BuildProdatObjectInput[]
  dependentConditionFacts?: ProdatDependentConditionFacts
  customer?: { id?: string | null; name?: string | null; nameLines?: readonly string[]; identity?: string | null; identityQualifier?: string | null; idAgency?: '89' | '260'; country?: string | null; city?: string | null; postalCode?: string | null; address?: string | null; addressLines?: readonly string[] } | null
  gridOwner?: { edielId?: string | null; name?: string | null } | null
  brp?: { edielId?: string | null } | null
  dates?: Record<string, string | null | undefined>
  references?: Record<string, string | null | undefined>
  codedAttributes?: Record<string, string | null | undefined>
  requestAck?: boolean
  environment: 'test' | 'production' | string
  routeProfileId?: string | null
  applicationReference?: string | null
}

/** Object fields never fall through from another object or a root default. */
export type BuildProdatObjectInput = Pick<BuildProdatMessageInput, 'meteringPoint' | 'customer' | 'gridOwner' | 'brp' | 'dates' | 'references' | 'codedAttributes' | 'registers'>

export type BuiltProdatMessage = {
  rawEdifact: string
  businessCode: SupportedProdatBusinessCode
  applicationReference: string
  interchangeReference: string
  validation: ReturnType<typeof validateProdat>
}

function referenceSegments(references: BuildProdatMessageInput['references']): string[] {
  return Object.entries(references ?? {}).flatMap(([qualifier, value]) => {
    const clean = String(value ?? '').trim()
    return clean && !['messageReference','documentReference','transactionReference'].includes(qualifier) ? [`RFF+${escapeEdifactValue(qualifier)}:${escapeEdifactValue(clean)}`] : []
  })
}

function codedAttributeSegments(attributes: BuildProdatMessageInput['codedAttributes'], businessCode: string): string[] {
  return Object.entries(attributes ?? {}).flatMap(([code, value]) => {
    const clean = String(value ?? '').trim()
    const messageIndex = PRODAT_26A_MESSAGE_CODES.findIndex(value => value === businessCode)
    const descriptor = PRODAT_26A_FIELD_MATRIX.find(row => row.segmentPath === `CCI++${code}/CAV` && row.requirements[messageIndex] !== '-')
    if (!clean) return []
    if (!descriptor) throw new Error('prodat_coded_attribute_not_allowed')
    return [`CCI++${escapeEdifactValue(code)}`, `CAV+${':'.repeat(descriptor.cavComponent ?? 0)}${escapeEdifactValue(clean)}`]
  })
}

export function buildProdatMessage(input: BuildProdatMessageInput): BuiltProdatMessage {
  const businessCode = input.businessCode.toUpperCase()
  if (!isSupportedProdatBusinessCode(businessCode)) {
    throw new Error(`PRODAT ${businessCode} stöds inte av buildProdatMessage.`)
  }

  const messageReference = input.references?.messageReference ?? '1'
  const documentReference =
    input.references?.documentReference ??
    input.references?.transactionReference ??
    `${businessCode}-${generateEdielInterchangeReference('BGM')}`
  const interchangeReference = generateEdielInterchangeReference('UNB')
  const applicationReference =
    input.applicationReference ??
    resolveApplicationReference({
      companyRole: input.role,
      actorRole: input.role === 'energy_service_company' ? 'DGI' : 'DDQ',
      messageFamily: 'PRODAT',
      businessCode,
      transactionSubtype: input.transactionSubtype ?? null,
      environment: input.environment,
      sender: input.sender.edielId,
      receiver: input.receiver.edielId,
    })

  const dates = buildProdatDateSegments(businessCode, input.transactionSubtype, resolveProdatDateInputs(businessCode, input.transactionSubtype, input.dates ?? {}))
  const codeIndex = PRODAT_26A_MESSAGE_CODES.findIndex(code => code === businessCode)
  const endUserAllowed = codeIndex >= 0 && PRODAT_26A_FIELD_MATRIX.find(row => row.fieldNumber === 'END_USER_GROUP')?.requirements[codeIndex] !== '-'
    && !isProdatFieldInInapplicableParent({ messageCode: businessCode, subtype: input.transactionSubtype, fieldNumber: 'END_USER_GROUP' })

  const objects = input.objects ?? [input]
  if (!objects.length) throw new Error('prodat_register_objects_empty')
  let nextLineSequence = 1
  const identities = new Set<string>()
  const objectSegments = objects.flatMap(object => {
    const id = object.meteringPoint?.id?.trim()
    const agency = prodatObjectIdentityAgency(object.meteringPoint?.identityAgency)
    const identity = JSON.stringify([id,agency])
    if (id && identities.has(identity)) throw new Error('prodat_register_object_repeated_use_one_inventory')
    if (id) identities.add(identity)
    const customerId = object.customer?.identity ?? object.customer?.id
    const objectDates = buildProdatDateSegments(businessCode,input.transactionSubtype,resolveProdatDateInputs(businessCode,input.transactionSubtype,object.dates ?? {}))
    const rows = [
      id ? `LIN+1++${escapeEdifactValue(id)}:::${agency}` : 'LIN+1',
      ...objectDates.line,
      ...codedAttributeSegments(object.codedAttributes,businessCode),
      object.meteringPoint?.gridArea ? `RFF+Z05:${escapeEdifactValue(object.meteringPoint.gridArea)}` : null,
      ...referenceSegments(object.references),
    ].filter((segment): segment is string => segment !== null)
    // Z06/Z09 objects can have different wire reasons. Root subtype metadata
    // must not drop an E customer's data or emit it for another object's F/G.
    const ownEndUserAllowed = isSourceBoundProdatEndUserField(businessCode, 'END_USER_GROUP')
      ? prodatEndUserContexts({code:businessCode,rawSegments:rows}).contexts[0]?.requirement !== 'forbidden'
      : endUserAllowed
    if (ownEndUserAllowed && customerId) rows.push(prodatCustomerNadSegment({
      customerId, customerIdCodeListQualifier:object.customer?.identityQualifier, idAgency:object.customer?.idAgency,
      customerName:object.customer?.name ?? '', nameLines:object.customer?.nameLines,
      country:object.customer?.country, city:object.customer?.city, postalCode:object.customer?.postalCode,
      address:object.customer?.address, addressLines:object.customer?.addressLines,
    }))
    const expanded = renderProdatRegisterObject({code:businessCode,segments:rows,registers:object.registers,firstLineSequence:nextLineSequence})
    nextLineSequence = expanded.nextLineSequence
    return expanded.segments
  })
  const businessSegments = [
    renderProdatDocumentHeader({ code: businessCode, documentId: documentReference, acknowledgement: input.requestAck === false ? 'NA' : 'AB' }),
    ...dates.header,
    prodatPartySegment('FR', input.legalSenderId ?? input.sender.edielId, input.legalSenderCountry ?? 'SE'),
    prodatPartySegment('DO', input.legalReceiverId ?? input.receiver.edielId, input.legalReceiverCountry ?? 'SE'),
    ...objectSegments,
  ]

  const rawEdifact = serializeEdifact({
    sender: input.sender.edielId,
    senderSubAddress: input.sender.subAddress ?? null,
    receiver: input.receiver.edielId,
    receiverSubAddress: input.receiver.subAddress ?? null,
    applicationReference,
    interchangeReference,
    messageReference: String(messageReference),
    messageTypeToken: 'PRODAT:D:97A:UN:E2SE6A',
    businessSegments,
    testIndicator: input.environment === 'production' ? 0 : 1,
  })
  const endUserIssues = validateProdatEndUserPolicy({code:businessCode,rawSegments:businessSegments},canonicalProdat26AFieldRules(businessCode))
  if (endUserIssues.length) throw new Error(`PRODAT elanvändargrupp kunde inte valideras: ${endUserIssues.map(issue=>issue.description).join(' | ')}`)
  const validation = validateProdat(rawEdifact,{registerFacts:input.dependentConditionFacts,requireRegisterConditions:true})

  if (!validation.ok) {
    throw new Error(`PRODAT ${businessCode} kunde inte valideras: ${validation.issues.map((issue) => issue.message).join(' | ')}`)
  }

  return {
    rawEdifact,
    businessCode,
    applicationReference,
    interchangeReference,
    validation,
  }
}
