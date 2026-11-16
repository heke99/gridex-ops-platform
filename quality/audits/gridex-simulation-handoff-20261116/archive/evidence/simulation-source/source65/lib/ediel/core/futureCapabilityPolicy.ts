import { EdielExecutionFailure } from '@/lib/ediel/core/failureDisposition'
import type { EdielMessageRow } from '@/lib/ediel/types'

import { EDIEL_ENERGY_SHARING_CAPABILITY } from '@/lib/ediel/rulebook/canonicalEdielFacade'
export { EDIEL_ENERGY_SHARING_CAPABILITY } from '@/lib/ediel/rulebook/canonicalEdielFacade'

export type EdielRequestedCapability = 'energy_sharing'

/** This is recognition of a request and can only tighten a hold. Wire S17
 * alone also describes established data sharing and cannot identify this scope. */
export function requestedEdielCapability(message: Pick<EdielMessageRow, 'message_intent' | 'parsed_payload'>): EdielRequestedCapability | null {
  return message.message_intent === 'energy_sharing' || message.parsed_payload?.requestedCapability === 'energy_sharing'
    ? 'energy_sharing' : null
}

export function assertEdielFutureCapabilityHeld(capability: EdielRequestedCapability | null | undefined, admissionDate: string): void {
  if (capability !== 'energy_sharing') return
  const reason = admissionDate < EDIEL_ENERGY_SHARING_CAPABILITY.effectiveFrom ? 'before_effective_date' : 'activation_evidence_missing'
  // No metadata flag or passage of time can substitute for those separate
  // legal/process/register owners. New national reason codes remain undefined.
  throw new EdielExecutionFailure({ kind: 'unsupported_capability', code: 'EDIEL_ENERGY_SHARING_HELD' }, `ediel_energy_sharing_activation_held:${reason}`)
}
