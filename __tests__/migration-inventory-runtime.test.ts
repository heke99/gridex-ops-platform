import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
const script = resolve('scripts/generate-canonical-migration-inventory.cjs')
const name = '20260903164000_synthetic.sql'
const sql = 'create table public.synthetic (id integer);\n'
const hash = createHash('sha256').update(sql).digest('hex')
const runtime = 'migration-history-manifest.runtime.additions.json'
const sources = ['migration-history-manifest.json', 'migration-history-manifest.additions.json', 'migration-history-verified-tail.json']
function run(manifests: Record<string, Record<string, string>>, content = sql) {
  const root = mkdtempSync(join(tmpdir(), 'gridex-inventory-'))
  try {
    mkdirSync(join(root, 'scripts')); mkdirSync(join(root, 'supabase/migrations'), { recursive: true })
    writeFileSync(join(root, 'supabase/migrations', name), content)
    for (const [file, files] of Object.entries({ [sources[0]]: {}, ...manifests })) writeFileSync(join(root, 'scripts', file), JSON.stringify({ files }))
    // Load inherited Node preloads in the real repo first, then give the actual
    // generator its isolated fixture cwd. Relative NODE_OPTIONS remain valid.
    const result = spawnSync(process.execPath, ['-e', 'process.chdir(process.argv[1]); require(process.argv[2])', root, script], { encoding: 'utf8' })
    let inventory = null
    try { inventory = JSON.parse(readFileSync(join(root, 'artifacts/migration-inventory-2026-08-03.json'), 'utf8')) } catch { /* early conflict has no inventory */ }
    return { status: result.status, output: result.stdout + result.stderr, inventory }
  } finally { rmSync(root, { recursive: true, force: true }) }
}
describe('canonical inventory consumes existing runtime provenance without hash adoption', () => {
  it('registers runtime-only source and keeps live effects unverified', () => {
    const result = run({ [runtime]: { [name]: hash } })
    expect(result.status).toBe(0)
    expect(result.inventory.checksum_sources).toContain(`scripts/${runtime}`)
    expect(result.inventory.migrations[0]).toMatchObject({ checksum_registered: true, live_ledger_state: 'UNVERIFIED', live_schema_effect_state: 'UNVERIFIED' })
    expect(result.inventory.verification_state).toBe('LOCAL_INVENTORY_ONLY')
  })
  for (const source of sources) {
    it(`accepts identical overlap with ${source}`, () => expect(run({ [source]: { [name]: hash }, [runtime]: { [name]: hash } }).status).toBe(0))
    it(`rejects conflicting runtime registration against ${source}`, () => {
      const result = run({ [source]: { [name]: hash }, [runtime]: { [name]: '0'.repeat(64) } })
      expect(result.status).not.toBe(0)
      expect(result.output).toMatch(/conflict/i)
      expect(result.inventory).toBeNull()
    })
  }
  it('rejects SQL changed after runtime registration', () => expect(run({ [runtime]: { [name]: hash } }, sql + '-- altered').status).not.toBe(0))
  it('rejects unknown SQL instead of adopting its hash', () => expect(run({}).status).not.toBe(0))
  it.each<Record<string, Record<string, string>>>([{}, { [runtime]: {} }])('retains optional absent/empty runtime source', manifests => expect(run({ [sources[0]]: { [name]: hash }, ...manifests }).status).toBe(0))
})
