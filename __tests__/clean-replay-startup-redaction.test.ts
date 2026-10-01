import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve('scripts/gridex-aud-003-clean-replay.sh'), 'utf8')
const startupAnchor = '  echo "local_replay_postgres_image=$REPLAY_POSTGRES_VERSION"\n'
const startupOffset = source.indexOf(startupAnchor) + startupAnchor.length
if (startupOffset < startupAnchor.length) throw new Error('clean_replay_startup_anchor_missing')
const startup = source.slice(startupOffset, source.indexOf('\nelse\n', startupOffset))
const cleanup = source.match(/^cleanup\(\)\{[\s\S]*?^\}/m)?.[0]
if (!cleanup) throw new Error('clean_replay_cleanup_missing')

// Execute the production Bash block and EXIT cleanup. Only the external CLI
// is replaced: Docker startup would require the disposable CI environment.
function runStartup(status: number) {
  const root = mkdtempSync(join(tmpdir(), 'gridex-startup-test-'))
  const runnerTemp = join(root, 'runner temp'), bin = join(root, 'bin'), observation = join(root, 'observed')
  for (const name of [runnerTemp, bin, observation, join(root, 'migrations'), join(root, 'hold'), join(root, 'markers')]) mkdirSync(name)
  writeFileSync(join(root, 'seed-backup'), 'synthetic seed\n')
  writeFileSync(join(root, 'hold', 'preserved.sql'), 'select 1;\n')
  writeFileSync(join(bin, 'supabase'), `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == start ]]; then
  captures=("$RUNNER_TEMP"/gridex-replay-start.*)
  target="\${captures[0]}"
  printf '%s' "$target" > "$START_OBSERVATION/capture-path"
  if [[ -f "$target" ]]; then stat -c %a "$target" > "$START_OBSERVATION/capture-mode"; fi
  printf '%s\\n' sb_publishable_synthetic_startup_fixture
  printf '%s\\n' sb_secret_synthetic_startup_fixture >&2
  if [[ -f "$target" ]] && [[ "$(wc -l < "$target")" == 2 ]]; then
    printf present > "$START_OBSERVATION/private-raw-present"
  fi
  exit "$START_STATUS"
fi
if [[ "$1" == stop ]]; then printf stopped > "$START_OBSERVATION/stop"; exit 0; fi
exit 90
`, { mode: 0o700 })
  const vars = {
    HOLD: join(root, 'hold'), LEDGER_MARKERS: join(root, 'markers'), SEED_BACKUP: join(root, 'seed-backup'),
    FOUNDATION_EXEC: join(root, 'foundation'), TIMESTAMP_EXEC: join(root, 'timestamps'),
    MIGRATIONS: join(root, 'migrations'), SEED: join(root, 'seed'),
  }
  const assignments = Object.entries(vars).map(([key, value]) => `${key}='${value.replaceAll("'", "'\\''")}'`).join('\n')
  try {
    const result = spawnSync('bash', ['-c', `set -euo pipefail
${assignments}
EXTERNAL_DB=''
REPLAY_PG_VERSION_PINNED=''
REPLAY_START_LOG=''
${cleanup}
trap cleanup EXIT
${startup}
printf START_CONTINUED
`], {
      encoding: 'utf8', timeout: 5000,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: runnerTemp, START_STATUS: String(status), START_OBSERVATION: observation },
    })
    if (!existsSync(join(observation, 'capture-path'))) throw new Error(`startup_harness_failed status=${result.status}`)
    const captured = readFileSync(join(observation, 'capture-path'), 'utf8')
    return {
      status: result.status, continued: result.stdout.includes('START_CONTINUED'),
      safeOutput: !/sb_(?:secret|publishable)_|synthetic_startup_fixture/.test(result.stdout + result.stderr),
      pathHidden: !(result.stdout + result.stderr).includes(runnerTemp),
      privateCapture: dirname(captured) === runnerTemp && existsSync(join(observation, 'private-raw-present')),
      privateMode: existsSync(join(observation, 'capture-mode')) ? readFileSync(join(observation, 'capture-mode'), 'utf8').trim() : null,
      captureRemoved: !existsSync(captured) && readdirSync(runnerTemp).length === 0,
      stopCalled: existsSync(join(observation, 'stop')),
      preservedInputs: readFileSync(join(root, 'migrations', 'preserved.sql'), 'utf8') === 'select 1;\n'
        && readFileSync(join(root, 'seed'), 'utf8') === 'synthetic seed\n',
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
}

describe('clean replay startup credential capture', () => {
  it('keeps successful CLI output private while preserving stack and replay cleanup', () => {
    const result = runStartup(0)
    expect(result.status).toBe(0)
    expect(result.continued).toBe(true)
    expect(result.safeOutput).toBe(true)
    expect(result.pathHidden).toBe(true)
    expect(result.privateCapture).toBe(true)
    expect(result.privateMode).toBe('600')
    expect(result.captureRemoved).toBe(true)
    expect(result.stopCalled).toBe(true)
    expect(result.preservedInputs).toBe(true)
  })

  it('keeps failed CLI output private and retains its original exit status', () => {
    const result = runStartup(37)
    expect(result.status).toBe(37)
    expect(result.continued).toBe(false)
    expect(result.safeOutput).toBe(true)
    expect(result.pathHidden).toBe(true)
    expect(result.privateCapture).toBe(true)
    expect(result.privateMode).toBe('600')
    expect(result.captureRemoved).toBe(true)
    expect(result.stopCalled).toBe(true)
    expect(result.preservedInputs).toBe(true)
  })
})
