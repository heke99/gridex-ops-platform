"""Isolated provider-image correction. No permission, policy or test bypass."""
import hashlib,json,pathlib,subprocess
root=pathlib.Path.cwd(); changes=[]
def amend(rel,old,new):
    p=root/rel;t=p.read_text();assert t.count(old)==1, 'unexpected input: '+rel
    p.write_text(t.replace(old,new));changes.append(rel)
replay='scripts/gridex-aud-003-clean-replay.sh'
base_blob=subprocess.check_output(['git','hash-object',replay],text=True).strip()
amend(replay,'TIMESTAMP_EXEC="$(mktemp)"', '''TIMESTAMP_EXEC="$(mktemp)"
# Supautils <=3.2.2 crashes on actual EXECUTE-denied calls for hint roles.
# The vendor-fixed image preserves the real 42501 and every RLS/ACL test.
# https://github.com/supabase/supautils/issues/214#issuecomment-5312009974
REPLAY_POSTGRES_VERSION="17.6.1.155"
REPLAY_PG_VERSION_PATH="$SUPABASE/.temp/postgres-version"
REPLAY_PG_VERSION_BACKUP=""
REPLAY_PG_VERSION_PINNED=""''')
amend(replay, '  rm -f "$MIGRATIONS"/*.sql', '''  if [[ -n "${REPLAY_PG_VERSION_PINNED:-}" ]]; then
    if [[ -n "${REPLAY_PG_VERSION_BACKUP:-}" ]]; then
      mv "$REPLAY_PG_VERSION_BACKUP" "$REPLAY_PG_VERSION_PATH"
    else
      rm -f "$REPLAY_PG_VERSION_PATH"
    fi
  fi
  rm -f "$MIGRATIONS"/*.sql''')
amend(replay,'  supabase start -x studio,imgproxy,mailpit,edge-runtime,logflare,vector', '''  # Only this already-disposable local stack uses the image override. A
  # linked/production project is not upgraded and no database GUC is changed.
  python3 -c 'import pathlib,tomllib; assert tomllib.loads(pathlib.Path("supabase/config.toml").read_text())["db"]["major_version"] == 17'
  if [[ -L "$REPLAY_PG_VERSION_PATH" ]]; then
    echo "refusing symlinked local PostgreSQL version pin" >&2; exit 1
  fi
  if [[ -e "$REPLAY_PG_VERSION_PATH" ]]; then
    test -f "$REPLAY_PG_VERSION_PATH"
    REPLAY_PG_VERSION_BACKUP="$(mktemp)"
    cp -p "$REPLAY_PG_VERSION_PATH" "$REPLAY_PG_VERSION_BACKUP"
  fi
  mkdir -p "$SUPABASE/.temp"
  REPLAY_PG_VERSION_PINNED=1
  printf '%s' "$REPLAY_POSTGRES_VERSION" > "$REPLAY_PG_VERSION_PATH"
  echo "local_replay_postgres_image=$REPLAY_POSTGRES_VERSION"
  supabase start -x studio,imgproxy,mailpit,edge-runtime,logflare,vector''')
# Retain the full existing SQL suite including the exact authenticated denied
# function call that crashed before; do not replace it by metadata assertions.
amend('.e035-tools/prepare_native.py','proofs=[];children=[]', '''proofs=[];children=[]
provider_image=subprocess.check_output(['docker','inspect','supabase_db_gridex-ops-platform','--format','{{.Config.Image}}'],text=True).strip()
provider_id=subprocess.check_output(['docker','inspect','supabase_db_gridex-ops-platform','--format','{{.Image}}'],text=True).strip()
provider_digests=subprocess.check_output(['docker','image','inspect',provider_id,'--format','{{json .RepoDigests}}'],text=True).strip()
check('fixed-vendor-postgres-image',provider_image.endswith(':17.6.1.155'))
check('same-postgres-major-17',sql("SELECT current_setting('server_version_num')::integer/10000;")=='17')
hints=sql("SELECT current_setting('supautils.hint_roles',true);")
check('vendor-error-hints-not-disabled',{'anon','authenticated','service_role'}.issubset({v.strip() for v in hints.split(',')}))
(OUT/'provider-image.json').write_text(json.dumps({'image':provider_image,'image_id':provider_id,'repo_digests':json.loads(provider_digests),'hint_roles':hints,'upstream_issue':'https://github.com/supabase/supautils/issues/214','previous_failed_run':35711226452,'scope':'disposable local image only; no authorization, GUC, expected assertion or production change'},indent=2)+'\\n')''')
manifest=root/'.e035-tools/input-manifest.json';data=json.loads(manifest.read_text())
for rel in sorted(set(changes)):
    digest=hashlib.sha256((root/rel).read_bytes()).hexdigest()
    existing=next((f for f in data['files'] if f['path']==rel),None)
    if existing:existing['sha256']=digest
    else:data['files'].append({'path':rel,'sha256':digest,'baseline_blob':base_blob,'mode':'100644','deliver':True})
manifest.write_text(json.dumps(data,indent=2)+'\n')
p=root/'.e035-tools/provenance.json';v=json.loads(p.read_text());v['amendment_r7']={'previous_failed_run':35711226452,'artifact':10686972334,'fix':'vendor-fixed PostgreSQL17.6.1.155 image, unchanged actual ACL/RLS probes; no disabled hints','upstream':'https://github.com/supabase/supautils/issues/214#issuecomment-5312009974','files':sorted(set(changes))};v['files']=data['files'];p.write_text(json.dumps(v,indent=2)+'\n')
print('Vendor image amendment; actual SQL authorization tests unchanged:',sorted(set(changes)))
