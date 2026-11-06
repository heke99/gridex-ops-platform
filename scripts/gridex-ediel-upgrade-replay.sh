#!/usr/bin/env bash
# Runs only in a disposable CI checkout. The historical replay owns its own
# local stack; it is stopped before a second, independent candidate clean run.
set -euo pipefail
CANDIDATE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CANDIDATE_SHA="$(git -C "$CANDIDATE_ROOT" rev-parse HEAD)"
CANDIDATE_TREE="$(git -C "$CANDIDATE_ROOT" rev-parse 'HEAD^{tree}')"
cd "$CANDIDATE_ROOT"
[[ "${GITHUB_ACTIONS:-}" == true && -n "${RUNNER_TEMP:-}" ]] || { echo 'upgrade_disposable_ci_runner_required' >&2; exit 1; }
[[ -z "${GRIDEX_REPLAY_DB_URL:-}" ]] || { echo 'upgrade_external_database_forbidden' >&2; exit 1; }
# Verified main ancestor: #420 preserves its green head's replay inputs exactly.
# The former d30 branch pin is not an ancestor after the #483–#489 split merges.
UPGRADE_BASE=53bf989b0ad402bb2ce151c186eea31f1ec9cf03
# Local047 uses the actual immutable missing-table history, never DROP TABLE
# simulation or an external/shared database. Runs serially after the two phases.
EDIEL047_MISSING_BASE=f23c1dc0c58f8bb1a55b83d8409e5712177b51b6
EDIEL047_FORWARD=20261106184525_ediel_operations_tables_replay_completeness.sql
UPGRADE_WORK="$(mktemp -d "$RUNNER_TEMP/gridex-upgrade.XXXXXX")"
UPGRADE_OUT="$CANDIDATE_ROOT/rem002-upgrade"
mkdir -p "$UPGRADE_OUT"
upgrade_cleanup() {
 local redaction_failed=0
 if [[ -f "$UPGRADE_WORK/native-status.json" ]]; then
  if ! python3 "$CANDIDATE_ROOT/scripts/gridex-redact-native-evidence.py" \
   --local-secrets "$UPGRADE_WORK/native-status.json" --root "$UPGRADE_OUT" \
   --root "$CANDIDATE_ROOT/rem002-upgrade-replay.log"; then
   rm -rf "$UPGRADE_OUT"
   rm -f "$CANDIDATE_ROOT/rem002-upgrade-replay.log"
   redaction_failed=1
  fi
 fi
 git -C "$CANDIDATE_ROOT" worktree remove --force "$UPGRADE_WORK/f23-missing" >/dev/null 2>&1 || true
 git -C "$CANDIDATE_ROOT" worktree remove --force "$UPGRADE_WORK/base" >/dev/null 2>&1 || true
 rm -rf "$UPGRADE_WORK"
 [[ "$redaction_failed" == 0 ]] || { echo 'native_evidence_redaction_failed; evidence_removed' >&2; return 1; }
}
trap upgrade_cleanup EXIT
python3 "$CANDIDATE_ROOT/scripts/gridex-ediel-upgrade-inputs.py" --base "$UPGRADE_BASE" --out "$UPGRADE_WORK/plan"
cp "$UPGRADE_WORK/plan/upgrade-inputs.json" "$UPGRADE_OUT/upgrade-inputs.json"
git worktree add --detach "$UPGRADE_WORK/base" "$UPGRADE_BASE"
application_schemas() {
 psql 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' -XAtq -v ON_ERROR_STOP=1 \
  -c "select string_agg(nspname,',' order by nspname) from pg_namespace where nspname='public' or starts_with(nspname,'gridex_');"
}
generate_upgrade_artifacts() {
 local destination="$1" schemas
 schemas="$(application_schemas)"
 [[ -n "$schemas" ]] || { echo 'upgrade_application_schemas_missing' >&2; return 1; }
 node "$CANDIDATE_ROOT/scripts/gridex-schema-snapshot.cjs" --mode write \
  --url 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' --out-dir "$destination/schema" --schemas "$schemas"
 supabase gen types typescript --local > "$destination/database.types.ts"
 node "$CANDIDATE_ROOT/scripts/apply-supabase-types-nullability-overrides.cjs" "$destination/database.types.ts"
}
# Catalog assertions supplement, never replace, whole-schema/type parity below.
assert_ediel047_contract() {
 psql "$DB_URL" -XAtq -v ON_ERROR_STOP=1 <<'SQL_EDIEL047'
BEGIN READ ONLY;
DO $assert$
DECLARE rel text; expected_columns integer;
BEGIN
 FOREACH rel IN ARRAY ARRAY['ediel_test_run_locks','ediel_agt_readiness','ediel_unlinked_test_messages'] LOOP
  IF to_regclass('public.' || rel) IS NULL THEN RAISE EXCEPTION 'ediel047_relation_missing: %', rel; END IF;
  expected_columns:=CASE rel WHEN 'ediel_test_run_locks' THEN 12 WHEN 'ediel_agt_readiness' THEN 25 ELSE 19 END;
  IF (SELECT count(*) FROM pg_attribute WHERE attrelid=to_regclass('public.' || rel) AND attnum>0 AND NOT attisdropped)<>expected_columns THEN
   RAISE EXCEPTION 'ediel047_column_contract_missing: %', rel;
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('public.' || rel)) OR
     NOT EXISTS (SELECT FROM pg_policies WHERE schemaname='public' AND tablename=rel AND policyname=rel || '_service_role_all' AND cmd='ALL'
                 AND regexp_replace(qual,'[[:space:]()]','','g')='auth.role=''service_role''::text'
                 AND regexp_replace(with_check,'[[:space:]()]','','g')='auth.role=''service_role''::text') THEN
   RAISE EXCEPTION 'ediel047_service_rls_missing: %', rel;
  END IF;
  IF EXISTS (SELECT FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) AS privilege(name)
             WHERE NOT has_table_privilege('service_role','public.' || rel,privilege.name)) OR
     has_table_privilege('anon','public.' || rel,'SELECT,INSERT,UPDATE,DELETE') OR
     has_table_privilege('authenticated','public.' || rel,'SELECT,INSERT,UPDATE,DELETE') THEN
   RAISE EXCEPTION 'ediel047_table_acl_mismatch: %', rel;
  END IF;
 END LOOP;
 IF NOT EXISTS (SELECT FROM pg_constraint WHERE conrelid='public.ediel_test_run_locks'::regclass AND conname='ediel_test_run_locks_company_fkey' AND confdeltype='c') OR
    NOT EXISTS (SELECT FROM pg_constraint WHERE conrelid='public.ediel_agt_readiness'::regclass AND conname='ediel_agt_readiness_company_fkey' AND confdeltype='c') OR
    EXISTS (SELECT FROM pg_constraint WHERE conrelid='public.ediel_unlinked_test_messages'::regclass AND contype='f') THEN
  RAISE EXCEPTION 'ediel047_company_foreign_key_mismatch';
 END IF;
 IF NOT EXISTS (SELECT FROM pg_index WHERE indexrelid=to_regclass('public.ediel_test_run_locks_one_active_agt_uidx') AND indisunique AND indisvalid AND pg_get_expr(indpred,indrelid)='(released_at IS NULL)') OR
    NOT EXISTS (SELECT FROM pg_index WHERE indexrelid=to_regclass('public.ediel_unlinked_test_messages_open_idx') AND indisvalid AND pg_get_expr(indpred,indrelid)='(status = ''unlinked''::text)') THEN
  RAISE EXCEPTION 'ediel047_partial_index_mismatch';
 END IF;
END $assert$;
SELECT json_build_object('phase','ediel047_catalog_contract','relations',3,'business_acceptance',false);
COMMIT;
SQL_EDIEL047
}
(
 cd "$UPGRADE_WORK/base"
 # Sourcing retains the authenticated local stack and the original migration
 # HOLD until all upgrade operations finish. Its EXIT trap restores old bytes.
 source scripts/gridex-aud-003-clean-replay.sh
 psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$CANDIDATE_ROOT/scripts/sql/gridex-ediel-upgrade-fixture.sql"
 psql "$DB_URL" -XAtq -v ON_ERROR_STOP=1 -f "$CANDIDATE_ROOT/scripts/sql/gridex-ediel-upgrade-fixture-observe.sql" > "$UPGRADE_OUT/retained-before.json"
 while IFS= read -r migration; do
  printf 'UPGRADE_APPLY: %s\n' "${migration##*/}"
  if [[ "${migration##*/}" == 20261001110500_ediel_utilts_current_execution_actor.sql ]]; then
    psql "$DB_URL" -XAtq -v ON_ERROR_STOP=1 \
      -v candidate_sha="$CANDIDATE_SHA" -v candidate_tree="$CANDIDATE_TREE" \
      -f "$CANDIDATE_ROOT/scripts/sql/ediel-utilts-pre-actor-catalog.sql" \
      > "$UPGRADE_OUT/utilts-pre110500.json"
    [[ -s "$UPGRADE_OUT/utilts-pre110500.json" ]] || { echo 'pre110500_original_public6_missing' >&2; exit 1; }
  fi
  if [[ "${migration##*/}" == 20261001000500_ediel_artifact_retention_decision_and_purge.sql ]]; then
    psql "$DB_URL" -XAtq -v ON_ERROR_STOP=1 -f "$CANDIDATE_ROOT/scripts/sql/ediel-retention-replay-role-diagnostic.sql"
  fi
  psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$migration"
 done < "$UPGRADE_WORK/plan/upgrade-inputs.list"
 mkdir -p "$UPGRADE_OUT/upgraded"
 supabase status -o json > "$UPGRADE_WORK/native-status.json"
 (
  cd "$CANDIDATE_ROOT"
  GRIDEX_NATIVE_STATUS="$UPGRADE_WORK/native-status.json" \
  GRIDEX_NATIVE_DATABASE_PHASE=upgrade \
  GRIDEX_UTILTS_PREUPGRADE_CATALOG_PATH="$UPGRADE_OUT/utilts-pre110500.json" \
  GRIDEX_UTILTS_CATALOG_RECEIPT_PATH="$UPGRADE_OUT/upgraded/utilts-catalog.json" \
  npx vitest run scripts/ediel-utilts-consumption-native.test.ts \
   --config scripts/ediel-source-owner-native.config.ts \
   -t 'native catalog binds preserved UTILTS OIDs to the only actor-protected callable chain' \
   --reporter=default --reporter=junit --outputFile="$UPGRADE_OUT/utilts-catalog-upgrade-junit.xml"
 )
 psql "$DB_URL" -XAtq -v ON_ERROR_STOP=1 -f "$CANDIDATE_ROOT/scripts/sql/gridex-ediel-upgrade-fixture-observe.sql" > "$UPGRADE_OUT/retained-after.json"
 cmp "$UPGRADE_OUT/retained-before.json" "$UPGRADE_OUT/retained-after.json"
 # An old original acquires no prospective legal approval as a side effect.
 psql "$DB_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
DO $assert$
BEGIN
 IF EXISTS(SELECT FROM gridex_ediel_inbound_context.receipts WHERE source_message_id='00000000-0000-4000-8000-00000000d082' AND status='ready') THEN
  RAISE EXCEPTION 'upgrade_fabricated_historical_legal_authority';
 END IF;
END $assert$;
SQL
 assert_ediel047_contract > "$UPGRADE_OUT/upgraded/ediel047-contract.json"
 generate_upgrade_artifacts "$UPGRADE_OUT/upgraded"
 python3 "$CANDIDATE_ROOT/scripts/ediel-received-context-upgrade-regression.py"
)
(
 cd "$CANDIDATE_ROOT"
 source scripts/gridex-aud-003-clean-replay.sh
 mkdir -p "$UPGRADE_OUT/clean"
 assert_ediel047_contract > "$UPGRADE_OUT/clean/ediel047-contract.json"
 generate_upgrade_artifacts "$UPGRADE_OUT/clean"
)
# A third serial, disposable stack proves the precise already-applied f23
# omission. No business/evidence DB, synthetic DROP or other forward is used.
git merge-base --is-ancestor "$EDIEL047_MISSING_BASE" "$CANDIDATE_SHA"
python3 - "$CANDIDATE_ROOT" "$EDIEL047_FORWARD" <<'PY_EDIEL047_PIN'
import hashlib,json,pathlib,sys
root=pathlib.Path(sys.argv[1]);name=sys.argv[2]
pin=json.loads((root/'scripts/migration-history-manifest.additions.json').read_text())['files'][name]
if hashlib.sha256((root/'supabase/migrations'/name).read_bytes()).hexdigest()!=pin:
 raise SystemExit('ediel047_forward_checksum_mismatch')
PY_EDIEL047_PIN
git worktree add --detach "$UPGRADE_WORK/f23-missing" "$EDIEL047_MISSING_BASE"
(
 cd "$UPGRADE_WORK/f23-missing"
 source scripts/gridex-aud-003-clean-replay.sh
 mkdir -p "$UPGRADE_OUT/f23-repaired"
 psql "$DB_URL" -XAtq -v ON_ERROR_STOP=1 <<'SQL_EDIEL047_PREIMAGE'
DO $assert$
BEGIN
 IF to_regclass('public.ediel_test_run_locks') IS NOT NULL OR
    to_regclass('public.ediel_agt_readiness') IS NOT NULL OR
    to_regclass('public.ediel_unlinked_test_messages') IS NOT NULL THEN
  RAISE EXCEPTION 'ediel047_f23_missing_preimage_not_authentic';
 END IF;
END $assert$;
SQL_EDIEL047_PREIMAGE
 psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$CANDIDATE_ROOT/scripts/sql/gridex-ediel-upgrade-fixture.sql"
 psql "$DB_URL" -XAtq -v ON_ERROR_STOP=1 -f "$CANDIDATE_ROOT/scripts/sql/gridex-ediel-upgrade-fixture-observe.sql" > "$UPGRADE_OUT/f23-repaired/retained-before.json"
 psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$CANDIDATE_ROOT/supabase/migrations/$EDIEL047_FORWARD"
 assert_ediel047_contract > "$UPGRADE_OUT/f23-repaired/ediel047-contract.json"
 psql "$DB_URL" -XAtq -v ON_ERROR_STOP=1 -f "$CANDIDATE_ROOT/scripts/sql/gridex-ediel-upgrade-fixture-observe.sql" > "$UPGRADE_OUT/f23-repaired/retained-after.json"
 cmp "$UPGRADE_OUT/f23-repaired/retained-before.json" "$UPGRADE_OUT/f23-repaired/retained-after.json"
 generate_upgrade_artifacts "$UPGRADE_OUT/f23-repaired"
)
cmp "$UPGRADE_OUT/f23-repaired/schema/schema.sql" "$UPGRADE_OUT/clean/schema/schema.sql"
cmp "$UPGRADE_OUT/f23-repaired/schema/schema.fingerprint.json" "$UPGRADE_OUT/clean/schema/schema.fingerprint.json"
cmp "$UPGRADE_OUT/f23-repaired/database.types.ts" "$UPGRADE_OUT/clean/database.types.ts"
# Compare authentic independent clean/upgrade catalogs, including every private
# gridex_ schema, and keep the ordinary committed-type comparator blocking.
cmp "$UPGRADE_OUT/upgraded/schema/schema.sql" "$UPGRADE_OUT/clean/schema/schema.sql"
cmp "$UPGRADE_OUT/upgraded/schema/schema.fingerprint.json" "$UPGRADE_OUT/clean/schema/schema.fingerprint.json"
cmp "$UPGRADE_OUT/upgraded/database.types.ts" "$UPGRADE_OUT/clean/database.types.ts"
cmp "$UPGRADE_OUT/clean/database.types.ts" "$CANDIDATE_ROOT/supabase/database.types.ts"
ACTUAL_TYPES_HASH="$(sha256sum "$UPGRADE_OUT/clean/database.types.ts" | awk '{print $1}')"
EXPECTED_TYPES_HASH="$(node -p 'require("./scripts/supabase-types-manifest.json").sha256')"
[[ "$ACTUAL_TYPES_HASH" == "$EXPECTED_TYPES_HASH" ]] || { echo 'upgrade_generated_types_manifest_mismatch' >&2; exit 1; }
echo 'UPGRADE_REPLAY: PASS; genuine ancestor -> forward-only checksummed upgrade == independent candidate clean schema/types; retained source unchanged'
# A separate committed-history scenario proves an already-applied TXT importer
# accepts only exact absent union inputs. It never weakens the strict old path.
bash "$CANDIDATE_ROOT/scripts/gridex-ediel-applied-txt-branch-upgrade.sh"
