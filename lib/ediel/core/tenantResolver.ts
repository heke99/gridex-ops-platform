// lib/ediel/core/tenantResolver.ts

import { supabaseService } from '@/lib/supabase/service'
import {
  createEdielMessageEvent,
  getEdielMessageById,
} from '@/lib/ediel/db'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { parseCanonicalEdielPayload } from '@/lib/ediel/core/canonicalMessage'
import {
  extractMarketActorEdielIdFromRawPayload,
  resolveInboundTenantFromIdentifiers,
  tenantResolutionForStorage,
  type InboundTenantResolution,
} from '@/lib/ediel/tenant/resolveInboundTenant'

export type EdielTenantResolutionResult =
  | {
      status: 'tenant_resolved'
      companyId: string
      message: EdielMessageRow
      evidence: TenantEvidence[]
    }
  | {
      status: 'tenant_not_found' | 'tenant_ambiguous'
      companyId: null
      message: EdielMessageRow
      evidence: TenantEvidence[]
      issueId: string | null
    }

type TenantEvidence = {
  companyId: string
  source: string
  score: number
  details: Record<string, unknown>
}

type CanonicalPartySnapshot = {
  sender: string | null
  senderSubAddress: string | null
  receiver: string | null
  receiverSubAddress: string | null
  applicationReference: string | null
  interchangeReference: string | null
  messageFamily: string | null
  messageCode: string | null
  bgmReference: string | null
  messageReference: string | null
  transactionReference: string | null
  businessReference: string | null
  relatedReference: string | null
}

function trimOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function compactEvidence(evidence: TenantEvidence[]): TenantEvidence[] {
  const byKey = new Map<string, TenantEvidence>()

  for (const item of evidence) {
    const key = `${item.companyId}:${item.source}:${JSON.stringify(item.details)}`
    const current = byKey.get(key)
    if (!current || item.score > current.score) byKey.set(key, item)
  }

  return [...byKey.values()].sort((a, b) => b.score - a.score)
}

function snapshotFromMessage(message: EdielMessageRow): CanonicalPartySnapshot {
  const canonical = parseCanonicalEdielPayload({
    rawPayload: message.raw_payload,
    direction: message.direction,
    standardHint: message.message_standard,
  })

  return {
    sender: trimOrNull(message.unb_sender_id) ?? trimOrNull(message.sender_ediel_id) ?? canonical.sender,
    senderSubAddress:
      trimOrNull(message.unb_sender_subaddress) ??
      trimOrNull(message.sender_sub_address) ??
      canonical.senderSubAddress,
    receiver:
      trimOrNull(message.unb_receiver_id) ?? trimOrNull(message.receiver_ediel_id) ?? canonical.receiver,
    receiverSubAddress:
      trimOrNull(message.unb_receiver_subaddress) ??
      trimOrNull(message.receiver_sub_address) ??
      canonical.receiverSubAddress,
    applicationReference:
      trimOrNull(message.application_reference) ?? canonical.applicationReference,
    interchangeReference: trimOrNull(message.interchange_reference) ?? canonical.interchangeReference,
    messageFamily: trimOrNull(message.message_family) ?? canonical.messageFamilyForStorage,
    messageCode: trimOrNull(String(message.message_code ?? '')) ?? canonical.messageCode,
    bgmReference: trimOrNull(message.bgm_reference) ?? canonical.documentReference,
    messageReference: trimOrNull(message.message_reference) ?? canonical.messageReference,
    transactionReference: trimOrNull(message.transaction_reference) ?? canonical.transactionReference,
    businessReference:
      trimOrNull(message.external_reference) ??
      canonical.businessReference ??
      canonical.transactionReference,
    relatedReference: trimOrNull(message.correlation_reference) ?? canonical.relatedReference,
  }
}

async function evidenceFromOriginalReferences(
  snapshot: CanonicalPartySnapshot,
): Promise<TenantEvidence[]> {
  const references = [
    ['UNB_REF', snapshot.interchangeReference],
    ['BGM_REF', snapshot.bgmReference],
    ['RFF_LI', snapshot.businessReference],
    ['RFF_ACW', snapshot.relatedReference],
    ['RFF_TN', snapshot.transactionReference],
    ['DOC_REF', snapshot.bgmReference],
    ['IDE', snapshot.transactionReference],
  ] as const

  const values: Array<{ referenceType: string; referenceValue: string }> = references.flatMap(([
    referenceType,
    referenceValue,
  ]) => {
    const clean = trimOrNull(referenceValue)
    return clean ? [{ referenceType, referenceValue: clean }] : []
  })

  if (values.length === 0) return []

  const rows: Array<Record<string, unknown>> = []
  for (const value of values) {
    const { data, error } = await supabaseService
      .from('ediel_business_references')
      .select('id,company_id,reference_type,reference_value,business_object_type,business_object_id')
      .eq('reference_type', value.referenceType)
      .eq('reference_value', value.referenceValue)
      .limit(20)

    if (error) throw error
    rows.push(...((data ?? []) as Array<Record<string, unknown>>))
  }

  return rows.flatMap((row) => {
    const companyId = trimOrNull(row.company_id)
    if (!companyId) return []
    return [{
      companyId,
      source: 'ediel_business_references',
      score: 160,
      details: {
        businessReferenceId: row.id,
        referenceType: row.reference_type,
        referenceValue: row.reference_value,
        businessObjectType: row.business_object_type,
        businessObjectId: row.business_object_id,
      },
    }]
  })
}

function chooseCompany(evidence: TenantEvidence[]): {
  status: 'tenant_resolved' | 'tenant_not_found' | 'tenant_ambiguous'
  companyId: string | null
} {
  if (evidence.length === 0) return { status: 'tenant_not_found', companyId: null }

  const highest = evidence[0]?.score ?? 0
  const best = evidence.filter((item) => item.score === highest)
  const companyIds = [...new Set(best.map((item) => item.companyId))]

  if (companyIds.length === 1) return { status: 'tenant_resolved', companyId: companyIds[0] }
  return { status: 'tenant_ambiguous', companyId: null }
}

function evidenceFromSharedResolution(resolution: InboundTenantResolution): TenantEvidence[] {
  return resolution.evidence.map((item) => ({
    companyId: item.companyId,
    source: item.source,
    score: item.score,
    details: item.details,
  }))
}

function tenantResolutionFromReferenceChoice(params: {
  snapshot: CanonicalPartySnapshot
  message: EdielMessageRow
  companyId: string
  evidence: TenantEvidence[]
}): InboundTenantResolution {
  return {
    status: 'resolved',
    companyId: params.companyId,
    transportEdielId: params.snapshot.receiver,
    marketActorEdielId: extractMarketActorEdielIdFromRawPayload(params.message.raw_payload) ?? params.snapshot.receiver,
    receiverEdielId: params.snapshot.receiver,
    receiverSubaddress: params.snapshot.receiverSubAddress,
    source: 'ediel_business_references',
    confidence: params.evidence[0]?.score ?? 160,
    evidence: params.evidence.map((item) => ({
      companyId: item.companyId,
      source: item.source === 'ediel_business_references' ? 'ediel_business_references' : 'manual',
      score: item.score,
      details: item.details,
    })),
    reasons: ['Inbound tenant löstes via sparade Ediel business references.'],
    candidateCompanyIds: [...new Set(params.evidence.map((item) => item.companyId))],
    warnings: [],
  }
}

async function createUnresolvedTenantItem(params: {
  message: EdielMessageRow
  issueType: 'tenant_not_found' | 'tenant_ambiguous'
  snapshot: CanonicalPartySnapshot
  evidence: TenantEvidence[]
  tenantResolution?: InboundTenantResolution | null
}): Promise<string | null> {
  const existing = await supabaseService
    .from('ediel_unresolved_items')
    .select('id')
    .eq('source_message_id', params.message.id)
    .eq('issue_type', params.issueType)
    .eq('status', 'open')
    .limit(1)
    .maybeSingle()

  if (existing.error) throw existing.error
  if (existing.data?.id) return String(existing.data.id)

  const { data, error } = await supabaseService
    .from('ediel_unresolved_items')
    .insert({
      company_id: null,
      source_message_id: params.message.id,
      issue_type: params.issueType,
      severity: params.issueType === 'tenant_ambiguous' ? 'critical' : 'warning',
      extracted_identifiers: {
        sender: params.snapshot.sender,
        senderSubAddress: params.snapshot.senderSubAddress,
        receiver: params.snapshot.receiver,
        receiverSubAddress: params.snapshot.receiverSubAddress,
        applicationReference: params.snapshot.applicationReference,
        interchangeReference: params.snapshot.interchangeReference,
        messageFamily: params.snapshot.messageFamily,
        messageCode: params.snapshot.messageCode,
        bgmReference: params.snapshot.bgmReference,
        transactionReference: params.snapshot.transactionReference,
        businessReference: params.snapshot.businessReference,
        tenantResolution: params.tenantResolution ? tenantResolutionForStorage(params.tenantResolution) : null,
      },
      suggested_matches: params.evidence,
      status: 'open',
    })
    .select('id')
    .single()

  if (error) throw error
  return String((data as { id: string }).id)
}

async function patchMessageTenant(params: {
  message: EdielMessageRow
  snapshot: CanonicalPartySnapshot
  companyId: string | null
  status: 'tenant_resolved' | 'tenant_not_found' | 'tenant_ambiguous'
  tenantResolution?: InboundTenantResolution | null
}): Promise<EdielMessageRow> {
  const storedTenantResolution = params.tenantResolution ? tenantResolutionForStorage(params.tenantResolution) : null
  const parsedPayload = storedTenantResolution
    ? { ...(params.message.parsed_payload ?? {}), tenantResolution: storedTenantResolution }
    : params.message.parsed_payload
  const validationReport = storedTenantResolution
    ? { ...(params.message.validation_report ?? {}), tenantResolution: storedTenantResolution }
    : params.message.validation_report

  const { data, error } = await supabaseService
    .from('ediel_messages')
    .update({
      company_id: params.companyId,
      unb_sender_id: params.snapshot.sender,
      unb_sender_subaddress: params.snapshot.senderSubAddress,
      unb_receiver_id: params.snapshot.receiver,
      unb_receiver_subaddress: params.snapshot.receiverSubAddress,
      application_reference: params.snapshot.applicationReference,
      interchange_reference: params.snapshot.interchangeReference,
      message_reference: params.snapshot.messageReference,
      bgm_code: params.snapshot.messageCode,
      bgm_reference: params.snapshot.bgmReference,
      tenant_resolution_status: params.status,
      business_match_status: params.status === 'tenant_resolved' ? 'not_checked' : 'business_blocked',
      processing_status: params.status === 'tenant_resolved' ? params.message.status : 'routing_unresolved',
      parsed_payload: parsedPayload,
      validation_report: validationReport,
      failure_reason: params.status === 'tenant_resolved'
        ? params.message.failure_reason
        : 'Routing unresolved: meddelandet är tekniskt läsbart men kunde inte kopplas säkert till tenant.',
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.message.id)
    .select('*')
    .single()

  if (error) throw error
  return data as EdielMessageRow
}

export async function resolveInboundTenantForMessage(params: {
  actorUserId: string
  message: EdielMessageRow
}): Promise<EdielTenantResolutionResult> {
  const snapshot = snapshotFromMessage(params.message)
  const marketActorEdielId = extractMarketActorEdielIdFromRawPayload(params.message.raw_payload) ?? snapshot.receiver

  const sharedResolution = await resolveInboundTenantFromIdentifiers({
    existingCompanyId: params.message.company_id ?? null,
    mailbox: params.message.mailbox,
    communicationRouteId: params.message.communication_route_id,
    environment: params.message.environment,
    senderEdielId: snapshot.sender,
    senderSubaddress: snapshot.senderSubAddress,
    receiverEdielId: snapshot.receiver,
    receiverSubaddress: snapshot.receiverSubAddress,
    marketActorEdielId,
    applicationReference: snapshot.applicationReference,
    messageFamily: snapshot.messageFamily,
    messageCode: snapshot.messageCode,
  })

  if (sharedResolution.status === 'resolved' && sharedResolution.companyId) {
    const message = await patchMessageTenant({
      message: params.message,
      snapshot,
      companyId: sharedResolution.companyId,
      status: 'tenant_resolved',
      tenantResolution: sharedResolution,
    })

    await createEdielMessageEvent({
      actorUserId: params.actorUserId,
      edielMessageId: params.message.id,
      eventType: 'linked',
      eventStatus: 'success',
      message: 'Inbound Ediel tenant resolved before runtime/business matching.',
      payload: {
        companyId: sharedResolution.companyId,
        tenantResolution: tenantResolutionForStorage(sharedResolution),
      },
    })

    return {
      status: 'tenant_resolved',
      companyId: sharedResolution.companyId,
      message,
      evidence: evidenceFromSharedResolution(sharedResolution),
    }
  }

  const referenceEvidence = await evidenceFromOriginalReferences(snapshot)
  const evidence = compactEvidence([
    ...evidenceFromSharedResolution(sharedResolution),
    ...referenceEvidence,
  ])
  const choice = chooseCompany(evidence)

  if (choice.status === 'tenant_resolved' && choice.companyId) {
    const referenceResolution = tenantResolutionFromReferenceChoice({
      message: params.message,
      snapshot,
      companyId: choice.companyId,
      evidence,
    })
    const message = await patchMessageTenant({
      message: params.message,
      snapshot,
      companyId: choice.companyId,
      status: 'tenant_resolved',
      tenantResolution: referenceResolution,
    })

    await createEdielMessageEvent({
      actorUserId: params.actorUserId,
      edielMessageId: params.message.id,
      eventType: 'linked',
      eventStatus: 'success',
      message: 'Inbound Ediel tenant resolved through saved business references.',
      payload: {
        companyId: choice.companyId,
        tenantResolution: tenantResolutionForStorage(referenceResolution),
        evidence,
      },
    })

    return { status: 'tenant_resolved', companyId: choice.companyId, message, evidence }
  }

  const issueType = sharedResolution.status === 'ambiguous' || choice.status === 'tenant_ambiguous'
    ? 'tenant_ambiguous'
    : 'tenant_not_found'
  const message = await patchMessageTenant({
    message: params.message,
    snapshot,
    companyId: null,
    status: issueType,
    tenantResolution: sharedResolution,
  })
  const issueId = await createUnresolvedTenantItem({
    message,
    issueType,
    snapshot,
    evidence,
    tenantResolution: sharedResolution,
  })

  await createEdielMessageEvent({
    actorUserId: params.actorUserId,
    edielMessageId: params.message.id,
    eventType: 'manual_note',
    eventStatus: 'warning',
    message: issueType === 'tenant_ambiguous'
      ? 'Inbound Ediel tenant resolution is ambiguous; no negative CONTRL is created for this routing issue.'
      : 'Inbound Ediel tenant could not be resolved; no negative CONTRL is created for this routing issue.',
    payload: {
      issueId,
      issueType,
      evidence,
      snapshot,
      tenantResolution: tenantResolutionForStorage(sharedResolution),
    },
  })

  return { status: issueType, companyId: null, message, evidence, issueId }
}

export async function resolveInboundTenantByMessageId(params: {
  actorUserId: string
  edielMessageId: string
}): Promise<EdielTenantResolutionResult> {
  const message = await getEdielMessageById(params.edielMessageId)
  if (!message) throw new Error('Ediel message not found for tenant resolution.')
  return resolveInboundTenantForMessage({ actorUserId: params.actorUserId, message })
}
