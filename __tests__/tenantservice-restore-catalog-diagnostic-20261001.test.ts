import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const script = new URL('../scripts/tenantservice-restore-catalog-diagnostic.cjs', import.meta.url).pathname
const source = readFileSync(new URL('../scripts/tenantservice-upgrade-restore.sh', import.meta.url), 'utf8')
const failureGate = source.match(/  if ! cmp "\$TENANTSERVICE_TEMP\/data-before.sha256"[\s\S]*?\n  fi\n/)?.[0]
if (!failureGate) throw new Error('actual restore comparison gate missing')
const catalog = { owners: [{ kind: 'extension', schema_name: 'extensions', object_name: 'pgcrypto', arguments: '', owner_name: 'private-owner-before' }], acl: [], defaultAcl: [] }

function diagnostic(after: unknown, before: unknown = catalog) {
  const directory = mkdtempSync(join(tmpdir(), 'restore-catalog.'))
  try {
    writeFileSync(join(directory, 'before'), JSON.stringify(before))
    writeFileSync(join(directory, 'after'), JSON.stringify(after))
    return spawnSync(process.execPath, [script, join(directory, 'before'), join(directory, 'after')], { encoding: 'utf8', timeout: 5_000 })
  } finally { rmSync(directory, { recursive: true, force: true }) }
}
describe('private actual restore catalog diagnostics', () => {
  it('locates changed extension ownership without printing either owner', () => {
    const result = diagnostic({ ...catalog, owners: [{ ...catalog.owners[0], owner_name: 'private-owner-after' }] })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('count=1 shown=1')
    expect(result.stdout).toContain('"object":"pgcrypto"')
    expect(result.stdout).not.toContain('private-owner')
  })
  it('locates column ACL and creator defaults without printing grants or roles', () => {
    const result = diagnostic({ owners: [], acl: [{ kind: 'column', schema_name: 'public', object_name: 'customers', arguments: '', column_name: 'name', grantee: 'private-grantee', grantor: 'private-grantor', privilege_type: 'SELECT', is_grantable: true }], defaultAcl: [{ creator: 'private-creator', schema_name: 'public', object_type: 'r', grantee: 'private-grantee', grantor: 'private-grantor', privilege_type: 'SELECT', is_grantable: false }] }, { owners: [], acl: [], defaultAcl: [] })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('count=2 shown=2')
    expect(result.stdout).toContain('"column":"name"')
    expect(result.stdout).not.toMatch(/private-grantee|private-grantor|private-creator|SELECT/)
  })
  it('reports no differences for byte-equal catalog values', () => {
    expect(diagnostic(catalog).stdout.trim()).toBe('TENANTSERVICE_RESTORE_CATALOG_DIFFERENCES count=0 shown=0')
  })
  it('bounds output, redacts object name credential patterns and hides parse content', () => {
    const owners = Array.from({ length: 100 }, (_, index) => ({ ...catalog.owners[0], object_name: `sb_secret_synthetic${index}` }))
    const result = diagnostic({ owners, acl: [], defaultAcl: [] }, { owners: [], acl: [], defaultAcl: [] })
    expect(result.stdout).toContain('count=100 shown=80')
    expect(result.stdout).not.toContain('sb_secret_')
    expect(result.stdout.split('\n').filter(line => line.startsWith('TENANTSERVICE_RESTORE_CATALOG_OBJECT '))).toHaveLength(80)
    const malformed = diagnostic({ secret: 'never-print-this' })
    expect(malformed.status).toBe(1)
    expect(malformed.stderr.split('\n')[0]).toBe('TENANTSERVICE_RESTORE_CATALOG_DIAGNOSTIC_UNAVAILABLE')
    expect(malformed.stderr).not.toContain('never-print-this')
    expect(malformed.stdout).toBe('')
  })
  it.each([0, 1])('retains the failing acceptance gate when diagnostic exits %i', diagnosticStatus => {
    const result = spawnSync('bash', ['-c', `
set -euo pipefail
TENANTSERVICE_TEMP=/private/synthetic
TENANTSERVICE_CANDIDATE_ROOT=/candidate/synthetic
TENANTSERVICE_RESTORE_URL=synthetic-local
cmp() { return 1; }
psql() { printf '{}\\n'; }
node() { printf 'SYNTHETIC_DIAGNOSTIC_REACHED\\n'; return "$1"; }
# Redirect stays private but the controlled process does not need a real DB.
${failureGate!.replace('> "$TENANTSERVICE_TEMP/restore-catalog-after.json"', '> /dev/null').replace('node "$TENANTSERVICE_CANDIDATE_ROOT/scripts/tenantservice-restore-catalog-diagnostic.cjs"', `node ${diagnosticStatus}`)}
echo FALSE_RESTORE_ACCEPTANCE
`], { encoding: 'utf8', timeout: 5_000 })
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('SYNTHETIC_DIAGNOSTIC_REACHED')
    expect(result.stdout).not.toContain('FALSE_RESTORE_ACCEPTANCE')
    expect(result.stderr).toContain('TENANTSERVICE_RESTORE_DATA_OR_CATALOG_FINGERPRINT_MISMATCH')
  })
})
