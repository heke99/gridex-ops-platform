#!/usr/bin/env python3
"""Temporary unmerged native generation and immutable-blob transport only."""
from pathlib import Path
import base64
import datetime as dt
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys

BASE='c6e624e23b7894568b0435919d3abc3cd9659c3c'
REPO='heke99/gridex-ops-platform'
BRANCH='codex/ediel-pr369-native-preparation-20260922'
OUT=Path('pr369-generation')
UPGRADE='scripts/ediel-received-context-upgrade-regression.py'
TEMP={'.github/workflows/pr369-native-preparation.yml','scripts/pr369-native-preparation.py','.github/pr369-inputs/production.patch','.github/pr369-inputs/migration.sql'}
EXPECTED={
 'lib/inbound-mail/inboundStatusUpdater.ts':'35993c8cc013bef5757e283dcd564caf1c016858',
 'lib/ediel/utilts/receivedStructuralSources.ts':'ab36573447ed63489a34c6579fe0a718d9d8a2ca',
 'scripts/manual-inbound-tenant-graph-regression.sql':'a945b453afd614a36325ee780a8b71b8d890561f',
 'supabase/schema.sql':'a409f2319fa377ab88f49253b1ccebffb2f28d0e',
 'supabase/schema.fingerprint.json':'b81a9500316f45ee61b2902bcc7fa5273a0729dc',
 'supabase/database.types.ts':'35c34d178032e8a5b3485761f77ce027f4605e53',
 'scripts/migration-history-manifest.runtime.additions.json':'ad55a08ca2910a53aad4f635ae0a40ce3976532d',
 'scripts/supabase-types-manifest.json':'5268106885173693215a7a8550672efa88da0950',
}
FUNCTION=re.compile(r'CREATE (?:OR REPLACE )?FUNCTION public\.gridex_validate_ediel_message_contract\(\) RETURNS trigger\n.*?end \$\$;',re.S)
def sha(data): return hashlib.sha256(data).hexdigest()
def blob(data): return hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
def cmd(*args): return subprocess.check_output(args,text=True).strip()
def original(path): return subprocess.check_output(['git','show',BASE+':'+path])
def save(path,data): path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(data,indent=2)+'\n')
def checked():
 assert os.environ['GITHUB_REPOSITORY']==REPO and os.environ['GITHUB_REF']=='refs/heads/'+BRANCH
 subprocess.run(['git','merge-base','--is-ancestor',BASE,'HEAD'],check=True)
 assert set(cmd('git','diff','--name-only',BASE,'HEAD').splitlines()) == TEMP | {UPGRADE}
 for path,expected in EXPECTED.items(): assert blob(original(path))==expected,('base mismatch',path)

def prepare():
 checked()
 assert cmd('git','status','--porcelain')=='','unclean preparation worktree'
 for path,expected in EXPECTED.items(): assert blob(Path(path).read_bytes())==expected,('working mismatch',path)
 assert blob(Path('.github/pr369-inputs/production.patch').read_bytes())=='5c69686839646869904822c0a3cbad86011765b9'
 assert blob(Path('.github/pr369-inputs/migration.sql').read_bytes())=='7312eaf7881826f832a5b5c900f88b1ad70745ee'
 assert blob(Path(UPGRADE).read_bytes())=='0bd94145dbd85a74c4800a72e96113d0ca46878f'
 OUT.mkdir()
 subprocess.run(['git','apply','--check','.github/pr369-inputs/production.patch'],check=True)
 subprocess.run(['git','apply','.github/pr369-inputs/production.patch'],check=True)
 assert blob(Path('lib/inbound-mail/inboundStatusUpdater.ts').read_bytes())=='35052efe71209a7a08fb5f41222d4cdf0e85d0e7'
 assert blob(Path('lib/ediel/utilts/receivedStructuralSources.ts').read_bytes())=='76642fed2fa9ff4664cdf7b63601119400417416'
 before=set(Path('supabase/migrations').glob('*.sql'))
 subprocess.run(['supabase','migration','new','ediel_inbound_prodat_receive_context'],check=True)
 created=set(Path('supabase/migrations').glob('*.sql'))-before
 assert len(created)==1
 migration=created.pop()
 assert re.fullmatch(r'\d{14}_ediel_inbound_prodat_receive_context.sql',migration.name)
 migration.write_bytes(Path('.github/pr369-inputs/migration.sql').read_bytes())
 manifest=Path('scripts/migration-history-manifest.runtime.additions.json');content=json.loads(manifest.read_text())
 assert migration.name not in content['files']
 content['files'][migration.name]=sha(migration.read_bytes());save(manifest,content)
 manual=Path('scripts/manual-inbound-tenant-graph-regression.sql')
 manual.write_text(manual.read_text()+'''\n-- Actual upgrade collisions and competing writer lock; localhost-only rollback probes.
\\! python3 scripts/ediel-received-context-upgrade-regression.py
\\if :SHELL_ERROR
  do $$ begin raise exception 'PRODAT_RECEIVE_CONTEXT_UPGRADE_FAILURE'; end $$;
\\endif
''')
 assert blob(manual.read_bytes())=='02f9dcfb717dc7b9a250725d987c43711879b4aa'
 old_schema=Path('supabase/schema.sql').read_text()
 old=FUNCTION.findall(old_schema);new=FUNCTION.findall(migration.read_text())
 assert len(old)==len(new)==1
 expected_schema=old_schema.replace(old[0],new[0].replace('CREATE OR REPLACE FUNCTION ','CREATE FUNCTION ',1),1)
 (OUT/'expected-schema.sql').write_text(expected_schema)
 paths=[str(migration),'scripts/migration-history-manifest.runtime.additions.json','scripts/supabase-types-manifest.json',
   'supabase/schema.sql','supabase/schema.fingerprint.json','lib/inbound-mail/inboundStatusUpdater.ts',
   'lib/ediel/utilts/receivedStructuralSources.ts','scripts/manual-inbound-tenant-graph-regression.sql',UPGRADE]
 for path in paths:
  target=OUT/'delivery'/path;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(path,target)
 save(OUT/'state.json',{'base':BASE,'base_tree':cmd('git','rev-parse',BASE+'^{tree}'),'preparation_sha':cmd('git','rev-parse','HEAD'),
  'run_id':os.environ['GITHUB_RUN_ID'],'migration':str(migration),'migration_sha256':sha(migration.read_bytes()),'paths':paths,
  'supabase_cli':cmd('supabase','--version'),'node':cmd('node','--version'),'pg_dump':cmd(os.environ['GRIDEX_PG_DUMP'],'--version')})
 print('PR369_FINITE_PATCH_READY',migration,flush=True)

def finish():
 checked();state=json.loads((OUT/'state.json').read_text())
 t1=(OUT/'types-first.ts').read_bytes();t2=(OUT/'types-second.ts').read_bytes()
 assert t1==t2==original('supabase/database.types.ts'),'unexpected generated type change'
 s1=(OUT/'schema-first/schema.sql').read_bytes();s2=(OUT/'schema-second/schema.sql').read_bytes()
 assert s1==s2==(OUT/'expected-schema.sql').read_bytes(),'unexpected schema delta'
 fp=(OUT/'schema-first/schema.fingerprint.json').read_bytes()
 assert fp==(OUT/'schema-second/schema.fingerprint.json').read_bytes(),'unstable fingerprint'
 old=json.loads(original('supabase/schema.fingerprint.json'));new=json.loads(fp)
 assert old['algorithm']==new['algorithm'] and old['schemas']==new['schemas'] and set(old['sections'])==set(new['sections'])
 for name,section in old['sections'].items():
  assert section['count']==new['sections'][name]['count'],('object count changed',name)
  if name!='functions': assert section==new['sections'][name],('unexpected section change',name)
 assert old['sections']['functions']['sha256']!=new['sections']['functions']['sha256']
 Path('supabase/schema.sql').write_bytes(s1);Path('supabase/schema.fingerprint.json').write_bytes(fp)
 p=Path('scripts/supabase-types-manifest.json');m=json.loads(p.read_text())
 m.update({'generated_at':dt.datetime.now(dt.timezone.utc).isoformat(),
  'generated_with':'supabase-cli-'+state['supabase_cli']+'-repeated-isolated-clean-replay','sha256':sha(t1),
  'latest_migration':Path(state['migration']).name,
  'latest_migration_schema_effect':'PR369 existing trigger body only; repeated real types equal committed bytes; exact function-only schema delta and unchanged object counts, ACL, RLS and triggers'})
 save(p,m)
 state.update({'types_identical_to_base':True,'generated_types_sha256':sha(t1),'schema_only_expected_function_delta':True,
  'repeated_schema_identical':True,'schema_sha256':sha(s1),'fingerprint_sha256':sha(fp),'fingerprint_only_functions_changed':True})
 for path in state['paths']:
  if path==state['migration']: continue
  shutil.copyfile(path,OUT/'delivery'/path)
 save(OUT/'state.json',state)
 print('PR369_GENUINE_GENERATION_VERIFIED',state['schema_sha256'],flush=True)

def transport():
 checked();state=json.loads((OUT/'state.json').read_text())
 changed=set(cmd('git','diff','--name-only',BASE,'--').splitlines())
 assert changed==(set(state['paths'])-{state['migration']}) | TEMP,('unexpected changed paths',sorted(changed))
 log=(OUT/'native-replay.log').read_text()
 for required in ['PRODAT_SOURCE_STORAGE_REGRESSION: 62/62 PASS','PRODAT_RECEIVE_CONTEXT_REGRESSION: 84/84 PASS','RECEIVE_CONTEXT_UPGRADE: 3/3 PASS']:
  assert required in log,('missing executed evidence',required)
 entries=[]
 for path in state['paths']:
  data=(OUT/'delivery'/path).read_bytes();assert data==Path(path).read_bytes(),('restored-byte mismatch',path)
  request=json.dumps({'content':base64.b64encode(data).decode(),'encoding':'base64'})
  result=subprocess.run(['gh','api','--method','POST',f'repos/{REPO}/git/blobs','--input','-'],input=request,text=True,capture_output=True,check=True)
  assert json.loads(result.stdout)['sha']==blob(data)
  entries.append({'path':path,'mode':'100644','type':'blob','sha':blob(data),'sha256':sha(data),'bytes':len(data)})
 state['delivery_blobs']=entries;state['writes']='Immutable Git blobs only, no ref/commit/PR/merge/deployment'
 save(OUT/'generation-receipt.json',state);print(json.dumps(state,indent=2),flush=True)

if __name__=='__main__': {'prepare':prepare,'finish':finish,'transport':transport}[sys.argv[1]]()
