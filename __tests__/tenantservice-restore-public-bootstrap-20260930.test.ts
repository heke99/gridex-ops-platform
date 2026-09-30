import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../scripts/tenantservice-upgrade-restore.sh', import.meta.url), 'utf8')
const bootstrap = source.match(/  psql "\$DB_URL" -X -q -v ON_ERROR_STOP=1 -c \\\n    "create database[\s\S]*?  tenantservice_restore_archive "\$TENANTSERVICE_RESTORE_DATABASE" "\$TENANTSERVICE_RESTORE_URL"/)?.[0]
if (!bootstrap) throw new Error('actual restore bootstrap not found')

// Actual extracted Bash bootstrap. psql/restore are controlled processes;
// PostgreSQL restore and native ACL success are separately qualified in CI.
function run(scenario: 'empty' | 'application-objects' | 'public-missing') {
  const directory = mkdtempSync(join(tmpdir(), 'restore-public-bootstrap.'))
  try {
    return spawnSync('bash', ['-c', `
set -euo pipefail
TENANTSERVICE_TEMP="$1"
SCENARIO="$2"
DB_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres'
TENANTSERVICE_RESTORE_DATABASE=tenantservice_restore_100_200
TENANTSERVICE_RESTORE_URL="postgresql://postgres:postgres@127.0.0.1:54322/$TENANTSERVICE_RESTORE_DATABASE"
psql() {
  if [[ "$*" == *'create database'* ]]; then
    if [[ "$SCENARIO" != public-missing ]]; then touch "$TENANTSERVICE_TEMP/public-present"; fi
  elif [[ "$*" == *'drop schema public'* ]]; then
    rm -f "$TENANTSERVICE_TEMP/public-present"
  elif [[ "$*" == *'select count(*) from pg_class'* ]]; then
    if [[ "$SCENARIO" == application-objects ]]; then echo 1; else echo 0; fi
  elif [[ "$*" == *"nspname='public'"* ]]; then
    if [[ -e "$TENANTSERVICE_TEMP/public-present" ]]; then echo t; else echo f; fi
  else return 98; fi
}
tenantservice_restore_archive() {
  [[ "$1" == "$TENANTSERVICE_RESTORE_DATABASE" && "$2" == "$TENANTSERVICE_RESTORE_URL" ]] || return 97
  if [[ ! -e "$TENANTSERVICE_TEMP/public-present" ]]; then echo 'ERROR: schema public does not exist' >&2; return 1; fi
  echo SYNTHETIC_ARCHIVE_STREAM_REACHED
}
${bootstrap}
`, 'restore-bootstrap', directory, scenario], { encoding: 'utf8', timeout: 5_000 })
  } finally { rmSync(directory, { recursive: true, force: true }) }
}
describe('template0 restore bootstrap retains the initdb public namespace', () => {
  it('restores into an empty application database with its original public schema', () => {
    const result = run('empty')
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('TENANTSERVICE_RESTORE_EMPTY_TEMPLATE0_DATABASE_PASS')
    expect(result.stdout).toContain('SYNTHETIC_ARCHIVE_STREAM_REACHED')
  })
  it.each(['application-objects', 'public-missing'] as const)('refuses %s before the archive stream', scenario => {
    const result = run(scenario)
    expect(result.status).not.toBe(0)
    expect(result.stdout).not.toContain('SYNTHETIC_ARCHIVE_STREAM_REACHED')
  })
})
