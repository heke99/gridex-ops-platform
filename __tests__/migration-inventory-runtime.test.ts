import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
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
function run(manifests: Record<string, Record<string, string>>, content = sql, writeToStdout = false) {
  const root = mkdtempSync(join(tmpdir(), 'gridex-inventory-'))
  try {
    mkdirSync(join(root, 'scripts')); mkdirSync(join(root, 'supabase/migrations'), { recursive: true })
    writeFileSync(join(root, 'supabase/migrations', name), content)
    for (const [file, files] of Object.entries({ [sources[0]]: {}, ...manifests })) writeFileSync(join(root, 'scripts', file), JSON.stringify({ files }))
    // Load inherited Node preloads in the real repo first, then give the actual
    // generator its isolated fixture cwd. Relative NODE_OPTIONS remain valid.
    const args = ['-e', 'process.chdir(process.argv[1]); require(process.argv[2])', '--', root, script]
    if (writeToStdout) args.push('--stdout')
    const result = spawnSync(process.execPath, args, { encoding: 'utf8' })
    const artifactDir = join(root, 'artifacts')
    let inventory = null
    try {
      const json = writeToStdout ? result.stdout : readFileSync(join(artifactDir, 'migration-inventory-2026-08-03.json'), 'utf8')
      inventory = JSON.parse(json)
    } catch { /* invalid source can end before inventory output */ }
    return { status: result.status, output: result.stdout + result.stderr, inventory, wroteArtifacts: existsSync(artifactDir) }
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
  it('returns the checked inventory as JSON without writing repository artifacts', () => {
    const result = run({ [runtime]: { [name]: hash } }, sql, true)
    expect(result.status).toBe(0)
    expect(result.wroteArtifacts).toBe(false)
    expect(result.inventory).toMatchObject({
      summary: { sql_file_count: 1, checksum_registered_count: 1 },
      migrations: [{ filename: name, checksum: hash, ledger_eligible: true }],
    })
  })

  it('rejects changed SQL with no JSON or artifact paths in stdout mode', () => {
    const result = run({ [runtime]: { [name]: hash } }, sql + '-- altered', true)
    expect(result.status).not.toBe(0)
    expect(result.inventory).toBeNull()
    expect(result.wroteArtifacts).toBe(false)
    expect(result.output).toContain('not registered')
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
