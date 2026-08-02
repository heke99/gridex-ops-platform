#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
mkdir -p artifacts/verification

run() {
  local name="$1"
  shift
  echo "==> $name"
  "$@" 2>&1 | tee "artifacts/verification/${name}.log"
}

run 01-npm-ci npm ci
run 02-lint npm run lint
run 03-typecheck npm run typecheck
run 04-typecheck-tests npm run typecheck:tests
run 05-tests npm test
run 06-build npm run build
run 07-migration-integrity npm run db:migrations:check
run 08-migration-production-readiness npm run db:migrations:production-readiness
run 09-public-api-contract node scripts/check-public-api-contract.cjs
run 10-public-api-errors node scripts/check-public-api-error-registry.cjs
run 11-openapi-runtime node scripts/check-openapi-runtime-parity.cjs
run 12-external-api-parity node scripts/canonical-external-api-runtime-parity.cjs
run 13-documentation-version node scripts/check-api-documentation-version.cjs
run 14-documentation-examples node scripts/check-api-documentation-examples.cjs
run 15-openapi-release node scripts/verify-openapi-release.cjs
run 16-public-contract-runtime node scripts/check-public-contract-runtime-openapi.cjs
run 17-contract-channel node scripts/gridex-contract-channel-publication-regression.cjs
run 18-contract-commercial node scripts/gridex-contract-commercial-selection-regression.cjs
run 19-contract-security node scripts/gridex-contract-security-energy-direction-regression.cjs
run 20-tenant-integration node scripts/gridex-single-api-key-tenant-integration-regression.cjs

if ! command -v supabase >/dev/null 2>&1; then
  echo 'Supabase CLI is required for the remaining release gates.' >&2
  exit 1
fi
run 21-supabase-help supabase --help
run 22-supabase-migration-repair-help supabase migration repair --help

if [[ -z "${GRIDEX_CLEAN_DATABASE_URL:-}" ]]; then
  echo 'GRIDEX_CLEAN_DATABASE_URL must point to a disposable empty PostgreSQL database.' >&2
  exit 1
fi
if ! command -v psql >/dev/null 2>&1; then
  echo 'psql is required for clean reconstruction and schema fingerprint verification.' >&2
  exit 1
fi

run 23-clean-reconstruction bash scripts/verify-clean-migration-reconstruction-2026-08-02.sh

if [[ -z "${GRIDEX_API_BASE_URL:-}" || -z "${GRIDEX_API_KEY:-}" || -z "${EXPECTED_TENANT_REFERENCE:-}" ]]; then
  echo 'GRIDEX_API_BASE_URL, GRIDEX_API_KEY and EXPECTED_TENANT_REFERENCE are required for deployed smoke tests.' >&2
  exit 1
fi
run 24-live-api-smoke bash scripts/post-deployment-api-verification-2026-08-02.sh

echo 'All production release gates passed.'
