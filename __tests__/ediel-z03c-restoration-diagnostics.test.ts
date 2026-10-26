import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

// Only extract and execute these two ordinary-clock diagnostic functions.
// Never execute the controller, sudo, watchdog, date setter, or a network call.
const harness = String.raw`
import ast, contextlib, io, json, math, pathlib, re, subprocess, sys, textwrap, types, urllib.error
case=json.loads(sys.argv[1])
source=pathlib.Path('.github/workflows/ediel-z03c-supplier-boundary-native.yml').read_text()
lines=source.splitlines();begin=next(i for i,line in enumerate(lines) if 'cat > "$RUNNER_TEMP/z03c-owned-clock-controller.py"' in line)+1
end=next(i for i in range(begin,len(lines)) if lines[i].strip()=='PY')
tree=ast.parse(textwrap.dedent('\n'.join(lines[begin:end])))
names={'qualified_normal_clock','emit_restoration_failure_summary','safe_error'}
definitions=[node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name in names]
if {node.name for node in definitions}!=names:raise RuntimeError('diagnostic_function_missing')
clock=types.SimpleNamespace(monotonic=lambda:101.0,time=lambda:case.get('now',1001.0))
namespace={'math':math,'time':clock,'sys':sys,'json':json,'subprocess':subprocess,'urllib':__import__('urllib'),'re':re,'contextlib':contextlib}
exec(compile(ast.Module(body=definitions,type_ignores=[]),'<extracted-diagnostics>','exec'),namespace)
state={'original_realtime_ms':1000000.0,'original_monotonic_s':100.0}
kind=case.get('kind','runtime');message=case.get('message','private synthetic detail')
if kind=='http':error=urllib.error.HTTPError('https://private.invalid/?secret=synthetic',case.get('status',503),message,{},None)
elif kind=='process':error=subprocess.CalledProcessError(case.get('exit',1),['secret-command'],output='synthetic private output',stderr='synthetic private stderr')
elif kind=='unknown':error=type('SyntheticPrivateProviderError',(Exception,),{})(message)
else:error=RuntimeError(message)
output=io.StringIO();thrown=None
with contextlib.redirect_stderr(output):
 try:
  if case.get('controllerCase'):
   final=next(node for node in reversed(tree.body) if isinstance(node,ast.Try) and node.finalbody).finalbody
   guard=next(node for node in final if isinstance(node,ast.If) and ast.unparse(node.test)=='state_path.exists()')
   def fail():raise error
   def restore():return {} if case['controllerCase']=='reference' else fail()
   namespace.update(state_path=types.SimpleNamespace(exists=lambda:True),state=state,working=pathlib.Path('/synthetic-working'),restored_path=pathlib.Path('/synthetic-restored'),save=lambda *args:None,restore=restore,trusted_reference=fail,exit_code=0,restoration_verified=False)
   exec(compile(ast.Module(body=[guard],type_ignores=[]),'<actual-restoration-branch>','exec'),namespace)
  else:namespace['emit_restoration_failure_summary'](state,error,case.get('stage','LOCAL_RESTORE'))
 except Exception as failure:thrown=type(failure).__name__
print(json.dumps({'stderr':output.getvalue(),'thrown':thrown}))
`
function probe(input: Record<string, unknown> = {}) {
  const result = JSON.parse(execFileSync('python3', ['-c', harness, JSON.stringify(input)], { encoding: 'utf8', timeout: 5000 })) as { stderr: string; thrown: string | null }
  return { ...result, summary: result.stderr ? JSON.parse(result.stderr) as Record<string, unknown> : null }
}
describe('Z03C bounded diagnostics after an independently observed normal clock', () => {
  it('reports a failed trusted reference without claiming restoration or leaking a URL/body', () => {
    const result = probe({ kind: 'http', stage: 'TRUSTED_NORMAL_REFERENCE', status: 503, message: 'synthetic private token' })
    expect(result.thrown).toBeNull()
    expect(result.summary).toEqual({ code: 'z03c_restoration_qualification_failed', stage: 'TRUSTED_NORMAL_REFERENCE', normal_clock_observed: true, restoration_verified: false, error: { class: 'HTTPError', code: null, exit_code: null, http_status: 503 } })
    expect(result.stderr).not.toMatch(/private|synthetic|secret|https|token/)
  })
  it('retains the fixed known synchronization error code', () => {
    expect(probe({ message: 'z03c_sync_state_restore_failed' }).summary).toMatchObject({ stage: 'LOCAL_RESTORE', error: { class: 'RuntimeError', code: 'z03c_sync_state_restore_failed' } })
  })
  it('does not copy arbitrary z03c-prefixed exception messages into logs', () => {
    const result = probe({ message: 'z03c_synthetic_private_secret' })
    expect(result.summary).toMatchObject({ error: { class: 'RuntimeError', code: null } })
    expect(result.stderr).not.toContain('synthetic_private_secret')
  })
  it('bounds unknown exception classes and stage text', () => {
    const result = probe({ kind: 'unknown', stage: 'synthetic private stage' })
    expect(result.summary).toMatchObject({ stage: 'UNKNOWN_RESTORATION_STAGE', error: { class: 'OtherError' } })
    expect(result.stderr).not.toContain('SyntheticPrivateProviderError')
    expect(Buffer.byteLength(result.stderr)).toBeLessThan(1024)
  })
  it('does not emit even a bounded summary while the clock remains advanced', () => {
    expect(probe({ now: 1061 })).toMatchObject({ stderr: '', summary: null, thrown: 'RuntimeError' })
  })
  it('refuses a nonfinite clock before emitting anything', () => {
    expect(probe({ now: 'NaN' })).toMatchObject({ stderr: '', summary: null, thrown: 'TypeError' })
  })
  it.each([1, -9, 255])('reports only the bounded actual child exit %s', exit => {
    const result = probe({ kind: 'process', exit })
    expect(result.summary).toMatchObject({ error: { class: 'CalledProcessError', exit_code: exit } })
    expect(result.stderr).not.toMatch(/secret-command|private|synthetic/)
  })
  it.each([true, 999999])('does not coerce or expose an invalid exit code %s', exit => {
    expect(probe({ kind: 'process', exit }).summary).toMatchObject({ error: { exit_code: null } })
  })
  it.each([true, 99, 600])('does not coerce an invalid HTTP status %s', status => {
    expect(probe({ kind: 'http', status }).summary).toMatchObject({ error: { http_status: null } })
  })
  it.each([
    ['reference', 'TRUSTED_NORMAL_REFERENCE'],
    ['restore', 'LOCAL_RESTORE'],
  ])('the actual controller restoration branch diagnoses %s without releasing evidence', (controllerCase, stage) => {
    const result = probe({ controllerCase, kind: 'http' })
    expect(result.thrown).toBeNull()
    expect(result.summary).toMatchObject({ stage, restoration_verified: false })
  })
})
