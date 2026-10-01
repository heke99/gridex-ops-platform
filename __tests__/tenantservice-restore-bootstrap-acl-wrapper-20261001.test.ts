import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repository = dirname(dirname(fileURLToPath(import.meta.url)))
const source = readFileSync(join(repository, 'scripts/tenantservice-upgrade-restore.sh'), 'utf8')
const localDocker = source.match(/^tenantservice_local_docker\(\)\{[\s\S]*?^\}/m)?.[0]
if (!localDocker) throw new Error('actual pinned local Docker helper not found')
const sanitizer = source.match(/^tenantservice_safe_first_error\(\)\{[\s\S]*?^\}/m)?.[0]
const cleanup = source.match(/^tenantservice_private_cleanup\(\)\{[\s\S]*?^\}/m)?.[0]
if (!sanitizer || !cleanup) throw new Error('actual private cleanup/sanitizer helpers not found')
const pass = 'TENANTSERVICE_RESTORE_SOURCE_BOOTSTRAP_ACL_RECONCILIATION_PASS'
const owner = 'PRIVATE_CATALOG_OWNER_CANARY', reader = 'PRIVATE_CATALOG_READER_CANARY'
const privateError = 'PRIVATE_PROCESS_ERROR_CANARY'
const catalog = {
  owners: [{ kind: 'schema', schema_name: 'graphql', object_name: 'graphql', arguments: '', owner_name: owner }],
  acl: [{ kind: 'schema', schema_name: 'graphql', object_name: 'graphql', arguments: '', column_name: '',
    grantor: owner, grantee: reader, privilege_type: 'USAGE', is_grantable: false }],
  defaultAcl: [],
}

type Scenario = 'missing' | 'unchanged' | 'not-ci' | 'external-source' | 'external-target' | 'nonrandom-target'
  | 'no-runner-temp' | 'outside-temp' | 'capture-failure' | 'unsupported-plan' | 'oid-failure' | 'invalid-oid'
  | 'admin-failure' | 'wrong-session' | 'wrong-current' | 'not-superuser' | 'wrong-oid' | 'apply-failure'

// Actual sourced Bash and actual Node planner; only the psql/Docker process
// boundaries are controlled. These checks do not execute GRANTs or certify a
// PostgreSQL/Supabase restore. The separate real SQL proof remains mandatory.
function run(scenario: Scenario) {
  const runner = mkdtempSync(join(tmpdir(), 'tenantservice-bootstrap-wrapper.'))
  const temporary = mkdtempSync(join(runner, 'tenantservice-upgrade-restore.'))
  const trace = join(runner, 'process-trace')
  const after = scenario === 'unchanged' ? catalog : {
    ...catalog,
    acl: scenario === 'unsupported-plan' ? [{ ...catalog.acl[0], is_grantable: true }] : [],
  }
  writeFileSync(join(temporary, 'restore-catalog-before.json'), JSON.stringify(catalog), { mode: 0o600 })
  const capture = join(runner, 'controlled-target-catalog.json')
  writeFileSync(capture, JSON.stringify(after), { mode: 0o600 })
  try {
    const result = spawnSync('bash', ['-c', `
set -euo pipefail
umask 077
TENANTSERVICE_CANDIDATE_ROOT="$1"
TENANTSERVICE_TEMP="$2"
export RUNNER_TEMP="$3" CI=true
SCENARIO="$4"
PRIVATE_TRACE="$5"
CONTROLLED_CAPTURE="$6"
DB_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres'
RESTORE_DATABASE=tenantservice_restore_100_200
RESTORE_URL="postgresql://postgres:postgres@127.0.0.1:54322/$RESTORE_DATABASE"
case "$SCENARIO" in
  not-ci) CI=false;;
  external-source) DB_URL='postgresql://postgres@example.invalid/production';;
  external-target) RESTORE_URL='postgresql://postgres@example.invalid/production';;
  nonrandom-target) RESTORE_DATABASE=production; RESTORE_URL="postgresql://postgres:postgres@127.0.0.1:54322/$RESTORE_DATABASE";;
  no-runner-temp) RUNNER_TEMP='';;
  outside-temp) TENANTSERVICE_TEMP="$RUNNER_TEMP";;
esac
record(){ printf '%s\\n' "$1" >> "$PRIVATE_TRACE"; }
psql(){
  [[ "$1" == "postgresql://postgres:postgres@127.0.0.1:54322/$RESTORE_DATABASE" && "$*" == *'ON_ERROR_STOP=1'* ]] || return 99
  if [[ "$*" == *'tenantservice-restore-data-fingerprint.sql'* ]]; then
    [[ "$*" == *'tenantservice_catalog_detail=1'* && "$*" == *'-XAtq'* ]] || return 98
    record capture
    if [[ "$SCENARIO" == capture-failure ]]; then echo '${privateError}' >&2; return 7; fi
    cat "$CONTROLLED_CAPTURE"
  elif [[ "$*" == *'select oid from pg_database where datname=current_database();'* ]]; then
    record oid
    case "$SCENARIO" in
      oid-failure) echo '${privateError}' >&2; return 6;;
      invalid-oid) echo 'PRIVATE_INVALID_OID_CANARY';;
      *) echo 42001;;
    esac
  else return 97; fi
}
node(){
  record "node:$(basename "$1")"
  command node "$@"
}
env(){
  [[ "$1" == -u && "$2" == DOCKER_HOST && "$3" == -u && "$4" == DOCKER_CONTEXT && "$5" == docker ]] || return 96
  shift 5
  docker "$@"
}
docker(){
  [[ "$1" == '--host=unix:///var/run/docker.sock' ]] || return 95
  shift
  [[ "$1" == exec ]] || return 94
  shift
  local streaming=false
  if [[ "$1" == -i ]]; then streaming=true; shift; fi
  [[ "$1" == supabase_db_gridex-ops-platform ]] || return 93
  shift
  [[ "$1" == psql && "$*" == *'--host=127.0.0.1'* && "$*" == *'--port=5432'* &&
     "$*" == *'--username=supabase_admin'* && "$*" == *'--no-password'* &&
     "$*" == *"--dbname=$RESTORE_DATABASE"* && "$*" == *'ON_ERROR_STOP=1'* ]] || return 92
  if [[ "$streaming" == false ]]; then
    [[ "$*" == *'session_user'* && "$*" == *'current_user'* && "$*" == *'rolsuper'* && "$*" == *'d.oid'* ]] || return 91
    record admin
    case "$SCENARIO" in
      admin-failure) echo '${privateError}' >&2; return 5;;
      wrong-session) echo 'postgres|supabase_admin|true|42001';;
      wrong-current) echo 'supabase_admin|postgres|true|42001';;
      not-superuser) echo 'supabase_admin|supabase_admin|false|42001';;
      wrong-oid) echo 'supabase_admin|supabase_admin|true|99999';;
      *) echo 'supabase_admin|supabase_admin|true|42001';;
    esac
    return
  fi
  [[ "$*" == *'-X -q'* ]] || return 90
  record apply
  cat > "$TENANTSERVICE_TEMP/controlled-applied.sql"
  if [[ "$SCENARIO" == apply-failure ]]; then echo '${privateError}' >&2; return 4; fi
}
${localDocker}
source "$TENANTSERVICE_CANDIDATE_ROOT/scripts/tenantservice-restore-bootstrap-acl.sh"
tenantservice_restore_bootstrap_acl "$RESTORE_DATABASE" "$RESTORE_URL"
`, 'bootstrap-acl-wrapper-test', repository, temporary, runner, scenario, trace, capture], {
      encoding: 'utf8', timeout: 10_000,
      env: { ...process.env, DOCKER_HOST: 'tcp://remote.example.invalid:2376', DOCKER_CONTEXT: 'production' },
    })
    const readPrivate = (filename: string) => existsSync(join(temporary, filename)) ? readFileSync(join(temporary, filename), 'utf8') : ''
    const sqlPath = join(temporary, 'bootstrap-acl.sql')
    return {
      ...result, runner,
      trace: existsSync(trace) ? readFileSync(trace, 'utf8').trim().split('\n') : [],
      sql: readPrivate('bootstrap-acl.sql'), applied: readPrivate('controlled-applied.sql'),
      sqlMode: existsSync(sqlPath) ? statSync(sqlPath).mode & 0o777 : null,
      privateModes: ['restore-catalog-before.json', 'bootstrap-restored-catalog.json', 'bootstrap-catalog.log', 'bootstrap-plan.log', 'bootstrap-authority.log', 'bootstrap-apply.log']
        .filter(filename => existsSync(join(temporary, filename))).map(filename => statSync(join(temporary, filename)).mode & 0o777),
      privateLogs: ['bootstrap-catalog.log', 'bootstrap-plan.log', 'bootstrap-authority.log', 'bootstrap-apply.log'].map(readPrivate).join('\n'),
    }
  } finally { rmSync(runner, { recursive: true, force: true }) }
}

function expectPrivate(result: ReturnType<typeof run>) {
  expect(result.stdout + result.stderr).not.toContain(owner)
  expect(result.stdout + result.stderr).not.toContain(reader)
  expect(result.stdout + result.stderr).not.toContain(privateError)
  expect(result.privateModes.every(mode => mode === 0o600)).toBe(true)
  expect(existsSync(result.runner)).toBe(false)
}

describe('actual disposable restore source-ACL Bootstrap Bash wrapper', () => {
  it('skips OID, administrator and SQL application for an unchanged real generator plan', () => {
    const result = run('unchanged')
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout.trim()).toBe(pass)
    expect(result.trace).toEqual(['capture', 'node:tenantservice-restore-bootstrap-acl.cjs'])
    expect(result.sql).toBe(''); expect(result.applied).toBe(''); expect(result.sqlMode).toBe(0o600)
    expect(result.privateLogs).toContain('objects=0 missingPrivileges=0')
    expectPrivate(result)
  })

  it('uses the actual source-only plan after exact local administrator and same-OID checks', () => {
    const result = run('missing')
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout.trim()).toBe(pass)
    expect(result.trace).toEqual(['capture', 'node:tenantservice-restore-bootstrap-acl.cjs', 'oid', 'admin', 'apply'])
    expect(result.sqlMode).toBe(0o600); expect(result.applied).toBe(result.sql)
    expect(result.sql.startsWith('BEGIN;')).toBe(true); expect(result.sql.endsWith('COMMIT;\n')).toBe(true)
    expect(result.sql).toContain('restore_bootstrap_target_catalog_changed')
    expect(result.sql).toContain(`SET LOCAL ROLE "${owner}";`)
    expect(result.sql).toContain(`GRANT USAGE ON SCHEMA "graphql" TO "${reader}";`)
    expect(result.sql).not.toMatch(/ALTER ROLE|CREATE ROLE|ALTER .*OWNER|REVOKE|DISABLE TRIGGER|NOINHERIT|BYPASSRLS/)
    expect(result.privateLogs).toContain('objects=1 missingPrivileges=1')
    expectPrivate(result)
  })

  it.each(['not-ci', 'external-source', 'external-target', 'nonrandom-target', 'no-runner-temp', 'outside-temp'] as const)('refuses %s before capture, planner or administrator processes', scenario => {
    const result = run(scenario)
    expect(result.status).toBe(2); expect(result.stderr).toContain('TENANTSERVICE_BOOTSTRAP_ACL_LOCAL_BOUNDARY_REQUIRED')
    expect(result.trace).toEqual([]); expect(result.sql).toBe(''); expect(result.applied).toBe('')
    expect(result.stdout).not.toContain(pass); expectPrivate(result)
  })

  it.each([
    ['oid-failure', 'TARGET_OID_FAILED'], ['invalid-oid', 'TARGET_OID_INVALID'],
  ] as const)('refuses %s before the administrator or SQL apply', (scenario, marker) => {
    const result = run(scenario)
    expect(result.status).toBe(1); expect(result.stderr).toContain(`TENANTSERVICE_BOOTSTRAP_ACL_${marker}`)
    expect(result.trace).toEqual(['capture', 'node:tenantservice-restore-bootstrap-acl.cjs', 'oid'])
    expect(result.applied).toBe(''); expect(result.stdout).not.toContain(pass); expectPrivate(result)
  })

  it.each(['wrong-session', 'wrong-current', 'not-superuser', 'wrong-oid'] as const)('refuses %s before passing any generated SQL to the administrator', scenario => {
    const result = run(scenario)
    expect(result.status).toBe(1); expect(result.stderr).toContain('TENANTSERVICE_BOOTSTRAP_ACL_ADMIN_AUTHORITY_MISMATCH')
    expect(result.trace).toEqual(['capture', 'node:tenantservice-restore-bootstrap-acl.cjs', 'oid', 'admin'])
    expect(result.applied).toBe(''); expect(result.stdout).not.toContain(pass); expectPrivate(result)
  })

  it('propagates catalog capture failure with only its stage marker publicly visible', () => {
    const result = run('capture-failure')
    expect(result.status).toBe(1); expect(result.stderr).toContain('TENANTSERVICE_BOOTSTRAP_ACL_TARGET_CAPTURE_FAILED')
    expect(result.trace).toEqual(['capture']); expect(result.privateLogs).toContain(privateError)
    expect(result.sql).toBe(''); expect(result.stdout).not.toContain(pass); expectPrivate(result)
  })

  it('rejects an actual unsupported grant-option plan without administrator use or public role values', () => {
    const result = run('unsupported-plan')
    expect(result.status).toBe(1); expect(result.stderr).toContain('TENANTSERVICE_BOOTSTRAP_ACL_UNSUPPORTED_CATALOG_DIVERGENCE')
    expect(result.trace).toEqual(['capture', 'node:tenantservice-restore-bootstrap-acl.cjs', 'node:tenantservice-restore-catalog-diagnostic.cjs'])
    expect(result.privateLogs).toContain('TENANTSERVICE_RESTORE_BOOTSTRAP_ACL_UNSUPPORTED')
    expect(result.stdout).toContain('TENANTSERVICE_RESTORE_CATALOG_DIFFERENCES count=1 shown=1')
    expect(result.sql).toBe(''); expect(result.applied).toBe(''); expect(result.stdout).not.toContain(pass); expectPrivate(result)
  })

  it('propagates administrator connection failure without applying SQL or exposing private errors', () => {
    const result = run('admin-failure')
    expect(result.status).toBe(1); expect(result.stderr).toContain('TENANTSERVICE_BOOTSTRAP_ACL_ADMIN_CONNECTION_FAILED')
    expect(result.trace).toEqual(['capture', 'node:tenantservice-restore-bootstrap-acl.cjs', 'oid', 'admin'])
    expect(result.privateLogs).toContain(privateError); expect(result.applied).toBe('')
    expect(result.stdout).not.toContain(pass); expectPrivate(result)
  })

  it('propagates SQL consumer failure after authority checks and never emits reconciliation PASS', () => {
    const result = run('apply-failure')
    expect(result.status).toBe(1); expect(result.stderr).toContain('TENANTSERVICE_BOOTSTRAP_ACL_REPLAY_FAILED')
    expect(result.trace).toEqual(['capture', 'node:tenantservice-restore-bootstrap-acl.cjs', 'oid', 'admin', 'apply'])
    expect(result.applied).toBe(result.sql); expect(result.privateLogs).toContain(privateError)
    expect(result.stdout).not.toContain(pass); expectPrivate(result)
  })

  it.each(['bootstrap-catalog.log', 'bootstrap-plan.log', 'bootstrap-authority.log', 'bootstrap-apply.log'])('actual failure cleanup suppresses complete private %s error details', filename => {
    const temporary = mkdtempSync(join(tmpdir(), 'tenantservice-bootstrap-sanitizer.'))
    try {
      writeFileSync(join(temporary, filename), `ERROR: role "${owner}" cannot GRANT USAGE TO "${reader}"; SELECT private_column FROM auth.users; PRIVATE_AUTH_ROW_CANARY person@example.invalid postgresql://user:private-password@example.invalid/database sb_secret_PRIVATE_KEY_CANARY eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJwcml2YXRlIn0.cHJpdmF0ZQ\nDETAIL: PRIVATE_ACL_SQL_CANARY\n`, { mode: 0o600 })
      const result = spawnSync('bash', ['-c', `
set -euo pipefail
TENANTSERVICE_TEMP="$1"
${sanitizer}
${cleanup}
tenantservice_private_cleanup 1
`, 'bootstrap-sanitizer-test', temporary], { encoding: 'utf8', timeout: 5_000 })
      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout).toBe('')
      expect(result.stderr.trim()).toBe(`TENANTSERVICE_PROOF_FIRST_ERROR ${filename}: private bootstrap stage failed; catalog and role details suppressed`)
      expect(result.stderr).not.toMatch(/PRIVATE_|GRANT|SELECT|auth\.users|person@|postgresql:\/\/|sb_secret_|eyJhbGci/)
      expect(existsSync(temporary)).toBe(false)
    } finally { rmSync(temporary, { recursive: true, force: true }) }
  })
})
