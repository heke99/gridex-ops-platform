"""Temporary R4 preparation amendment; original source/assertions stay intact.
Replay checksum-pinned R3, then fix the observed SQL fixture name collision.
This file and the preparation workflow are not substantive delivery files.
"""
import hashlib,json,pathlib,subprocess
frozen_script=subprocess.check_output(['git','show','8568d1d00386facf2e6e3a141311c70ebcaac88c:.e035-preparation/amend-r1.py'])
assert hashlib.sha1(f'blob {len(frozen_script)}\0'.encode()+frozen_script).hexdigest()=='eacb4bb293d968f34b8f690d9b61303623e2a85a'
exec(compile(frozen_script,'verified-r3-amendment','exec'),globals())
file=pathlib.Path('scripts/ediel-source-ledger-regression.sql');before=file.read_bytes()
old="""   select * into strict profile from public.ediel_message_profiles
    where profile->>'family'='UTILTS' and message_code='E66' and direction in ('inbound','both') and is_enabled
    order by profile_key limit 1;"""
new="""   select mp.* into strict profile from public.ediel_message_profiles mp
    where mp.profile->>'family'='UTILTS' and mp.message_code='E66' and mp.direction in ('inbound','both') and mp.is_enabled
    order by mp.profile_key limit 1;"""
text=before.decode();assert text.count(old)==1;file.write_text(text.replace(old,new))
manifest=pathlib.Path('.e035-tools/input-manifest.json');data=json.loads(manifest.read_text())
for entry in data['files']:
    if entry['path']==str(file):entry['sha256']=hashlib.sha256(file.read_bytes()).hexdigest()
manifest.write_text(json.dumps(data,indent=2)+'\n')
prov=pathlib.Path('.e035-tools/provenance.json');p=json.loads(prov.read_text())
p['amendment_r4']={'previous_run':35709174833,'previous_artifact':10685123951,'before_sql_sha256':hashlib.sha256(before).hexdigest(),'after_sql_sha256':hashlib.sha256(file.read_bytes()).hexdigest(),'fix':'qualify existing fixture columns; production SQL and all expected assertions unchanged'}
p['files']=data['files'];prov.write_text(json.dumps(p,indent=2)+'\n')
print('Applied R4 fixture-only qualification; original assertion set retained.')
