// ops-api-review: F41
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'

const script = path.resolve(__dirname, '../scripts/check-n-plus-one-query-budget.cjs')
const roots = ['app/api/v1', 'lib/customer-portal', 'lib/pricing', 'lib/website', 'lib/staff-api', 'lib/tenant', 'lib/partner-api']
const loop = "export async function fixture(){ for (const id of ['synthetic']) { await db.from('synthetic').select('*').eq('id', id) } }\n"
const bounded = "export async function fixture(){\n  // query-loop-budget: bounded-retry max=3\n  for (const id of ['synthetic']) { await db.from('synthetic').select('*').eq('id', id) }\n}\n"
let fixture: string | null = null
function makeFixture() {
  fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'n-plus-one-scope-'))
  for (const root of roots) fs.mkdirSync(path.join(fixture, root), { recursive: true })
  return fixture
}
const run = (dir: string) => spawnSync(process.execPath, [script, `--root=${dir}`], { encoding: 'utf8' })
afterEach(() => { if (fixture) fs.rmSync(fixture, { recursive: true, force: true }); fixture = null })

it.each(['lib/staff-api', 'lib/tenant', 'lib/partner-api', 'lib/website'])('detects a forbidden awaited select-in-loop in %s', (root) => {
  const dir = makeFixture()
  fs.writeFileSync(path.join(dir, root, 'probe.ts'), loop)
  const result = run(dir)
  expect(result.status).toBe(1)
  expect(result.stderr).toContain(`${root}/probe.ts`)
})

it.each(['lib/staff-api', 'lib/partner-api'])('keeps documented bounded-loop exceptions in %s', (root) => {
  const dir = makeFixture()
  fs.writeFileSync(path.join(dir, root, 'probe.ts'), bounded)
  expect(run(dir).status).toBe(0)
})

it('the real repository passes with the extended scope', () => {
  expect(execFileSync(process.execPath, [script], { encoding: 'utf8' })).toMatch(/lib\/staff-api.*lib\/tenant.*lib\/partner-api/)
})
