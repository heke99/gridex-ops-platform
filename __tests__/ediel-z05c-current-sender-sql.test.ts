// Finite actual registry/permission/supply SQL mechanics. Synthetic issuer,
// canonical facet and prior-ending inputs; no native/public-entrypoint approval.
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { expect, it } from 'vitest'

it('first Z05/C restoration requires the current physical sender registry and exact bindings while preserving retained replay', () => {
  const root = process.cwd()
  const require = createRequire(path.join(root, 'package.json'))
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/ediel-z05c-current-sender-sql-regression.mjs')], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, EDIEL_PGLITE_MODULE: require.resolve('@electric-sql/pglite'), EDIEL_SQL_REPOSITORY: root },
  })
  expect(result.error, result.stderr).toBeUndefined()
  expect(result.status, result.stdout + result.stderr).toBe(0)
  const marker = 'EDIEL_Z05C_CURRENT_SENDER_RESULT '
  const records = result.stdout.split('\n').filter(line => line.startsWith(marker))
  expect(records).toHaveLength(1)
  const report = JSON.parse(records[0].slice(marker.length)) as {
    checks: string[]
    failures: number
    migrationApplication: string
    installedBodySha256: string
    metadataPreserved: boolean
    proofLimits: Record<string, string>
  }
  expect(report.checks).toEqual([
    'authorized sender restores its exact ending',
    'revoked physical sender grid role holds with no domain effects',
    'expired physical sender verified identifier holds with no effects',
    'current reviewer permission deny holds with no effects',
    'actual original artifact withdrawal holds with no effects',
    'unqualified current network representation holds with no effects',
    'physical sender with no original registry holds with no effects',
    'same sender authority in another environment holds with no effects',
    'metering actor permission deny remains held before sender admission',
    'retained same-source receipt replay preserves existing no-write behavior',
    'synthetic owner output companyId mismatch holds with no effects',
    'synthetic owner output environment mismatch holds with no effects',
    'synthetic owner output networkEdielId mismatch holds with no effects',
    'unknown installed predecessor fails closed before changing function',
  ])
  expect(report.failures).toBe(0)
  expect(['applied_to_captured_preimage', 'already_captured_postimage']).toContain(report.migrationApplication)
  expect(report.installedBodySha256).toBe('aab2d2f6dcbfe17e31f92c07a70c9f9346396a2c1435a5976b1d70c8e58cb2b7')
  expect(report.metadataPreserved).toBe(true)
  expect(report.proofLimits).toEqual({
    nativeConcurrency: 'NOT_EXERCISED',
    wholeScenario: 'NOT_APPROVED',
    publicSupplyEntrypoint: 'NOT_EXERCISED',
    rls: 'NOT_EXERCISED',
    registryQueries: 'ACTUAL_SQL',
    issuer: 'SYNTHETIC',
    canonicalAdmission: 'FINITE_DECLARED_FACET',
    globalGraphLock: 'FINITE_NO_OP',
    priorEndingReceipt: 'SYNTHETIC_RETAINED_STATE',
    bindingOutputFaults: 'THREE_SEPARATE_SYNTHETIC_PROPERTY_CASES',
  })
}, 65_000)
