// lib/ediel/prodatEngine.ts

export type ProdatEngineCode = 'Z03' | 'Z04' | 'Z05' | 'Z06' | 'Z09' | 'Z10'

export type ProdatEnginePortalSnapshot = Record<string, unknown> | null

export type ProdatEngineProductionContext = {
  code: ProdatEngineCode
  bgmReference: string
  transactionReference: string
  senderEdielId: string
  receiverEdielId: string
  customerName: string
  customerId?: string | null
  customerIdCodeListQualifier?: string | null
  meterPointId: string
  gridAreaId?: string | null
  startDate?: string | null
  customerAddress?: string | null
  customerCity?: string | null
  customerPostalCode?: string | null
  customerCountry?: string | null
  siteAddress?: string | null
  siteCity?: string | null
  sitePostalCode?: string | null
  siteCountry?: string | null
  reasonForTransaction?: string | null
  meteringMethod?: string | null
  powerOfAttorneyReference?: string | null
  balanceResponsibleId?: string | null
}

export type ProdatEngineValidationIssue = {
  severity: 'error' | 'warning'
  code: string
  title: string
  description: string
}

export type ProdatEngineRenderResult = {
  segments: string[]
  diagnostics: {
    engine: 'prodat'
    renderer: 'prodatEngine.renderProdat26A'
    code: ProdatEngineCode
    lineItemReference: string
    bgmReference: string
    reasonForTransaction: string
    meteringMethod: string | null
    hasPortalSnapshot: boolean
    segmentCountBeforeEnvelope: number
  }
  issues: ProdatEngineValidationIssue[]
}

function sanitize(value?: string | null): string {
  return (value ?? '').replace(/[\r\n'+]/g, ' ').replace(/\s+/g, ' ').trim()
}

function sanitizeToken(value?: string | null, maxLength = 35): string | null {
  const cleaned = sanitize(value).toUpperCase().replace(/[^A-Z0-9_.\/-]/g, '')
  return cleaned ? cleaned.slice(0, maxLength) : null
}

function normalizeDate(value?: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return `${trimmed}T00:00`
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(trimmed)) return trimmed
  return trimmed
}

function date102(value?: string | null): string | null {
  if (!value) return null
  const digits = value.replace(/\D/g, '')
  if (digits.length >= 8) return digits.slice(0, 8)

  const normalized = normalizeDate(value)
  if (!normalized) return null
  const ymd = normalized.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd.replace(/-/g, '') : null
}

function date203AtStartOfDay(value?: string | null): string | null {
  const ymd = date102(value)
  return ymd ? `${ymd}0000` : null
}

function swedishDateTimeParts(date = new Date()): Record<string, string> {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)

  return Object.fromEntries(parts.map((part) => [part.type, part.value]))
}

function nowDate203(date = new Date()): string {
  const parts = swedishDateTimeParts(date)
  return `${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}`
}

function partySegment(role: 'FR' | 'DO', edielId: string): string {
  return `NAD+${role}+${sanitize(edielId)}:160:SVK+++++++SE`
}

function normalizeReasonForTransaction(value?: string | null): string {
  const normalized = sanitize(value).toUpperCase()
  if (normalized === 'LK' || normalized === 'Z23') return 'Z23'
  if (normalized === 'L' || normalized === 'Z22') return 'Z22'
  if (normalized === 'F' || normalized === 'Z06F' || normalized === 'Z09F' || normalized === 'E64') return 'E64'
  if (normalized === 'G' || normalized === 'Z06G' || normalized === 'Z09G' || normalized === 'E32') return 'E32'
  if (normalized === 'D' || normalized === 'Z09D' || normalized === 'Z70') return 'Z70'
  return normalized || 'Z22'
}

function normalizeEndUserIdQualifier(value: string | null | undefined, customerId: string | null): 'SE1' | 'SE2' | '1' {
  const normalized = sanitize(value).toUpperCase()
  if (normalized === 'SE1' || normalized === 'SE2' || normalized === '1') return normalized
  if (customerId && /^\d{10}$/.test(customerId)) return 'SE1'
  if (customerId && /^\d{12}$/.test(customerId)) return 'SE2'
  return 'SE2'
}

function customerNadSegment(params: {
  customerId?: string | null
  customerIdCodeListQualifier?: string | null
  customerName: string
  address?: string | null
  city?: string | null
  postalCode?: string | null
  country?: string | null
}): string {
  const customerId = sanitize(params.customerId)
  const qualifier = normalizeEndUserIdQualifier(params.customerIdCodeListQualifier, customerId || null)
  const id = customerId ? `${customerId}:${qualifier}:260` : ''
  const name = sanitize(params.customerName) || 'KUND'
  const address = sanitize(params.address)
  const city = sanitize(params.city)
  const postalCode = sanitize(params.postalCode)
  const country = sanitize(params.country) || 'SE'
  return `NAD+UD+${id}++${name}+${address}+${city}++${postalCode}+${country}`
}

function installationNadSegment(params: {
  meterPointId: string
  address?: string | null
  city?: string | null
  postalCode?: string | null
  country?: string | null
}): string {
  const address = sanitize(params.address)
  const city = sanitize(params.city)
  const postalCode = sanitize(params.postalCode)
  const country = sanitize(params.country) || 'SE'
  return `NAD+IT+${sanitize(params.meterPointId)}::9+++${address}+${city}++${postalCode}+${country}`
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function portalString(portalData: ProdatEnginePortalSnapshot, key: string): string | null {
  const value = portalData?.[key]
  return typeof value === 'string' && value.trim().length > 0 ? sanitize(value) : null
}

function portalObject(portalData: ProdatEnginePortalSnapshot, key: string): Record<string, unknown> | null {
  return objectValue(portalData?.[key])
}

function portalDate102(portalData: ProdatEnginePortalSnapshot, key: string): string | null {
  return date102(portalString(portalData, key))
}

function resolveMeteringMethod(portalData: ProdatEnginePortalSnapshot, fallback?: string | null): string | null {
  const override = portalString(portalObject(portalData, 'testCaseOverrides'), 'meteringMethod')
  return sanitizeToken(override ?? portalString(portalData, 'meteringMethod') ?? fallback ?? null, 12)
}

function compactReference(value: string, maxLength: number): string {
  return sanitize(value).replace(/[^A-Za-z0-9_.\/-]/g, '').slice(0, maxLength)
}

function validateContext(context: ProdatEngineProductionContext): ProdatEngineValidationIssue[] {
  const issues: ProdatEngineValidationIssue[] = []
  if (!sanitize(context.senderEdielId)) {
    issues.push({
      severity: 'error',
      code: 'prodat_engine_sender_missing',
      title: 'Avsändare saknas',
      description: 'PRODAT engine kräver senderEdielId innan EDIFACT kan renderas.',
    })
  }
  if (!sanitize(context.receiverEdielId)) {
    issues.push({
      severity: 'error',
      code: 'prodat_engine_receiver_missing',
      title: 'Mottagare saknas',
      description: 'PRODAT engine kräver receiverEdielId innan EDIFACT kan renderas.',
    })
  }
  if (!sanitize(context.meterPointId)) {
    issues.push({
      severity: 'error',
      code: 'prodat_engine_metering_point_missing',
      title: 'Anläggnings-id saknas',
      description: 'PRODAT engine kräver mätpunkt/anläggnings-id till LIN.',
    })
  }
  if (!compactReference(context.bgmReference, 35)) {
    issues.push({
      severity: 'error',
      code: 'prodat_engine_bgm_reference_missing',
      title: 'Meddelande-id saknas',
      description: 'PRODAT engine kräver BGM/1004.',
    })
  }
  if (!compactReference(context.transactionReference, 35)) {
    issues.push({
      severity: 'error',
      code: 'prodat_engine_case_reference_missing',
      title: 'Ärendereferens saknas',
      description: 'PRODAT engine kräver RFF+LI för PRODAT-ärendet.',
    })
  }
  return issues
}

export function renderProdat26A(input: {
  context: ProdatEngineProductionContext
  portalSnapshot?: ProdatEnginePortalSnapshot
  generatedAt?: Date
}): ProdatEngineRenderResult {
  const portalData = input.portalSnapshot ?? null
  const context = input.context
  const issues = validateContext(context)

  const bgmReference = compactReference(context.bgmReference, 35)
  const lineItemReference = compactReference(context.transactionReference || context.bgmReference, 35)
  const reasonForTransaction = normalizeReasonForTransaction(
    portalString(portalData, 'reasonForTransaction') ?? context.reasonForTransaction ?? null
  )
  const meteringMethod = resolveMeteringMethod(portalData, context.meteringMethod)

  const meterPointId =
    portalString(portalData, 'facilityId') ??
    (sanitize(context.meterPointId) || 'UNKNOWN')

  const gridAreaId = portalString(portalData, 'gridAreaId') ?? sanitize(context.gridAreaId)
  const startDate =
    portalDate102(portalData, 'agreementStartDateTime') ??
    date102(context.startDate)

  const segments: string[] = [
    `BGM+${context.code}+${bgmReference}+9+AB`,
    `DTM+137:${nowDate203(input.generatedAt)}:203`,
    'DTM+ZZZ:1:805',
    partySegment('FR', context.senderEdielId),
    partySegment('DO', context.receiverEdielId),
    `LIN+1++${sanitize(meterPointId)}:::9`,
  ]

  const startDate203 = date203AtStartOfDay(startDate)
  if (startDate203) {
    segments.push(`DTM+92:${startDate203}:203`)
  }

  segments.push('CCI++Z13', `CAV+${reasonForTransaction}`)

  if (meteringMethod) {
    segments.push('CCI++Z04', `CAV+${meteringMethod}`)
  }

  segments.push(`RFF+LI:${lineItemReference}`)

  if (gridAreaId) {
    segments.push(`RFF+Z05:${sanitize(gridAreaId)}`)
  }

  const powerOfAttorneyReference = portalString(portalData, 'powerOfAttorneyReference') ?? context.powerOfAttorneyReference
  if (powerOfAttorneyReference) {
    segments.push(`RFF+ANJ:${sanitize(powerOfAttorneyReference)}`)
  }

  segments.push(customerNadSegment({
    customerId: portalString(portalData, 'customerId') ?? context.customerId ?? null,
    customerIdCodeListQualifier: portalString(portalData, 'customerIdCodeListQualifier') ?? context.customerIdCodeListQualifier ?? null,
    customerName: portalString(portalData, 'customerName') ?? context.customerName,
    address: portalString(portalData, 'customerAddress') ?? context.customerAddress ?? null,
    city: portalString(portalData, 'customerCity') ?? context.customerCity ?? null,
    postalCode: portalString(portalData, 'customerPostalCode') ?? context.customerPostalCode ?? null,
    country: portalString(portalData, 'customerCountry') ?? context.customerCountry ?? 'SE',
  }))

  if (context.code !== 'Z03') {
    segments.push(installationNadSegment({
      meterPointId,
      address: portalString(portalData, 'siteAddress') ?? context.siteAddress ?? null,
      city: portalString(portalData, 'siteCity') ?? context.siteCity ?? null,
      postalCode: portalString(portalData, 'sitePostalCode') ?? context.sitePostalCode ?? null,
      country: portalString(portalData, 'siteCountry') ?? context.siteCountry ?? 'SE',
    }))
  }

  const balanceResponsibleId = portalString(portalData, 'balanceResponsibleId') ?? context.balanceResponsibleId
  if (balanceResponsibleId) {
    segments.push(`NAD+Z02+${sanitize(balanceResponsibleId)}:160:SVK`)
  }

  return {
    segments,
    issues,
    diagnostics: {
      engine: 'prodat',
      renderer: 'prodatEngine.renderProdat26A',
      code: context.code,
      lineItemReference,
      bgmReference,
      reasonForTransaction,
      meteringMethod,
      hasPortalSnapshot: Boolean(portalData),
      segmentCountBeforeEnvelope: segments.length,
    },
  }
}
