"""Temporary R6 diagnostic amendment after a native server disconnect.
Collect only owned disposable-stack diagnostics. No policy/guard is changed.
"""
import hashlib,json,pathlib,subprocess
frozen_r5=subprocess.check_output(['git','show','6fa9412996c45fe89902c3dc4102826b805aa3c6:.e035-preparation/amend-r1.py'])
assert hashlib.sha1(f'blob {len(frozen_r5)}\0'.encode()+frozen_r5).hexdigest()=='f353a6f2d8cd3d4530da7337983629c4b0842be4'
exec(compile(frozen_r5,'verified-r5-amendment','exec'),globals())
changed_r6=[]
def patch_r6(rel,old,new):
    f=pathlib.Path(rel);s=f.read_text();assert s.count(old)==1,(rel,old);f.write_text(s.replace(old,new));changed_r6.append(rel)
patch_r6('.e035-tools/prepare_native.py','finally:\n    for proc in children:',
'''finally:
    # Read-only diagnostics of this runner's own local stack, before its existing
    # EXIT trap tears it down. Never inspect external/live project credentials.
    for label,args in [('server-log',['docker','logs','--tail','1600','supabase_db_gridex-ops-platform']),
        ('container-state',['docker','inspect','--format','{{json .State}}','supabase_db_gridex-ops-platform']),
        ('host-memory',['free','-m']),('container-memory',['docker','stats','--no-stream','--format','{{.Name}} {{.MemUsage}}','supabase_db_gridex-ops-platform'])]:
        try:
            d=subprocess.run(args,text=True,capture_output=True,timeout=20)
            (OUT/(label+'.log')).write_text(d.stdout+d.stderr)
        except Exception as exc:
            (OUT/(label+'.log')).write_text(type(exc).__name__)
    for proc in children:''')
patch_r6('scripts/ediel-source-ledger-regression.sql',
" FOREACH tab IN ARRAY ARRAY['sources','snapshots','discovery_attempts','validation_assessments'] LOOP\n  EXECUTE 'SET LOCAL ROLE authenticated';",
" RAISE NOTICE 'E035_HUMAN_PROBE starting; version=%',version();\n FOREACH tab IN ARRAY ARRAY['sources','snapshots','discovery_attempts','validation_assessments'] LOOP\n  RAISE NOTICE 'E035_HUMAN_PROBE own-scope table=%',tab;\n  EXECUTE 'SET LOCAL ROLE authenticated';")
patch_r6('scripts/ediel-source-ledger-regression.sql',
"  EXECUTE format('SELECT count(*) FROM gridex_received_sources.%I WHERE company_id=%L',tab,'00000000-0000-4000-8000-00000000e002') INTO foreign_rows;",
"  RAISE NOTICE 'E035_HUMAN_PROBE own-read returned; foreign-scope table=%',tab;\n  EXECUTE format('SELECT count(*) FROM gridex_received_sources.%I WHERE company_id=%L',tab,'00000000-0000-4000-8000-00000000e002') INTO foreign_rows;")
patch_r6('scripts/ediel-source-ledger-regression.sql',
" UPDATE public.user_profiles SET user_status='disabled' WHERE id='00000000-0000-4000-8000-00000000e010';",
" RAISE NOTICE 'E035_HUMAN_PROBE disabling synthetic user';\n UPDATE public.user_profiles SET user_status='disabled' WHERE id='00000000-0000-4000-8000-00000000e010';")
manifest=pathlib.Path('.e035-tools/input-manifest.json');data=json.loads(manifest.read_text())
for entry in data['files']:
    if entry['path'] in changed_r6:entry['sha256']=hashlib.sha256(pathlib.Path(entry['path']).read_bytes()).hexdigest()
manifest.write_text(json.dumps(data,indent=2)+'\n')
prov=pathlib.Path('.e035-tools/provenance.json');p=json.loads(prov.read_text())
p['amendment_r6']={'previous_run':35710647368,'previous_artifact':10686066651,'scope':'diagnostic notices and owned PostgreSQL log/state capture only; same policies and assertions; no production fix inferred','files':changed_r6}
p['files']=data['files'];prov.write_text(json.dumps(p,indent=2)+'\n')
print('Applied R6 diagnostics, no policy or expected outcome changed.')
