import { randomUUID } from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'

export type CanonicalEnergyEventInput = {
  eventType: string
  companyId?: string | null
  customerId?: string | null
  siteId?: string | null
  meteringPointId?: string | null
  resolutionId?: string | null
  quoteId?: string | null
  contractId?: string | null
  correlationId?: string | null
  source: string
  payload?: Record<string, unknown>
  actorType?: 'system' | 'api_client' | 'user'
  actorId?: string | null
}

export class CanonicalEnergyAuditError extends Error {
  readonly code = 'canonical_energy_audit_failed'
  readonly retryable = true

  constructor(
    readonly eventType: string,
    readonly correlationId: string,
    readonly databaseMessage: string,
  ) {
    super(`Canonical audit event ${eventType} could not be persisted.`)
    this.name = 'CanonicalEnergyAuditError'
  }
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

/**
 * Fail-closed canonical audit insert with a stable event ID and bounded retry.
 * Database RPCs that already write their event transactionally remain the
 * strongest guarantee; application-level flows must surface an audit failure
 * instead of silently continuing without provenance.
 */
export async function recordCanonicalEnergyEvent(input: CanonicalEnergyEventInput): Promise<void> {
  const eventId = randomUUID()
  const correlationId = input.correlationId ?? randomUUID()
  const row = {
    id: eventId,
    event_type: input.eventType,
    company_id: input.companyId ?? null,
    customer_id: input.customerId ?? null,
    site_id: input.siteId ?? null,
    metering_point_id: input.meteringPointId ?? null,
    resolution_id: input.resolutionId ?? null,
    quote_id: input.quoteId ?? null,
    contract_id: input.contractId ?? null,
    correlation_id: correlationId,
    source: input.source,
    payload_version: '1',
    payload: input.payload ?? {},
    actor_type: input.actorType ?? 'system',
    actor_id: input.actorId ?? null,
  }

  let lastMessage = 'unknown_database_error'
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const { error } = await supabaseService.from('canonical_energy_flow_events').insert(row)
    if (!error || error.code === '23505') return
    lastMessage = error.message
    console.error('[canonical-energy-event] insert_failed', {
      eventId,
      eventType: input.eventType,
      companyId: input.companyId ?? null,
      correlationId,
      attempt,
      errorCode: error.code,
      error: error.message,
    })
    if (attempt < 3) await sleep(40 * 2 ** (attempt - 1))
  }

  const { error: remediationError } = await supabaseService.from('canonical_energy_remediation_queue').insert({
    company_id: input.companyId ?? null,
    remediation_type: 'audit_event_repair',
    entity_type: 'canonical_energy_flow_event',
    entity_id: null,
    fingerprint: `audit:${eventId}`,
    reason_code: 'canonical_energy_event_insert_failed',
    severity: 'critical',
    payload: { event_row: row, last_error: lastMessage },
  })
  if (!remediationError || remediationError.code === '23505') {
    console.error('[canonical-energy-event] escalated_to_remediation', {
      eventId,
      eventType: input.eventType,
      companyId: input.companyId ?? null,
      correlationId,
      error: lastMessage,
    })
    return
  }

  throw new CanonicalEnergyAuditError(
    input.eventType,
    correlationId,
    `${lastMessage}; remediation: ${remediationError.message}`,
  )
}
