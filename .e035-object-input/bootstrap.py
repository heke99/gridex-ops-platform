"""Reconstruct the exact disposable candidate; no hosted access or ref writes."""
import hashlib,io,json,lzma,os,pathlib,subprocess,tarfile
base='92d4980e5f1e068a3d33826f4ef75d086bfaf714'
assert subprocess.check_output(['git','rev-parse',base+'^{tree}'],text=True).strip()=='b19587747eff6be6bc744c4954e7d815b62cc30c'
data=b''.join(pathlib.Path(f'.e035-object-input/part-{n}.bin').read_bytes() for n in range(6))
assert hashlib.sha256(data).hexdigest()=='51a781993b45b2649bade05843e77796f705387443a77a5eee6e1dc819987764'
out=pathlib.Path(os.environ['E035_INPUT_DIR']);out.mkdir(parents=True,exist_ok=True)
with tarfile.open(fileobj=io.BytesIO(lzma.decompress(data)),mode='r:') as archive:
 for member in archive.getmembers():
  assert member.isfile() and pathlib.PurePosixPath(member.name).name==member.name
  (out/member.name).write_bytes(archive.extractfile(member).read())
for rel,h in json.loads((out/'input-sha256.json').read_text()).items():assert hashlib.sha256((out/rel).read_bytes()).hexdigest()==h,rel
patch=pathlib.Path('.e035-object-input/normative-facade.patch')
assert hashlib.sha256(patch.read_bytes()).hexdigest()=='c76b97644f42f1e5c2096393fa386da22abc3e89c3a6146549c588b4f3e35ac0'
paths=set(json.loads((out/'source-files.json').read_text()))
for patch in [out/'source.patch',patch,*sorted(pathlib.Path('.e035-object-input').glob('source-fix-*.patch'))]:
 subprocess.run(['git','apply','--check',str(patch)],check=True);subprocess.run(['git','apply',str(patch)],check=True)
 for line in patch.read_text().splitlines():
  if line.startswith('+++ b/'):
   rel=line[6:];assert not rel.startswith('.') and '..' not in pathlib.PurePosixPath(rel).parts if patch.name.startswith('source-fix-') else True
   paths.add(rel)
(out/'source-files.json').write_text(json.dumps(sorted(paths),indent=2)+'\n')
repair=pathlib.Path('.e035-object-input/native-repairs.py')
if repair.exists():subprocess.run(['python3',str(repair)],check=True)
print('Candidate source paths:',len(paths))
