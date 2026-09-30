import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const script = readFileSync(new URL('../scripts/tenantservice-upgrade-restore.sh', import.meta.url), 'utf8')
const helpers = script.match(/^tenantservice_local_docker\(\)\{[\s\S]*?^\}\n\ntenantservice_restore_archive\(\)\{[\s\S]*?^\}/m)?.[0]
const originalRestore = script.match(/  if ! "\$TENANTSERVICE_PG_RESTORE" --dbname=[\s\S]*?\n  fi/)?.[0]
if (!helpers && !originalRestore) throw new Error('actual restore wrapper not found')

type Scenario = 'valid' | 'not-superuser' | 'wrong-database' | 'restore-failure' | 'generator-failure' | 'not-ci' | 'external-url'
// Real Bash control flow and pipeline status are exercised. Database/Docker
// processes are stubs; this never claims a real owner/ACL restore or native PASS.
function run(scenario: Scenario) {
  const temporary = mkdtempSync(join(tmpdir(), 'tenantservice-upgrade-restore.'))
  const restoreDatabase = 'tenantservice_restore_100_200'
  try {
    const result = spawnSync('bash', ['-c', `
set -euo pipefail
TENANTSERVICE_TEMP="$1"
TENANTSERVICE_RESTORE_DATABASE='${restoreDatabase}'
TENANTSERVICE_RESTORE_URL="postgresql://postgres:postgres@127.0.0.1:54322/$TENANTSERVICE_RESTORE_DATABASE"
DB_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres'
RUNNER_TEMP="$(dirname "$TENANTSERVICE_TEMP")"
CI=true
TENANTSERVICE_PG_RESTORE=synthetic_pg_restore
SCENARIO="$2"
if [[ "$SCENARIO" == not-ci ]]; then CI=false; fi
if [[ "$SCENARIO" == external-url ]]; then TENANTSERVICE_RESTORE_URL='postgresql://postgres@example.invalid/production'; fi
psql() {
  [[ "$1" == "postgresql://postgres:postgres@127.0.0.1:54322/"* ]] || return 99
  if [[ "$*" == *'rolsuper'* ]]; then printf '%s\\n' 'postgres|false';
  else printf '%s\\n' '42001'; fi
}
synthetic_pg_restore() {
  if [[ "$*" == *'--dbname='* ]]; then
    printf '%s\\n' 'pg_restore: error: could not execute query: ERROR: must be able to SET ROLE "supabase_admin"' >&2
    return 7
  fi
  [[ "$*" == *'--file=-'* && "$*" == *'--single-transaction'* && "$*" == *'--use-list='* ]] || return 98
  [[ "$*" != *'--no-owner'* && "$*" != *'--no-acl'* && "$*" != *'--no-privileges'* ]] || return 97
  printf '%s\\n' 'RESTORE_GENERATOR_CALLED' >&2
  printf '%s\\n' 'BEGIN;' 'CREATE SCHEMA auth AUTHORIZATION supabase_admin;' 'GRANT USAGE ON SCHEMA auth TO service_role;' 'COMMIT;'
  if [[ "$SCENARIO" == generator-failure ]]; then return 6; fi
}
env() {
  [[ "$1" == -u && "$2" == DOCKER_HOST && "$3" == -u && "$4" == DOCKER_CONTEXT && "$5" == docker ]] || return 96
  shift 5
  docker "$@"
}
docker() {
  [[ "$1" == '--host=unix:///var/run/docker.sock' ]] || return 95
  shift
  [[ "$1" == exec ]] || return 94
  shift
  local streaming=false
  if [[ "$1" == -i ]]; then streaming=true; shift; fi
  [[ "$1" == supabase_db_gridex-ops-platform ]] || return 93
  shift
  [[ "$1" == psql && "$*" == *'--host=127.0.0.1'* && "$*" == *'--port=5432'* &&
     "$*" == *'--username=supabase_admin'* && "$*" == *"--dbname=$TENANTSERVICE_RESTORE_DATABASE"* && "$*" == *'--no-password'* ]] || return 92
  if [[ "$streaming" == false ]]; then
    case "$SCENARIO" in
      not-superuser) printf '%s\\n' 'supabase_admin|supabase_admin|false|42001';;
      wrong-database) printf '%s\\n' 'supabase_admin|supabase_admin|true|99999';;
      *) printf '%s\\n' 'supabase_admin|supabase_admin|true|42001';;
    esac
    return
  fi
  local restored_sql
  restored_sql="$(cat)"
  [[ "$restored_sql" == *'AUTHORIZATION supabase_admin'* && "$restored_sql" == *'GRANT USAGE ON SCHEMA auth TO service_role'* ]] || return 91
  printf '%s\\n' 'RESTORE_CONSUMER_CALLED' >&2
  if [[ "$SCENARIO" == restore-failure ]]; then return 5; fi
}
${helpers ?? ''}
${helpers ? 'tenantservice_restore_archive "$TENANTSERVICE_RESTORE_DATABASE" "$TENANTSERVICE_RESTORE_URL"' : originalRestore}
`, 'restore-wrapper-test', temporary, scenario], { encoding: 'utf8', timeout: 5_000,
      env: { ...process.env, DOCKER_HOST: 'tcp://remote.example.invalid:2376', DOCKER_CONTEXT: 'production' } })
    const logPath = join(temporary, 'restore.log')
    return { ...result, restoreLog: existsSync(logPath) ? readFileSync(logPath, 'utf8') : '' }
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

describe('disposable restore authority wrapper', () => {
  it('restores the unstripped archive through the proven local administrator instead of restricted postgres', () => {
    const result = run('valid')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('TENANTSERVICE_RESTORE_SOURCE_ROLE postgres_superuser=false')
    expect(result.stdout).toContain('TENANTSERVICE_RESTORE_LOCAL_ADMIN_AUTHORITY_PASS')
    expect(result.stderr).not.toContain('must be able to SET ROLE')
    expect(result.restoreLog).toContain('RESTORE_GENERATOR_CALLED')
    expect(result.restoreLog).toContain('RESTORE_CONSUMER_CALLED')
  })

  it.each(['not-superuser', 'wrong-database', 'not-ci', 'external-url'] as const)('fails closed before restore for %s', scenario => {
    const result = run(scenario)
    expect(result.status).not.toBe(0)
    expect(result.stdout).not.toContain('TENANTSERVICE_RESTORE_LOCAL_ADMIN_AUTHORITY_PASS')
    expect(result.stderr).not.toContain('RESTORE_GENERATOR_CALLED')
    expect(result.stderr).not.toContain('RESTORE_CONSUMER_CALLED')
    expect(result.restoreLog).not.toContain('RESTORE_GENERATOR_CALLED')
    expect(result.restoreLog).not.toContain('RESTORE_CONSUMER_CALLED')
  })

  it.each(['restore-failure', 'generator-failure'] as const)('propagates %s and cannot report the restore as successful', scenario => {
    const result = run(scenario)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('TENANTSERVICE_RESTORE_PG_RESTORE_FAILED')
    expect(result.restoreLog).toContain('RESTORE_GENERATOR_CALLED')
    expect(result.stdout).not.toContain('TENANTSERVICE_RESTORE_REAL_PG_DUMP_ARCHIVE_PASS')
  })
})
