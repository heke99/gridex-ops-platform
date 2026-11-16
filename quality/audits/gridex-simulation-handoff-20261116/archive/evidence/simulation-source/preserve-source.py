import os,json,pathlib,hashlib,re,stat
B=pathlib.Path('/workspace/gridex-main-transfer-20261116/handoff/simulation-source')
I=pathlib.Path('/workspace/gridex-local-migration-preflight-20261116/PRODUCER-DEPENDENCIES.v2.safe.json')
R=pathlib.Path('/workspace/gridex-pilot65-source-20261115-k11')
j=json.loads(I.read_bytes()); classified=[]
def walk(x):
 if isinstance(x,dict):
  if 'classification' in x and 'path' in x: classified.append(x)
  for v in x.values():walk(v)
 elif isinstance(x,list):
  for v in x:walk(v)
walk(j)
deny={x['path'] for x in classified if x['classification']=='PRIVATE_REQUIRED_NOT_BUNDLED'}
patterns={
 'JWT':re.compile(rb'eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}'),
 'PEM':re.compile(rb'-----BEGIN [A-Z0-9 ]+-----'),
 'github_token':re.compile(rb'(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})'),
 'AWS_access_key':re.compile(rb'(?:AKIA|ASIA)[A-Z0-9]{16}'),
 'secret_literal':re.compile(rb'''(?i)(?:service_role_key|jwt_secret|supabase_service_role_key|api_secret|private_key)\s*[:=]\s*["'][A-Za-z0-9+/=_-]{24,}["']''')}
entries=[];excluded=[];missing=[];seen=set();total=0

def include(p,rel,kind,expected=None):
 global total
 p=pathlib.Path(p);sp=str(p)
 if sp in seen:return
 seen.add(sp)
 reason=None
 low=p.name.lower()
 if sp in deny:reason='PRIVATE_REQUIRED_NOT_BUNDLED'
 elif any(x in p.parts for x in ('node_modules','.git','.next')):reason='dependency_or_generated_tree'
 elif low.startswith('.env') or '.private' in low or low.endswith(('.key','.p12','.pfx','.dump','.gz','.tar','.png','.jpg','.ico','.woff','.woff2','.pdf')) or 'baseconfig' in low:reason='private_env_data_binary_or_baseconfig_name'
 if reason:excluded.append({'originalPath':sp,'reason':reason});return
 try:s=p.lstat()
 except FileNotFoundError:missing.append({'originalPath':sp});return
 if not stat.S_ISREG(s.st_mode):excluded.append({'originalPath':sp,'reason':'symlink_or_nonregular'});return
 b=p.read_bytes()
 if b'\x00' in b:reason='binary_nul'
 else:
  try:b.decode('utf-8')
  except UnicodeDecodeError:reason='non_utf8_binary_or_unqualified_encoding'
 hits=[name for name,rx in patterns.items() if rx.search(b)]
 if hits:reason='offline_secret_pattern_match'
 h=hashlib.sha256(b).hexdigest()
 if expected and h!=expected:reason='declared_SHA256_mismatch'
 if reason:
  row={'originalPath':sp,'reason':reason}
  if hits:row['patternClasses']=hits
  excluded.append(row);return
 if total+len(b)>59000000:excluded.append({'originalPath':sp,'reason':'bundle_size_cap'});return
 dest=B/rel;dest.parent.mkdir(parents=True,exist_ok=True)
 with dest.open('xb') as f:f.write(b)
 os.chmod(dest,0o644)
 if hashlib.sha256(dest.read_bytes()).hexdigest()!=h:raise RuntimeError('copy verification')
 entries.append({'originalPath':sp,'bundlePath':str(rel),'bytes':len(b),'sha256':h,'originalMode':oct(stat.S_IMODE(s.st_mode)),'kind':kind});total+=len(b)

for base,ds,fs in os.walk(R,followlinks=False):
 for name in sorted(list(ds)):
  p=pathlib.Path(base)/name
  if p.is_symlink() or name in ('node_modules','.git','.next'):
   excluded.append({'originalPath':str(p),'reason':'symlink_or_dependency_generated_tree'});ds.remove(name)
 for name in sorted(fs):
  p=pathlib.Path(base)/name;include(p,pathlib.Path('source65')/p.relative_to(R),'Source65')
for x in classified:
 if x['classification']=='NONSECRET_SOURCE_OR_METADATA':
  p=pathlib.Path(x['path']);include(p,pathlib.Path('declared')/str(p).lstrip('/'),'explicit_classified',x.get('sha256'))
for p in sorted(deny):
 if p not in seen:excluded.append({'originalPath':p,'reason':'PRIVATE_REQUIRED_NOT_BUNDLED'})
readme='''# Källbevarande för fortsatt simuleringsarbete\n\nDetta är ett filtrerat källarkiv, inte ett körbart Macpaket. Inkluderade filers bytes är oförändrade och verifierade med SHA256. Source65 och uttryckligen klassificerade icke-hemliga käll-/metadataposter har prövats; undantag och saknade filer anges i manifestet. Inga absoluta eller andra symlänkar kopieras.\n\nMiljöfiler, privata baseConfig/DB-/rådatafiler, nycklar, tokenmönster, binärer, node_modules och uttryckligen privata poster ingår inte. Token/PEM-sökningen är offline och skriver aldrig ut matchade värden. Den är mönsterbaserad och är inte ett bevis för frånvaro av alla tänkbara hemligheter.\n\nFullständiga transitiva beroenden, runtime, paketversioner, Linux/Mac-kompatibilitet, aktuella roller och normal autentisering måste kvalificeras separat. Bevara samma befintliga stagingdatabas; detta paket innehåller ingen DB och medger inte ersättning, återställning eller ny databas. Referenser till absoluta molnsökvägar i ursprunglig källtext är historiska och gör inte paketet portabelt. Ingen kod har exekverats och inga Docker-, SQL-, npm- eller Git-mutationer har utförts.\n'''
(B/'README.sv.md').write_text(readme)
manifest={'state':'PARTIAL_FILTERED_SOURCE_PRESERVATION_NOT_EXECUTABLE_PACKAGE','dependencyIndex':{'originalPath':str(I),'sha256':hashlib.sha256(I.read_bytes()).hexdigest()},'sourceRoot':str(R),'limitBytes':60000000,'includedCount':len(entries),'includedBytes':total,'entries':entries,'missing':missing,'excluded':excluded,'offlineScan':{'patternClasses':list(patterns),'includedFilesMatched':0,'valuesPrinted':False},'sameExistingStagingDatabaseMustBePreserved':True,'transitiveRuntimeQualificationRequired':True,'codeExecuted':False}
(B/'SHA256-MANIFEST.safe.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
allfiles=[p for p in B.rglob('*') if p.is_file()]
size=sum(p.stat().st_size for p in allfiles)
assert size<60000000
print(json.dumps({'included':len(entries),'includedBytes':total,'totalBundleBytes':size,'excluded':len(excluded),'missing':len(missing),'manifestSHA256':hashlib.sha256((B/'SHA256-MANIFEST.safe.json').read_bytes()).hexdigest(),'excludedPatternCounts':{k:sum(k in x.get('patternClasses',[]) for x in excluded) for k in patterns}}))
