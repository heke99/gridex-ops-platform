// lib/ediel/core/productionGuards.ts

import type { EdielEnvironment, EdielMessageRow } from '@/lib/ediel/types'

type ProductionGuardMessageLike = {
  id?: string | null
  environment?: EdielEnvironment | string | null
  sender_ediel_id?: string | null
  receiver_ediel_id?: string | null
  application_reference?: string | null
}

type ProductionGuardInputLike = {
  id?: string | null
  environment?: EdielEnvironment | string | null
  senderEdielId?: string | null
  receiverEdielId?: string | null
  applicationReference?: string | null
}

function text(value: unknown): string {
  return String(value ?? '').trim()
}

function upper(value: unknown): string {
  return text(value).toUpperCase()
}

export function isTgtApplicationReference(value?: string | null): boolean {
  return upper(value).startsWith('23-DDQ')
}

export function isEdielPortalParty(value?: string | null): boolean {
  return text(value) === '91100'
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
    senderEdielId: input.senderEdielId ?? null,
    receiverEdielId: input.receiverEdielId ?? null,
    applicationReference: input.applicationReference ?? null,
  })
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
  }
}
