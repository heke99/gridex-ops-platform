// masterplan: AT-Z09B-SUPPLIER
// Runs the real BRP origination and 20261011120000 confirmation migrations in
// embedded PostgreSQL: the dated BRP version stays a source declaration until
// its own bound, unchanged Z09/Z27 reaches the final acknowledgement with a
// positive APERAK; CONTRL alone, negative or mixed outcomes, an unbound or
// inbound Z09, an AI list, a revoked event or a changed original confirm
// nothing, and a change nearer than one calendar month is held.
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { expect, it } from 'vitest'

it('AT-Z09B: BRP change is confirmed only by its own positive APERAK, dated and tenant-scoped (PGlite)', () => {
  const root = process.cwd(), require = createRequire(path.join(root, 'package.json'))
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/ediel-at-z09b-brp-ack-confirmation-sql-regression.mjs')], {
    cwd: root, encoding: 'utf8', timeout: 120_000, env: { ...process.env, EDIEL_PGLITE_MODULE: require.resolve('@electric-sql/pglite') },
  })
  expect(result.error, result.stderr).toBeUndefined()
  expect(result.status, result.stdout + result.stderr).toBe(0)
  expect(result.stdout).toMatch(/PASS \d+ AT-Z09B BRP APERAK confirmation/)
}, 125_000)
