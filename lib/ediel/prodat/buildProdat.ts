import {validateProdatGasApplicability} from '@/lib/ediel/rulebook/prodatGasApplicabilityPolicy'
import {projectDeathStatus} from './prodatDeathStatus'
import {validateProdatDeathStatus} from '@/lib/ediel/rulebook/prodatDeathStatusPolicy'
import {validateProdatMeterChange} from '@/lib/ediel/rulebook/prodatMeterChangePolicy'
import {validateProdatReportingPermission} from '@/lib/ediel/rulebook/prodatReportingPermissionPolicy'
import type {ExpectedContext} from './prodatReportingPermissionContext'
import {validateProdatDateEvents} from '@/lib/ediel/rulebook/prodatDateEventPolicy'
import {validateProdatInvoicee} from '@/lib/ediel/rulebook/prodatInvoiceePolicy'
import {assertInvoiceeOwnership} from './prodatInvoicee'
import type {ProdatEngineInvoiceeContext} from './types'
import {validateProdatEndUserAddress} from '@/lib/ediel/rulebook/prodatEndUserAddressPolicy'
import {createProdatRegisterEvidence,type ProdatRegisterEvidence} from './prodatRegisterEvidence'
import {assertProdatAddressOwnership} from './prodatEndUserAddress'
import { validateProdatZ14Policy, z14DependentRules } from '@/lib/ediel/rulebook/prodatZ14Policy'
import { optionalInstallationRules, validateProdatOptionalInstallationPolicy } from '@/lib/ediel/rulebook/prodatOptionalInstallationPolicy'
import { tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { prodatRegisterTokens } from '@/lib/ediel/prodat/prodatRegisterFields'
import { parseUna } from '@/lib/ediel/core/una'
import { prodatEndUserWireSubtype, validateProdatEndUserPolicy } from '@/lib/ediel/rulebook/prodatEndUserPolicy'
import { renderProdatRegisterObject } from '@/lib/ediel/prodat/render/registers'
import { prodatObjectIdentityAgency, type ProdatMeterRegisterInput } from '@/lib/ediel/prodat/prodatRegisterInput'
import type { ProdatDependentConditionFacts } from '@/lib/ediel/prodat/prodatDependentConditionEngine'
import { buildProdatDateSegments, resolveProdatDateInputs } from '@/lib/ediel/prodat/render/dateSegments'
import { isProdatFieldInInapplicableParent } from '@/lib/ediel/prodat/prodatParentApplicability'
import { prodatPartySegment, prodatInvoiceeNadSegment, prodatCustomerNadSegment, prodatInstallationNadSegment } from '@/lib/ediel/prodat/render/segments'
import { canonicalProdat26AFieldRules, PRODAT_26A_FIELD_MATRIX, PRODAT_26A_MESSAGE_CODES } from '@/lib/ediel/prodat/prodat26AFieldMatrix'
import { renderProdatDocumentHeader } from '@/lib/ediel/prodat/prodatDocumentFields'
import { serializeEdifact, escapeEdifactValue } from '@/lib/ediel/core/edifactSerializer'
import { canonicalAckRequirementsForFamilyCode } from '@/lib/ediel/rulebook/canonicalEdielFacade'
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
  invoicee?: ProdatEngineInvoiceeContext | null
  reportingContext?:ExpectedContext
  dependentConditionFacts?: ProdatDependentConditionFacts
  customer?: {
    id?: string | null; name?: string | null; identity?: string | null
    identityQualifier?: string | null; idAgency?: '89' | '260'; country?: string | null
    nameLines?: readonly string[]; address?: string | null; addressLines?: readonly string[]
    city?: string | null; postalCode?: string | null
  } | null
  /** Z14 positive-response installation parent (P26.A p22). */
  installation?: { address?: string | null; addressLines?: readonly string[]; idAgency?: '9' | '89'; city?: string | null; postalCode?: string | null; country?: string | null } | null
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
export type BuildProdatObjectInput = Pick<BuildProdatMessageInput, 'meteringPoint' | 'customer' | 'gridOwner' | 'brp' | 'dates' | 'references' | 'codedAttributes' | 'registers' | 'installation' | 'invoicee'>

export type BuiltProdatMessage = {
  rawEdifact: string
  businessCode: SupportedProdatBusinessCode
  applicationReference: string
  interchangeReference: string
  dateEventReadiness: 'unqualified' | 'not_applicable'
  reportingReadiness: 'unqualified' | 'not_applicable'
  registerEvidence: ProdatRegisterEvidence
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
    && (['Z06', 'Z09', 'Z14'].includes(businessCode) || !isProdatFieldInInapplicableParent({ messageCode: businessCode, subtype: input.transactionSubtype, fieldNumber: 'END_USER_GROUP' }))

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
    const attributes = codedAttributeSegments(object.codedAttributes, businessCode)
    if(!object.codedAttributes?.Z17)attributes.push(...projectDeathStatus({code:businessCode,reason:object.codedAttributes?.Z13,installation:{id:id??'',agency},selection:input.dependentConditionFacts?.deathStatus}))
    const objectSubtype = ['Z06', 'Z09', 'Z14'].includes(businessCode)
      ? prodatEndUserWireSubtype(businessCode, prodatRegisterTokens(attributes), parseUna(null)) : input.transactionSubtype
    const objectEndUserAllowed = endUserAllowed && !isProdatFieldInInapplicableParent({
      messageCode:businessCode,subtype:objectSubtype,fieldNumber:'END_USER_GROUP',
    })
    const dateSubtype = ['Z14','Z09'].includes(businessCode) ? objectSubtype : input.transactionSubtype
    const objectDateInputs = resolveProdatDateInputs(businessCode,dateSubtype,object.dates ?? {})
    const objectDates = buildProdatDateSegments(businessCode,dateSubtype,objectDateInputs)
    const rows = [
      id ? `LIN+1++${escapeEdifactValue(id)}:::${agency}` : 'LIN+1',
      ...objectDates.line,
      ...attributes,
      object.meteringPoint?.gridArea ? `RFF+Z05:${escapeEdifactValue(object.meteringPoint.gridArea)}` : null,
      ...referenceSegments(object.references),
      objectEndUserAllowed && customerId ? prodatCustomerNadSegment({
        customerId,customerIdCodeListQualifier:object.customer?.identityQualifier,idAgency:object.customer?.idAgency,
        customerName:object.customer?.name ?? '',nameLines:object.customer?.nameLines,country:object.customer?.country,
        address:object.customer?.address,addressLines:object.customer?.addressLines,
        city:object.customer?.city,postalCode:object.customer?.postalCode,
      }) : null,
      object.invoicee ? prodatInvoiceeNadSegment({customerId:object.invoicee.id,customerIdCodeListQualifier:object.invoicee.idCodeListQualifier,idAgency:object.invoicee.idAgency,customerName:object.invoicee.name,nameLines:object.invoicee.nameLines,address:object.invoicee.address,addressLines:object.invoicee.addressLines,city:object.invoicee.city,postalCode:object.invoicee.postalCode,country:object.invoicee.country}) : null,
      ((['Z01', 'Z03', 'Z08'].includes(businessCode)) || (businessCode === 'Z14' && objectSubtype !== 'N')) && object.installation
        ? prodatInstallationNadSegment({meterPointId:id ?? '',...object.installation,
          ...(['Z01', 'Z03', 'Z08'].includes(businessCode) ? {idAgency:object.installation.idAgency ?? agency} : {})}) : null,
    ].filter((segment): segment is string => segment !== null)
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

  const ack = canonicalAckRequirementsForFamilyCode({ family: 'PRODAT', code: businessCode })
  const rawEdifact = serializeEdifact({
    acknowledgementRequest: ack.requiresContrl,
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
  assertInvoiceeOwnership(input.dependentConditionFacts?.invoiceeObjects,{companyId:input.companyId,code:businessCode})
  const invoiceeFailures=[...validateProdatGasApplicability({code:businessCode,rawSegments:businessSegments,facts:input.dependentConditionFacts,applicationReference}),...validateProdatDeathStatus({code:businessCode,rawSegments:businessSegments,facts:input.dependentConditionFacts}),...validateProdatMeterChange({code:businessCode,rawSegments:businessSegments,facts:input.dependentConditionFacts,applicationReference}),...validateProdatReportingPermission({code:businessCode,rawSegments:businessSegments,facts:input.dependentConditionFacts,reportingContext:input.reportingContext}),...validateProdatDateEvents({code:businessCode,rawSegments:businessSegments,facts:input.dependentConditionFacts}),...validateProdatInvoicee({code:businessCode,rawSegments:businessSegments,facts:input.dependentConditionFacts})]
  const validation = validateProdat(rawEdifact,{registerFacts:input.dependentConditionFacts,requireRegisterConditions:true})
  validation.issues.push(...invoiceeFailures.map(f=>({severity:'error' as const,code:f.code,message:f.description})))
  if(invoiceeFailures.length)validation.ok=false
  // A generic builder must not label an E message valid after discarding its
  // required customer fields. Keep this bounded UD check out of inbound parsing.
  if (['Z06', 'Z09'].includes(businessCode)) {
    const wire = tokenizeEdifact(rawEdifact)
    const failures = validateProdatEndUserPolicy({family:'PRODAT',code:businessCode,
      rawSegments:wire.segments.map(segment => segment.raw),una:wire.una}, canonicalProdat26AFieldRules(businessCode))
    validation.issues.push(...failures.map(failure => ({severity:'error' as const,code:failure.code,message:failure.description})))
    if (failures.length) validation.ok = false
  }

  if (businessCode === 'Z14') {
    const wire = tokenizeEdifact(rawEdifact)
    const failures = validateProdatZ14Policy({family:'PRODAT',code:businessCode,rawSegments:wire.segments.map(s=>s.raw),una:wire.una},z14DependentRules())
    validation.issues.push(...failures.map(failure=>({severity:'error' as const,code:failure.code,message:failure.description})))
    if (failures.length) validation.ok = false
  }

  if (['Z01', 'Z03', 'Z08'].includes(businessCode)) {
    const wire = tokenizeEdifact(rawEdifact)
    const failures = validateProdatOptionalInstallationPolicy({
      family: 'PRODAT', code: businessCode, rawSegments: wire.segments.map(segment => segment.raw), una: wire.una, mode: 'parse',
    }, optionalInstallationRules(businessCode))
    validation.issues.push(...failures.map(failure => ({severity:'error' as const,code:failure.code,message:failure.description})))
    if (failures.length) validation.ok = false
  }

  const addressWire=tokenizeEdifact(rawEdifact)
  assertProdatAddressOwnership(input.dependentConditionFacts?.endUserAddressObjects,{companyId:input.companyId,code:businessCode})
  const addressFailures=validateProdatEndUserAddress({code:businessCode,rawSegments:addressWire.segments.map(s=>s.raw),una:addressWire.una,facts:input.dependentConditionFacts})
  validation.issues.push(...addressFailures.map(f=>({severity:'error' as const,code:f.code,message:f.description})))
  if(addressFailures.length)validation.ok=false
  if (!validation.ok) {
    throw new Error(`PRODAT ${businessCode} kunde inte valideras: ${validation.issues.map((issue) => issue.message).join(' | ')}`)
  }

  return {
    rawEdifact,
    reportingReadiness:['Z13','Z14'].includes(businessCode)?'unqualified':'not_applicable',
    dateEventReadiness:['Z06','Z09','Z10'].includes(businessCode)?'unqualified':'not_applicable',
    registerEvidence:createProdatRegisterEvidence({code:businessCode,rawSegments:addressWire.segments.map(s=>s.raw),una:addressWire.una,facts:input.dependentConditionFacts}),
    businessCode,
    applicationReference,
    interchangeReference,
    validation,
  }
}
