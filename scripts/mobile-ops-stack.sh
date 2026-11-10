#!/usr/bin/env bash
set -eo pipefail
unset GRIDEX_REPLAY_DB_URL
# Short-lived local tokens let the emulator exercise real expiry and refresh.
python3 - <<'PY_EXPIRY'
from pathlib import Path
p=Path('supabase/config.toml');s=p.read_text();assert 'jwt_expiry = 3600' in s;p.write_text(s.replace('jwt_expiry = 3600','jwt_expiry = 60'))
PY_EXPIRY
source scripts/gridex-aud-003-clean-replay.sh
owned_pids=()
mobile_cleanup() {
  local result=$?
  trap - EXIT
  for pid in "${owned_pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  rm -rf "$RUNNER_TEMP/mobile-fixtures"
  rm -f "$RUNNER_TEMP/ops.key" "$RUNNER_TEMP/ops.crt"
  set +e
  (exit "$result"); cleanup
  exit "$result"
}
trap mobile_cleanup EXIT
export DB_URL
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f scripts/portal-claim-atomic-regression.sql
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f scripts/staff-api-integration-auth-regression.sql
status="$(supabase status -o json)"
export NEXT_PUBLIC_SUPABASE_URL="$(jq -er .API_URL <<< "$status")"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="$(jq -er .ANON_KEY <<< "$status")"
export SUPABASE_SERVICE_ROLE_KEY="$(jq -er .SERVICE_ROLE_KEY <<< "$status")"
node scripts/mobile-ops-fixtures.mjs "$RUNNER_TEMP/mobile-fixtures"
export GRIDEX_PORTAL_IDENTITY_ENFORCEMENT=enforce
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=localhost \
  -addext subjectAltName=IP:127.0.0.1 -keyout "$RUNNER_TEMP/ops.key" -out "$RUNNER_TEMP/ops.crt" 2>/dev/null
npm exec -- next dev --hostname 127.0.0.1 --port 3101 > "$RUNNER_TEMP/ops-runtime.log" 2>&1 &
owned_pids+=("$!")
node scripts/mobile-e2e-ops-https.mjs "$RUNNER_TEMP/ops.key" "$RUNNER_TEMP/ops.crt" &
bridge_pid=$!
owned_pids+=("$bridge_pid")
curl --fail --silent --show-error --retry 20 --retry-all-errors --retry-delay 3 --max-time 30 \
  --cacert "$RUNNER_TEMP/ops.crt" https://127.0.0.1:3443/api/v1/openapi/customer-portal-v1.json \
  --output "$RUNNER_TEMP/ops-portal-openapi.json"
jq -e '.paths | type == "object"' "$RUNNER_TEMP/ops-portal-openapi.json" >/dev/null
(
  cd gridex-web
  source "$RUNNER_TEMP/mobile-fixtures/web.env"
  export NODE_EXTRA_CA_CERTS="$RUNNER_TEMP/ops.crt"
  export GRIDEX_OPS_API_URL=https://127.0.0.1:3443/api/v1
  export GRIDEX_OPS_STAGING_ALLOWED_ORIGINS=https://127.0.0.1:3443
  export GRIDEX_MOBILE_API_ENABLED=true
  exec npm exec -- next dev --hostname 127.0.0.1 --port 3100
) > "$RUNNER_TEMP/web-runtime.log" 2>&1 &
owned_pids+=("$!")
curl --silent --show-error --retry 20 --retry-connrefused --retry-delay 3 --max-time 60 \
  http://127.0.0.1:3100/api/mobile/customer/contracts --output /dev/null
node gridex-web/scripts/check-mobile-http.mjs http://127.0.0.1:3100 "$RUNNER_TEMP/mobile-http.json"
(
  source "$RUNNER_TEMP/mobile-fixtures/web.env"
  export NODE_EXTRA_CA_CERTS="$RUNNER_TEMP/ops.crt"
  export GRIDEX_OPS_API_URL=https://127.0.0.1:3443/api/v1
  export GRIDEX_OPS_STAGING_ALLOWED_ORIGINS=https://127.0.0.1:3443
  node --experimental-strip-types --experimental-loader ./gridex-web/tests/typescript-alias-loader.mjs scripts/mobile-ops-diagnose.mjs "$RUNNER_TEMP/mobile-fixtures/customers.json"
)
node scripts/mobile-ops-fixtures.mjs "$RUNNER_TEMP/mobile-fixtures" --refresh
node scripts/mobile-ops-customer-acceptance.mjs "$RUNNER_TEMP/mobile-fixtures/customers.json" "$RUNNER_TEMP/mobile-acceptance.json"
kill "$bridge_pid"
wait "$bridge_pid" || true
node scripts/mobile-ops-customer-acceptance.mjs "$RUNNER_TEMP/mobile-fixtures/customers.json" --outage
node scripts/mobile-e2e-ops-https.mjs "$RUNNER_TEMP/ops.key" "$RUNNER_TEMP/ops.crt" &
owned_pids+=("$!")
bash scripts/mobile-android-build.sh
python3 scripts/mobile-android-emulator.py "$RUNNER_TEMP/mobile-fixtures/customers.json"
