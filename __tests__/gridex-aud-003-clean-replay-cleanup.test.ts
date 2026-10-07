/** Real shell/provenance and disposable files; external stack/SQL commands are
 * confined stand-ins. No Docker, database or network is invoked. */
import {afterEach,expect,it} from 'vitest'
import {chmodSync,copyFileSync,existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,statSync,symlinkSync,writeFileSync} from 'node:fs'
import {execFileSync,spawnSync} from 'node:child_process'
import {join,dirname,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {createHash} from 'node:crypto'

const repo=resolve(__dirname,'..'),script='scripts/gridex-aud-003-clean-replay.sh'
const temps:string[]=[]
const python=execFileSync('/bin/sh',['-c','command -v python3'],{encoding:'utf8'}).trim()
const inputs=[
 script,'scripts/gridex-aud-003-schema-fingerprint.sql','scripts/gridex-aud-003-foundation-order.json',
 'scripts/gridex-aud-003-noncanonical-artifacts.json','scripts/gridex-aud-003-main-ledger.json',
 'scripts/migration-history-manifest.json','scripts/migration-history-manifest.additions.json',
 'scripts/migration-history-manifest.runtime.additions.json','scripts/gridex-aud-003-legacy-foundation.json',
 'scripts/gridex-aud-003-legacy-foundation.additions.json',
 'supabase/bootstrap/20260824_powers_of_attorney_legal_bundle_version_document_prerequisite.sql',
 'supabase/bootstrap/20260902_inbound_email_dedupe_replay_prerequisite.sql',
 'supabase/bootstrap/20260902_inbound_ediel_pipeline_replay_prerequisite.sql',
 'supabase/bootstrap/20260902_grid_owner_name_key_replay_prerequisite.sql',
 'supabase/bootstrap/20260902_white_label_admin_membership_hygiene_replay_shim.sql',
]
const quote=(v:string)=>"'" + v.replaceAll("'","'\\''") + "'"
function copy(root:string,relative:string){const target=join(root,relative);mkdirSync(dirname(target),{recursive:true});copyFileSync(join(repo,relative),target)}
function executable(path:string,body:string){writeFileSync(path,'#!/bin/bash\nset -eu\n'+body);chmodSync(path,0o755)}
function fixture(full=false){
 const root=mkdtempSync(join(tmpdir(),'gridex-replay-cleanup-'));temps.push(root)
 for(const input of inputs)copy(root,input)
 if(full){
  const tracked=execFileSync('git',['ls-files','-z','--','supabase'],{cwd:repo,encoding:'utf8'}).split('\0').filter(Boolean)
  for(const path of tracked)if(path.startsWith('supabase/migrations/')||path.startsWith('supabase/bootstrap/')||path==='supabase/config.toml')copy(root,path)
 }
 const migrations=join(root,'supabase/migrations');mkdirSync(migrations,{recursive:true})
 if(!full){writeFileSync(join(migrations,'001.sql'),'-- ORIGINAL ONE\n');writeFileSync(join(migrations,'002.sql'),'-- ORIGINAL TWO\n');chmodSync(join(migrations,'001.sql'),0o640)}
 writeFileSync(join(migrations,'keep.txt'),'NON-SQL SOURCE MUST SURVIVE\n');chmodSync(join(migrations,'keep.txt'),0o600)
 const seed=join(root,'supabase/seed.sql');writeFileSync(seed,'-- ORIGINAL SEED\nselect 42;\n');chmodSync(seed,0o640)
 const bin=join(root,'bin'),trace=join(root,'trace.txt');mkdirSync(bin)
 for(const name of ['dirname','mktemp','mkdir','rm','mv','sha256sum','awk'])symlinkSync('/usr/bin/'+name,join(bin,name))
 symlinkSync(python,join(bin,'python3'));symlinkSync('/usr/bin/cp',join(bin,'cp'))
 executable(join(bin,'supabase'),"printf 'supabase:%s\\n' \"$1\" >> "+quote(trace)+"\nif [[ \"$1\" == start ]]; then exit 71; fi\n")
 executable(join(bin,'psql'),"printf 'psql\\n' >> "+quote(trace)+"\nexit 86\n")
 const run=()=>spawnSync('/bin/bash',[join(root,script)],{cwd:root,encoding:'utf8',timeout:30_000,env:{...process.env,PATH:bin,GRIDEX_REPLAY_DB_URL:'',TMPDIR:root}})
 const calls=()=>existsSync(trace)?readFileSync(trace,'utf8').trim().split('\n'):[]
 return {root,migrations,seed,bin,trace,run,calls}
}
function snapshot(f:ReturnType<typeof fixture>){
 const files=readdirSync(f.migrations).sort().map(name=>{const p=join(f.migrations,name);return {name,mode:statSync(p).mode&0o777,sha:createHash('sha256').update(readFileSync(p)).digest('hex')}})
 return {files,seed:readFileSync(f.seed).toString('hex'),seedMode:statSync(f.seed).mode&0o777}
}
function preservedFailure(f:ReturnType<typeof fixture>,before:ReturnType<typeof snapshot>){
 const result=f.run();expect(result.error).toBeUndefined();expect(result.status).not.toBe(0);expect(snapshot(f)).toEqual(before);return result
}
afterEach(()=>{for(const root of temps.splice(0))rmSync(root,{recursive:true,force:true})})

it('missing psql preserves every original file and never stops an unstarted stack',()=>{
 const f=fixture(),before=snapshot(f);rmSync(join(f.bin,'psql'))
 preservedFailure(f,before);expect(f.calls()).toEqual([])
})
it.each(['missing provenance','changed bootstrap checksum'] as const)('%s preserves originals without stopping a stack',kind=>{
 const f=fixture(),before=snapshot(f)
 if(kind==='missing provenance')rmSync(join(f.root,'scripts/gridex-aud-003-schema-fingerprint.sql'))
 else writeFileSync(join(f.root,inputs[10]),'-- wrong bootstrap source\n')
 const result=preservedFailure(f,before);expect(result.stderr).toContain(kind==='missing provenance'?'missing replay provenance input':'checksum drift');expect(f.calls()).toEqual([])
})
it.each(['migrations','seed'] as const)('partial %s backup never replaces the original source with an incomplete copy',part=>{
 const f=fixture(),before=snapshot(f);rmSync(join(f.bin,'cp'))
 const source=part==='migrations'?f.migrations+'/.':f.seed
 const partial=part==='migrations'?'/usr/bin/cp '+quote(join(f.migrations,'001.sql'))+' "$last/"':'printf PARTIAL > "$last"'
 executable(join(f.bin,'cp'),'last=""\nfor arg in "$@"; do last="$arg"; done\nfor arg in "$@"; do\n if [[ "$arg" == '+quote(source)+' ]]; then\n '+partial+'\n exit 77\n fi\ndone\nexec /usr/bin/cp "$@"\n')
 preservedFailure(f,before);expect(f.calls()).toEqual([])
})
it('actual provenance failure after staging restores complete backups without stopping an unstarted stack',()=>{
 const f=fixture(),before=snapshot(f);writeFileSync(join(f.root,'scripts/gridex-aud-003-foundation-order.json'),'{"foundation":[]}\n')
 const result=preservedFailure(f,before);expect(result.stderr).toContain('canonical foundation order is empty');expect(f.calls()).toEqual([])
})
it.each(['present','absent'] as const)('a failed local start restores sources and the %s PostgreSQL pin and stops its attempted stack',pinState=>{
 const f=fixture(true),pin=join(f.root,'supabase/.temp/postgres-version');mkdirSync(dirname(pin),{recursive:true})
 if(pinState==='present'){writeFileSync(pin,'ORIGINAL IMAGE PIN\n');chmodSync(pin,0o640)}
 const before=snapshot(f);preservedFailure(f,before)
 expect(f.calls()).toEqual(['supabase:start','supabase:stop'])
 if(pinState==='present'){expect(readFileSync(pin,'utf8')).toBe('ORIGINAL IMAGE PIN\n');expect(statSync(pin).mode&0o777).toBe(0o640)}else expect(existsSync(pin)).toBe(false)
})
it('first SQL failure after successful local start restores originals and stops only that attempted stack',()=>{
 const f=fixture(true),before=snapshot(f)
 executable(join(f.bin,'supabase'),"printf 'supabase:%s\\n' \"$1\" >> "+quote(f.trace)+"\n")
 const result=preservedFailure(f,before);expect(result.status).toBe(86);expect(f.calls()).toEqual(['supabase:start','psql','supabase:stop']);expect(existsSync(join(f.root,'supabase/.temp/postgres-version'))).toBe(false)
})
