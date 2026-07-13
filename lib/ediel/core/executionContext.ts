import type { EdielDirection, EdielEnvironment } from '@/lib/ediel/types'

export type EdielExecutionFamily = 'PRODAT' | 'UTILTS' | 'APERAK' | 'CONTRL' | 'UTILTS_ERR'

export type EdielExecutionContext = Readonly<{
  companyId: string
  environment: EdielEnvironment
  market: 'electricity'
  direction: EdielDirection
  family: EdielExecutionFamily
  messageCode: string
  transactionSubtype: string | null
  businessProcess: string
  businessDate: string
  senderActorId: string
  senderEdielId: string
  senderRole: string
  senderSubAddress: string | null
  receiverActorId: string
  receiverEdielId: string
  receiverRole: string
  receiverSubAddress: string | null
  gridAreaCode: string | null
  rulePackId: string
  communicationRouteId: string
  routeProfileId: string
  certificateProfileId: string | null
  applicationReference: string
  sourceOperationId: string
}>

export type EdielExecutionContextInput = {
  [K in keyof EdielExecutionContext]: EdielExecutionContext[K] | null | undefined
}

export type EdielExecutionContextIssue = {
  field: keyof EdielExecutionContext | 'context'
  code: string
  message: string
}

export class EdielExecutionContextError extends Error {
  readonly code = 'ediel_execution_context_invalid'
  readonly issues: readonly EdielExecutionContextIssue[]

  constructor(issues: readonly EdielExecutionContextIssue[]) {
    super(`Ediel execution context blockerades: ${issues.map((issue) => `${issue.field}:${issue.code}`).join(', ')}`)
    this.name = 'EdielExecutionContextError'
    this.issues = issues
  }
}

function nonEmpty(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function nullableText(value: unknown): string | null {
  return nonEmpty(value)
}

function validBusinessDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

const REQUIRED_TEXT_FIELDS = [
  'companyId',
  'messageCode',
  'businessProcess',
  'senderActorId',
  'senderEdielId',
  'senderRole',
  'receiverActorId',
  'receiverEdielId',
  'receiverRole',
  'rulePackId',
  'communicationRouteId',
  'routeProfileId',
  'applicationReference',
  'sourceOperationId',
] as const satisfies readonly (keyof EdielExecutionContext)[]

export function validateEdielExecutionContext(
  input: EdielExecutionContextInput,
): EdielExecutionContextIssue[] {
  const issues: EdielExecutionContextIssue[] = []

  for (const field of REQUIRED_TEXT_FIELDS) {
    if (!nonEmpty(input[field])) {
      issues.push({ field, code: 'required', message: `${field} måste vara explicit och tenant-scopat.` })
    }
  }

  if (input.environment !== 'test' && input.environment !== 'production') {
    issues.push({ field: 'environment', code: 'invalid_environment', message: 'Miljö måste vara test eller production.' })
  }
  if (input.market !== 'electricity') {
    issues.push({ field: 'market', code: 'invalid_market', message: 'Canonical Ediel-kärnan stödjer endast electricity.' })
  }
  if (input.direction !== 'inbound' && input.direction !== 'outbound') {
    issues.push({ field: 'direction', code: 'invalid_direction', message: 'Riktning måste vara inbound eller outbound.' })
  }
  if (!['PRODAT', 'UTILTS', 'APERAK', 'CONTRL', 'UTILTS_ERR'].includes(String(input.family ?? ''))) {
    issues.push({ field: 'family', code: 'invalid_family', message: 'Meddelandefamiljen ingår inte i canonical Ediel-kärnan.' })
  }

  const businessDate = nonEmpty(input.businessDate)
  if (!businessDate || !validBusinessDate(businessDate)) {
    issues.push({ field: 'businessDate', code: 'invalid_business_date', message: 'Affärsdatum måste vara ett verkligt YYYY-MM-DD-datum.' })
  }

  if (input.environment === 'production') {
    const applicationReference = nonEmpty(input.applicationReference)?.toUpperCase() ?? ''
    if (applicationReference.includes('TGT') || applicationReference.includes('AGT') || applicationReference.includes('EDIELPORTAL')) {
      issues.push({
        field: 'applicationReference',
        code: 'test_reference_in_production',
        message: 'Produktionskontext får inte använda TGT-, AGT- eller Edielportalreferens.',
      })
    }
  }

  const senderEdielId = nonEmpty(input.senderEdielId)
  const receiverEdielId = nonEmpty(input.receiverEdielId)
  if (senderEdielId && receiverEdielId && senderEdielId === receiverEdielId) {
    issues.push({ field: 'context', code: 'sender_receiver_equal', message: 'Avsändare och mottagare får inte vara samma Ediel-id.' })
  }

  return issues
}

export function createEdielExecutionContext(input: EdielExecutionContextInput): EdielExecutionContext {
  const issues = validateEdielExecutionContext(input)
  if (issues.length > 0) throw new EdielExecutionContextError(issues)

  return Object.freeze({
    companyId: nonEmpty(input.companyId)!,
    environment: input.environment as EdielEnvironment,
    market: 'electricity',
    direction: input.direction as EdielDirection,
    family: input.family as EdielExecutionFamily,
    messageCode: nonEmpty(input.messageCode)!,
    transactionSubtype: nullableText(input.transactionSubtype),
    businessProcess: nonEmpty(input.businessProcess)!,
    businessDate: nonEmpty(input.businessDate)!,
    senderActorId: nonEmpty(input.senderActorId)!,
    senderEdielId: nonEmpty(input.senderEdielId)!,
    senderRole: nonEmpty(input.senderRole)!,
    senderSubAddress: nullableText(input.senderSubAddress),
    receiverActorId: nonEmpty(input.receiverActorId)!,
    receiverEdielId: nonEmpty(input.receiverEdielId)!,
    receiverRole: nonEmpty(input.receiverRole)!,
    receiverSubAddress: nullableText(input.receiverSubAddress),
    gridAreaCode: nullableText(input.gridAreaCode),
    rulePackId: nonEmpty(input.rulePackId)!,
    communicationRouteId: nonEmpty(input.communicationRouteId)!,
    routeProfileId: nonEmpty(input.routeProfileId)!,
    certificateProfileId: nullableText(input.certificateProfileId),
    applicationReference: nonEmpty(input.applicationReference)!,
    sourceOperationId: nonEmpty(input.sourceOperationId)!,
  })
}

export function stockholmBusinessDate(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}
