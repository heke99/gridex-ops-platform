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
  companyId: string | null
  environment: 'test' | 'production' | null
  receiverEdielId: string | null
  applicationReference: string | null
  mailbox: string | null
  mailboxMessageId: string | null
  senderEdielId: string | null
  interchangeReference: string | null
  transactionReference: string | null
  externalReference: string | null
}

export function buildInboundCanonicalIdentity(params: {
  companyId?: string | null
  environment?: string | null
  receiverEdielId?: string | null
  applicationReference?: string | null
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
    companyId: trimOrNull(params.companyId),
    environment:params.environment==='test'||params.environment==='production'?params.environment:null,
    receiverEdielId:trimOrNull(params.receiverEdielId),
    applicationReference:trimOrNull(params.applicationReference),
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
  if(!identity.environment)throw new Error('ediel_inbound_duplicate_scope_required')
  const scoped=()=>{
    let query=supabaseService.from('ediel_messages').select('*').eq('direction','inbound').eq('environment',identity.environment!)
    query=identity.companyId?query.eq('company_id',identity.companyId):query.is('company_id',null)
    query=identity.receiverEdielId?query.eq('receiver_ediel_id',identity.receiverEdielId):query.is('receiver_ediel_id',null)
    return identity.applicationReference?query.eq('application_reference',identity.applicationReference):query.is('application_reference',null)
  }
  const unique=(rows:EdielMessageRow[]|null)=>{
    if((rows??[]).length>1)throw new Error('ediel_inbound_duplicate_identity_ambiguous')
    return rows?.[0]??null
  }
  if (identity.mailbox && identity.mailboxMessageId) {
    const { data, error } = await scoped()
      .eq('mailbox', identity.mailbox)
      .eq('mailbox_message_id', identity.mailboxMessageId)
      .limit(2)

    if (error) throw error
    const existing=unique(data as EdielMessageRow[]|null)
    if(existing)return existing
  }

  // An unattributed wire has only its real transport receipt as a stable
  // duplicate key. Sender/UNB numbers cannot choose a global legal tenant.
  if(!identity.companyId)return null

  if (identity.senderEdielId && identity.interchangeReference) {
    const { data, error } = await scoped()
      .eq('sender_ediel_id', identity.senderEdielId)
      .eq('interchange_reference', identity.interchangeReference)
      .limit(2)

    if (error) throw error
    // An explicit new interchange is a new original even when its BGM/IDE
    // references repeat an earlier business transaction. Functional duplicate
    // assessment belongs to the source owner, not canonical original reuse.
    return unique(data as EdielMessageRow[]|null)
  }

  if (
    identity.senderEdielId &&
    identity.transactionReference &&
    identity.externalReference
  ) {
    const { data, error } = await scoped()
      .eq('sender_ediel_id', identity.senderEdielId)
      .eq('transaction_reference', identity.transactionReference)
      .eq('external_reference', identity.externalReference)
      .limit(2)

    if (error) throw error
    const existing=unique(data as EdielMessageRow[]|null)
    if(existing)return existing
  }

  return null
}

async function listMatchingOutboundRequests(params: {
  companyId: string
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
      .eq('company_id', params.companyId)
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
    .eq('company_id', params.companyId)
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
  companyId?: string | null
  environment?: string | null
  sourceOperationId?: string | null
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
  if (!params.companyId || !['test', 'production'].includes(params.environment ?? '')
      || !(params.outboundRequestId || params.sourceOperationId || params.sourceType && params.sourceId && params.requestType)) return null
  const matchingOutboundRequests = await listMatchingOutboundRequests({
    companyId: params.companyId,
    outboundRequestId: params.outboundRequestId ?? null,
    sourceType: params.sourceType ?? null,
    sourceId: params.sourceId ?? null,
    requestType: params.requestType ?? null,
    periodStart: params.periodStart ?? null,
    periodEnd: params.periodEnd ?? null,
  })
  // A source index that has no own request is not a license to search every
  // message of this family. Only a concrete operation/request anchors replay.
  if (!params.sourceOperationId && !params.outboundRequestId && !matchingOutboundRequests.length) return null

  let query = supabaseService
    .from('ediel_messages')
    .select('*')
    .eq('company_id', params.companyId)
    .eq('environment', params.environment)
    .eq('direction', 'outbound')
    .eq('message_family', params.messageFamily)
    .eq('message_code', params.messageCode)
    .order('created_at', { ascending: false })
    .limit(20)

  if (params.sourceOperationId) query = query.eq('source_operation_id', params.sourceOperationId)
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

  const blockingDuplicate = rows.find(row => {
    if (row.company_id !== params.companyId || row.environment !== params.environment) return false
    // An immutable attempted source belongs to its own operation even when a
    // mutable projection says failed. TR05 retries use the same original and a
    // separate protected recovery operation; receiver 91100 is no exception.
    if ((row as EdielMessageRow & {immutable_rendered_at?:string|null}).immutable_rendered_at || row.message_sent_at) return true
    return ['draft', 'queued', 'prepared', 'dispatching', 'provider_accepted', 'sent', 'delivered', 'acknowledged', 'delivery_uncertain'].includes(String(row.status ?? '').toLowerCase())
  })

  return blockingDuplicate ?? null
}

export async function hasCanonicalAckDuplicate(params: {
  sourceMessageId: string
  ackFamily: 'CONTRL' | 'APERAK' | 'UTILTS_ERR'
  outcome?: 'positive' | 'negative'
  ackScope?: 'interchange'|'message'|'transaction'|'object'
  acknowledgedReferences?: readonly string[]
  acknowledgedProdatObjects?: Parameters<typeof findExistingAckForSource>[0]['acknowledgedProdatObjects']
  expectedSource?: EdielMessageRow
  expectedTechnicalCompanyId?: string
}): Promise<EdielMessageRow | null> {
  const exact = await findExistingAckForSource({
    ...params,
  })

  if (exact) return exact

  if (params.outcome) {
    const conflictingOutcome = params.outcome === 'positive' ? 'negative' : 'positive'
    const conflict = await findExistingAckForSource({
      ...params,
      outcome: conflictingOutcome,
    })

    if (conflict) return conflict
  }

  return null
}
