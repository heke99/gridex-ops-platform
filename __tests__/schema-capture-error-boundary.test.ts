import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync,rmSync,symlinkSync,statSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {spawn} from 'node:child_process'
import {describe,expect,it} from 'vitest'

// Execute the actual cleanup and diagnostic blocks against isolated shell
// fixtures. No Supabase, Docker, credentials or database profile is started.
const root=resolve(__dirname,'..')
const owner=readFileSync(join(root,'scripts/gridex-aud-003-clean-replay.sh'),'utf8')
const workflow=readFileSync(join(root,'.github/workflows/staff-api-schema-capture.yml'),'utf8')
const cleanup=owner.match(/cleanup\(\)\{[\s\S]*?\ntrap cleanup EXIT/)![0]
const invocation=workflow.includes('# BEGIN fixed capture failure boundary') ? workflow.split('# BEGIN fixed capture failure boundary\n')[1].split('          # END fixed capture failure boundary')[0].split('\n').map(line=>line.trimStart()).join('\n') : workflow.split('\n').find(line=>line.includes('source scripts/gridex-aud-003-clean-replay.sh >'))!.trim()
const diagnostic=workflow.split("python3 - <<'PY_CAPTURE_DIAGNOSTIC'\n")[1].split('          PY_CAPTURE_DIAGNOSTIC')[0].split('\n').map(line=>line.slice(10)).join('\n')
const syntheticSecret='SYNTHETIC_SECRET_NOT_FOR_PUBLIC_OUTPUT'

function runLocal(command:string,args:string[],options:{cwd?:string;env?:NodeJS.ProcessEnv}={}){
 return new Promise<{status:number|null;stdout:string;stderr:string}>((resolve,reject)=>{
  const child=spawn(command,args,{...options,stdio:['ignore','pipe','pipe']});let stdout='',stderr=''
  const timeout=setTimeout(()=>child.kill('SIGKILL'),3000)
  child.stdout.on('data',chunk=>{stdout+=chunk});child.stderr.on('data',chunk=>{stderr+=chunk})
  child.on('error',error=>{clearTimeout(timeout);reject(error)})
  child.on('close',status=>{clearTimeout(timeout);resolve({status,stdout,stderr})})
 })
}

async function exercise(trigger:string,obstruction?:'symlink'|'fifo'|'existing'){
 const dir=mkdtempSync(join(tmpdir(),'gridex-capture-boundary-test-'))
 try {
  mkdirSync(join(dir,'scripts'));mkdirSync(join(dir,'runtime'))
  const meta=join(dir,'runtime/staff-schema-capture-error-boundary.json'),victim=join(dir,'preserved.txt')
  writeFileSync(victim,'PRESERVE-'+syntheticSecret)
  if(obstruction==='symlink')symlinkSync(victim,meta)
  if(obstruction==='fifo')expect((await runLocal('mkfifo',[meta])).status).toBe(0)
  if(obstruction==='existing')writeFileSync(meta,'PRESERVE-'+syntheticSecret)
  const fixture=`set -euo pipefail
ROOT="$PWD"
EXTERNAL_DB=""; LOCAL_STACK_START_ATTEMPTED=0; SOURCE_RESTORE_REQUIRED=0; REPLAY_PG_VERSION_PINNED=""
HOLD="$ROOT/hold"; LEDGER_MARKERS="$ROOT/markers"; SEED_BACKUP="$ROOT/seed-backup"; FOUNDATION_EXEC="$ROOT/foundation"; TIMESTAMP_EXEC="$ROOT/timestamp"
rm(){ command rm "$@"; printf done > "$ROOT/cleanup-ran"; }
${cleanup}
printf '%s\\n' '${syntheticSecret}' >&2
${trigger}
`
  writeFileSync(join(dir,'scripts/gridex-aud-003-clean-replay.sh'),fixture)
  writeFileSync(join(dir,'wrapper.sh'),`set -euo pipefail\nexport RUNNER_TEMP="$PWD/runtime"\n${invocation}\ntest ! -e "$PWD/cleanup-ran"\nprintf yes > "$PWD/after-source"\n`)
  const run=await runLocal('bash',['--noprofile','--norc',join(dir,'wrapper.sh')],{cwd:dir})
  expect(existsSync(join(dir,'cleanup-ran'))).toBe(true)
  expect(run.stdout+run.stderr).not.toContain(syntheticSecret)
  const report=await runLocal('python3',['-c',diagnostic],{cwd:dir,env:{...process.env,RUNNER_TEMP:join(dir,'runtime')}})
  expect(report.status).toBe(0);expect(report.stdout+report.stderr).not.toContain(syntheticSecret)
  const result={exit:run.status,after:existsSync(join(dir,'after-source')),report:JSON.parse(report.stdout) as {exit_code:number|string;source:string;source_line:number},
   metadata:!obstruction&&existsSync(meta)?JSON.parse(readFileSync(meta,'utf8')) as {exit_code:number;source:string;source_line:number}:null,
   mode:!obstruction&&existsSync(meta)?statSync(meta).mode&0o777:null,victim:readFileSync(victim,'utf8'),existing:obstruction==='existing'?readFileSync(meta,'utf8'):null}
  return result
 } finally {rmSync(dir,{recursive:true,force:true})}
}

describe('existing capture replay failure boundary',()=>{
 it.each([['exit 7',7],['false',1],['false | true',1],['nested(){ return 11; }; nested',11]])('preserves %s status, owner cleanup and bounded failure location', async(trigger,code)=>{
  const result=await exercise(String(trigger))
  expect(result.exit).toBe(code);expect(result.after).toBe(false)
  expect(result.metadata).toMatchObject({exit_code:code,source:'scripts/gridex-aud-003-clean-replay.sh'})
  expect(result.metadata!.source_line).toBeGreaterThan(0);expect(result.mode).toBe(0o600)
  expect(result.report).toMatchObject(result.metadata!)
 })
 it('keeps the owner cleanup deferred until successful capture continuation finishes',async()=>{
  const result=await exercise('true');expect(result.exit).toBe(0);expect(result.after).toBe(true);expect(result.metadata).toBeNull()
 })
 it.each(['symlink','fifo','existing'] as const)('never blocks cleanup or overwrites a preexisting %s metadata target',async kind=>{
  const result=await exercise('exit 9',kind);expect(result.exit).toBe(9);expect(result.after).toBe(false)
  expect(result.victim).toBe('PRESERVE-'+syntheticSecret)
  if(kind==='existing')expect(result.existing).toBe('PRESERVE-'+syntheticSecret)
  expect(result.report.exit_code).toBe('unavailable')
 })
})
