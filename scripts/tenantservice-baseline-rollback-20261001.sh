#!/usr/bin/env bash
# Pre-forward logical rollback drill on a private, pinned old Supabase stack.
# No candidate migration is applied. Cluster roles pre-exist on this disposable
# cluster; storage object bytes, hosted PITR and live dispatch are outside scope.
set -euo pipefail
umask 077
readonly TENANTSERVICE_CANDIDATE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly TENANTSERVICE_BASELINE_SHA=ae56ee0a1e0e8adbce9d5f4d92da75cdcb8010c8
readonly TENANTSERVICE_ROLLBACK_MODE="${1:-}"
if [[ -n "$TENANTSERVICE_ROLLBACK_MODE" && "$TENANTSERVICE_ROLLBACK_MODE" != --plan-only ]]; then
  echo 'usage: scripts/tenantservice-baseline-rollback-20261001.sh [--plan-only]' >&2; exit 2
fi
if [[ -n "${GRIDEX_REPLAY_DB_URL:-}" ]]; then
  echo 'TENANTSERVICE_BASELINE_ROLLBACK_EXTERNAL_URL_REFUSED' >&2; exit 2
fi
if [[ "$TENANTSERVICE_ROLLBACK_MODE" != --plan-only && "${CI:-}" != true ]]; then
  echo 'TENANTSERVICE_BASELINE_ROLLBACK_DISPOSABLE_CI_REQUIRED' >&2; exit 2
fi
test -n "${RUNNER_TEMP:-}" || { echo 'RUNNER_TEMP is required' >&2; exit 2; }
# This private directory prefix is deliberately the exact existing helper's
# boundary. A differently named target must not weaken or bypass that guard.
readonly TENANTSERVICE_TEMP="$(mktemp -d "$RUNNER_TEMP/tenantservice-upgrade-restore.XXXXXX")"
tenantservice_baseline_cleanup(){
  local original_status="$1"
  if [[ "$original_status" != 0 ]]; then
    echo 'TENANTSERVICE_BASELINE_ROLLBACK_FAILED_PRIVATE_LOGS_REMOVED' >&2
  fi
  rm -rf "$TENANTSERVICE_TEMP"
  return "$original_status"
}
trap 'tenantservice_baseline_cleanup "$?"' EXIT

# Copy only the two named trusted repository helpers, byte for byte. The source
# contains no workflow top-level provisioning or EXIT trap. Hash both the whole
# reviewed file and exact helper region, then parse the private copy before use.
python3 - "$TENANTSERVICE_CANDIDATE_ROOT" "$TENANTSERVICE_TEMP" <<'PY'
import hashlib,pathlib,sys
root,temporary=map(pathlib.Path,sys.argv[1:])
source=(root/'scripts/tenantservice-upgrade-restore.sh').read_bytes()
begin=b'tenantservice_local_docker(){\n'; end=b'tenantservice_private_cleanup(){\n'
if source.count(begin)!=1 or source.count(end)!=1:
    raise SystemExit('TENANTSERVICE_BASELINE_ROLLBACK_HELPER_BOUNDARY_INVALID')
start=source.index(begin); stop=source.index(end)
if stop<=start: raise SystemExit('TENANTSERVICE_BASELINE_ROLLBACK_HELPER_ORDER_INVALID')
region=source[start:stop]
if region.count(b'tenantservice_restore_archive(){\n')!=1:
    raise SystemExit('TENANTSERVICE_BASELINE_ROLLBACK_RESTORE_HELPER_INVALID')
(temporary/'restore-helpers.sh').write_bytes(region)
print('TENANTSERVICE_BASELINE_ROLLBACK_HELPER_SOURCE_SHA256='+hashlib.sha256(source).hexdigest())
print('TENANTSERVICE_BASELINE_ROLLBACK_HELPER_SHA256='+hashlib.sha256(region).hexdigest())
PY
bash -n "$TENANTSERVICE_TEMP/restore-helpers.sh"
source "$TENANTSERVICE_TEMP/restore-helpers.sh"
# BEGIN_BASELINE_BOOTSTRAP_SOURCE
# Capture the trusted ACL helper and its exact generator/catalog dependencies.
# Only its definitions are privately sourced; no provisioning code is copied.
python3 - "$TENANTSERVICE_CANDIDATE_ROOT" "$TENANTSERVICE_TEMP" <<'PY'
import hashlib,json,pathlib,sys
root,temporary=map(pathlib.Path,sys.argv[1:])
names=('scripts/tenantservice-restore-bootstrap-acl.sh','scripts/tenantservice-restore-bootstrap-acl.cjs',
       'scripts/tenantservice-restore-catalog-diagnostic.cjs','scripts/sql/tenantservice-restore-data-fingerprint.sql')
manifest={}
for name in names:
    data=(root/name).read_bytes(); manifest[name]=hashlib.sha256(data).hexdigest()
    if name.endswith('bootstrap-acl.sh'):
        if data.count(b'tenantservice_restore_bootstrap_acl(){\n')!=1:
            raise SystemExit('TENANTSERVICE_BASELINE_ROLLBACK_BOOTSTRAP_BOUNDARY_INVALID')
        (temporary/'bootstrap-helpers.sh').write_bytes(data)
    print('TENANTSERVICE_BASELINE_ROLLBACK_BOOTSTRAP_SOURCE_SHA256 script='+pathlib.Path(name).name+' sha256='+manifest[name])
(temporary/'bootstrap-source.json').write_text(json.dumps(manifest,sort_keys=True)+'\n')
PY
bash -n "$TENANTSERVICE_TEMP/bootstrap-helpers.sh"
source "$TENANTSERVICE_TEMP/bootstrap-helpers.sh"
tenantservice_baseline_bootstrap_source_guard(){
  python3 - "$TENANTSERVICE_CANDIDATE_ROOT" "$TENANTSERVICE_TEMP" <<'PY'
import hashlib,json,pathlib,sys
root,temporary=map(pathlib.Path,sys.argv[1:])
names={'scripts/tenantservice-restore-bootstrap-acl.sh','scripts/tenantservice-restore-bootstrap-acl.cjs',
       'scripts/tenantservice-restore-catalog-diagnostic.cjs','scripts/sql/tenantservice-restore-data-fingerprint.sql'}
try:
    manifest=json.loads((temporary/'bootstrap-source.json').read_text())
    valid=set(manifest)==names and all(hashlib.sha256((root/name).read_bytes()).hexdigest()==manifest[name] for name in names)
    valid=valid and hashlib.sha256((temporary/'bootstrap-helpers.sh').read_bytes()).hexdigest()==manifest['scripts/tenantservice-restore-bootstrap-acl.sh']
except (OSError,ValueError,TypeError,KeyError): valid=False
if not valid: raise SystemExit('TENANTSERVICE_BASELINE_ROLLBACK_BOOTSTRAP_SOURCE_CHANGED')
PY
}
tenantservice_baseline_bootstrap_source_guard
# END_BASELINE_BOOTSTRAP_SOURCE
mkdir "$TENANTSERVICE_TEMP/baseline"
git -C "$TENANTSERVICE_CANDIDATE_ROOT" cat-file -e "$TENANTSERVICE_BASELINE_SHA^{commit}"
git -C "$TENANTSERVICE_CANDIDATE_ROOT" archive "$TENANTSERVICE_BASELINE_SHA" |
  tar -x -C "$TENANTSERVICE_TEMP/baseline"
python3 - "$TENANTSERVICE_CANDIDATE_ROOT" "$TENANTSERVICE_TEMP/baseline" <<'PY'
import hashlib,pathlib,sys
root,old=map(pathlib.Path,sys.argv[1:]); files=sorted((old/'supabase/migrations').glob('*.sql'))
if len(files)!=653: raise SystemExit('TENANTSERVICE_BASELINE_ROLLBACK_PINNED_INVENTORY_MISMATCH')
for source in files:
    current=root/'supabase/migrations'/source.name
    if not current.is_file() or current.read_bytes()!=source.read_bytes():
        raise SystemExit('TENANTSERVICE_BASELINE_ROLLBACK_HISTORICAL_BYTES_CHANGED')
print('TENANTSERVICE_BASELINE_ROLLBACK_PLAN_VALIDATED baseline_migrations='+str(len(files)))
PY
echo "TENANTSERVICE_BASELINE_ROLLBACK_BASELINE_SHA=$TENANTSERVICE_BASELINE_SHA"
if [[ "$TENANTSERVICE_ROLLBACK_MODE" == --plan-only ]]; then
  echo 'TENANTSERVICE_BASELINE_ROLLBACK_PLAN_ONLY_NATIVE_NOT_EXECUTED'; exit 0
fi
for required in supabase psql python3 node docker; do command -v "$required" >/dev/null; done
readonly TENANTSERVICE_PG_DUMP="${GRIDEX_PG_DUMP:-pg_dump}"
readonly TENANTSERVICE_PG_RESTORE="${GRIDEX_PG_RESTORE:-pg_restore}"
command -v "$TENANTSERVICE_PG_DUMP" >/dev/null
command -v "$TENANTSERVICE_PG_RESTORE" >/dev/null
[[ "$(node -p 'process.versions.node.split(".")[0]')" == 22 ]] || {
  echo 'TENANTSERVICE_BASELINE_ROLLBACK_NODE22_REQUIRED' >&2; exit 2;
}

# This proof uses ONLY the actual old service-only contact v1 interface. The
# pinned version has actor/membership/permission checks, but no sessionId input;
# it must never be advertised as proof of newer session-bound command semantics.
cat > "$TENANTSERVICE_TEMP/old-schema-proof.sql" <<'OLD_SCHEMA_PROOF'
\set ON_ERROR_STOP on
\set QUIET on
begin;
do $old_shape$
begin
 if exists(select 1 from information_schema.columns where table_schema='public'
  and table_name='customers' and column_name in ('billing_profile','profile_revision','address_book_revision'))
  or to_regprocedure('public.gridex_change_customer_billing_profile_v1(jsonb)') is not null then
  raise exception 'baseline_rollback_was_not_pre_forward_old_schema'; end if;
 if not has_function_privilege('service_role','public.gridex_change_customer_contact_v1(jsonb)','EXECUTE')
  or has_function_privilege('authenticated','public.gridex_change_customer_contact_v1(jsonb)','EXECUTE')
  or has_function_privilege('anon','public.gridex_change_customer_contact_v1(jsonb)','EXECUTE') then
  raise exception 'baseline_rollback_old_contact_grants_not_retained'; end if;
end;
$old_shape$;
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated',
 'sub','e4954930-0000-4000-8000-000000000011',
 'session_id','e4954930-0000-4000-8000-000000000021')::text,true) as jwt_claims \gset
set local role authenticated;
do $old_authenticated$
declare denied boolean:=false;
begin
 if auth.uid() is distinct from 'e4954930-0000-4000-8000-000000000011'::uuid
  or (select count(*) from public.customers where id='e4954930-0000-4000-8000-000000000031')<>1
  or exists(select 1 from public.customers where company_id='e4954930-0000-4000-8000-000000000002') then
  raise exception 'baseline_rollback_old_tenant_read_rls_failed'; end if;
 begin update public.customers set email='denied-raw@example.invalid'
  where id='e4954930-0000-4000-8000-000000000031';
 exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'baseline_rollback_authenticated_raw_write_not_denied'; end if;
 denied:=false;
 begin perform public.gridex_change_customer_contact_v1('{}');
 exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'baseline_rollback_authenticated_command_not_denied'; end if;
end;
$old_authenticated$;
reset role;
select set_config('request.jwt.claims','{"role":"anon"}',true) as jwt_claims \gset
set local role anon;
do $old_anonymous$
declare denied boolean:=false;
begin
 if auth.uid() is not null then raise exception 'baseline_rollback_anon_identity_invalid'; end if;
 begin
  if exists(select 1 from public.customers) then
   raise exception 'baseline_rollback_anonymous_read_not_denied'; end if;
 exception when insufficient_privilege then null; end;
 begin update public.customers set email='denied-anon@example.invalid';
 exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'baseline_rollback_anonymous_raw_write_not_denied'; end if;
 denied:=false;
 begin perform public.gridex_change_customer_contact_v1('{}');
 exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'baseline_rollback_anonymous_command_not_denied'; end if;
end;
$old_anonymous$;
\echo TENANTSERVICE_BASELINE_ROLLBACK_OLD_RLS_LOW_ROLE_DENIAL_PASS
reset role;
select set_config('request.jwt.claims','{}',true) as jwt_claims \gset
set local role service_role;
do $old_command$
declare command jsonb:=jsonb_build_object('companyId','e4954930-0000-4000-8000-000000000001',
 'customerId','e4954930-0000-4000-8000-000000000031',
 'contactId','e4954930-0000-4000-8000-000000000041',
 'actorUserId','e4954930-0000-4000-8000-000000000011','mode','ops',
 'reason','Synthetic old-schema rollback command','expectedRevision',0,
 'idempotencyKey','baseline-rollback-old-contact',
 'changes',jsonb_build_object('email','restored-old-contact@example.invalid'));
 denied boolean:=false; result jsonb; replay jsonb;
begin
 begin perform public.gridex_change_customer_contact_v1(command||jsonb_build_object(
  'companyId','e4954930-0000-4000-8000-000000000002',
  'customerId','e4954930-0000-4000-8000-000000000032','idempotencyKey','baseline-rollback-foreign'));
 exception when insufficient_privilege then denied:=sqlerrm='contact_actor_forbidden'; end;
 if not denied then raise exception 'baseline_rollback_old_foreign_company_not_denied'; end if;
 denied:=false;
 begin perform public.gridex_change_customer_contact_v1(command||jsonb_build_object(
  'actorUserId','e4954930-0000-4000-8000-000000000012','idempotencyKey','baseline-rollback-denied'));
 exception when insufficient_privilege then denied:=sqlerrm='contact_actor_forbidden'; end;
 if not denied then raise exception 'baseline_rollback_old_explicit_permission_not_denied'; end if;
 if exists(select 1 from public.canonical_command_results where idempotency_key in
   ('baseline-rollback-foreign','baseline-rollback-denied')) then
  raise exception 'baseline_rollback_old_denial_persisted_effect'; end if;
 result:=public.gridex_change_customer_contact_v1(command);
 replay:=public.gridex_change_customer_contact_v1(command);
 if (result->>'changed')::boolean is distinct from true
  or (result->>'revision')::bigint<>1 or (replay->>'replayed')::boolean is distinct from true
  or (select email from public.customers where id='e4954930-0000-4000-8000-000000000031')
   is distinct from 'restored-old-contact@example.invalid'
  or (select count(*) from public.canonical_command_results where idempotency_key='baseline-rollback-old-contact')<>1
  or (select count(*) from public.canonical_audit_events where idempotency_key='baseline-rollback-old-contact')<>1
  or (select count(*) from public.canonical_domain_events where idempotency_key='baseline-rollback-old-contact')<>1
  or (select count(*) from public.canonical_event_outbox where idempotency_key='baseline-rollback-old-contact')<>1 then
  raise exception 'baseline_rollback_old_command_or_replay_failed'; end if;
end;
$old_command$;
reset role;
update public.user_permissions set effect='deny' where user_id='e4954930-0000-4000-8000-000000000011'
 and company_id='e4954930-0000-4000-8000-000000000001' and permission_key='masterdata.write';
set local role service_role;
do $old_revocation$
declare denied boolean:=false;
begin
 begin perform public.gridex_change_customer_contact_v1(jsonb_build_object(
  'companyId','e4954930-0000-4000-8000-000000000001','customerId','e4954930-0000-4000-8000-000000000031',
  'contactId','e4954930-0000-4000-8000-000000000041',
  'actorUserId','e4954930-0000-4000-8000-000000000011','mode','ops',
  'reason','Synthetic old-schema rollback command','expectedRevision',0,
  'idempotencyKey','baseline-rollback-old-contact','changes',jsonb_build_object('email','restored-old-contact@example.invalid')));
 exception when insufficient_privilege then denied:=sqlerrm='contact_actor_forbidden'; end;
 if not denied then raise exception 'baseline_rollback_old_current_permission_replay_not_denied'; end if;
end;
$old_revocation$;
\echo TENANTSERVICE_BASELINE_ROLLBACK_OLD_CURRENT_COMMAND_REPLAY_REVOKED_PERMISSION_PASS
rollback;
OLD_SCHEMA_PROOF

(
  cd "$TENANTSERVICE_TEMP/baseline"
  # Preserve the historical script's own EXIT stack/checkout cleanup. Source is
  # not under if/!, so Bash errexit remains enabled during the real old replay.
  source scripts/gridex-aud-003-clean-replay.sh > "$TENANTSERVICE_TEMP/baseline-clean.log" 2>&1
  [[ "$DB_URL" == postgresql://postgres:postgres@127.0.0.1:54322/postgres ]]
  echo 'TENANTSERVICE_BASELINE_ROLLBACK_PINNED_PRE_FORWARD_REPLAY_PASS'
  tenantservice_baseline_sql(){
    local database="$1" input="$2" log="$TENANTSERVICE_TEMP/$(basename "$2").log"
    if ! psql "$database" -X -q -v ON_ERROR_STOP=1 -f "$input" > "$log" 2>&1; then
      echo 'TENANTSERVICE_BASELINE_ROLLBACK_SQL_FAILED_PRIVATE_CONTEXT' >&2; return 1;
    fi
    awk '/^TENANTSERVICE_(UPGRADE|BASELINE_ROLLBACK)_[A-Z0-9_]+_PASS$/' "$log"
  }
  tenantservice_baseline_sql "$DB_URL" "$TENANTSERVICE_CANDIDATE_ROOT/scripts/sql/tenantservice-upgrade-fixture.sql"
  tenantservice_baseline_fingerprints(){
    local database="$1" phase="$2"
    psql "$database" -X -At -v ON_ERROR_STOP=1 \
      -f "$TENANTSERVICE_CANDIDATE_ROOT/scripts/sql/tenantservice-upgrade-immutable-fingerprint.sql" \
      > "$TENANTSERVICE_TEMP/issued-$phase.sha256" 2> "$TENANTSERVICE_TEMP/issued-$phase.log"
    psql "$database" -X -At -v ON_ERROR_STOP=1 \
      -f "$TENANTSERVICE_CANDIDATE_ROOT/scripts/sql/tenantservice-restore-data-fingerprint.sql" \
      > "$TENANTSERVICE_TEMP/data-$phase.sha256" 2> "$TENANTSERVICE_TEMP/data-$phase.log"
    psql "$database" -X -At -v ON_ERROR_STOP=1 -v tenantservice_catalog_detail=1 \
      -f "$TENANTSERVICE_CANDIDATE_ROOT/scripts/sql/tenantservice-restore-data-fingerprint.sql" \
      > "$TENANTSERVICE_TEMP/restore-catalog-$phase.json" 2> "$TENANTSERVICE_TEMP/restore-catalog-$phase.log"
    psql "$database" -X -At -v ON_ERROR_STOP=1 -v 'schemas={public,private,auth,storage,gridex_received_sources}' \
      -f "$TENANTSERVICE_CANDIDATE_ROOT/scripts/sql/gridex-db-parity-introspect.sql" \
      > "$TENANTSERVICE_TEMP/catalog-$phase.json" 2> "$TENANTSERVICE_TEMP/catalog-$phase.log"
    python3 - "$TENANTSERVICE_TEMP/issued-$phase.sha256" "$TENANTSERVICE_TEMP/data-$phase.sha256" <<'PY'
import pathlib,re,sys
for filename,count in zip(sys.argv[1:],(1,2)):
    rows=pathlib.Path(filename).read_text().splitlines()
    if len(rows)!=count or any(not re.fullmatch('[0-9a-f]{64}',r) for r in rows):
        raise SystemExit('TENANTSERVICE_BASELINE_ROLLBACK_DIGEST_SHAPE_INVALID')
PY
  }
  tenantservice_baseline_fingerprints "$DB_URL" before
  "$TENANTSERVICE_PG_DUMP" "$DB_URL" --format=custom --exclude-schema=cron \
    --file="$TENANTSERVICE_TEMP/database.dump" 2> "$TENANTSERVICE_TEMP/dump.log"
  "$TENANTSERVICE_PG_RESTORE" --list "$TENANTSERVICE_TEMP/database.dump" \
    > "$TENANTSERVICE_TEMP/restore.toc" 2> "$TENANTSERVICE_TEMP/restore-list.log"
  python3 - "$TENANTSERVICE_TEMP/restore.toc" "$TENANTSERVICE_TEMP/restore.filtered.toc" <<'PY'
import pathlib,re,sys
rows=pathlib.Path(sys.argv[1]).read_text().splitlines()
kept=['; pg_cron cluster scheduling excluded: '+r if re.search(r'\b(?:EXTENSION - pg_cron|COMMENT - EXTENSION pg_cron)\b',r) else r for r in rows]
pathlib.Path(sys.argv[2]).write_text('\n'.join(kept)+'\n')
PY
  TENANTSERVICE_RESTORE_DATABASE="tenantservice_restore_${RANDOM}_${RANDOM}"
  TENANTSERVICE_RESTORE_URL="postgresql://postgres:postgres@127.0.0.1:54322/$TENANTSERVICE_RESTORE_DATABASE"
  psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -c \
    "create database \"$TENANTSERVICE_RESTORE_DATABASE\" with template template0;" \
    > "$TENANTSERVICE_TEMP/create-database.log" 2>&1
  [[ "$(psql "$TENANTSERVICE_RESTORE_URL" -X -At -v ON_ERROR_STOP=1 -c \
    "select exists(select 1 from pg_namespace where nspname='public');" 2> "$TENANTSERVICE_TEMP/empty-public.log")" == t ]]
  [[ "$(psql "$TENANTSERVICE_RESTORE_URL" -X -At -v ON_ERROR_STOP=1 -c \
    "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not like 'pg_%' and n.nspname <> 'information_schema';" \
    2> "$TENANTSERVICE_TEMP/empty-relations.log")" == 0 ]]
  echo 'TENANTSERVICE_BASELINE_ROLLBACK_NEW_TEMPLATE0_EMPTY_DATABASE_PASS'
  tenantservice_restore_archive "$TENANTSERVICE_RESTORE_DATABASE" "$TENANTSERVICE_RESTORE_URL"
  echo 'TENANTSERVICE_BASELINE_ROLLBACK_REAL_ARCHIVE_PASS'
  # Only replay actual source privileges missing from the five observed vendor
  # bootstrap objects. The helper rechecks exact target catalog/admin/OID; any
  # other divergence is fatal. Original complete digests still gate afterwards.
  tenantservice_baseline_bootstrap_source_guard
  tenantservice_restore_bootstrap_acl "$TENANTSERVICE_RESTORE_DATABASE" "$TENANTSERVICE_RESTORE_URL"
  tenantservice_baseline_bootstrap_source_guard
  tenantservice_baseline_fingerprints "$TENANTSERVICE_RESTORE_URL" restored
  cmp -s "$TENANTSERVICE_TEMP/issued-before.sha256" "$TENANTSERVICE_TEMP/issued-restored.sha256"
  if ! cmp -s "$TENANTSERVICE_TEMP/data-before.sha256" "$TENANTSERVICE_TEMP/data-restored.sha256"; then
    node "$TENANTSERVICE_CANDIDATE_ROOT/scripts/tenantservice-restore-catalog-diagnostic.cjs" \
      "$TENANTSERVICE_TEMP/restore-catalog-before.json" "$TENANTSERVICE_TEMP/restore-catalog-restored.json" || true
    echo 'TENANTSERVICE_BASELINE_ROLLBACK_DATA_OR_OWNER_ACL_FINGERPRINT_MISMATCH' >&2; exit 1
  fi
  echo 'TENANTSERVICE_BASELINE_ROLLBACK_OLD_BUSINESS_AUTH_ISSUED_OWNER_ACL_FINGERPRINT_PASS'
  python3 - "$TENANTSERVICE_TEMP/catalog-before.json" "$TENANTSERVICE_TEMP/catalog-restored.json" <<'PY'
import json,pathlib,sys
documents=[json.loads(pathlib.Path(p).read_text()) for p in sys.argv[1:]]
for document in documents:
    document['extensions']=[e for e in document['extensions'] if e['extname']!='pg_cron']
if documents[0]!=documents[1]: raise SystemExit('TENANTSERVICE_BASELINE_ROLLBACK_OLD_CATALOG_PARITY_MISMATCH')
print('TENANTSERVICE_BASELINE_ROLLBACK_OLD_SCHEMA_FUNCTION_RLS_ACL_PARITY_PASS')
PY
  tenantservice_baseline_sql "$TENANTSERVICE_RESTORE_URL" "$TENANTSERVICE_TEMP/old-schema-proof.sql"
  tenantservice_baseline_fingerprints "$TENANTSERVICE_RESTORE_URL" post-proof
  cmp -s "$TENANTSERVICE_TEMP/issued-before.sha256" "$TENANTSERVICE_TEMP/issued-post-proof.sha256"
  cmp -s "$TENANTSERVICE_TEMP/data-before.sha256" "$TENANTSERVICE_TEMP/data-post-proof.sha256"
  cmp -s "$TENANTSERVICE_TEMP/catalog-restored.json" "$TENANTSERVICE_TEMP/catalog-post-proof.json"
  psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -c "drop database \"$TENANTSERVICE_RESTORE_DATABASE\";" \
    > "$TENANTSERVICE_TEMP/drop-database.log" 2>&1
  echo 'TENANTSERVICE_BASELINE_ROLLBACK_POST_PROOF_NO_PERSISTED_EFFECT_PASS'
)
echo 'TENANTSERVICE_BASELINE_ROLLBACK_ALL_PASS'
