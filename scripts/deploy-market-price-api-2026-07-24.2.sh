#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_URL:?SUPABASE_URL must be set}"
: "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY must be set}"
: "${DATABASE_URL:?DATABASE_URL must be set}"

npm ci
npm run verify:market-price-api:static
supabase db push
npm run spot:backfill -- \
  --start-date="${SPOT_BACKFILL_START_DATE:-2026-06-24}" \
  --end-date="${SPOT_BACKFILL_END_DATE:-2026-07-24}" \
  --areas="${SPOT_BACKFILL_AREAS:-SE1,SE2,SE3,SE4}"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/verify-market-price-api-production.sql
npm run verify:market-price-api
