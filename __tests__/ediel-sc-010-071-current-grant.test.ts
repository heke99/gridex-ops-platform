// masterplan: SC-010, SC-071
// Partial evidence only: real current SQL consumer, finite upstream fixtures;
// no leased export worker or genuinely concurrent native transactions.
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { expect, it } from 'vitest'

it('existing current SQL consumer rejects stale/revoked grants without new effects and preserves a separately authorized beneficiary', () => {
  const root = process.cwd()
  const require = createRequire(path.join(root, 'package.json'))
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/ediel-sc-010-071-current-grant-sql-regression.mjs')], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, EDIEL_PGLITE_MODULE: require.resolve('@electric-sql/pglite'), EDIEL_SQL_REPOSITORY: root },
  })
  expect(result.error, result.stderr).toBeUndefined()
  expect(result.status, result.stdout + result.stderr).toBe(0)
  const marker = 'SC010_SC071_CURRENT_GRANT_RESULT '
  const records = result.stdout.split('\n').filter(line => line.startsWith(marker))
  expect(records).toHaveLength(1)
  const report = JSON.parse(records[0].slice(marker.length)) as { checks: string[]; leasedExportWorker: string; nativeConcurrency: string; wholeScenarios: string }
  expect(report.checks).toEqual([
    'positive-current-read-and-retained-receipt',
    'stale-version-denied-with-zero-row-effects',
    'expired-grant-denied-with-zero-row-effects',
    'revoked-beneficiary-membership-denied-with-zero-row-effects',
    'revoked-upstream-evidence-denied-with-zero-row-effects',
    'actual-revoke-command-advances-own-version',
    'cached-previous-page-cannot-authorize-a-new-read',
    'revoke-replay-preserves-exact-result-and-all-rows',
    'independent-beneficiary-retains-own-quality-only-read',
  ])
  expect(report.leasedExportWorker).toBe('NOT_EXERCISED')
  expect(report.nativeConcurrency).toBe('NOT_EXERCISED')
  expect(report.wholeScenarios).toBe('NOT_APPROVED')
}, 65_000)
