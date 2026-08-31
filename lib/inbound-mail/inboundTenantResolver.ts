import type { ParsedEdifactEnvelope } from '@/lib/inbound-mail/edielEmailParser'
import { supabaseService } from '@/lib/supabase/service'
import {
  resolveInboundTenantFromIdentifiers,
  type InboundTenantEvidence,
  type InboundTenantResolution as SharedInboundTenantResolution,
} from '@/lib/ediel/tenant/resolveInboundTenant'

export type InboundTenantResolution = {
  status: 'resolved' | 'unassigned' | 'ambiguous'
  companyId: string | null
  reasons: string[]
  candidates: string[]
  transportEdielId: string | null
  marketActorEdielId: string | null
  receiverEdielId: string | null
  receiverSubaddress: string | null
  source: string | null
  confidence: number
  evidence: InboundTenantEvidence[]
  warnings: string[]
  shared: SharedInboundTenantResolution
}

function clean(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function upper(value: unknown): string {
  return String(value ?? '').trim().toUpperCase()
}

function firstParty(parsed: ParsedEdifactEnvelope, ...qualifiers: string[]): string | null {
  for (const qualifier of qualifiers) {
    const values = parsed.parties[qualifier]
    const value = Array.isArray(values) ? clean(values[0]) : null
    if (value) return value
  }
  return null
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map(clean).filter((value): value is string => Boolean(value))))
}

function referenceCandidatesForTenant(parsed: ParsedEdifactEnvelope): string[] {
  const references = parsed.references ?? {}
  return uniqueStrings([
    parsed.bgmReference,
    parsed.interchangeReference,
    parsed.transactionReference,
    references.UCI?.[0],
    references.UCM?.[0],
    references.ACW?.[0],
    references.TN?.[0],
    references.LI?.[0],
    references.Z09?.[0],
    references.Z07?.[0],
    references.DOC_PRODAT?.[0],
    references.DOC_UTILTS?.[0],
    references.DOC_APERAK?.[0],
  ])
}

function outboundPartiesMirrorInboundAck(row: Record<string, unknown>, parsed: ParsedEdifactEnvelope): boolean {
  const inboundSender = upper(parsed.senderEdielId)
  const inboundReceiver = upper(parsed.receiverEdielId)
  const outboundSender = upper(row.sender_ediel_id)
  const outboundReceiver = upper(row.receiver_ediel_id)
  if (!inboundSender || !inboundReceiver || !outboundSender || !outboundReceiver) return false
  if (inboundSender !== outboundReceiver || inboundReceiver !== outboundSender) return false

  const expectedInboundSenderSub = upper(row.receiver_sub_address ?? row.receiver_subaddress)
  const expectedInboundReceiverSub = upper(row.sender_sub_address ?? row.sender_subaddress)
  if (expectedInboundSenderSub && upper(parsed.senderSubAddress) !== expectedInboundSenderSub) return false
  if (expectedInboundReceiverSub && upper(parsed.receiverSubAddress) !== expectedInboundReceiverSub) return false
  return true
}

async function findCompanyIdFromMatchedOutbound(parsed: ParsedEdifactEnvelope, environment?: string | null): Promise<{ companyId: string | null; references: string[] }> {
  if (!['CONTRL', 'APERAK', 'UTILTS_ERR'].includes(parsed.messageFamily)) {
    return { companyId: null, references: [] }
  }

  const references = referenceCandidatesForTenant(parsed)
  if (references.length === 0) return { companyId: null, references }

  const columns = [
    'interchange_reference',
    'transaction_reference',
    'external_reference',
    'correlation_reference',
    'original_message_id',
    'original_transaction_id',
    'message_reference',
    'bgm_reference',
  ]

  const rows: Array<Record<string, unknown>> = []
  for (const column of columns) {
    const query = supabaseService
      .from('ediel_messages')
      .select('id,company_id,message_family,message_code,direction,environment,sender_ediel_id,sender_sub_address,receiver_ediel_id,receiver_sub_address,created_at,message_sent_at')
      .eq('direction', 'outbound')
      .not('message_family', 'in', '(CONTRL,APERAK,UTILTS_ERR)')
      .in(column, references)
      .order('message_sent_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(10)

    const { data, error } = environment ? await query.eq('environment', environment) : await query
    if (error) continue
    rows.push(...((data ?? []) as Array<Record<string, unknown>>))
  }

  // A reference is only tenant evidence when the ACK transport parties are the
  // exact reverse of the original outbound UNB parties. A colliding reference
  // must never elevate an unrelated tenant to a resolved match.
  const partyBoundRows = rows.filter((row) => outboundPartiesMirrorInboundAck(row, parsed))
  const companyIds = uniqueStrings(partyBoundRows.map((row) => typeof row.company_id === 'string' ? row.company_id : null))
  return { companyId: companyIds.length === 1 ? companyIds[0] : null, references }
}

function adaptResolution(resolution: SharedInboundTenantResolution): InboundTenantResolution {
  return {
    status: resolution.status === 'unresolved' ? 'unassigned' : resolution.status,
    companyId: resolution.companyId,
    reasons: resolution.reasons,
    candidates: resolution.candidateCompanyIds,
    transportEdielId: resolution.transportEdielId,
    marketActorEdielId: resolution.marketActorEdielId,
    receiverEdielId: resolution.receiverEdielId,
    receiverSubaddress: resolution.receiverSubaddress,
    source: resolution.source,
    confidence: resolution.confidence,
    evidence: resolution.evidence,
    warnings: resolution.warnings,
    shared: resolution,
  }
}

export async function resolveTenantForInboundEdiel(input: {
  existingCompanyId?: string | null
  mailboxCompanyId?: string | null
  mailboxId?: string | null
  mailbox?: string | null
  environment?: string | null
  parsed: ParsedEdifactEnvelope
}): Promise<InboundTenantResolution> {
  const marketActorEdielId = firstParty(input.parsed, 'DO', 'DDQ', 'MR', 'MS') ?? input.parsed.receiverEdielId
  const outbound = await findCompanyIdFromMatchedOutbound(input.parsed, input.environment)
  const resolution = await resolveInboundTenantFromIdentifiers({
    existingCompanyId: input.existingCompanyId ?? outbound.companyId,
    mailboxCompanyId: input.mailboxCompanyId,
    mailboxId: input.mailboxId,
    mailbox: input.mailbox,
    environment: input.environment,
    senderEdielId: input.parsed.senderEdielId,
    senderSubaddress: input.parsed.senderSubAddress,
    receiverEdielId: input.parsed.receiverEdielId,
    receiverSubaddress: input.parsed.receiverSubAddress,
    marketActorEdielId,
    applicationReference: input.parsed.applicationReference,
    messageFamily: input.parsed.messageFamily,
    messageCode: input.parsed.messageCode,
    referenceCandidates: outbound.references.length > 0 ? outbound.references : referenceCandidatesForTenant(input.parsed),
  })

  return adaptResolution(resolution)
}