import { EdielExecutionFailure } from '@/lib/ediel/core/failureDisposition'
import type { EdielMessageRow } from '@/lib/ediel/types'

/** P26.A §2.3 p35 defines future constraints, not operational authorization. */
export const EDIEL_ENERGY_SHARING_CAPABILITY = Object.freeze({
  id: 'energy_sharing', effectiveFrom: '2027-01-01', activation: 'held',
  messageCodes: Object.freeze(['Z13', 'Z14', 'Z15', 'Z18']),
  forbiddenTransactionReasons: Object.freeze(['S18']),
  measurementResolution: '15_minutes', measurementMethod: '15_minutes', installationType: 'production',
  source: Object.freeze({ document: '260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B',
    sha256: '83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95', section: '2.3', page: 35 }),
  requiredActivationEvidence: Object.freeze(['legal_authority_decision', 'process_authority_decision', 'versioned_capability_owner_register']),
} as const)

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
