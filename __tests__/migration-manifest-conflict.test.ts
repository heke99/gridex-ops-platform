import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, expect, it } from 'vitest'

const canonical = 'migration-history-manifest.json'
const general = 'migration-history-manifest.additions.json'
const ediel = 'migration-history-manifest.ediel.additions.json'
const runtime = 'migration-history-manifest.runtime.additions.json'
const migration = '20261119100100_fixture.sql'
const sql = 'SELECT 1;\n'
const hash = createHash('sha256').update(sql).digest('hex')
const otherHash = 'a'.repeat(64)
const checker = fileURLToPath(new URL('../scripts/check-migration-versions.cjs', import.meta.url))
let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'migration-manifest-conflict-test-'))
  mkdirSync(join(root, 'scripts'))
  mkdirSync(join(root, 'supabase/migrations'), { recursive: true })
  copyFileSync(checker, join(root, 'scripts/check-migration-versions.cjs'))
  writeMigration(migration, sql)
  writeManifest(canonical, {})
})

afterEach(() => { rmSync(root, { recursive: true, force: true }) })

function writeManifest(name: string, files: Record<string, string>, allowedLegacyCollisions?: Record<string, string[]>) {
  writeFileSync(join(root, 'scripts', name), JSON.stringify({ files, allowedLegacyCollisions }))
}

function writeMigration(name: string, source: string) {
  writeFileSync(join(root, 'supabase/migrations', name), source)
}

function verify() {
  return spawnSync(process.execPath, ['scripts/check-migration-versions.cjs'], { cwd: root, encoding: 'utf8' })
}

it.each([[general, ediel], [general, runtime], [ediel, runtime]])(
  'rejects a checksum disagreement between %s and %s even when the later hash matches the file',
  (earlier, later) => {
    writeManifest(earlier, { [migration]: otherHash })
    writeManifest(later, { [migration]: hash })
    const result = verify()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(`Additive manifests conflict on checksum: ${migration}`)
    expect(result.stderr).toContain(`${earlier}=${otherHash}`)
    expect(result.stderr).toContain(`${later}=${hash}`)
    expect(result.stderr).not.toContain('Migration checksum changed')
  },
)

it('preserves the canonical checksum and reports every duplicate origin on a conflict', () => {
  writeManifest(canonical, { [migration]: hash })
  writeManifest(general, { [migration]: otherHash })
  writeManifest(ediel, { [migration]: 'b'.repeat(64) })
  writeManifest(runtime, { [migration]: hash })
  const result = verify()
  expect(result.status).toBe(1)
  expect(result.stderr).toContain(`Additive manifest conflicts with canonical checksum: ${migration}`)
  expect(result.stderr).toContain(`${canonical}=${hash}, ${general}=${otherHash}, ${ediel}=${'b'.repeat(64)}, ${runtime}=${hash}`)
  expect(result.stderr).not.toContain('Migration checksum changed')
})

it('accepts identical digests from all manifests and preserves distinct migration counts', () => {
  for (const name of [canonical, general, ediel, runtime]) writeManifest(name, { [migration]: hash })
  const another = '20261119100200_another.sql'
  writeMigration(another, sql)
  writeManifest(runtime, { [migration]: hash, [another]: hash })
  const result = verify()
  expect(result.status).toBe(0)
  expect(result.stderr).toBe('')
  expect(result.stdout).toContain('2 files; 2 version groups')
})

it('keeps optional overlays optional and requires the canonical manifest', () => {
  writeManifest(canonical, { [migration]: hash })
  expect(verify().status).toBe(0)
  rmSync(join(root, 'scripts', canonical))
  writeManifest(general, { [migration]: hash })
  const result = verify()
  expect(result.status).toBe(1)
  expect(result.stderr).toContain(canonical)
})

it('keeps version-prefix collisions separate from same-name checksum validation', () => {
  const sibling = '20261119100100_sibling.sql'
  writeMigration(sibling, sql)
  writeManifest(canonical, { [migration]: hash })
  writeManifest(general, { [sibling]: hash })
  let result = verify()
  expect(result.status).toBe(1)
  expect(result.stderr).toContain(`Unexpected migration collision 20261119100100: ${migration}, ${sibling}`)
  writeManifest(canonical, { [migration]: hash }, { '20261119100100': [sibling, migration] })
  result = verify()
  expect(result.status).toBe(0)
  expect(result.stdout).toContain('2 files; 1 version groups')
})

it('still reports changed, unlisted, and missing migration files', () => {
  const unlisted = '20261119100300_unlisted.sql'
  const missing = '20261119100400_missing.sql'
  writeMigration(unlisted, sql)
  writeManifest(canonical, { [migration]: otherHash })
  writeManifest(runtime, { [missing]: hash })
  const result = verify()
  expect(result.status).toBe(1)
  expect(result.stderr).toContain(`Migration checksum changed: ${migration}`)
  expect(result.stderr).toContain(`Migration is missing from checksum manifest: ${unlisted}`)
  expect(result.stderr).toContain(`Manifest references a missing migration: ${missing}`)
})
