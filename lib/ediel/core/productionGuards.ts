// lib/ediel/core/productionGuards.ts

import type { EdielEnvironment, EdielMessageRow } from '@/lib/ediel/types'
import type { EdielPayloadPreflightResult } from '@/lib/ediel/core/messageBuilder'

type ProductionGuardMessageLike = {
  id?: string | null
  company_id?: string | null
  environment?: EdielEnvironment | string | null
  direction?: string | null
  status?: string | null
  test_flag?: number | null
  message_family?: string | null
  message_code?: string | null
  message_version?: string | null
  message_standard?: string | null
  raw_payload?: string | null
  sender_ediel_id?: string | null
  receiver_ediel_id?: string | null
  receiver_email?: string | null
  application_reference?: string | null
  communication_route_id?: string | null
  related_message_id?: string | null
}

type ProductionGuardInputLike = {
  id?: string | null
  environment?: EdielEnvironment | string | null
  senderEdielId?: string | null
  receiverEdielId?: string | null
  applicationReference?: string | null
}

export type EdielSendLockIssue = {
  code: string
  severity: 'warning' | 'blocked'
  message: string
}

export type EdielSendLockResult = {
  locked: boolean
  status: 'ready' | 'warning' | 'blocked'
  issues: EdielSendLockIssue[]
}

function text(value: unknown): string {
  return String(value ?? '').trim()
}

function upper(value: unknown): string {
  return text(value).toUpperCase()
}

function hasText(value: unknown): boolean {
  return text(value).length > 0
}

export function isTgtApplicationReference(value?: string | null): boolean {
  const normalized = upper(value)
  // 23-DDQ-PRODAT is a valid PRODAT application reference and must not be
  // treated as a test-system marker. Only explicit portal/TGT references are blocked.
  return normalized === '91100' || normalized.includes('TGT') || normalized.includes('EDIELPORTAL')
}

export function isEdielPortalParty(value?: string | null): boolean {
  return ['91100', '91109'].includes(text(value))
}

function assertNoProductionTgtFields(params: {
  id?: string | null
  environment?: EdielEnvironment | string | null
  senderEdielId?: string | null
  receiverEdielId?: string | null
  applicationReference?: string | null
}) {
  if (params.environment !== 'production') return

  if (
    isEdielPortalParty(params.senderEdielId) ||
    isEdielPortalParty(params.receiverEdielId) ||
    isTgtApplicationReference(params.applicationReference)
  ) {
    throw new Error(
      `Produktionsruntime innehåller TGT-adressering eller TGT application reference${params.id ? ` för ${params.id}` : ''}. Stoppar för att undvika att testtrafik skickas i produktion.`
    )
  }
}

export function assertNoTgtLeakageInProductionMessage(message: ProductionGuardMessageLike | EdielMessageRow) {
  assertNoProductionTgtFields({
    id: message.id ?? null,
    environment: message.environment ?? null,
    senderEdielId: message.sender_ediel_id ?? null,
    receiverEdielId: message.receiver_ediel_id ?? null,
    applicationReference: message.application_reference ?? null,
  })
}

export function assertNoTgtLeakageInProductionInput(input: ProductionGuardInputLike) {
  assertNoProductionTgtFields({
    id: input.id ?? null,
    environment: input.environment ?? null,
    senderEdielId: input.senderEdielId,
    receiverEdielId: input.receiverEdielId,
    applicationReference: input.applicationReference,
  })
}

export function evaluateEdielProductionSendLock(
  message: ProductionGuardMessageLike | EdielMessageRow,
  preflight?: EdielPayloadPreflightResult | null
): EdielSendLockResult {
  const issues: EdielSendLockIssue[] = []

  if (message.environment !== 'production') {
    return { locked: false, status: 'ready', issues }
  }

  const family = upper(message.message_family)
  const requiresApplicationReference = !['CONTRL', 'NBS_XML', 'AI_LIST'].includes(family)
  const requiresVersion = ['PRODAT', 'UTILTS', 'APERAK', 'UTILTS_ERR'].includes(family)

  if (!hasText(message.company_id)) {
    issues.push({
      code: 'missing_company_id',
      severity: 'blocked',
      message: 'Produktionsmeddelande saknar company_id. Tenant-isolering kan inte verifieras.',
    })
  }

  if (message.test_flag === 1) {
    issues.push({
      code: 'production_test_flag',
      severity: 'blocked',
      message: 'Produktionsmeddelande har test_flag=1. Live-send stoppas.',
    })
  }

  if (isEdielPortalParty(message.sender_ediel_id) || isEdielPortalParty(message.receiver_ediel_id)) {
    issues.push({
      code: 'ediel_portal_party_in_production',
      severity: 'blocked',
      message: 'Produktionsmeddelande innehåller Edielportal/testpart 91100 eller 91109 som sender/receiver.',
    })
  }

  if (isTgtApplicationReference(message.application_reference)) {
    issues.push({
      code: 'tgt_application_reference_in_production',
      severity: 'blocked',
      message: 'Produktionsmeddelande innehåller TGT/portal-application-reference.',
    })
  }

  if (!hasText(message.raw_payload)) {
    issues.push({
      code: 'missing_payload',
      severity: 'blocked',
      message: 'Produktionsmeddelande saknar raw_payload.',
    })
  }

  if (!hasText(message.sender_ediel_id) || !hasText(message.receiver_ediel_id)) {
    issues.push({
      code: 'missing_actor_addressing',
      severity: 'blocked',
      message: 'Produktionsmeddelande saknar sender_ediel_id eller receiver_ediel_id.',
    })
  }

  if (!hasText(message.receiver_email)) {
    issues.push({
      code: 'missing_receiver_email',
      severity: 'blocked',
      message: 'Produktionsmeddelande saknar receiver_email.',
    })
  }

  if (requiresApplicationReference && !hasText(message.application_reference)) {
    issues.push({
      code: 'missing_application_reference',
      severity: 'blocked',
      message: `${family} i produktion saknar Application Reference.`,
    })
  }

  if (requiresVersion && !hasText(message.message_version)) {
    issues.push({
      code: 'missing_message_version',
      severity: 'blocked',
      message: `${family} i produktion saknar message_version.`,
    })
  }

  if (!hasText(message.communication_route_id) && !hasText(message.related_message_id)) {
    issues.push({
      code: 'missing_route_or_source',
      severity: 'blocked',
      message: 'Produktionsmeddelande saknar communication_route_id och är inte tydligt kopplat till ett source message.',
    })
  }

  if (preflight?.blocking) {
    for (const issue of preflight.issues.filter((item) => item.severity === 'error')) {
      issues.push({
        code: `payload_preflight_${issue.code}`,
        severity: 'blocked',
        message: issue.description,
      })
    }
  }

  issues.push({
    code: 'regression_gate_pending',
    severity: 'warning',
    message: '2.5C regression/golden suite är ännu inte byggd. Nya regler ska inte aktiveras som live-regler innan regression är grön.',
  })

  const locked = issues.some((issue) => issue.severity === 'blocked')
  return {
    locked,
    status: locked ? 'blocked' : issues.some((issue) => issue.severity === 'warning') ? 'warning' : 'ready',
    issues,
  }
}

export function assertEdielProductionSendLock(
  message: ProductionGuardMessageLike | EdielMessageRow,
  preflight?: EdielPayloadPreflightResult | null
): EdielSendLockResult {
  const result = evaluateEdielProductionSendLock(message, preflight)
  if (result.locked) {
    throw new Error(
      `Live-send blockerad: ${result.issues
        .filter((issue) => issue.severity === 'blocked')
        .map((issue) => `${issue.code}: ${issue.message}`)
        .join(' | ')}`
    )
  }
  return result
}

export function productionRuntimeSummary(message: ProductionGuardMessageLike | EdielMessageRow): Record<string, unknown> {
  return {
    environment: message.environment,
    senderEdielId: message.sender_ediel_id,
    receiverEdielId: message.receiver_ediel_id,
    applicationReference: message.application_reference,
    tgtApplicationReference: isTgtApplicationReference(message.application_reference),
    edielPortalParty:
      isEdielPortalParty(message.sender_ediel_id) || isEdielPortalParty(message.receiver_ediel_id),
    sendLock: evaluateEdielProductionSendLock(message),
  }
}
