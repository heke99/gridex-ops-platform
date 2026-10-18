// masterplan: AT-Z09B-SUPPLIER
// Runs the real BRP origination (20260930200545/211156/230653) and confirmation
// (20261011170000) SQL in embedded PostgreSQL under a controlled clock: two
// dated BRP versions of one supply period are both kept (v1 row, original and
// confirmation unchanged; v1 closed exactly at v2, v2 open); a sibling period
// and a foreign tenant stay untouched; the one-calendar-month notice boundary
// in fixed UTC+1 is authorized at the exact minute and held one minute later,
// including month-end clamping; wrong area, agreement or actor is held; an AI
// list creates no version.
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { expect, it } from 'vitest'

it('AT-Z09B: dated BRP history keeps every version, scoped and at the exact notice boundary (PGlite)', () => {
  const root = process.cwd(), require = createRequire(path.join(root, 'package.json'))
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/ediel-at-z09b-brp-dated-history-sql-regression.mjs')], {
    cwd: root, encoding: 'utf8', timeout: 120_000, env: { ...process.env, EDIEL_PGLITE_MODULE: require.resolve('@electric-sql/pglite') },
  })
  expect(result.error, result.stderr).toBeUndefined()
  expect(result.status, result.stdout + result.stderr).toBe(0)
  expect(result.stdout).toMatch(/PASS \d+ AT-Z09B BRP dated history/)
}, 125_000)
