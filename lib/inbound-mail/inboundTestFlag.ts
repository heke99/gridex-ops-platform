import { unbTestIndicator } from '@/lib/inbound-mail/inboundEdifactSources'

/**
 * test_flag of an inbound EDIFACT original at birth (FINDINGS F102).
 *
 * ediel_messages.test_flag defaults to 1, so an inbound insert that omits it
 * stores every production original as a test message. The mailbox environment
 * decides: test -> 1, production -> 0. An interchange that carries the UNB/0035
 * test indicator is never flagged as production; a production mailbox holds
 * that mismatch before storage (J3-05 environment_mismatch), this only keeps
 * the flag conservative if one ever reaches an insert.
 */
export function inboundEdielTestFlag(environment: 'test' | 'production', rawPayload: string | null | undefined): 0 | 1 {
  return environment === 'test' || unbTestIndicator(rawPayload) === '1' ? 1 : 0
}
