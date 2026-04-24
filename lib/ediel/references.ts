// lib/ediel/references.ts

/**
 * Legacy-kompatibilitetslager.
 * Canonical reference-logik ägs nu i lib/ediel/core/referenceRegistry.ts
 * och ack-defaults i lib/ediel/core/ackPolicy.ts.
 */

export {
  normalizeEdielReference,
  normalizeInterchangeReference,
  buildEdielExternalReference,
  buildEdielTransactionReference,
  buildEdielInterchangeReference,
} from '@/lib/ediel/core/referenceRegistry'

export {
  computeCanonicalAckDueAt,
  computeOutboundAckDueAt,
  deriveEdielAckDefaults,
} from '@/lib/ediel/core/ackPolicy'
