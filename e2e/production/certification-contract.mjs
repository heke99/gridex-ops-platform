export const CERTIFICATION_VERSION = 1

export const REQUIRED_PRODUCTION_PHASES = Object.freeze([
  'platform-preflight',
  'tenant-bootstrap',
  'tenant-admin-invitation',
  'tenant-admin-rbac',
  'tenant-isolation',
  'contract-readiness',
  'website-publication',
  'public-api-contract',
  'live-customer-quote',
  'customer-portal-registration',
  'customer-email-verification',
  'live-customer-contract-submit',
  'canonical-customer-graph',
  'customer-number-assignment',
  'legal-snapshot',
  'power-of-attorney',
  'agreement-confirmation-delivery',
  'facility-resolution',
  'grid-owner-resolution',
  'market-route-readiness',
  'supplier-switch-outbound',
  'market-acknowledgement',
  'supplier-switch-state',
  'metering-ingestion',
  'pricing-and-billing',
  'invoice-generation',
  'invoice-delivery',
  'customer-portal-data',
  'tenant-pause-write-block',
  'tenant-reactivation',
  'tenant-close',
  'repeatability-replay',
])

export const REQUIRED_ASSERTION_CLASSES = Object.freeze([
  'happy_path',
  'negative_path',
  'authorization',
  'tenant_isolation',
  'idempotency',
  'replay',
  'auditability',
  'pii_safety',
])

export const CERTIFICATION_STATES = Object.freeze([
  'PENDING',
  'RUNNING',
  'WAITING_EXTERNAL',
  'PASSED',
  'FAILED',
  'BLOCKED',
])

export const LIVE_PRODUCTION_INVARIANTS = Object.freeze({
  opsOrigin: 'https://app.gridex.se',
  gridexTenantOrigin: 'https://gridex.se',
  automaticTriggersForbidden: true,
  productionMutationRequiresExplicitHumanGate: true,
  externalWaitsMustBeResumable: true,
  customerBusinessRecordsAreNeverCleanupFixtures: true,
  syntheticTenantDataMustBeUnmistakablyMarked: true,
  secretsUseLeastPrivilegePerPhase: true,
  browserArtifactsMayNotContainRawPii: true,
  failedDefectsMustBecomePermanentRegressionCoverage: true,
  certificationMustBeRepeatableForAnotherTenant: true,
})

export function assertCertificationDefinition(definition) {
  const phase = String(definition?.phase ?? '')
  if (!REQUIRED_PRODUCTION_PHASES.includes(phase)) {
    throw new Error(`Unknown production certification phase: ${phase || '<missing>'}`)
  }

  const classes = Array.isArray(definition?.assertionClasses)
    ? definition.assertionClasses
    : []
  const unknownClasses = classes.filter((value) => !REQUIRED_ASSERTION_CLASSES.includes(value))
  if (unknownClasses.length) {
    throw new Error(`Unknown assertion classes for ${phase}: ${unknownClasses.join(', ')}`)
  }

  if (!definition?.repeatable) {
    throw new Error(`Production certification phase ${phase} must be repeatable.`)
  }
  if (!definition?.regressionKey || typeof definition.regressionKey !== 'string') {
    throw new Error(`Production certification phase ${phase} must define a permanent regression key.`)
  }

  return true
}
