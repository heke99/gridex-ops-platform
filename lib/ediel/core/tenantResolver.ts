// lib/ediel/core/tenantResolver.ts

import { supabaseService } from '@/lib/supabase/service'
import {
  createEdielMessageEvent,
  getEdielMessageById,
} from '@/lib/ediel/db'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { parseCanonicalEdielPayload } from '@/lib/ediel/core/canonicalMessage'

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

function upper(value: unknown): string {
  return String(value ?? '').trim().toUpperCase()
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

async function evidenceFromTransport(message: EdielMessageRow): Promise<TenantEvidence[]> {
  if (!message.communication_route_id) return []

  const { data, error } = await supabaseService
    .from('communication_routes')
    .select('id,company_id,route_name,route_scope')
    .eq('id', message.communication_route_id)
    .maybeSingle()

  if (error) throw error
  const companyId = trimOrNull((data as { company_id?: unknown } | null)?.company_id)
  if (!companyId) return []

  return [{
    companyId,
    source: 'transport_route',
    score: 200,
    details: {
      communicationRouteId: message.communication_route_id,
      routeName: (data as { route_name?: unknown } | null)?.route_name ?? null,
      routeScope: (data as { route_scope?: unknown } | null)?.route_scope ?? null,
    },
  }]
}

async function evidenceFromRouteProfiles(
  message: EdielMessageRow,
  snapshot: CanonicalPartySnapshot
): Promise<TenantEvidence[]> {
  if (!snapshot.receiver) return []

  const { data, error } = await supabaseService
    .from('ediel_route_profiles')
    .select('*')
    .eq('environment', message.environment)
    .limit(1000)

  if (error) throw error

  const receiver = upper(snapshot.receiver)
  const receiverSub = upper(snapshot.receiverSubAddress)
  const appRef = upper(snapshot.applicationReference)
  const family = upper(snapshot.messageFamily)
  const code = upper(snapshot.messageCode)

  return ((data ?? []) as Array<Record<string, unknown>>).flatMap((row) => {
    const companyId = trimOrNull(row.company_id)
    if (!companyId) return []

    if (row.is_active === false || row.is_enabled === false) return []

    const ownIds = [
      row.own_ediel_id,
      row.receiver_ediel_id,
    ].map(upper).filter(Boolean)
    if (!ownIds.includes(receiver)) return []

    let score = 100
    const profileSub = upper(row.own_subaddress ?? row.receiver_sub_address)
    const profileApp = upper(row.application_reference)
    const profileFamily = upper(row.message_family)
    const profileCode = upper(row.message_code)

    if (receiverSub && profileSub && receiverSub === profileSub) score += 40
    if (appRef && profileApp && appRef === profileApp) score += 35
    if (family && profileFamily && family === profileFamily) score += 15
    if (code && profileCode && code === profileCode) score += 10
    if (message.mailbox && trimOrNull(row.mailbox) === message.mailbox) score += 20

    if (profileSub && receiverSub && profileSub !== receiverSub) return []
    if (profileApp && appRef && profileApp !== appRef) return []
    if (profileFamily && family && profileFamily !== family) return []
    if (profileCode && code && profileCode !== code) return []

    return [{
      companyId,
      source: 'ediel_route_profiles',
      score,
      details: {
        routeProfileId: row.id,
        receiverEdielId: snapshot.receiver,
        receiverSubAddress: snapshot.receiverSubAddress,
        applicationReference: snapshot.applicationReference,
        messageFamily: snapshot.messageFamily,
        messageCode: snapshot.messageCode,
      },
    }]
  })
}

async function evidenceFromActorSettings(
  message: EdielMessageRow,
  snapshot: CanonicalPartySnapshot
): Promise<TenantEvidence[]> {
  if (!snapshot.receiver) return []

  const { data, error } = await supabaseService
    .from('ediel_actor_settings')
    .select('*')
    .eq('environment', message.environment)
    .limit(1000)

  if (error) throw error

  const receiver = upper(snapshot.receiver)
  const receiverSub = upper(snapshot.receiverSubAddress)

  return ((data ?? []) as Array<Record<string, unknown>>).flatMap((row) => {
    const companyId = trimOrNull(row.company_id)
    if (!companyId || row.is_active === false) return []

    const actorIds = [row.ediel_id, row.actor_ediel_id].map(upper).filter(Boolean)
    if (!actorIds.includes(receiver)) return []

    const actorSub = upper(row.receiver_subaddress ?? row.sender_subaddress ?? row.sender_sub_address)
    if (actorSub && receiverSub && actorSub !== receiverSub) return []

    return [{
      companyId,
      source: 'ediel_actor_settings',
      score: actorSub && receiverSub ? 90 : 70,
      details: {
        actorSettingId: row.id,
        receiverEdielId: snapshot.receiver,
        receiverSubAddress: snapshot.receiverSubAddress,
      },
    }]
  })
}

async function evidenceFromOriginalReferences(
  snapshot: CanonicalPartySnapshot
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

  const values = references
    .map(([referenceType, referenceValue]) => ({ referenceType, referenceValue: trimOrNull(referenceValue) }))
    .filter((row): row is { referenceType: string; referenceValue: string } => Boolean(row.referenceValue))

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

async function createUnresolvedTenantItem(params: {
  message: EdielMessageRow
  issueType: 'tenant_not_found' | 'tenant_ambiguous'
  snapshot: CanonicalPartySnapshot
  evidence: TenantEvidence[]
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
}): Promise<EdielMessageRow> {
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
      processing_status: params.status === 'tenant_resolved' ? params.message.status : 'tenant_unresolved',
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

  if (params.message.company_id) {
    const message = await patchMessageTenant({
      message: params.message,
      snapshot,
      companyId: params.message.company_id,
      status: 'tenant_resolved',
    })
    return {
      status: 'tenant_resolved',
      companyId: params.message.company_id,
      message,
      evidence: [{
        companyId: params.message.company_id,
        source: 'existing_message_company_id',
        score: 300,
        details: { messageId: params.message.id },
      }],
    }
  }

  const evidence = compactEvidence([
    ...(await evidenceFromTransport(params.message)),
    ...(await evidenceFromRouteProfiles(params.message, snapshot)),
    ...(await evidenceFromActorSettings(params.message, snapshot)),
    ...(await evidenceFromOriginalReferences(snapshot)),
  ])
  const choice = chooseCompany(evidence)

  if (choice.status === 'tenant_resolved' && choice.companyId) {
    const message = await patchMessageTenant({
      message: params.message,
      snapshot,
      companyId: choice.companyId,
      status: 'tenant_resolved',
    })

    await createEdielMessageEvent({
      actorUserId: params.actorUserId,
      edielMessageId: params.message.id,
      eventType: 'linked',
      eventStatus: 'success',
      message: 'Inbound Ediel tenant resolved before business matching.',
      payload: {
        companyId: choice.companyId,
        evidence,
      },
    })

    return { status: 'tenant_resolved', companyId: choice.companyId, message, evidence }
  }

  const issueType = choice.status === 'tenant_ambiguous' ? 'tenant_ambiguous' : 'tenant_not_found'
  const message = await patchMessageTenant({
    message: params.message,
    snapshot,
    companyId: null,
    status: issueType,
  })
  const issueId = await createUnresolvedTenantItem({
    message,
    issueType,
    snapshot,
    evidence,
  })

  await createEdielMessageEvent({
    actorUserId: params.actorUserId,
    edielMessageId: params.message.id,
    eventType: 'manual_note',
    eventStatus: 'warning',
    message: issueType === 'tenant_ambiguous'
      ? 'Inbound Ediel tenant resolution is ambiguous; business updates are blocked.'
      : 'Inbound Ediel tenant could not be resolved; business updates are blocked.',
    payload: {
      issueId,
      issueType,
      evidence,
      snapshot,
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
