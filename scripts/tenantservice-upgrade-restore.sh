#!/usr/bin/env bash
# Dedicated disposable CI job, never a linked/hosted database operation.
# PostgreSQL logical restore scope: database schemas/data/owners/ACLs, except
# pg_cron extension/job state, which belongs to cron.database_name=postgres.
# Cluster roles already exist on the SAME disposable Supabase cluster. Storage
# object bytes, service configuration, hosted backups/PITR and dispatch recovery
# are deliberately outside this logical database proof.
set -euo pipefail
umask 077

readonly TENANTSERVICE_CANDIDATE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly TENANTSERVICE_BASELINE_SHA="ae56ee0a1e0e8adbce9d5f4d92da75cdcb8010c8"
readonly TENANTSERVICE_PLAN_ONLY="${1:-}"
if [[ -n "$TENANTSERVICE_PLAN_ONLY" && "$TENANTSERVICE_PLAN_ONLY" != --plan-only ]]; then
  echo 'usage: scripts/tenantservice-upgrade-restore.sh [--plan-only]' >&2; exit 2
fi
if [[ -n "${GRIDEX_REPLAY_DB_URL:-}" ]]; then
  echo 'tenantservice proof refuses external replay database URLs' >&2; exit 2
fi
if [[ "$TENANTSERVICE_PLAN_ONLY" != --plan-only && "${CI:-}" != true ]]; then
  echo 'tenantservice native proof requires a dedicated disposable CI runner (CI=true)' >&2; exit 2
fi
test -n "${RUNNER_TEMP:-}" || { echo 'RUNNER_TEMP is required for private disposable proof files' >&2; exit 2; }
readonly TENANTSERVICE_TEMP="$(mktemp -d "$RUNNER_TEMP/tenantservice-upgrade-restore.XXXXXX")"
tenantservice_safe_first_error(){
  # Only the first error message, never DETAIL, COPY rows, SQL statements or
  # credential-bearing Supabase startup output. All raw logs stay private.
  python3 - "$@" <<'PY'
import pathlib,re,sys
for filename in sys.argv[1:]:
    path=pathlib.Path(filename)
    if not path.is_file(): continue
    for line in path.read_text(errors='replace').splitlines():
        match=re.search(r'(?:ERROR|FATAL):\s*(.*)',line)
        if match:
            message=match.group(1)
        elif re.match(r'(?:pg_dump|pg_restore): error:',line):
            message=line.split('error:',1)[1].strip()
        elif re.search(r'(?:schema fingerprint mismatch|checksum mismatch|missing replay provenance input)',line):
            message=line
        elif re.match(r'(?:Error:|failed to (?:start|create|inspect)\b)',line):
            message=line
        else: continue
        message=re.sub(r'\b[a-zA-Z][a-zA-Z0-9+.-]*://\S+','[connection]',message)
        message=re.sub(r'\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b','[token]',message)
        message=re.sub(r'\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+\b','[key]',message)
        message=re.sub(r'(?i)\b(?:password|secret|token|api[_-]?key)\s*[=:]\s*\S+','[credential]',message)
        message=re.sub(r'\b[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}\b','[synthetic-id]',message)
        message=re.sub(r'[^\s\x27\x22]+@[^\s\x27\x22]+','[synthetic-email]',message)
        # SQL context is not necessary to diagnose a restore object's error.
        message=message.split('Command was:',1)[0].split('DETAIL:',1)[0].strip()
        if path.name.startswith('bootstrap-'):
            message='private bootstrap stage failed; catalog and role details suppressed'
        print(f'TENANTSERVICE_PROOF_FIRST_ERROR {path.name}: {message[:240]}',file=sys.stderr)
        raise SystemExit(0)
PY
}
tenantservice_local_docker(){
  # A selected Docker context or DOCKER_HOST must never redirect this proof to
  # a remote daemon. The dedicated Ubuntu runner owns this local Unix socket.
  env -u DOCKER_HOST -u DOCKER_CONTEXT docker --host=unix:///var/run/docker.sock "$@"
}

tenantservice_restore_archive(){
  local restore_database="$1" restore_url="$2"
  local restore_container='supabase_db_gridex-ops-platform'
  local source_role target_oid admin_evidence
  # The immutable archived baseline config pins project_id=gridex-ops-platform.
  # Only the random template0 database just created through the proven local
  # stack is an allowed target. No linked project URL or admin credential exists.
  if [[ "${CI:-}" != true || "${DB_URL:-}" != postgresql://postgres:postgres@127.0.0.1:54322/postgres ||
        -z "${RUNNER_TEMP:-}" || "$TENANTSERVICE_TEMP" != "$RUNNER_TEMP"/tenantservice-upgrade-restore.* ||
        ! "$restore_database" =~ ^tenantservice_restore_[0-9]+_[0-9]+$ ||
        "$restore_url" != "postgresql://postgres:postgres@127.0.0.1:54322/$restore_database" ]]; then
    echo 'TENANTSERVICE_RESTORE_LOCAL_BOUNDARY_REQUIRED' >&2; return 2
  fi
  source_role="$(psql "$DB_URL" -XAtq -v ON_ERROR_STOP=1 -c \
    "select current_user||'|'||rolsuper::text from pg_roles where rolname=current_user;" \
    2> "$TENANTSERVICE_TEMP/restore-authority.log")" || return 1
  [[ "$source_role" =~ ^postgres\|(true|false)$ ]] || {
    echo 'TENANTSERVICE_RESTORE_SOURCE_ROLE_UNEXPECTED' >&2; return 1;
  }
  target_oid="$(psql "$restore_url" -XAtq -v ON_ERROR_STOP=1 -c \
    'select oid from pg_database where datname=current_database();' \
    2>> "$TENANTSERVICE_TEMP/restore-authority.log")" || return 1
  [[ "$target_oid" =~ ^[0-9]+$ ]] || {
    echo 'TENANTSERVICE_RESTORE_TARGET_DATABASE_UNEXPECTED' >&2; return 1;
  }
  # Supabase's postgres role is restricted. The existing vendor administrator
  # can preserve every archived owner/ACL without promoting postgres or changing
  # memberships. In-container loopback uses the vendor's local authentication.
  # Check actual session/current role, superuser attribute and the same target
  # database OID before handing any archive SQL to that connection.
  if ! admin_evidence="$(tenantservice_local_docker exec "$restore_container" psql \
    --host=127.0.0.1 --port=5432 --username=supabase_admin --no-password \
    --dbname="$restore_database" -XAtq -v ON_ERROR_STOP=1 -c \
    "select session_user||'|'||current_user||'|'||r.rolsuper::text||'|'||d.oid::text \
      from pg_roles r,pg_database d where r.rolname=current_user and d.datname=current_database();" \
    2>> "$TENANTSERVICE_TEMP/restore-authority.log")"; then
    echo 'TENANTSERVICE_RESTORE_LOCAL_ADMIN_CONNECTION_FAILED' >&2; return 1
  fi
  [[ "$admin_evidence" == "supabase_admin|supabase_admin|true|$target_oid" ]] || {
    echo 'TENANTSERVICE_RESTORE_LOCAL_ADMIN_AUTHORITY_MISMATCH' >&2; return 1;
  }
  echo "TENANTSERVICE_RESTORE_SOURCE_ROLE postgres_superuser=${source_role#*|}"
  echo 'TENANTSERVICE_RESTORE_LOCAL_ADMIN_AUTHORITY_PASS'
  # The matching host pg_restore reads the actual custom archive and exact TOC.
  # Its original owner/ACL SQL and BEGIN/COMMIT stream directly to the proven
  # local administrator. pipefail and ON_ERROR_STOP preserve either failure.
  # No private backup copy or admin password is written into the container.
  if ! {
    "$TENANTSERVICE_PG_RESTORE" --file=- --exit-on-error --single-transaction \
      --use-list="$TENANTSERVICE_TEMP/restore.filtered.toc" "$TENANTSERVICE_TEMP/database.dump" |
      tenantservice_local_docker exec -i "$restore_container" psql \
        --host=127.0.0.1 --port=5432 --username=supabase_admin --no-password \
        --dbname="$restore_database" -X -q -v ON_ERROR_STOP=1
  } > "$TENANTSERVICE_TEMP/restore.log" 2>&1; then
    echo 'TENANTSERVICE_RESTORE_PG_RESTORE_FAILED' >&2; return 1
  fi
}
tenantservice_private_cleanup(){
  local proof_status="$1"
  if [[ "$proof_status" != 0 ]]; then
    tenantservice_safe_first_error "$TENANTSERVICE_TEMP/baseline-clean.log" \
      "$TENANTSERVICE_TEMP/dump.log" "$TENANTSERVICE_TEMP/restore-authority.log" "$TENANTSERVICE_TEMP/restore.log" \
      "$TENANTSERVICE_TEMP/bootstrap-catalog.log" "$TENANTSERVICE_TEMP/bootstrap-plan.log" \
      "$TENANTSERVICE_TEMP/bootstrap-authority.log" "$TENANTSERVICE_TEMP/bootstrap-apply.log" \
      "$TENANTSERVICE_TEMP/schema-snapshot.log" || true
  fi
  rm -rf "$TENANTSERVICE_TEMP"
}
trap 'tenantservice_private_cleanup "$?"' EXIT
source "$TENANTSERVICE_CANDIDATE_ROOT/scripts/tenantservice-restore-bootstrap-acl.sh"
mkdir "$TENANTSERVICE_TEMP/baseline" "$TENANTSERVICE_TEMP/forward"
git -C "$TENANTSERVICE_CANDIDATE_ROOT" cat-file -e "$TENANTSERVICE_BASELINE_SHA^{commit}"
git -C "$TENANTSERVICE_CANDIDATE_ROOT" archive "$TENANTSERVICE_BASELINE_SHA" |
  tar -x -C "$TENANTSERVICE_TEMP/baseline"

# This preflight compares actual baseline bytes, not only two manifests. All
# historical sources must survive unchanged; ONLY new, checksum-pinned forward
# timestamp migrations may be executed on the already provisioned old schema.
python3 - "$TENANTSERVICE_CANDIDATE_ROOT" "$TENANTSERVICE_TEMP" <<'PY'
import hashlib,json,pathlib,re,shutil,sys
root=pathlib.Path(sys.argv[1]); temporary=pathlib.Path(sys.argv[2])
old=temporary/'baseline/supabase/migrations'; new=root/'supabase/migrations'
checksums={}
for name in ('migration-history-manifest.json','migration-history-manifest.additions.json',
             'migration-history-manifest.runtime.additions.json'):
    path=root/'scripts'/name
    if not path.exists(): continue
    for filename,digest in json.loads(path.read_text()).get('files',{}).items():
        if filename in checksums and checksums[filename] != digest:
            raise SystemExit(f'conflicting migration manifest entry: {filename}')
        checksums[filename]=digest
digest=lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
old_files={p.name:p for p in old.glob('*.sql')}
new_files={p.name:p for p in new.glob('*.sql')}
for name,path in old_files.items():
    if name not in new_files or digest(new_files[name]) != digest(path):
        raise SystemExit(f'published baseline migration changed or missing: {name}')
last=max(name[:14] for name in old_files if re.fullmatch(r'\d{14}_.+\.sql',name))
forward=[]; versions=set()
for name in sorted(new_files.keys()-old_files.keys()):
    if not re.fullmatch(r'\d{14}_[A-Za-z0-9_]+\.sql',name) or name[:14] <= last:
        raise SystemExit(f'not a new forward timestamp migration after {last}: {name}')
    if name[:14] in versions: raise SystemExit(f'forward migration version collision: {name}')
    versions.add(name[:14]); actual=digest(new_files[name])
    if checksums.get(name) != actual:
        raise SystemExit(f'candidate migration is not checksum-pinned: {name}')
    shutil.copyfile(new_files[name],temporary/'forward'/name)
    forward.append({'filename':name,'sha256':actual})
if not forward: raise SystemExit('upgrade proof requires genuinely new candidate migrations')
(temporary/'forward.json').write_text(json.dumps(forward,indent=2)+'\n')
(temporary/'forward.list').write_text(''.join(row['filename']+'\n' for row in forward))
print(f'TENANTSERVICE_UPGRADE_PLAN_VALIDATED baseline_migrations={len(old_files)} forward_migrations={len(forward)}')
PY
echo "TENANTSERVICE_UPGRADE_BASELINE_SHA=$TENANTSERVICE_BASELINE_SHA"
if [[ "$TENANTSERVICE_PLAN_ONLY" == --plan-only ]]; then
  echo 'TENANTSERVICE_PLAN_ONLY_NATIVE_NOT_EXECUTED'; exit 0
fi
for required in supabase psql python3 node docker; do command -v "$required" >/dev/null; done
readonly TENANTSERVICE_PG_DUMP="${GRIDEX_PG_DUMP:-pg_dump}"
readonly TENANTSERVICE_PG_RESTORE="${GRIDEX_PG_RESTORE:-pg_restore}"
command -v "$TENANTSERVICE_PG_DUMP" >/dev/null
command -v "$TENANTSERVICE_PG_RESTORE" >/dev/null
if [[ "$(node -p 'process.versions.node.split(".")[0]')" != 22 ]]; then
  echo 'tenantservice proof requires the project Node 22 runtime' >&2; exit 2
fi

(
  cd "$TENANTSERVICE_TEMP/baseline"
  # Source inside this subshell: its EXIT trap owns precisely this temporary
  # checkout and local stack. The candidate checkout and its migrations are
  # never moved, altered or passed to that historical cleanup function.
  # Do not place source in an if/! condition: Bash would suppress errexit
  # throughout the historical script and could turn a failed replay green.
  source scripts/gridex-aud-003-clean-replay.sh > "$TENANTSERVICE_TEMP/baseline-clean.log" 2>&1
  [[ "$DB_URL" == postgresql://postgres:postgres@127.0.0.1:54322/postgres ]] || {
    echo 'tenantservice baseline was not the expected disposable localhost stack' >&2; exit 1;
  }
  echo 'TENANTSERVICE_UPGRADE_PINNED_OLD_SCHEMA_REPLAY_PASS'

  tenantservice_sql(){
    local database="$1" source_file="$2"
    local proof_log="$TENANTSERVICE_TEMP/$(basename "$source_file").log"
    if ! psql "$database" -X -q -v ON_ERROR_STOP=1 -f "$source_file" > "$proof_log" 2>&1; then
      echo "TENANTSERVICE_NATIVE_SQL_FAILED $(basename "$source_file")" >&2
      tenantservice_safe_first_error "$proof_log"
      return 1
    fi
    awk '/^TENANTSERVICE_(UPGRADE|RESTORE)_[A-Z0-9_]+_PASS$/' "$proof_log"
  }
  tenantservice_sql "$DB_URL" "$TENANTSERVICE_CANDIDATE_ROOT/scripts/sql/tenantservice-upgrade-fixture.sql"
  psql "$DB_URL" -X -At -v ON_ERROR_STOP=1 \
    -f "$TENANTSERVICE_CANDIDATE_ROOT/scripts/sql/tenantservice-upgrade-immutable-fingerprint.sql" \
    > "$TENANTSERVICE_TEMP/issued-before.sha256"
  while IFS= read -r filename; do
    echo "TENANTSERVICE_UPGRADE_APPLY $filename"
    tenantservice_sql "$DB_URL" "$TENANTSERVICE_TEMP/forward/$filename"
  done < "$TENANTSERVICE_TEMP/forward.list"
  tenantservice_sql "$DB_URL" "$TENANTSERVICE_CANDIDATE_ROOT/scripts/sql/tenantservice-upgrade-postcheck.sql"
  psql "$DB_URL" -X -At -v ON_ERROR_STOP=1 \
    -f "$TENANTSERVICE_CANDIDATE_ROOT/scripts/sql/tenantservice-upgrade-immutable-fingerprint.sql" \
    > "$TENANTSERVICE_TEMP/issued-after.sha256"
  cmp "$TENANTSERVICE_TEMP/issued-before.sha256" "$TENANTSERVICE_TEMP/issued-after.sha256"
  echo 'TENANTSERVICE_UPGRADE_ISSUED_BYTES_RETAINED_PASS'

  # Capture public application schema using the same generator as clean replay.
  # Its final comparison below waits until the restore proof has executed, so
  # a stale committed schema artifact cannot hide native restore evidence.
  node "$TENANTSERVICE_CANDIDATE_ROOT/scripts/gridex-schema-snapshot.cjs" \
    --url "$DB_URL" --mode write --out-dir "$TENANTSERVICE_TEMP/upgraded-schema" \
    > "$TENANTSERVICE_TEMP/schema-snapshot.log" 2>&1
  psql "$DB_URL" -X -At -v ON_ERROR_STOP=1 -v 'schemas={public,private,auth,storage,gridex_received_sources}' \
    -f "$TENANTSERVICE_CANDIDATE_ROOT/scripts/sql/gridex-db-parity-introspect.sql" \
    > "$TENANTSERVICE_TEMP/catalog-before.json"
  psql "$DB_URL" -X -At -v ON_ERROR_STOP=1 \
    -f "$TENANTSERVICE_CANDIDATE_ROOT/scripts/sql/tenantservice-restore-data-fingerprint.sql" \
    > "$TENANTSERVICE_TEMP/data-before.sha256"
  psql "$DB_URL" -X -At -v ON_ERROR_STOP=1 -v tenantservice_catalog_detail=1 \
    -f "$TENANTSERVICE_CANDIDATE_ROOT/scripts/sql/tenantservice-restore-data-fingerprint.sql" \
    > "$TENANTSERVICE_TEMP/restore-catalog-before.json"

  # The backup contains real data and original ACL/ownership records. pg_cron
  # alone is excluded: it can be installed in only cron.database_name, and this
  # proof must not reconfigure/replay dispatch scheduling on the source stack.
  "$TENANTSERVICE_PG_DUMP" "$DB_URL" --format=custom --exclude-schema=cron \
    --file="$TENANTSERVICE_TEMP/database.dump" 2> "$TENANTSERVICE_TEMP/dump.log"
  "$TENANTSERVICE_PG_RESTORE" --list "$TENANTSERVICE_TEMP/database.dump" \
    > "$TENANTSERVICE_TEMP/restore.toc"
  python3 - "$TENANTSERVICE_TEMP/restore.toc" "$TENANTSERVICE_TEMP/restore.filtered.toc" <<'PY'
import pathlib,re,sys
rows=pathlib.Path(sys.argv[1]).read_text().splitlines(); kept=[]
for row in rows:
    if re.search(r'\b(?:EXTENSION - pg_cron|COMMENT - EXTENSION pg_cron)\b',row):
        kept.append('; pg_cron cluster scheduling excluded: '+row)
    else: kept.append(row)
pathlib.Path(sys.argv[2]).write_text('\n'.join(kept)+'\n')
PY
  TENANTSERVICE_RESTORE_DATABASE="tenantservice_restore_${RANDOM}_${RANDOM}"
  TENANTSERVICE_RESTORE_URL="postgresql://postgres:postgres@127.0.0.1:54322/$TENANTSERVICE_RESTORE_DATABASE"
  psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -c \
    "create database \"$TENANTSERVICE_RESTORE_DATABASE\" with template template0;"
  # Keep template0's initdb public namespace. The matching PostgreSQL 17
  # archive relies on it for public ownership/ACL and application objects.
  # An empty application database has no non-system relations; the namespace
  # itself does not weaken that check. All original archive records remain.
  [[ "$(psql "$TENANTSERVICE_RESTORE_URL" -X -At -v ON_ERROR_STOP=1 -c \
    "select exists(select 1 from pg_namespace where nspname='public');")" == t ]]
  [[ "$(psql "$TENANTSERVICE_RESTORE_URL" -X -At -v ON_ERROR_STOP=1 -c \
    "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not like 'pg_%' and n.nspname <> 'information_schema';")" == 0 ]]
  echo 'TENANTSERVICE_RESTORE_EMPTY_TEMPLATE0_DATABASE_PASS'
  tenantservice_restore_archive "$TENANTSERVICE_RESTORE_DATABASE" "$TENANTSERVICE_RESTORE_URL"
  echo 'TENANTSERVICE_RESTORE_REAL_PG_DUMP_ARCHIVE_PASS'
  tenantservice_restore_bootstrap_acl "$TENANTSERVICE_RESTORE_DATABASE" "$TENANTSERVICE_RESTORE_URL"
  psql "$TENANTSERVICE_RESTORE_URL" -X -At -v ON_ERROR_STOP=1 \
    -f "$TENANTSERVICE_CANDIDATE_ROOT/scripts/sql/tenantservice-restore-data-fingerprint.sql" \
    > "$TENANTSERVICE_TEMP/data-after.sha256"
  if ! cmp "$TENANTSERVICE_TEMP/data-before.sha256" "$TENANTSERVICE_TEMP/data-after.sha256"; then
    psql "$TENANTSERVICE_RESTORE_URL" -X -At -v ON_ERROR_STOP=1 -v tenantservice_catalog_detail=1 \
      -f "$TENANTSERVICE_CANDIDATE_ROOT/scripts/sql/tenantservice-restore-data-fingerprint.sql" \
      > "$TENANTSERVICE_TEMP/restore-catalog-after.json"
    node "$TENANTSERVICE_CANDIDATE_ROOT/scripts/tenantservice-restore-catalog-diagnostic.cjs" \
      "$TENANTSERVICE_TEMP/restore-catalog-before.json" "$TENANTSERVICE_TEMP/restore-catalog-after.json" || true
    echo 'TENANTSERVICE_RESTORE_DATA_OR_CATALOG_FINGERPRINT_MISMATCH' >&2
    exit 1
  fi
  echo 'TENANTSERVICE_RESTORE_APPLICATION_AUTH_DATA_FINGERPRINT_PASS'
  echo 'TENANTSERVICE_RESTORE_OWNER_COLUMN_DEFAULT_ACL_FINGERPRINT_PASS'
  psql "$TENANTSERVICE_RESTORE_URL" -X -At -v ON_ERROR_STOP=1 -v 'schemas={public,private,auth,storage,gridex_received_sources}' \
    -f "$TENANTSERVICE_CANDIDATE_ROOT/scripts/sql/gridex-db-parity-introspect.sql" \
    > "$TENANTSERVICE_TEMP/catalog-after.json"
  if ! python3 - "$TENANTSERVICE_TEMP/catalog-before.json" "$TENANTSERVICE_TEMP/catalog-after.json" <<'PY'
import json,pathlib,sys
before,after=(json.loads(pathlib.Path(p).read_text()) for p in sys.argv[1:])
for document in (before,after):
    document['extensions']=[e for e in document['extensions'] if e['extname'] != 'pg_cron']
if before != after:
    differences=[k for k in sorted(before.keys()|after.keys()) if before.get(k) != after.get(k)]
    raise SystemExit('restored schema/ACL catalog mismatch: '+','.join(differences))
print('TENANTSERVICE_RESTORE_SCHEMA_FUNCTION_RLS_ACL_PARITY_PASS')
PY
  then
    node "$TENANTSERVICE_CANDIDATE_ROOT/scripts/tenantservice-restore-schema-diagnostic.cjs" \
      "$TENANTSERVICE_TEMP/catalog-before.json" "$TENANTSERVICE_TEMP/catalog-after.json" || true
    exit 1
  fi
  tenantservice_sql "$TENANTSERVICE_RESTORE_URL" "$TENANTSERVICE_CANDIDATE_ROOT/scripts/sql/tenantservice-upgrade-postcheck.sql"
  tenantservice_sql "$TENANTSERVICE_RESTORE_URL" "$TENANTSERVICE_CANDIDATE_ROOT/scripts/sql/tenantservice-restore-proof.sql"
  # The positive/negative authorization proof is rolled back; data must still
  # match the actual backup, including sessions and issued invoice bytes.
  psql "$TENANTSERVICE_RESTORE_URL" -X -At -v ON_ERROR_STOP=1 \
    -f "$TENANTSERVICE_CANDIDATE_ROOT/scripts/sql/tenantservice-restore-data-fingerprint.sql" \
    > "$TENANTSERVICE_TEMP/data-post-proof.sha256"
  cmp "$TENANTSERVICE_TEMP/data-before.sha256" "$TENANTSERVICE_TEMP/data-post-proof.sha256"
  psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -c "drop database \"$TENANTSERVICE_RESTORE_DATABASE\";"
  echo 'TENANTSERVICE_RESTORE_POST_PROOF_NO_PERSISTED_EFFECT_PASS'
  cmp "$TENANTSERVICE_CANDIDATE_ROOT/supabase/schema.sql" "$TENANTSERVICE_TEMP/upgraded-schema/schema.sql"
  cmp "$TENANTSERVICE_CANDIDATE_ROOT/supabase/schema.fingerprint.json" "$TENANTSERVICE_TEMP/upgraded-schema/schema.fingerprint.json"
  echo 'TENANTSERVICE_UPGRADE_CANDIDATE_CLEAN_SCHEMA_ARTIFACT_PARITY_PASS'
  echo 'TENANTSERVICE_UPGRADE_RESTORE_NATIVE_PROOF_PASS'
)
