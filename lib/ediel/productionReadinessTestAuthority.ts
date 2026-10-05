export type CanonicalGoLiveReadinessSnapshot = {
  status?: unknown
  blockers?: unknown
  prodat_passed?: unknown
  prodat_total?: unknown
  utilts_passed?: unknown
  utilts_total?: unknown
  evidence_ready?: unknown
}

export type CanonicalActorTestReadiness = {
  ready: boolean
  prodatPassed: number | null
  prodatTotal: number | null
  utiltsPassed: number | null
  utiltsTotal: number | null
  reason: string | null
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : null
}

export function evaluateCanonicalActorTestReadiness(
  snapshot: CanonicalGoLiveReadinessSnapshot | null,
  expectedProdat: number,
  expectedUtilts: number,
): CanonicalActorTestReadiness {
  if (!snapshot) {
    return {
      ready: false,
      prodatPassed: null,
      prodatTotal: null,
      utiltsPassed: null,
      utiltsTotal: null,
      reason: 'Canonical go-live readiness saknas.',
    }
  }

  const prodatPassed = nonNegativeInteger(snapshot.prodat_passed)
  const prodatTotal = nonNegativeInteger(snapshot.prodat_total)
  const utiltsPassed = nonNegativeInteger(snapshot.utilts_passed)
  const utiltsTotal = nonNegativeInteger(snapshot.utilts_total)
  if (
    prodatPassed === null ||
    prodatTotal === null ||
    utiltsPassed === null ||
    utiltsTotal === null
  ) {
    return {
      ready: false,
      prodatPassed,
      prodatTotal,
      utiltsPassed,
      utiltsTotal,
      reason: 'Canonical go-live readiness saknar giltiga PRODAT/UTILTS-räknare.',
    }
  }

  const canonicalReady = snapshot.status === 'ready'
  const evidenceReady = snapshot.evidence_ready === true
  const countsReady =
    prodatTotal >= expectedProdat &&
    utiltsTotal >= expectedUtilts &&
    prodatPassed >= expectedProdat &&
    utiltsPassed >= expectedUtilts

  if (canonicalReady && evidenceReady && countsReady) {
    return {
      ready: true,
      prodatPassed,
      prodatTotal,
      utiltsPassed,
      utiltsTotal,
      reason: null,
    }
  }

  const blockers = Array.isArray(snapshot.blockers)
    ? snapshot.blockers.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : []
  const suffix = blockers.length > 0 ? ` Blockerare: ${blockers.join(' · ')}` : ''
  return {
    ready: false,
    prodatPassed,
    prodatTotal,
    utiltsPassed,
    utiltsTotal,
    reason: `Canonical Ediel-testreadiness är inte komplett: PRODAT ${prodatPassed}/${prodatTotal}, UTILTS ${utiltsPassed}/${utiltsTotal}, evidence_ready=${String(evidenceReady)}.${suffix}`,
  }
}
