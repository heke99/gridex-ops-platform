import { requireAdminActionAccess } from '@/lib/admin/guards'

export const EDIEL_PERMISSION_KEYS = {
  read: 'communication.read',
  write: 'communication.write',
  legacySend: 'communication.send',
  send: 'ediel.send',
  testingWrite: 'ediel_testing.write',
  testingAttest: 'ediel_testing.attest',
  productionActivate: 'ediel.production.activate',
  productionPause: 'ediel.production.pause',
  profileWrite: 'ediel.profile.write',
} as const

/** Read-only Ediel access. Never use this guard for a mutating action. */
export function requireEdielReadActionAccess() {
  return requireAdminActionAccess({ allOf: [EDIEL_PERMISSION_KEYS.read] })
}

/**
 * Mutating test/runtime actions may use the dedicated permission or the
 * existing communication.write compatibility permission. Neither path accepts
 * communication.read.
 */
export function requireEdielWriteActionAccess() {
  return requireAdminActionAccess({
    anyOf: [EDIEL_PERMISSION_KEYS.testingWrite, EDIEL_PERMISSION_KEYS.write],
  })
}

/** External transport requires a send-level permission, never generic write/read. */
export function requireEdielSendActionAccess() {
  return requireAdminActionAccess({
    anyOf: [EDIEL_PERMISSION_KEYS.send, EDIEL_PERMISSION_KEYS.legacySend],
  })
}

/** Manual attestation is intentionally separate from machine verification. */
export function requireEdielTestAttestActionAccess() {
  return requireAdminActionAccess({ allOf: [EDIEL_PERMISSION_KEYS.testingAttest] })
}

export function requireEdielProductionActivateActionAccess() {
  return requireAdminActionAccess({ allOf: [EDIEL_PERMISSION_KEYS.productionActivate] })
}

export function requireEdielProductionPauseActionAccess() {
  return requireAdminActionAccess({ allOf: [EDIEL_PERMISSION_KEYS.productionPause] })
}

export function requireEdielProfileWriteActionAccess() {
  return requireAdminActionAccess({ allOf: [EDIEL_PERMISSION_KEYS.profileWrite] })
}
