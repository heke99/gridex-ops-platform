"""Local source reproduction only; no network, database calls or repository writes."""
from pathlib import Path
import argparse,hashlib,json,shutil,sys

PACKET=Path(__file__).parent
parser=argparse.ArgumentParser()
parser.add_argument('--repository',required=True,type=Path)
parser.add_argument('--output',required=True,type=Path)
args=parser.parse_args()
args.output.mkdir(parents=True,exist_ok=True)
source_dir=args.repository/'quality/audits/2026-10-12-ops-api-contracts/release-proposals'
sha=lambda value:hashlib.sha256(value).hexdigest()
overlay=json.loads((PACKET/'source-edits.json').read_text())
base=(source_dir/'native-additive-reconciliation.sql').read_bytes()
assert len(base)==overlay['base_bytes'] and sha(base)==overlay['base_sha256']
pieces=[];previous=0
for patch in overlay['edits']:
    start=patch['start_byte'];end=start+patch['delete_bytes']
    assert previous<=start<=end<=len(base)
    assert sha(base[start:end])==patch['old_sha256']
    pieces.extend((base[previous:start],patch['new_text'].encode('UTF8')))
    previous=end
pieces.append(base[previous:])
derived=b''.join(pieces)
assert len(derived)==overlay['derived_bytes'] and sha(derived)==overlay['derived_sha256']
assert derived==(PACKET/'effective-main-source.sql').read_bytes()
(args.output/'effective-main-source.sql').write_bytes(derived)

# Verify every source component against its sealed original manifest, resolving
# preserved private path references through the publication provenance map.
provenance=json.loads((PACKET/'source-publication-provenance.json').read_text())
manifest=json.loads((PACKET/'atomic-eight-input-manifest.json').read_text())
component_bytes=[]
prefix=provenance['target_directory']+'/'
for component in provenance['components']:
    published=component['published_source_path']
    path=PACKET/published[len(prefix):] if published.startswith(prefix) else args.repository/published
    data=path.read_bytes()
    assert len(data)==component['bytes'] and sha(data)==component['sha256']
    component_bytes.append(data)
atomic=(PACKET/'atomic-eight-input-proposal.sql').read_bytes()
assert len(atomic)==manifest['atomic_bytes'] and sha(atomic)==manifest['atomic_sha256']
assert sha(atomic)==provenance['atomic_sha256']
(args.output/'atomic-eight-input-proposal.sql').write_bytes(atomic)
for name in ('auth-free-main-envelope.sql','source-edits.json','effective-complete-state-manifest.json','atomic-eight-input-manifest.json'):
    shutil.copyfile(PACKET/name,args.output/name)
print(json.dumps({'status':'LOCAL_SOURCE_RECONSTRUCTION_AND_HASH_VERIFICATION_ONLY','derived_sha256':sha(derived),'atomic_sha256':sha(atomic),'components_verified':len(component_bytes),'database_calls':0,'repository_writes':0}))
