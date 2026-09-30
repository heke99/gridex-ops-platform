import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const script = readFileSync(new URL('../scripts/tenantservice-upgrade-restore.sh', import.meta.url), 'utf8')
const wrapper = script.match(/  tenantservice_sql\(\)\{[\s\S]*?\n  \}/)?.[0]
if (!wrapper) throw new Error('tenantservice SQL wrapper not found')

// Exercise the real Bash wrapper under nounset. The psql process is a stub:
// these cases qualify log-path construction and failure propagation only.
function runWrapper(fails: boolean) {
  const temporary = mkdtempSync(join(tmpdir(), 'tenantservice-wrapper-'))
  try {
    const source = join(temporary, 'synthetic fixture.sql')
    writeFileSync(source, '-- synthetic wrapper input\n')
    const result = spawnSync('bash', ['-c', `
set -euo pipefail
TENANTSERVICE_TEMP="$1"
psql() {
  [[ "$1" == 'disposable-db' && "$6" == '-f' && "$7" == "$WRAPPER_SOURCE" ]] || return 99
  if [[ "$WRAPPER_FAILS" == true ]]; then
    printf '%s\\n' 'ERROR: synthetic SQL failure'
    return 3
  fi
  printf '%s\\n' 'TENANTSERVICE_UPGRADE_SYNTHETIC_PASS'
}
tenantservice_safe_first_error() {
  [[ "$1" == "$TENANTSERVICE_TEMP/synthetic fixture.sql.log" ]] || return 97
  printf '%s\\n' 'SANITIZED_WRAPPER_ERROR' >&2
}
WRAPPER_SOURCE="$2"
WRAPPER_FAILS="$3"
${wrapper}
tenantservice_sql 'disposable-db' "$WRAPPER_SOURCE"
`, 'wrapper-test', temporary, source, String(fails)], { encoding: 'utf8', timeout: 5_000 })
    const logPath = join(temporary, 'synthetic fixture.sql.log')
    const log = existsSync(logPath) ? readFileSync(logPath, 'utf8') : null
    return { result, log }
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

describe('isolated upgrade SQL wrapper', () => {
  it('constructs the per-source log after assigning the source path under nounset', () => {
    const { result, log } = runWrapper(false)
    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toBe('TENANTSERVICE_UPGRADE_SYNTHETIC_PASS\n')
    expect(log).toBe('TENANTSERVICE_UPGRADE_SYNTHETIC_PASS\n')
  })

  it('propagates SQL failure and passes the correct private log to the sanitizer', () => {
    const { result, log } = runWrapper(true)
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('TENANTSERVICE_NATIVE_SQL_FAILED synthetic fixture.sql\nSANITIZED_WRAPPER_ERROR\n')
    expect(log).toBe('ERROR: synthetic SQL failure\n')
  })
})
