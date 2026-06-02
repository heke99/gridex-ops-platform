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
  meteringPoint?: { id?: string | null; gridArea?: string | null } | null
  customer?: { id?: string | null; name?: string | null; identity?: string | null } | null
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

export type BuiltProdatMessage = {
  rawEdifact: string
  businessCode: SupportedProdatBusinessCode
  applicationReference: string
  interchangeReference: string
  validation: ReturnType<typeof validateProdat>
}

function compactDate(value: string | null | undefined): string | null {
  if (!value) return null
  return value.replace(/[^0-9]/g, '').slice(0, 12) || null
}

function referenceSegments(references: BuildProdatMessageInput['references']): string[] {
  return Object.entries(references ?? {}).flatMap(([qualifier, value]) => {
    const clean = String(value ?? '').trim()
    return clean ? [`RFF+${escapeEdifactValue(qualifier)}:${escapeEdifactValue(clean)}`] : []
  })
}

function codedAttributeSegments(attributes: BuildProdatMessageInput['codedAttributes']): string[] {
  return Object.entries(attributes ?? {}).flatMap(([code, value]) => {
    const clean = String(value ?? '').trim()
    return clean ? [`CCI++${escapeEdifactValue(code)}`, `CAV+${escapeEdifactValue(clean)}`] : []
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

  const startDate = compactDate(input.dates?.startDate ?? input.dates?.requestedStartDate)
  const endDate = compactDate(input.dates?.endDate)
  const meteringPointId = input.meteringPoint?.id?.trim()
  const customerId = input.customer?.identity ?? input.customer?.id

  const businessSegments = [
    `BGM+${businessCode}:SVK:260+${escapeEdifactValue(documentReference)}+9${input.requestAck ? '+AB' : ''}`,
    `DTM+137:${compactDate(input.dates?.createdAt) ?? new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 12)}:203`,
    startDate ? `DTM+92:${startDate}:102` : null,
    endDate ? `DTM+93:${endDate}:102` : null,
    `NAD+MS+${escapeEdifactValue(input.sender.edielId)}:SVK:260`,
    `NAD+MR+${escapeEdifactValue(input.receiver.edielId)}:SVK:260`,
    customerId ? `NAD+UD+${escapeEdifactValue(customerId)}:SVK:260` : null,
    meteringPointId ? `LIN+1++${escapeEdifactValue(meteringPointId)}:Z01:260` : 'LIN+1',
    input.meteringPoint?.gridArea ? `RFF+Z05:${escapeEdifactValue(input.meteringPoint.gridArea)}` : null,
    ...referenceSegments(input.references),
    ...codedAttributeSegments(input.codedAttributes),
  ].filter((segment): segment is string => Boolean(segment))

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
  const validation = validateProdat(rawEdifact)

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
