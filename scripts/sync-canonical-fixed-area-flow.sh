#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

printf '\n[1/6] Installerar exakt låsta beroenden\n'
npm ci

printf '\n[2/6] Kontrollerar migrationshistorik och canonical statiska regler\n'
npm run db:migrations:check
npm run gridex:canonical-fixed-area-flow-regression
npm run gridex:contract-single-source-regression
npm run gridex:invoice-fee-canonical-regression
npm run api:contract

printf '\n[3/6] Kör typkontroll\n'
npm run typecheck

printf '\n[4/6] Kör fokuserade regressionstester\n'
npm run test:canonical-fixed-area-flow

printf '\n[5/6] Bygger produktionspaketet\n'
npm run build

if [[ "${APPLY_SUPABASE_MIGRATIONS:-0}" == "1" ]]; then
  printf '\n[6/6] Synkar Supabase-migrationer till länkat projekt\n'
  npx supabase db push
else
  printf '\n[6/6] Databassynk hoppades över. Kör med APPLY_SUPABASE_MIGRATIONS=1 efter godkända kontroller.\n'
fi

printf '\nCanonical fixed-area flow verifierat.\n'
