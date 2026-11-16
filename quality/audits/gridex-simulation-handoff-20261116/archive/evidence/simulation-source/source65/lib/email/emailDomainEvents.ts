import { emitDomainEvent } from '@/lib/events/domainEvents'
import type { CommunicationLog } from './communicationLogs'

const EMAIL_SENT_DOMAIN_EVENT_KEYS = new Set([
  'contract.confirmation_sent',
  'contract.cooling_off_sent',
])

function stringFromMetadata(metadata: Record<string, unknown> | null | undefined, key: string) {
  const value = metadata?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function sentDomainEventTypesForCommunicationLog(log: CommunicationLog): string[] {
  const eventKey = log.event_key ?? null
  return eventKey && EMAIL_SENT_DOMAIN_EVENT_KEYS.has(eventKey) ? [eventKey] : []
}

export async function emitCommunicationSentDomainEvents(log: CommunicationLog, options: { source?: string } = {}) {
  for (const eventType of sentDomainEventTypesForCommunicationLog(log)) {
    const contractId = log.contract_id ?? stringFromMetadata(log.metadata, 'contract_id')
    await emitDomainEvent({
      companyId: log.company_id,
      eventType,
      aggregateType: contractId ? 'customer_contract' : 'communication_log',
      aggregateId: contractId ?? log.id,
      subjectCustomerId: log.customer_id,
      source: options.source ?? 'email_provider_webhook',
      idempotencyKey: `communication:${eventType}:${log.id}`,
      payload: {
        communication_log_id: log.id,
        customer_number: log.customer_number ?? stringFromMetadata(log.metadata, 'customer_number'),
        external_customer_id: log.external_customer_id ?? stringFromMetadata(log.metadata, 'external_customer_id'),
        contract_id: contractId,
        provider: log.provider,
        provider_message_id: log.provider_message_id,
        event_key: log.event_key,
        template_key: log.template_key,
      },
    }).catch((error) => console.warn('[email] domain event after sent mail skipped', error))
  }
}
