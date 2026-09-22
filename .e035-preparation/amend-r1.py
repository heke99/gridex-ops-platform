"""Temporary R5 preparation amendment. No old guard or assertion weakened.
Replay checksum-pinned R4, then remove the nonexistent fixture-only column.
"""
import hashlib,json,pathlib,subprocess
frozen_r4=subprocess.check_output(['git','show','0d6665f8918b31d1b8a5f0ffb611ec9fb8a26fcc:.e035-preparation/amend-r1.py'])
assert hashlib.sha1(f'blob {len(frozen_r4)}\0'.encode()+frozen_r4).hexdigest()=='b9e01ae01f1ac3a913d8b4b97089bd5eab230690'
exec(compile(frozen_r4,'verified-r4-amendment','exec'),globals())
file=pathlib.Path('scripts/ediel-source-ledger-regression.sql');before=file.read_bytes()
old="""INSERT INTO public.user_profiles(id,email,full_name,user_status,created_at,updated_at,must_change_password)
 VALUES('00000000-0000-4000-8000-00000000e010','e035-tenant-reader@example.invalid','Rollback ledger reader','active',now(),now(),false)"""
new="""INSERT INTO public.user_profiles(id,email,full_name,user_status,created_at,updated_at)
 VALUES('00000000-0000-4000-8000-00000000e010','e035-tenant-reader@example.invalid','Rollback ledger reader','active',now(),now())"""
text=before.decode();assert text.count(old)==1;file.write_text(text.replace(old,new))
manifest=pathlib.Path('.e035-tools/input-manifest.json');data=json.loads(manifest.read_text())
for entry in data['files']:
    if entry['path']==str(file):entry['sha256']=hashlib.sha256(file.read_bytes()).hexdigest()
manifest.write_text(json.dumps(data,indent=2)+'\n')
prov=pathlib.Path('.e035-tools/provenance.json');p=json.loads(prov.read_text())
p['amendment_r5']={'previous_run':35709701180,'previous_artifact':10684959969,'before_sql_sha256':hashlib.sha256(before).hexdigest(),'after_sql_sha256':hashlib.sha256(file.read_bytes()).hexdigest(),'fix':'new user fixture uses real accepted schema columns; no auth rule, role, source schema or expected assertion changed'}
p['files']=data['files'];prov.write_text(json.dumps(p,indent=2)+'\n')
print('Applied R5 schema-correct fixture; original behavioral assertions retained.')
