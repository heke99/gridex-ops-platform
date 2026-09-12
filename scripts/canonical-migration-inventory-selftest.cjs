const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const generator = path.join(__dirname, 'generate-canonical-migration-inventory.cjs')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gridex-inventory-test-'))
const filename = '20260901000000_fixture.sql'
const sql = 'create table public.fixture(id integer);\n'
const hash = crypto.createHash('sha256').update(sql).digest('hex')
const sources = ['migration-history-manifest.json', 'migration-history-manifest.additions.json',
  'migration-history-manifest.ediel.additions.json', 'migration-history-manifest.runtime.additions.json',
  'migration-history-verified-tail.json']
function manifest(source, files) {
  fs.writeFileSync(path.join(dir, 'scripts', source), JSON.stringify({ files }))
}
function run() {
  return spawnSync(process.execPath, [generator], { cwd: dir, encoding: 'utf8' })
}
try {
  fs.mkdirSync(path.join(dir, 'scripts'))
  fs.mkdirSync(path.join(dir, 'supabase/migrations'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'supabase/migrations', filename), sql)
  for (const source of sources) {
    for (const reset of sources) manifest(reset, {})
    manifest(source, { [filename]: hash })
    const result = run()
    assert.equal(result.status, 0, `${source}: ${result.stderr}`)
    const inventory = JSON.parse(fs.readFileSync(path.join(dir, 'artifacts/migration-inventory-2026-08-03.json')))
    assert.equal(inventory.summary.checksum_registered_count, 1)
    assert.ok(inventory.checksum_sources.includes(`scripts/${source}`))
    assert.equal(inventory.verification_state, 'LOCAL_INVENTORY_ONLY')
  }
  for (let i = 0; i < sources.length; i++) {
    for (let j = i + 1; j < sources.length; j++) {
      for (const reset of sources) manifest(reset, {})
      manifest(sources[i], { [filename]: '0'.repeat(64) })
      manifest(sources[j], { [filename]: hash })
      const result = run()
      assert.notEqual(result.status, 0, `conflicting sources accepted: ${sources[i]}, ${sources[j]}`)
      assert.match(result.stderr, /conflict/i)
    }
  }
  for (const source of sources) manifest(source, {})
  assert.notEqual(run().status, 0, 'unregistered migration accepted')
  manifest(sources[0], { [filename]: hash })
  fs.appendFileSync(path.join(dir, 'supabase/migrations', filename), '-- changed\n')
  assert.notEqual(run().status, 0, 'modified migration accepted')
  console.log('PASS: five checksum sources, ten source-conflict pairs, missing and changed bytes rejected')
} finally {
  fs.rmSync(dir, { recursive: true, force: true })
}
