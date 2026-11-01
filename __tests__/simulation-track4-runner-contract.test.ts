import { afterEach, describe, expect, it } from 'vitest'
import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// Actual runner subprocesses, private noop fixtures and denied network only.
// No application, DB, Docker, Supabase, native suite or business qualification.
const runner = resolve('scripts/simulation/track4/runner/run-scenarios.mjs')
const homes: string[] = []
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }) })

type Step = { id: string; scenarioId?: string; fixture?: boolean; needs?: string[]; todo?: string; fail?: boolean }
function control(steps: Step[] = [{ id: 'FX', fixture: true }, { id: 'MAIN05.03' }]) {
  const home = mkdtempSync(join(tmpdir(), 't4-runner-contract-'))
  homes.push(home)
  chmodSync(home, 0o700)
  const bin = join(home, 'bin'); mkdirSync(bin, { mode: 0o700 })
  const tools = join(home, 'tools.log'); const effects = join(home, 'effects.log')
  for (const tool of ['docker', 'psql']) {
    const file = join(bin, tool)
    writeFileSync(file, '#!/bin/sh\n/bin/printf "%s\\n" "' + tool + ' $*" >> "$CONTROL_TOOLS"\nexit ' + (tool === 'docker' ? '0' : '99') + '\n', { mode: 0o700 })
  }
  const deny = join(home, 'deny-network.cjs')
  writeFileSync(deny, "process.umask(0o022);globalThis.fetch=()=>{throw Error('network forbidden')};for(const n of ['node:net','node:http','node:https']){const m=require(n);for(const k of ['connect','createConnection','request','get'])if(k in m)m[k]=()=>{throw Error('network forbidden')}}")
  writeFileSync(join(home, 'env'), 'T4_DB_URL=postgresql://postgres:synthetic@127.0.0.1:1/postgres\nT4_APP_URL=http://127.0.0.1:1\nNEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:1\nT4_PROJECT_ID=synthetic-contract-only\n')
  const scenario = join(home, 'scenario.mjs')
  const source = steps.map(({ fail, ...step }) => '{...' + JSON.stringify(step) + ',title:' + JSON.stringify(step.id) + ',async run(){appendFileSync(process.env.CONTROL_EFFECTS,' + JSON.stringify(step.id + '\n') + ');' + (fail ? "throw Error('controlled required step failure')" : '') + '}}').join(',')
  writeFileSync(scenario, "import {appendFileSync} from 'node:fs';export const scenarios=[{id:'CONTROLLED',title:'synthetic source contract only',steps:[" + source + ']}]')
  const out = join(home, 'out'); const report = join(home, 'merged.json')
  const env = { NODE_ENV: 'test' as const, PATH: bin + ':/usr/bin:/bin', T4_SIM_HOME: home, CONTROL_TOOLS: tools, CONTROL_EFFECTS: effects, NODE_OPTIONS: '--require=' + deny }
  const argv = (only: string, overrides: { out?: string; report?: string; args?: string[]; scenario?: string }) =>
    [runner, '--scenario', overrides.scenario ?? scenario, '--out', overrides.out ?? out, '--report', overrides.report ?? report, ...(only ? ['--only', only] : []), ...(overrides.args ?? [])]
  const run = (only = 'MAIN05.03', overrides: { out?: string; report?: string; args?: string[]; scenario?: string } = {}) => {
    const result = spawnSync(process.execPath, argv(only, overrides), {
      env,
      timeout: 5_000, encoding: 'utf8',
    })
    expect(result.error).toBeUndefined()
    return result
  }
  const executed = () => existsSync(effects) ? readFileSync(effects, 'utf8').trim().split('\n') : []
  const data = () => JSON.parse(readFileSync(report, 'utf8'))
  const untouched = () => { expect(executed()).toEqual([]); expect(existsSync(tools)).toBe(false) }
  const start = () => spawn(process.execPath, argv('MAIN05.03', {}), { env, stdio: 'ignore' })
  const wrapper = (mode = 'plain', outside = '') => {
    writeFileSync(join(home, 'env'), readFileSync(join(home, 'env'), 'utf8').replace('NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:1', 'NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321'))
    mkdirSync(join(home, 'logs'), { recursive: true }); writeFileSync(join(home, 'logs/sink-requests.jsonl'), '')
    // Only the wrapper's exact readiness query, fake health and DB-log calls
    // are permitted. The actual common.sh, pipeline and runner execute.
    for (const tool of ['psql', 'curl', 'docker']) {
      writeFileSync(join(bin, tool), "#!/usr/bin/python3\nimport json,os,pathlib,sys\nname=pathlib.Path(sys.argv[0]).name\nwith open(os.environ['CONTROL_TOOLS'],'a')as f:f.write(json.dumps({'tool':name,'argv':sys.argv[1:]})+'\\n')\nif name=='psql' and sys.argv[-1]==\"select to_regclass('public.companies') is not null\":print('t');sys.exit(0)\nif name=='curl' and sys.argv[-1]=='http://127.0.0.1:1/login':print('200',end='');sys.exit(0)\nif name=='docker' and sys.argv[1]=='logs':sys.exit(0)\nsys.exit(99)\n", { mode: 0o700 })
    }
    // Explicit private fault injection before re-exec of the pinned real Node.
    writeFileSync(join(bin, 'node'), '#!/usr/bin/python3\nimport os,pathlib,sys\np=pathlib.Path(sys.argv[sys.argv.index("--out")+1])\npathlib.Path(os.environ["CONTROL_WRAPPER_OUT"]).write_text(str(p))\nmode=os.environ["CONTROL_INJECT"]\nif mode=="stale":p.mkdir(exist_ok=True);(p/"prior.txt").write_text("PRIOR_REPORT_DIRECTORY")\nif mode=="symlink":p.symlink_to(os.environ["CONTROL_OUTSIDE"])\nos.execv(os.environ["CONTROL_NODE"],[os.environ["CONTROL_NODE"],*sys.argv[1:]])\n', { mode: 0o700 })
    const capture = join(home, 'wrapper-out')
    let bashEnv = ''
    if (mode === 'stale-run' || mode === 'metadata-alias') {
      // Metadata-only shell clock stub: expose a deterministic wrapper directory
      // before its allocation. No Auth/business clock or system clock is changed.
      bashEnv = join(home, 'wrapper-clock.sh')
      let body = 'date(){ if [ "$*" = "-u +%Y%m%dT%H%M%SZ" ]; then printf "20000101T000000Z\\n"; else /usr/bin/date "$@"; fi; }\nCONTROL_ROOT="$SIM_HOME/runs/20000101T000000Z-$$"\nprintf "%s" "$CONTROL_ROOT" > "$SIM_HOME/controlled-run-root"\n'
      if (mode === 'stale-run') body += 'mkdir -p "$CONTROL_ROOT"; printf "PRIOR_WRAPPER_LOG" > "$CONTROL_ROOT/run.log"\n'
      else body += 'export SIM_REPORT="$CONTROL_ROOT/run.json"\n'
      writeFileSync(bashEnv, body)
    }
    const result = spawnSync('/bin/bash', [resolve('scripts/simulation/track4/run.sh'), scenario, '--only', 'MAIN05.03'], {
      env: { ...env, HOME: home, SIM_HOME: home, SIM_REPORT: report, ...(bashEnv ? { BASH_ENV: bashEnv } : {}), CONTROL_INJECT: mode, CONTROL_NODE: process.execPath, CONTROL_OUTSIDE: outside, CONTROL_WRAPPER_OUT: capture },
      timeout: 5_000, encoding: 'utf8',
    })
    expect(result.error).toBeUndefined()
    return { ...result, runnerOut: existsSync(capture) ? readFileSync(capture, 'utf8') : null }
  }
  return { home, out, report, scenario, run, start, wrapper, executed, data, untouched }
}

describe('T4 actual runner canonical selection', () => {
  it.each(['UNKNOWN01.01', 'BILLNEG01.05', 'MAIN05.03,MAIN05.03', '', 'MAIN05.03,', 'MAIN05.05b'])('refuses invalid or missing requested selection before effects: %j', only => {
    const c = control()
    const p = c.run(only, only === '' ? { args: ['--only', ''] } : {})
    expect(p.status).not.toBe(0)
    c.untouched()
  })

  it('selects every declared child of a canonical parent, including a failing required child', () => {
    const c = control([{ id: 'FX', fixture: true }, { id: 'MAIN05.05' }, { id: 'MAIN05.05b', scenarioId: 'MAIN05.05', fail: true }])
    expect(c.run('MAIN05.05').status).toBe(1)
    expect(c.executed()).toEqual(['FX', 'MAIN05.05', 'MAIN05.05b'])
    expect(c.data().steps.find((s: Step) => s.id === 'MAIN05.05b').status).toBe('failed')
  })

  it('resolves a canonical parent represented only by substeps and retains TODO as unmet', () => {
    const c = control([{ id: 'FX', fixture: true }, { id: 'BILLNEG01.04a', scenarioId: 'BILLNEG01.04' }, { id: 'BILLNEG01.04b', scenarioId: 'BILLNEG01.04', todo: 'qualified new E66 not implemented' }])
    c.run('BILLNEG01.04')
    expect(c.executed()).toEqual(['FX', 'BILLNEG01.04a'])
    const pending = c.data().steps.find((s: Step) => s.id === 'BILLNEG01.04b')
    expect(pending.status).toBe('skipped')
    expect(pending.reason).toMatch(/^TODO:/)
  })

  it('selects recursive dependencies, preserving the declared execution order', () => {
    const c = control([{ id: 'FX', fixture: true }, { id: 'MAIN04.02', needs: ['FX'] }, { id: 'MAIN04.05', needs: ['MAIN04.02'] }, { id: 'MAIN05.01', needs: ['MAIN04.05'] }, { id: 'MAIN05.03', needs: ['MAIN05.01'] }])
    expect(c.run().status).toBe(0)
    expect(c.executed()).toEqual(['FX', 'MAIN04.02', 'MAIN04.05', 'MAIN05.01', 'MAIN05.03'])
  })

  it('rejects an unfiltered fixture-only file before fixture effects', () => {
    const c = control([{ id: 'FX', fixture: true }])
    expect(c.run('').status).not.toBe(0)
    c.untouched()
  })

  it.each(([
    [{ id: 'FX', fixture: true }, { id: 'MAIN05.03', needs: ['MISSING'] }],
    [{ id: 'FX', fixture: true }, { id: 'MAIN05.03' }, { id: 'MAIN05.03' }],
    [{ id: 'FX', fixture: true }, { id: 'MAIN05.01', needs: ['MAIN05.03'] }, { id: 'MAIN05.03', needs: ['MAIN05.01'] }],
    [{ id: 'FX', fixture: true }, { id: 'MAIN05.03', needs: ['MAIN05.03'] }],
    [{ id: 'FX', fixture: true }, { id: 'MAIN05.05' }, { id: 'MAIN05.05z', scenarioId: 'MAIN05.05' }],
  ] satisfies Step[][]).map(steps => [steps] as const))('refuses invalid graph before fixture effects (%#)', steps => {
    const c = control(steps)
    expect(c.run().status).not.toBe(0)
    c.untouched()
  })
})

describe('T4 actual whole wrapper/common/tee/runner integration', () => {
  it('keeps wrapper log/run metadata outside the fresh runner report directory', () => {
    const c = control(); const p = c.wrapper()
    expect(p.status).toBe(0)
    expect(c.executed()).toEqual(['FX', 'MAIN05.03'])
    const runRoot = join(c.home, 'runs', readdirSync(join(c.home, 'runs'))[0])
    expect(p.runnerOut).toBe(join(runRoot, 'reports'))
    expect(readdirSync(runRoot).sort()).toEqual(['reports', 'run.json', 'run.log'])
    expect(readdirSync(join(runRoot, 'reports')).sort()).toEqual(['report-CONTROLLED.json', 'summary.json'])
    expect(lstatSync(runRoot).mode & 0o077).toBe(0)
    expect(JSON.parse(readFileSync(join(runRoot, 'run.json'), 'utf8')).exitCode).toBe(0)
    expect(c.data().summary.failed).toBe(0)
  })

  it('preserves prior merged evidence when the actual wrapper invokes the runner', () => {
    const c = control(); writeFileSync(c.report, 'PRIOR_WRAPPER_REPORT')
    expect(c.wrapper().status).not.toBe(0)
    expect(c.executed()).toEqual([])
    expect(readFileSync(c.report, 'utf8')).toBe('PRIOR_WRAPPER_REPORT')
  })

  it('refuses a stale reports directory injected before actual Node starts', () => {
    const c = control(); const p = c.wrapper('stale')
    expect(p.status).not.toBe(0)
    expect(c.executed()).toEqual([])
    expect(p.runnerOut).not.toBeNull()
    expect(readFileSync(join(p.runnerOut!, 'prior.txt'), 'utf8')).toBe('PRIOR_REPORT_DIRECTORY')
    expect(p.stdout).toContain('run output directory must be empty')
  })

  it('refuses a symlink reports directory without writing through it', () => {
    const c = control(); const foreign = mkdtempSync(join(tmpdir(), 't4-wrapper-report-link-')); homes.push(foreign)
    const canary = join(foreign, 'prior.txt'); writeFileSync(canary, 'PRIOR_CANARY')
    const p = c.wrapper('symlink', foreign)
    expect(p.status).not.toBe(0)
    expect(c.executed()).toEqual([])
    expect(p.stdout).toMatch(/ENOTDIR|ELOOP/)
    expect(readFileSync(canary, 'utf8')).toBe('PRIOR_CANARY')
    expect(readdirSync(foreign)).toEqual(['prior.txt'])
  })

  it('refuses a symlink run parent before creating wrapper logs outside the home', () => {
    const c = control(); const foreign = mkdtempSync(join(tmpdir(), 't4-wrapper-runs-link-')); homes.push(foreign)
    const canary = join(foreign, 'prior.txt'); writeFileSync(canary, 'PRIOR_CANARY')
    symlinkSync(foreign, join(c.home, 'runs'))
    expect(c.wrapper().status).not.toBe(0)
    expect(c.executed()).toEqual([])
    expect(readFileSync(canary, 'utf8')).toBe('PRIOR_CANARY')
    expect(readdirSync(foreign)).toEqual(['prior.txt'])
  })

  it('preserves a pre-existing wrapper run directory and its log before tee starts', () => {
    const c = control(); const p = c.wrapper('stale-run')
    expect(p.status).not.toBe(0)
    expect(p.runnerOut).toBeNull()
    expect(p.stderr).toContain('FileExistsError')
    expect(c.executed()).toEqual([])
    const runRoot = readFileSync(join(c.home, 'controlled-run-root'), 'utf8')
    expect(readFileSync(join(runRoot, 'run.log'), 'utf8')).toBe('PRIOR_WRAPPER_LOG')
  })

  it('refuses a merged report alias of the wrapper-owned metadata file', () => {
    const c = control(); const p = c.wrapper('metadata-alias')
    expect(p.status).not.toBe(0)
    // The wrapper creates SIM_REPORT's parent early; this alias is therefore
    // rejected by exclusive run-directory allocation before tee or fixtures.
    expect(p.stderr).toContain('FileExistsError')
    expect(c.executed()).toEqual([])
    const runRoot = readFileSync(join(c.home, 'controlled-run-root'), 'utf8')
    expect(existsSync(join(runRoot, 'run.json'))).toBe(false)
  })
})

describe('T4 actual runner output custody', () => {
  it('publishes complete regular reports with exclusive private temporary files', () => {
    const c = control()
    expect(c.run().status).toBe(0)
    expect(c.data().summary).toEqual({ total: 2, passed: 2, failed: 0, skipped: 0 })
    for (const file of [c.report, join(c.out, 'summary.json'), join(c.out, 'report-CONTROLLED.json')]) {
      expect(lstatSync(file).isFile()).toBe(true)
      expect(lstatSync(file).mode & 0o077).toBe(0)
      expect(() => JSON.parse(readFileSync(file, 'utf8'))).not.toThrow()
    }
    expect(readdirSync(c.out).sort()).toEqual(['report-CONTROLLED.json', 'summary.json'])
  })

  it.each(['merged', 'summary', 'scenario'])('preserves an existing %s report and refuses before workload', kind => {
    const c = control(); mkdirSync(c.out, { mode: 0o700 })
    const file = kind === 'merged' ? c.report : join(c.out, kind === 'summary' ? 'summary.json' : 'report-CONTROLLED.json')
    writeFileSync(file, 'PRIOR_EVIDENCE')
    expect(c.run().status).not.toBe(0)
    expect(readFileSync(file, 'utf8')).toBe('PRIOR_EVIDENCE')
    c.untouched()
  })

  it.each(['merged', 'legacy-temp', 'summary', 'scenario', 'out-directory', 'output-parent'])('refuses the %s symlink without changing its canary', kind => {
    const c = control()
    const foreign = mkdtempSync(join(tmpdir(), 't4-report-canary-')); homes.push(foreign)
    const canary = join(foreign, 'prior.txt'); writeFileSync(canary, 'DO_NOT_TOUCH')
    const out = c.out; let report = c.report
    if (kind === 'merged') symlinkSync(canary, report)
    if (kind === 'legacy-temp') symlinkSync(canary, report + '.tmp')
    if (kind === 'summary' || kind === 'scenario') {
      mkdirSync(out, { mode: 0o700 }); symlinkSync(canary, join(out, kind === 'summary' ? 'summary.json' : 'report-CONTROLLED.json'))
    }
    if (kind === 'out-directory') symlinkSync(foreign, out)
    if (kind === 'output-parent') { const link = join(c.home, 'linked-parent'); symlinkSync(foreign, link); report = join(link, 'new.json') }
    expect(c.run('MAIN05.03', { out, report }).status).not.toBe(0)
    expect(readFileSync(canary, 'utf8')).toBe('DO_NOT_TOUCH')
    expect(readdirSync(foreign)).toEqual(['prior.txt'])
    c.untouched()
  })

  it('refuses an output outside the private home before creating it', () => {
    const c = control(); const outside = mkdtempSync(join(tmpdir(), 't4-report-outside-')); homes.push(outside)
    expect(c.run('MAIN05.03', { report: join(outside, 'new.json') }).status).not.toBe(0)
    expect(readdirSync(outside)).toEqual([])
    c.untouched()
  })

  it('refuses aliasing merged/summary paths before effects', () => {
    const c = control(); mkdirSync(c.out, { mode: 0o700 })
    expect(c.run('MAIN05.03', { report: join(c.out, 'summary.json') }).status).not.toBe(0)
    c.untouched()
  })

  it('preserves an existing reservation and refuses before effects', () => {
    const c = control(); const marker = c.report + '.t4-reserved'
    writeFileSync(marker, 'PRIOR_IN_FLIGHT_INTENT')
    expect(c.run().status).not.toBe(0)
    expect(readFileSync(marker, 'utf8')).toBe('PRIOR_IN_FLIGHT_INTENT')
    c.untouched()
  })

  it('refuses a public home before fixture effects', () => {
    const c = control(); chmodSync(c.home, 0o755)
    expect(c.run().status).not.toBe(0)
    c.untouched()
  })

  it('reserves outputs before effects so a concurrent runner cannot repeat the workload', async () => {
    const c = control(); const release = join(c.home, 'release')
    const wait = 'for(let i=0;i<100&&!existsSync(' + JSON.stringify(release) + ');i++)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20);'
    writeFileSync(c.scenario, readFileSync(c.scenario, 'utf8').replace('appendFileSync}', 'appendFileSync,existsSync}'))
    // Insert after the fixture's first evidence marker, before it returns.
    const needle = JSON.stringify('FX\n') + ');'
    writeFileSync(c.scenario, readFileSync(c.scenario, 'utf8').replace(needle, needle + wait))
    const first = c.start()
    const done = new Promise<number | null>(resolveExit => first.once('exit', resolveExit))
    for (let i = 0; i < 100 && c.executed().length === 0 && first.exitCode === null; i++) await new Promise(resolveWait => setTimeout(resolveWait, 10))
    const second = c.run()
    writeFileSync(release, 'release own synthetic runner')
    const firstExit = await done
    expect(firstExit).toBe(0)
    expect(second.status).not.toBe(0)
    expect(c.executed()).toEqual(['FX', 'MAIN05.03'])
  })

  it('refuses a directory replaced by a symlink during workload without writing through it', () => {
    const c = control(); const parent = join(c.home, 'destination'); mkdirSync(parent, { mode: 0o700 })
    const foreign = mkdtempSync(join(tmpdir(), 't4-swapped-canary-')); homes.push(foreign)
    const report = join(parent, 'merged.json')
    const source = readFileSync(c.scenario, 'utf8').replace('appendFileSync}', 'appendFileSync,renameSync,symlinkSync}')
      .replace('async run(){', 'async run(){renameSync(' + JSON.stringify(parent) + ',' + JSON.stringify(parent + '.saved') + ');symlinkSync(' + JSON.stringify(foreign) + ',' + JSON.stringify(parent) + ');')
    writeFileSync(c.scenario, source)
    expect(c.run('MAIN05.03', { report }).status).not.toBe(0)
    expect(readdirSync(foreign)).toEqual([])
  })

  it('preserves a destination created during workload and exits nonzero instead of replacing it', () => {
    const c = control()
    appendFileSync(c.scenario, '\n')
    const source = readFileSync(c.scenario, 'utf8').replace('async run(){', "async run(){writeFileSync(process.env.CONTROL_COLLISION,'CONCURRENT_ORIGINAL');")
      .replace("import {appendFileSync}", "import {appendFileSync,writeFileSync}")
    writeFileSync(c.scenario, source)
    // Only this synthetic fixture writes a competing original. No services run.
    // control() sanitizes the environment; bake a public synthetic path into the source.
    writeFileSync(c.scenario, readFileSync(c.scenario, 'utf8').replace('process.env.CONTROL_COLLISION', JSON.stringify(c.report)))
    expect(c.run().status).not.toBe(0)
    expect(readFileSync(c.report, 'utf8')).toBe('CONCURRENT_ORIGINAL')
  })
})
