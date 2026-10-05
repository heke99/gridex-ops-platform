// masterplan: IMP-05, AT-IMP-05
// Collective IMP05 proof with signed recipient/address and readiness suites.
// Each existing SQL runner retains its own one database and real public RPCs;
// producer markers describe scope and never self-approve the whole rule.
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { expect, it } from 'vitest'

it('real certificate route versions invalidate both affected tenants, preserve old history and hold a new mailbox without changing the independent tenant', () => {
  const root = process.cwd()
  const require = createRequire(path.join(root, 'package.json'))
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/ediel-scoped-readiness-sql-regression.mjs')], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, EDIEL_PGLITE_MODULE: require.resolve('@electric-sql/pglite') },
  })
  expect(result.error, result.stderr).toBeUndefined()
  expect(result.status, result.stdout + result.stderr).toBe(0)
  const marker = 'IMP05_ROUTE_VERSION_RESULT '
  const records = result.stdout.split('\n').filter(line => line.startsWith(marker))
  expect(records).toHaveLength(1)
  const report = JSON.parse(records[0].slice(marker.length)) as { checks: string[]; wholeRule: string; returnPath: string; fixture: string }
  expect(report.checks).toEqual([
    'two-affected-and-one-independent-scope-ready-through-public-evidence-api',
    'real-certificate-update-increments-both-affected-route-versions',
    'both-affected-actors-tenants-held-and-stale-proof-renewal-denied',
    'independent-tenant-proof-dependencies-and-dispatch-remain-exact',
    'old-proof-and-certificate-route-history-preserved-byte-for-byte',
    'new-mailbox-old-registry-scope-denied-with-zero-message-proof-history-effects',
    'actual-imported-shared-route-and-distinct-registry-route-have-public-ready-proofs',
    'one-real-import-address-change-invalidates-both-selected-tenant-actor-scopes',
    'other-registry-actor-route-tenant-proof-and-dispatch-remain-byte-exact',
    'old-batch-bytes-route-history-and-proofs-retained-without-replay-reactivation',
    'current-immutable-registry-source-holds-old-edition-even-if-mutable-flags-restored',
  ])
  expect(report.wholeRule).toBe('NOT_APPROVED')
  expect(report.returnPath).toBe('NOT_EXERCISED')
  expect(report.fixture).toBe('ONE_EXISTING_EMBEDDED_DATABASE')
  console.info(result.stdout.trim())
}, 65_000)

it('actual first reception freezes original mailbox SMTP and the existing configured ACK reader holds a different current sender', () => {
  const root = process.cwd()
  const require = createRequire(path.join(root, 'package.json'))
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/ediel-technical-syntax-route-sql-regression.mjs')], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, EDIEL_PGLITE_MODULE: require.resolve('@electric-sql/pglite') },
  })
  expect(result.error, result.stderr).toBeUndefined()
  expect(result.status, result.stdout + result.stderr).toBe(0)
  const marker = 'IMP05_ORIGINAL_MAILBOX_RESULT '
  const records = result.stdout.split('\n').filter(line => line.startsWith(marker))
  expect(records).toHaveLength(1)
  const report = JSON.parse(records[0].slice(marker.length)) as { checks: string[]; wholeRule: string; externalActivation: string; fixture: string }
  expect(report.checks).toEqual([
    'legacy-receipt-without-birth-smtp-held-without-replay-backfill',
    'actual-public-reception-birth-smtp-hash-and-original-reversal-pass',
    'mutable-mailbox-address-cannot-move-original-smtp-custody',
    'new-current-smtp-refuses-old-original-with-zero-history-effects',
    'new-original-mailbox-reception-qualifies-the-new-current-smtp',
    'both-contrl-and-aperak-share-birth-smtp-guard-and-original-app-actor',
    'foreign-environment-mailbox-selector-and-hash-refused',
    'explicit-shared-platform-mailbox-qualified-foreign-unshared-held',
    'original-snapshot-immutable-and-replay-preserves-exact-receipt',
  ])
  expect(report.wholeRule).toBe('NOT_APPROVED')
  expect(report.externalActivation).toBe('NOT_EXERCISED')
  expect(report.fixture).toBe('ONE_EXISTING_EMBEDDED_DATABASE')
  console.info(result.stdout.trim())
}, 65_000)
