#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${1:-/Users/hekmath/Desktop/Projects/gridex-ops-platform}"
cd "$PROJECT_DIR"

echo "== Environment =="
node -v
npm -v

echo "== Required project files =="
test -f package.json
test -f package-lock.json
test -f tsconfig.app.json
test -f app/layout.tsx

echo "== Clean install =="
rm -rf node_modules .next
npm cache verify
npm ci --no-audit --no-fund

echo "== Migration and static contract checks =="
npm run db:migrations:check
npm run gridex:energy-resolver-regression
npm run gridex:energy-resolver-contract-regression
node scripts/pricing-spot-auto-import-regression.cjs
npm run api:contract
npm run api:error-boundaries
npm run api:performance-tenant-gates
npm run gridex:cron-idempotency-and-locking-regression
npm run gridex:canonical-fixed-area-flow-regression
npm run gridex:contract-single-source-regression
npm run gridex:website-supplier-switch-automation-regression

echo "== Known adjacent onboarding regressions =="
set +e
npm run gridex:website-application-ops-chain-regression
OPS_CHAIN=$?
npm run gridex:website-application-canonical-dispatch-regression
CANONICAL_DISPATCH=$?
npm run gridex:website-application-idempotency-hardening-regression
IDEMPOTENCY_DOCS=$?
set -e

echo "OPS_CHAIN_EXIT=$OPS_CHAIN"
echo "CANONICAL_DISPATCH_EXIT=$CANONICAL_DISPATCH"
echo "IDEMPOTENCY_DOCS_EXIT=$IDEMPOTENCY_DOCS"

echo "== TypeScript, tests and production build =="
npm run typecheck
npm run typecheck:scripts
npm run typecheck:tests
npm test
npm run build

echo "== Verification completed =="
if [[ "$OPS_CHAIN" -ne 0 || "$CANONICAL_DISPATCH" -ne 0 || "$IDEMPOTENCY_DOCS" -ne 0 ]]; then
  echo "WARNING: One or more known adjacent onboarding regressions are still red. See audit report."
  exit 2
fi
