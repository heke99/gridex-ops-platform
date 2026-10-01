# Trusted helper definitions only. Source from the owned disposable proof.
tenantservice_restore_bootstrap_acl(){
  local restore_database="$1" restore_url="$2"
  local restore_container='supabase_db_gridex-ops-platform'
  local target_oid admin_evidence
  if [[ "${CI:-}" != true || "${DB_URL:-}" != postgresql://postgres:postgres@127.0.0.1:54322/postgres ||
        -z "${RUNNER_TEMP:-}" || "$TENANTSERVICE_TEMP" != "$RUNNER_TEMP"/tenantservice-upgrade-restore.* ||
        ! "$restore_database" =~ ^tenantservice_restore_[0-9]+_[0-9]+$ ||
        "$restore_url" != "postgresql://postgres:postgres@127.0.0.1:54322/$restore_database" ]]; then
    echo 'TENANTSERVICE_BOOTSTRAP_ACL_LOCAL_BOUNDARY_REQUIRED' >&2; return 2
  fi
  if ! psql "$restore_url" -XAtq -v ON_ERROR_STOP=1 -v tenantservice_catalog_detail=1 \
    -f "$TENANTSERVICE_CANDIDATE_ROOT/scripts/sql/tenantservice-restore-data-fingerprint.sql" \
    > "$TENANTSERVICE_TEMP/bootstrap-restored-catalog.json" 2> "$TENANTSERVICE_TEMP/bootstrap-catalog.log"; then
    echo 'TENANTSERVICE_BOOTSTRAP_ACL_TARGET_CAPTURE_FAILED' >&2; return 1
  fi
  if ! node "$TENANTSERVICE_CANDIDATE_ROOT/scripts/tenantservice-restore-bootstrap-acl.cjs" \
    "$TENANTSERVICE_TEMP/restore-catalog-before.json" "$TENANTSERVICE_TEMP/bootstrap-restored-catalog.json" \
    "$TENANTSERVICE_TEMP/bootstrap-acl.sql" > "$TENANTSERVICE_TEMP/bootstrap-plan.log" 2>&1; then
    node "$TENANTSERVICE_CANDIDATE_ROOT/scripts/tenantservice-restore-catalog-diagnostic.cjs" \
      "$TENANTSERVICE_TEMP/restore-catalog-before.json" "$TENANTSERVICE_TEMP/bootstrap-restored-catalog.json" || true
    echo 'TENANTSERVICE_BOOTSTRAP_ACL_UNSUPPORTED_CATALOG_DIVERGENCE' >&2; return 1
  fi
  if [[ -s "$TENANTSERVICE_TEMP/bootstrap-acl.sql" ]]; then
    if ! target_oid="$(psql "$restore_url" -XAtq -v ON_ERROR_STOP=1 -c \
      'select oid from pg_database where datname=current_database();' 2>> "$TENANTSERVICE_TEMP/bootstrap-authority.log")"; then
      echo 'TENANTSERVICE_BOOTSTRAP_ACL_TARGET_OID_FAILED' >&2; return 1
    fi
    [[ "$target_oid" =~ ^[0-9]+$ ]] || { echo 'TENANTSERVICE_BOOTSTRAP_ACL_TARGET_OID_INVALID' >&2; return 1; }
    if ! admin_evidence="$(tenantservice_local_docker exec "$restore_container" psql \
      --host=127.0.0.1 --port=5432 --username=supabase_admin --no-password \
      --dbname="$restore_database" -XAtq -v ON_ERROR_STOP=1 -c \
      "select session_user||'|'||current_user||'|'||r.rolsuper::text||'|'||d.oid::text \
       from pg_roles r,pg_database d where r.rolname=current_user and d.datname=current_database();" \
      2>> "$TENANTSERVICE_TEMP/bootstrap-authority.log")"; then
      echo 'TENANTSERVICE_BOOTSTRAP_ACL_ADMIN_CONNECTION_FAILED' >&2; return 1
    fi
    [[ "$admin_evidence" == "supabase_admin|supabase_admin|true|$target_oid" ]] || {
      echo 'TENANTSERVICE_BOOTSTRAP_ACL_ADMIN_AUTHORITY_MISMATCH' >&2; return 1;
    }
    # This is the same owned random database, not a hosted or linked target.
    # The private SQL independently rechecks its complete captured catalog
    # in one transaction before applying source-only missing privileges.
    if ! tenantservice_local_docker exec -i "$restore_container" psql \
      --host=127.0.0.1 --port=5432 --username=supabase_admin --no-password \
      --dbname="$restore_database" -X -q -v ON_ERROR_STOP=1 \
      < "$TENANTSERVICE_TEMP/bootstrap-acl.sql" > "$TENANTSERVICE_TEMP/bootstrap-apply.log" 2>&1; then
      echo 'TENANTSERVICE_BOOTSTRAP_ACL_REPLAY_FAILED' >&2; return 1
    fi
  fi
  echo 'TENANTSERVICE_RESTORE_SOURCE_BOOTSTRAP_ACL_RECONCILIATION_PASS'
}
