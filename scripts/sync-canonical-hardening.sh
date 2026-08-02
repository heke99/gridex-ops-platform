#!/usr/bin/env bash

set -euo pipefail

readonly ACTION="${1:-help}"
readonly PROJECT_REF="${SUPABASE_PROJECT_REF:-}"
readonly TARGET_ENVIRONMENT="${GRIDEX_TARGET_ENVIRONMENT:-staging}"
readonly PARITY_TOKEN="I_HAVE_REVIEWED_EXACT_A_C_PARITY"
readonly NPM_CACHE_DIR="${GRIDEX_NPM_CACHE_DIR:-/tmp/gridex-supabase-npx}"

run_supabase() {
  npm_config_cache="${NPM_CACHE_DIR}" npx --yes supabase@latest "$@"
}

require_non_production_target() {
  local normalized_target_environment

  if [[ -z "${PROJECT_REF}" ]]; then
    echo "SUPABASE_PROJECT_REF must name the isolated staging/dev project." >&2
    exit 2
  fi

  normalized_target_environment="$(
    printf '%s' "${TARGET_ENVIRONMENT}" | LC_ALL=C tr '[:upper:]' '[:lower:]'
  )"

  case "${normalized_target_environment}" in
    production|prod|live)
      echo "Refusing to operate on a production-labelled target." >&2
      exit 2
      ;;
  esac
}

link_target() {
  require_non_production_target
  run_supabase link --project-ref "${PROJECT_REF}"
}

case "${ACTION}" in
  verify-local)
    node_major="$(node -p 'process.versions.node.split(".")[0]')"
    if [[ "${node_major}" != "22" ]]; then
      echo "Node 22 is required; found $(node --version)." >&2
      exit 2
    fi

    npm ci
    npm run lint
    npm run typecheck
    npm run typecheck:scripts
    npm run typecheck:tests
    npm test
    npm run db:migrations:integrity
    npm run ops:canonical-production-hardening
    npm run ops:hardening-behavior-regression
    npm run ops:hardening-regression
    npm run ediel:routing-security-regression
    npm run ediel:inbound-tenant-resolution-regression
    npm run security:rbac
    npm run security:audit-production
    npm run build
    ;;

  plan)
    link_target
    run_supabase migration list
    run_supabase db push --dry-run
    echo "Dry-run complete. Do not repair A-C or apply until exact schema parity is approved."
    ;;

  repair-ledger)
    require_non_production_target
    if [[ "${GRIDEX_SCHEMA_PARITY_APPROVED:-}" != "${PARITY_TOKEN}" ]]; then
      echo "Blocked: full A-C table/constraint/index/policy/trigger/function/grant parity is not approved." >&2
      echo "Review docs/canonical-hardening/MIGRATION_RECONCILIATION.md first." >&2
      exit 2
    fi

    link_target
    run_supabase migration repair --status applied 20260802010000
    run_supabase migration repair --status applied 20260802011000
    run_supabase migration repair --status applied 20260802012000
    run_supabase migration list
    ;;

  apply-staging)
    echo "Blocked: the full local migration directory does not match remote history." >&2
    echo "Use scripts/apply-canonical-hardening-isolated.sh after reviewing its exact plan." >&2
    exit 2
    ;;

  help|*)
    cat <<'USAGE'
Usage:
  ./scripts/sync-canonical-hardening.sh verify-local
  SUPABASE_PROJECT_REF=<staging-ref> ./scripts/sync-canonical-hardening.sh plan

After exact A-C parity has been independently approved:
  GRIDEX_TARGET_ENVIRONMENT=staging SUPABASE_PROJECT_REF=<staging-ref> \
    GRIDEX_SCHEMA_PARITY_APPROVED=I_HAVE_REVIEWED_EXACT_A_C_PARITY \
    ./scripts/sync-canonical-hardening.sh repair-ledger

The legacy apply-staging action is intentionally blocked because the full local
migration directory does not match remote history. Use the separately reviewed
scripts/apply-canonical-hardening-isolated.sh workflow.
USAGE
    ;;
esac
