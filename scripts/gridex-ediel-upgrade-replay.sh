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
# Main after the #426 split stack (#483-#489 merged, PR #489 merge commit);
# the old ancestor d30fa02 is not reachable from main. Owner decision A1.
UPGRADE_BASE=2bc65eab67dfb45a61e192a3233ed16584fb5a2e
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
 # The OID-preservation proof spans 20261001110500 only. When that migration is
 # already in the base, no pre-actor catalog exists and the proof does not apply.
 if [[ -f "$UPGRADE_OUT/utilts-pre110500.json" ]]; then
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
 elif grep -q '/20261001110500_ediel_utilts_current_execution_actor\.sql$' "$UPGRADE_WORK/plan/upgrade-inputs.list"; then
  echo 'pre110500_original_public6_missing' >&2; exit 1
 else
  echo 'UPGRADE_CATALOG: 20261001110500 is in the base; UTILTS OID-preservation proof not applicable'
 fi
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
 generate_upgrade_artifacts "$UPGRADE_OUT/upgraded"
 python3 "$CANDIDATE_ROOT/scripts/ediel-received-context-upgrade-regression.py"
)
(
 cd "$CANDIDATE_ROOT"
 source scripts/gridex-aud-003-clean-replay.sh
 generate_upgrade_artifacts "$UPGRADE_OUT/clean"
)
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
# The applied-TXT branch-history scenario (c8f666d9/#424) was retired after the
# #426 split (owner decision H1): its bases are not in main and no environment
# applied that branch history. This replay plus the clean replay cover upgrade.
