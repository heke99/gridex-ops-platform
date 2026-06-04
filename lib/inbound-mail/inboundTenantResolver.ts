import type { ParsedEdifactEnvelope } from '@/lib/inbound-mail/edielEmailParser'
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

function firstParty(parsed: ParsedEdifactEnvelope, ...qualifiers: string[]): string | null {
  for (const qualifier of qualifiers) {
    const values = parsed.parties[qualifier]
    const value = Array.isArray(values) ? clean(values[0]) : null
    if (value) return value
  }
  return null
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
  mailboxCompanyId?: string | null
  mailboxId?: string | null
  mailbox?: string | null
  environment?: string | null
  parsed: ParsedEdifactEnvelope
}): Promise<InboundTenantResolution> {
  const marketActorEdielId = firstParty(input.parsed, 'DO', 'DDQ', 'MR', 'MS') ?? input.parsed.receiverEdielId
  const resolution = await resolveInboundTenantFromIdentifiers({
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
  })

  return adaptResolution(resolution)
}
