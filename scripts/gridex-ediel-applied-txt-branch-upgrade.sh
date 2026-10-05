#!/usr/bin/env bash
# Additional final-CI branch-history qualification, after the ordinary genuine
# main-ancestor upgrade/independent clean run. No40446 ledger row is invented.
set -euo pipefail
CANDIDATE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CANDIDATE_SHA="$(git -C "$CANDIDATE_ROOT" rev-parse HEAD)"
CANDIDATE_TREE="$(git -C "$CANDIDATE_ROOT" rev-parse 'HEAD^{tree}')"
cd "$CANDIDATE_ROOT"
[[ "${GITHUB_ACTIONS:-}" == true && -n "${RUNNER_TEMP:-}" ]] || { echo 'history_union_disposable_ci_runner_required' >&2; exit 1; }
[[ -z "${GRIDEX_REPLAY_DB_URL:-}" ]] || { echo 'history_union_external_database_forbidden' >&2; exit 1; }
UNION_BASE=c8f666d9bf61f84816c2f295dc44442167f0b75a
UNION_WORK="$(mktemp -d "$RUNNER_TEMP/gridex-txt-union.XXXXXX")"
UNION_OUT="$CANDIDATE_ROOT/rem002-upgrade/applied-txt-branch"
REFERENCE_CLEAN="$CANDIDATE_ROOT/rem002-upgrade/clean"
mkdir -p "$UNION_OUT/upgraded"
union_cleanup() {
 local redaction_failed=0
 if [[ -f "$UNION_WORK/native-status.json" ]]; then
  if ! python3 "$CANDIDATE_ROOT/scripts/gridex-redact-native-evidence.py" \
    --local-secrets "$UNION_WORK/native-status.json" --root "$UNION_OUT" \
    --root "$CANDIDATE_ROOT/rem002-upgrade-replay.log"; then redaction_failed=1; fi
 fi
 git -C "$CANDIDATE_ROOT" worktree remove --force "$UNION_WORK/base" >/dev/null 2>&1 || true
 rm -rf "$UNION_WORK"
 if [[ "$redaction_failed" != 0 ]]; then
  # Do not leave unredacted evidence available to an always-upload CI step.
  rm -rf "$UNION_OUT"
  rm -f "$CANDIDATE_ROOT/rem002-upgrade-replay.log"
  echo 'history_union_evidence_redaction_failed' >&2
  exit 1
 fi
}
trap union_cleanup EXIT
# A same-head independent clean comparator is mandatory, never an older green.
python3 - "$CANDIDATE_ROOT/rem002-upgrade/upgrade-inputs.json" "$CANDIDATE_SHA" "$CANDIDATE_TREE" <<'PY'
import json,sys
receipt=json.load(open(sys.argv[1]))
if receipt['candidateSha']!=sys.argv[2] or receipt['candidateTree']!=sys.argv[3]:
 raise SystemExit('history_union_stale_reference_candidate')
PY
for artifact in schema/schema.sql schema/schema.fingerprint.json database.types.ts; do
 [[ -s "$REFERENCE_CLEAN/$artifact" ]] || { echo "history_union_independent_clean_missing:$artifact" >&2; exit 1; }
done
# The split main history need not retain the original branch ref forever.
# Fetch only this immutable approved source witness and its actual ancestors;
# the planner still checks every closed pin, ancestry edge and original byte.
SOURCE_PORT_WITNESS=f460fabf33eace3abb0e44df06a780f02b44a03d
if ! git cat-file -e "$SOURCE_PORT_WITNESS^{commit}" 2>/dev/null; then
 git fetch --no-tags origin "$SOURCE_PORT_WITNESS"
fi
python3 "$CANDIDATE_ROOT/scripts/gridex-ediel-history-union-inputs.py" --out "$UNION_WORK/plan"
cp "$UNION_WORK/plan/history-union-inputs.json" "$UNION_OUT/history-union-inputs.json"
python3 - "$UNION_OUT/history-union-inputs.json" "$UNION_BASE" <<'PY'
import json,sys
if json.load(open(sys.argv[1]))['baseSha']!=sys.argv[2]:
 raise SystemExit('history_union_wrong_fixed_base')
PY
git worktree add --detach "$UNION_WORK/base" "$UNION_BASE"
(
 cd "$UNION_WORK/base"
 # Unchanged original branch source owns its disposable local stack and EXIT
 # restoration. Candidate SQL is copied from Git, not this shell's CLI markers.
 source scripts/gridex-aud-003-clean-replay.sh
 psql "$DB_URL" -XAtq -v ON_ERROR_STOP=1 <<'SQL' > "$UNION_OUT/importer-before.json"
SELECT jsonb_build_object('oid',p.oid,'owner',p.proowner,'acl',p.proacl,'config',p.proconfig,'securityDefiner',p.prosecdef,
 'volatility',p.provolatile,'sourceHash',encode(pg_catalog.sha256(convert_to(p.prosrc,'UTF8')),'hex'),
 'txtCountryApplied',position('companies_txt' IN p.prosrc)>0 AND position('country_code=coalesce(nullif(item->>''countryCode'',''''),country_code)' IN p.prosrc)>0)
FROM pg_proc p WHERE p.oid='public.ediel_apply_actor_registry_v1(uuid,text,text,text,text,jsonb)'::regprocedure;
SQL
 python3 - "$UNION_OUT/importer-before.json" "$UNION_OUT/history-union-inputs.json" <<'PY' > "$UNION_OUT/applied-txt-source-provenance.json"
import json,sys
owner=json.load(open(sys.argv[1]));plan=json.load(open(sys.argv[2]))
if owner['txtCountryApplied'] is not True:
 raise SystemExit('history_union_original_txt_country_boundary_missing')
print(json.dumps({'baseSha':plan['baseSha'],'candidateSha':plan['candidateSha'],'candidateTree':plan['candidateTree'],
 'alreadyAppliedSource':plan['alreadyAppliedTxtSource'],'installedImporter':owner,
 'splitSquashProvenanceBridge':plan.get('splitSquashProvenanceBridge'),
 'provenance':'unchanged original c8 branch replay actually applied checksum-pinned40446 SQL; source and installed catalog observed',
 'ledgerClaim':plan['ledgerClaim']},indent=2))
PY
 psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$CANDIDATE_ROOT/scripts/sql/gridex-ediel-upgrade-fixture.sql"
 psql "$DB_URL" -XAtq -v ON_ERROR_STOP=1 -f "$CANDIDATE_ROOT/scripts/sql/gridex-ediel-upgrade-fixture-observe.sql" > "$UNION_OUT/retained-before.json"
 while IFS= read -r migration; do
  printf 'HISTORY_UNION_APPLY: %s\n' "${migration##*/}"
  if [[ "${migration##*/}" == 20261001110500_ediel_utilts_current_execution_actor.sql ]]; then
   psql "$DB_URL" -XAtq -v ON_ERROR_STOP=1 \
    -v candidate_sha="$CANDIDATE_SHA" -v candidate_tree="$CANDIDATE_TREE" \
    -f "$CANDIDATE_ROOT/scripts/sql/ediel-utilts-pre-actor-catalog.sql" > "$UNION_OUT/utilts-pre110500.json"
   [[ -s "$UNION_OUT/utilts-pre110500.json" ]] || { echo 'history_union_pre110500_original_public6_missing' >&2; exit 1; }
  fi
  psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$migration"
 done < "$UNION_WORK/plan/history-union-inputs.list"
 psql "$DB_URL" -XAtq -v ON_ERROR_STOP=1 -f "$CANDIDATE_ROOT/scripts/sql/gridex-ediel-upgrade-fixture-observe.sql" > "$UNION_OUT/retained-after.json"
 cmp "$UNION_OUT/retained-before.json" "$UNION_OUT/retained-after.json"
 psql "$DB_URL" -XAtq -v ON_ERROR_STOP=1 <<'SQL' > "$UNION_OUT/importer-after.json"
SELECT jsonb_build_object('oid',p.oid,'owner',p.proowner,'acl',p.proacl,'config',p.proconfig,'securityDefiner',p.prosecdef,
 'volatility',p.provolatile,'sourceHash',encode(pg_catalog.sha256(convert_to(p.prosrc,'UTF8')),'hex'),
 'txtCountryApplied',position('companies_txt' IN p.prosrc)>0 AND position('country_code=coalesce(nullif(item->>''countryCode'',''''),country_code)' IN p.prosrc)>0,
 'elMarketProtected',position('WHERE id=aid AND market=''EL''' IN p.prosrc)>0 AND position('capture_actor_market_v1' IN p.prosrc)>0 AND position('capture_route_market_v1' IN p.prosrc)>0)
FROM pg_proc p WHERE p.oid='public.ediel_apply_actor_registry_v1(uuid,text,text,text,text,jsonb)'::regprocedure;
DO $assert$
BEGIN
 IF EXISTS(SELECT FROM gridex_ediel_inbound_context.receipts WHERE source_message_id='00000000-0000-4000-8000-00000000d082' AND status='ready') THEN
  RAISE EXCEPTION 'history_union_fabricated_historical_legal_authority';
 END IF;
END $assert$;
SQL
 python3 - "$UNION_OUT/importer-before.json" "$UNION_OUT/importer-after.json" <<'PY'
import json,sys
before,after=(json.load(open(path)) for path in sys.argv[1:])
for key in ['oid','owner','acl','config','securityDefiner','volatility']:
 if before[key]!=after[key]:
  raise SystemExit('history_union_importer_identity_changed:'+key)
if after['txtCountryApplied'] is not True or after['elMarketProtected'] is not True:
 raise SystemExit('history_union_txt_country_el_protection_missing')
PY
 supabase status -o json > "$UNION_WORK/native-status.json"
 (
  cd "$CANDIDATE_ROOT"
  GRIDEX_NATIVE_STATUS="$UNION_WORK/native-status.json" GRIDEX_NATIVE_DATABASE_PHASE=upgrade \
  GRIDEX_UTILTS_PREUPGRADE_CATALOG_PATH="$UNION_OUT/utilts-pre110500.json" \
  GRIDEX_UTILTS_CATALOG_RECEIPT_PATH="$UNION_OUT/upgraded/utilts-catalog.json" \
  npx vitest run scripts/ediel-utilts-consumption-native.test.ts --config scripts/ediel-source-owner-native.config.ts \
   -t 'native catalog binds preserved UTILTS OIDs to the only actor-protected callable chain' \
   --reporter=default --reporter=junit --outputFile="$UNION_OUT/utilts-catalog-upgrade-junit.xml"
 )
 schemas="$(psql "$DB_URL" -XAtq -v ON_ERROR_STOP=1 -c "select string_agg(nspname,',' order by nspname) from pg_namespace where nspname='public' or starts_with(nspname,'gridex_');")"
 [[ -n "$schemas" ]] || { echo 'history_union_application_schemas_missing' >&2; exit 1; }
 node "$CANDIDATE_ROOT/scripts/gridex-schema-snapshot.cjs" --mode write --url "$DB_URL" --out-dir "$UNION_OUT/upgraded/schema" --schemas "$schemas"
 supabase gen types typescript --local > "$UNION_OUT/upgraded/database.types.ts"
 node "$CANDIDATE_ROOT/scripts/apply-supabase-types-nullability-overrides.cjs" "$UNION_OUT/upgraded/database.types.ts"
)
for artifact in schema/schema.sql schema/schema.fingerprint.json database.types.ts; do
 cmp "$UNION_OUT/upgraded/$artifact" "$REFERENCE_CLEAN/$artifact"
done
cmp "$UNION_OUT/upgraded/database.types.ts" "$CANDIDATE_ROOT/supabase/database.types.ts"
echo 'HISTORY_UNION_UPGRADE: PASS; authentic already-applied40446 c8 branch + exact absent inputs == same-head independent clean schema/types; original state/OIDs retained; NO deployment-ledger claim'
