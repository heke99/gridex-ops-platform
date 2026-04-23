// lib/ediel/core/dedupe.ts

import { supabaseService } from '@/lib/supabase/service'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { findExistingAckForSource } from '@/lib/ediel/core/ackPolicy'
import { normalizeInboundReferenceIdentity } from '@/lib/ediel/core/referenceRegistry'
import type { OutboundRequestRow } from '@/lib/cis/types'

function trimOrNull(value?: string | null): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export type InboundCanonicalIdentity = {
  mailbox: string | null
  mailboxMessageId: string | null
  senderEdielId: string | null
  interchangeReference: string | null
  transactionReference: string | null
  externalReference: string | null
}

export function buildInboundCanonicalIdentity(params: {
  mailbox?: string | null
  mailboxMessageId?: string | null
  senderEdielId?: string | null
  interchangeReference?: string | null
  transactionReference?: string | null
  externalReference?: string | null
}): InboundCanonicalIdentity {
  const refs = normalizeInboundReferenceIdentity({
    senderEdielId: params.senderEdielId,
    interchangeReference: params.interchangeReference,
    transactionReference: params.transactionReference,
    externalReference: params.externalReference,
  })

  return {
    mailbox: trimOrNull(params.mailbox),
    mailboxMessageId: trimOrNull(params.mailboxMessageId),
    senderEdielId: refs.senderEdielId,
    interchangeReference: refs.interchangeReference,
    transactionReference: refs.transactionReference,
    externalReference: refs.externalReference,
  }
}

export async function findInboundDuplicateByCanonicalIdentity(
  identity: InboundCanonicalIdentity
): Promise<EdielMessageRow | null> {
  if (identity.mailbox && identity.mailboxMessageId) {
    const { data, error } = await supabaseService
      .from('ediel_messages')
      .select('*')
      .eq('direction', 'inbound')
      .eq('mailbox', identity.mailbox)
      .eq('mailbox_message_id', identity.mailboxMessageId)
      .maybeSingle()

    if (error) throw error
    if (data) return data as EdielMessageRow
  }

  if (identity.senderEdielId && identity.interchangeReference) {
    const { data, error } = await supabaseService
      .from('ediel_messages')
      .select('*')
      .eq('direction', 'inbound')
      .eq('sender_ediel_id', identity.senderEdielId)
      .eq('interchange_reference', identity.interchangeReference)
      .order('created_at', { ascending: false })
      .limit(1)

    if (error) throw error
    if ((data ?? []).length > 0) return data![0] as EdielMessageRow
  }

  if (
    identity.senderEdielId &&
    identity.transactionReference &&
    identity.externalReference
  ) {
    const { data, error } = await supabaseService
      .from('ediel_messages')
      .select('*')
      .eq('direction', 'inbound')
      .eq('sender_ediel_id', identity.senderEdielId)
      .eq('transaction_reference', identity.transactionReference)
      .eq('external_reference', identity.externalReference)
      .order('created_at', { ascending: false })
      .limit(1)

    if (error) throw error
    if ((data ?? []).length > 0) return data![0] as EdielMessageRow
  }

  return null
}

async function listMatchingOutboundRequests(params: {
  outboundRequestId?: string | null
  sourceType?: string | null
  sourceId?: string | null
  requestType?: string | null
  periodStart?: string | null
  periodEnd?: string | null
}): Promise<OutboundRequestRow[]> {
  if (params.outboundRequestId) {
    const { data, error } = await supabaseService
      .from('outbound_requests')
      .select('*')
      .eq('id', params.outboundRequestId)
      .limit(1)

    if (error) throw error
    return (data ?? []) as OutboundRequestRow[]
  }

  if (!(params.sourceType && params.sourceId && params.requestType)) {
    return []
  }

  let query = supabaseService
    .from('outbound_requests')
    .select('*')
    .eq('source_type', params.sourceType)
    .eq('source_id', params.sourceId)
    .eq('request_type', params.requestType)
    .order('created_at', { ascending: false })
    .limit(20)

  if (params.periodStart) {
    query = query.eq('period_start', params.periodStart)
  }

  if (params.periodEnd) {
    query = query.eq('period_end', params.periodEnd)
  }

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as OutboundRequestRow[]
}

export async function findOutboundEdielMessageDuplicate(params: {
  outboundRequestId?: string | null
  sourceType?: string | null
  sourceId?: string | null
  requestType?: string | null
  receiverEdielId?: string | null
  messageFamily: string
  messageCode: string
  messageVersion?: string | null
  periodStart?: string | null
  periodEnd?: string | null
}): Promise<EdielMessageRow | null> {
  const matchingOutboundRequests = await listMatchingOutboundRequests({
    outboundRequestId: params.outboundRequestId ?? null,
    sourceType: params.sourceType ?? null,
    sourceId: params.sourceId ?? null,
    requestType: params.requestType ?? null,
    periodStart: params.periodStart ?? null,
    periodEnd: params.periodEnd ?? null,
  })

  let query = supabaseService
    .from('ediel_messages')
    .select('*')
    .eq('direction', 'outbound')
    .eq('message_family', params.messageFamily)
    .eq('message_code', params.messageCode)
    .order('created_at', { ascending: false })
    .limit(20)

  if (params.receiverEdielId) {
    query = query.eq('receiver_ediel_id', params.receiverEdielId)
  }

  if (params.messageVersion) {
    query = query.eq('message_version', params.messageVersion)
  }

  if (matchingOutboundRequests.length > 0) {
    query = query.in(
      'outbound_request_id',
      matchingOutboundRequests.map((row) => row.id)
    )
  } else if (params.outboundRequestId) {
    query = query.eq('outbound_request_id', params.outboundRequestId)
  }

  const { data, error } = await query
  if (error) throw error

  const rows = (data ?? []) as EdielMessageRow[]
  if (rows.length === 0) return null

  return rows[0] ?? null
}

export async function hasCanonicalAckDuplicate(params: {
  sourceMessageId: string
  ackFamily: 'CONTRL' | 'APERAK' | 'UTILTS_ERR'
  outcome?: 'positive' | 'negative'
}): Promise<EdielMessageRow | null> {
  const exact = await findExistingAckForSource({
    sourceMessageId: params.sourceMessageId,
    ackFamily: params.ackFamily,
    outcome: params.outcome,
  })

  if (exact) return exact

  if (params.outcome) {
    const conflictingOutcome = params.outcome === 'positive' ? 'negative' : 'positive'
    const conflict = await findExistingAckForSource({
      sourceMessageId: params.sourceMessageId,
      ackFamily: params.ackFamily,
      outcome: conflictingOutcome,
    })

    if (conflict) return conflict
  }

  return null
}