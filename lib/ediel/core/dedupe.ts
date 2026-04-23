// lib/ediel/core/dedupe.ts

import { supabaseService } from '@/lib/supabase/service'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { findExistingAckForSource } from '@/lib/ediel/core/ackPolicy'
import { normalizeInboundReferenceIdentity } from '@/lib/ediel/core/referenceRegistry'

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

export async function findOutboundEdielMessageDuplicate(params: {
  outboundRequestId?: string | null
  sourceType?: string | null
  sourceId?: string | null
  requestType?: string | null
  receiverEdielId?: string | null
  messageFamily: string
  messageCode: string
  messageVersion?: string | null
}): Promise<EdielMessageRow | null> {
  let query = supabaseService
    .from('ediel_messages')
    .select('*')
    .eq('direction', 'outbound')
    .eq('message_family', params.messageFamily)
    .eq('message_code', params.messageCode)
    .order('created_at', { ascending: false })
    .limit(10)

  if (params.outboundRequestId) {
    query = query.eq('outbound_request_id', params.outboundRequestId)
  }

  if (params.receiverEdielId) {
    query = query.eq('receiver_ediel_id', params.receiverEdielId)
  }

  if (params.messageVersion) {
    query = query.eq('message_version', params.messageVersion)
  }

  const { data, error } = await query
  if (error) throw error

  return ((data ?? [])[0] as EdielMessageRow | undefined) ?? null
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