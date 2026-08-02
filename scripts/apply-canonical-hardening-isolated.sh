#!/usr/bin/env bash

set -euo pipefail

readonly ACTION="${1:-help}"
readonly PROJECT_REF="${SUPABASE_PROJECT_REF:-}"
readonly TARGET_ENVIRONMENT="${GRIDEX_TARGET_ENVIRONMENT:-staging}"
readonly APPLY_TOKEN="I_UNDERSTAND_EXACT_FIVE_MIGRATIONS_ONLY"
readonly CLI_PACKAGE="${GRIDEX_SUPABASE_CLI_PACKAGE:-supabase@latest}"
readonly NPM_CACHE_DIR="${GRIDEX_NPM_CACHE_DIR:-/tmp/gridex-supabase-npx}"
readonly RECEIPT_FILE=".gridex-isolated-hardening-plan"

readonly BASE_REMOTE_VERSIONS='20260531075508
20260625121236
20260625125336
20260626084231
20260709151611
20260709152749
20260709152817
20260709152838
20260709152901
20260802010000
20260802011000
20260802012000'

readonly TARGET_VERSIONS='20260802013000
20260802014000
20260802015000
20260802160000
20260802170000'

readonly EXPECTED_HASHES='96f058911d2499fdf2f540e7b2db541cbbc0ffd5ba798858b349779497ecf46d  supabase/migrations/20260802013000_ediel_test_evidence_v2.sql
4fd103508d86a85ee41c168af90a25fdbbd546d17efea7ebcec91935c3c790fc  supabase/migrations/20260802014000_canonical_provisioning_access.sql
03be13ac213573978894b2261452c098ee0f082245e2387e60a0068ffffd9049  supabase/migrations/20260802015000_canonical_backfill_constraints.sql
55c2511768bfa5cc132d4a3a29223e169c4bc43b5c9323dab3d50361b9a4e23c  supabase/migrations/20260802160000_website_application_committed_canonical_event.sql
e34618a9cb0c780f3fd75034ab113e48d99a27d8983e5d0fcbfc4a53ee27370a  supabase/migrations/20260802170000_canonical_security_convergence.sql'

ISOLATED_WORKDIR=""
STATE_FINGERPRINT=""
CLI_VERSION=""
PENDING_VERSIONS=""

cleanup() {
  if [[ -n "${ISOLATED_WORKDIR}" && -d "${ISOLATED_WORKDIR}" ]]; then
    case "$(basename "${ISOLATED_WORKDIR}")" in
      gridex-isolated-hardening.*) rm -rf "${ISOLATED_WORKDIR}" ;;
      *) echo "Refusing to remove unexpected temporary path: ${ISOLATED_WORKDIR}" >&2 ;;
    esac
  fi
}
trap cleanup EXIT HUP INT TERM

run_supabase() {
  npm_config_cache="${NPM_CACHE_DIR}" npx --yes "${CLI_PACKAGE}" "$@"
}

run_isolated_supabase() {
  run_supabase --workdir "${ISOLATED_WORKDIR}" "$@"
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

verify_source_files() {
  local actual expected file

  printf '%s\n' "${EXPECTED_HASHES}" | while IFS='  ' read -r expected file; do
    file="$(printf '%s' "${file}" | sed 's/^ *//')"
    if [[ ! -f "${file}" ]]; then
      echo "Missing required migration: ${file}" >&2
      exit 2
    fi
    actual="$(shasum -a 256 "${file}" | awk '{print $1}')"
    if [[ "${actual}" != "${expected}" ]]; then
      echo "Checksum mismatch for ${file}" >&2
      echo "Expected: ${expected}" >&2
      echo "Actual:   ${actual}" >&2
      exit 2
    fi
  done
}

prepare_isolated_workdir() {
  local version source_file

  ISOLATED_WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/gridex-isolated-hardening.XXXXXX")"
  mkdir -p "${ISOLATED_WORKDIR}/supabase/migrations"

  cat > "${ISOLATED_WORKDIR}/supabase/config.toml" <<'TOML'
project_id = "gridex-canonical-hardening-isolated"

[db]
major_version = 17

[db.migrations]
enabled = true
schema_paths = []

[db.seed]
enabled = false
sql_paths = []
TOML

  printf '%s\n' "${BASE_REMOTE_VERSIONS}" | while IFS= read -r version; do
    printf '%s\n' '-- Existing remote-ledger anchor. Intentionally contains no SQL.' \
      > "${ISOLATED_WORKDIR}/supabase/migrations/${version}_remote_ledger_anchor.sql"
  done

  for source_file in \
    supabase/migrations/20260802013000_ediel_test_evidence_v2.sql \
    supabase/migrations/20260802014000_canonical_provisioning_access.sql \
    supabase/migrations/20260802015000_canonical_backfill_constraints.sql \
    supabase/migrations/20260802160000_website_application_committed_canonical_event.sql \
    supabase/migrations/20260802170000_canonical_security_convergence.sql
  do
    cp "${source_file}" "${ISOLATED_WORKDIR}/supabase/migrations/"
  done
}

extract_remote_versions() {
  awk -F'|' '
    NF >= 3 {
      remote = $2
      gsub(/[^0-9]/, "", remote)
      if (remote ~ /^[0-9]+$/ && length(remote) == 14) print remote
    }
  ' | LC_ALL=C sort -u
}

extract_pending_versions() {
  awk -F'|' '
    NF >= 3 {
      local_version = $1
      remote = $2
      gsub(/[^0-9]/, "", local_version)
      gsub(/[^0-9]/, "", remote)
      if (local_version ~ /^[0-9]+$/ && length(local_version) == 14 && remote == "") print local_version
    }
  ' | LC_ALL=C sort -u
}

expected_remote_for_prefix() {
  local applied_count="$1"
  {
    printf '%s\n' "${BASE_REMOTE_VERSIONS}"
    if [[ "${applied_count}" -gt 0 ]]; then
      printf '%s\n' "${TARGET_VERSIONS}" | sed -n "1,${applied_count}p"
    fi
  } | LC_ALL=C sort -u
}

expected_pending_for_prefix() {
  local applied_count="$1"
  if [[ "${applied_count}" -lt 5 ]]; then
    printf '%s\n' "${TARGET_VERSIONS}" | sed -n "$((applied_count + 1)),5p"
  fi
}

assert_exact_state() {
  local list_output remote_versions pending_versions target_remote_count
  local applied_count expected_remote expected_pending

  list_output="$(run_isolated_supabase migration list 2>&1)" || {
    printf '%s\n' "${list_output}" >&2
    exit 2
  }
  printf '%s\n' "${list_output}"

  remote_versions="$(printf '%s\n' "${list_output}" | extract_remote_versions)"
  pending_versions="$(printf '%s\n' "${list_output}" | extract_pending_versions)"

  target_remote_count="$(
    comm -12 \
      <(printf '%s\n' "${remote_versions}" | LC_ALL=C sort -u) \
      <(printf '%s\n' "${TARGET_VERSIONS}" | LC_ALL=C sort -u) | wc -l | tr -d ' '
  )"
  applied_count="${target_remote_count:-0}"

  if [[ "${applied_count}" -lt 0 || "${applied_count}" -gt 5 ]]; then
    echo "Invalid target migration count in remote ledger." >&2
    exit 2
  fi

  expected_remote="$(expected_remote_for_prefix "${applied_count}")"
  expected_pending="$(expected_pending_for_prefix "${applied_count}")"

  if [[ "${remote_versions}" != "${expected_remote}" ]]; then
    echo "BLOCKED: remote ledger is not the approved base plus a target prefix." >&2
    diff -u \
      <(printf '%s\n' "${expected_remote}") \
      <(printf '%s\n' "${remote_versions}") || true
    exit 2
  fi

  if [[ "${pending_versions}" != "${expected_pending}" ]]; then
    echo "BLOCKED: isolated pending set is not the exact remaining target suffix." >&2
    diff -u \
      <(printf '%s\n' "${expected_pending}") \
      <(printf '%s\n' "${pending_versions}") || true
    exit 2
  fi

  PENDING_VERSIONS="${pending_versions}"
  STATE_FINGERPRINT="$(
    {
      printf 'project_ref=%s\n' "${PROJECT_REF}"
      printf 'remote=%s\n' "${remote_versions}"
      printf 'pending=%s\n' "${pending_versions}"
      printf '%s\n' "${EXPECTED_HASHES}"
    } | shasum -a 256 | awk '{print $1}'
  )"
}

assert_exact_dry_run() {
  local dry_run_output dry_run_versions

  if [[ -z "${PENDING_VERSIONS}" ]]; then
    echo "No target migrations remain pending. Run post-apply verification." >&2
    return 0
  fi

  dry_run_output="$(run_isolated_supabase db push --dry-run 2>&1)" || {
    printf '%s\n' "${dry_run_output}" >&2
    exit 2
  }
  printf '%s\n' "${dry_run_output}"

  dry_run_versions="$(
    printf '%s\n' "${dry_run_output}" \
      | grep -Eo '[0-9]{14}' \
      | LC_ALL=C sort -u
  )"

  if [[ "${dry_run_versions}" != "${PENDING_VERSIONS}" ]]; then
    echo "BLOCKED: dry-run did not name exactly the remaining target migrations." >&2
    diff -u \
      <(printf '%s\n' "${PENDING_VERSIONS}") \
      <(printf '%s\n' "${dry_run_versions}") || true
    exit 2
  fi
}

write_receipt() {
  {
    printf 'PROJECT_REF=%s\n' "${PROJECT_REF}"
    printf 'CLI_VERSION=%s\n' "${CLI_VERSION}"
    printf 'STATE_FINGERPRINT=%s\n' "${STATE_FINGERPRINT}"
  } > "${RECEIPT_FILE}"
  chmod 600 "${RECEIPT_FILE}"
}

assert_receipt() {
  local receipt_project_ref receipt_cli_version receipt_fingerprint

  if [[ ! -f "${RECEIPT_FILE}" ]]; then
    echo "BLOCKED: run the isolated plan first." >&2
    exit 2
  fi

  receipt_project_ref="$(sed -n 's/^PROJECT_REF=//p' "${RECEIPT_FILE}")"
  receipt_cli_version="$(sed -n 's/^CLI_VERSION=//p' "${RECEIPT_FILE}")"
  receipt_fingerprint="$(sed -n 's/^STATE_FINGERPRINT=//p' "${RECEIPT_FILE}")"

  if [[ "${receipt_project_ref}" != "${PROJECT_REF}" \
     || "${receipt_cli_version}" != "${CLI_VERSION}" \
     || "${receipt_fingerprint}" != "${STATE_FINGERPRINT}" ]]; then
    echo "BLOCKED: project, CLI version or remote plan state changed since plan." >&2
    echo "Run plan again and review it before applying." >&2
    exit 2
  fi
}

prepare_and_inspect() {
  require_non_production_target
  verify_source_files
  prepare_isolated_workdir
  CLI_VERSION="$(run_supabase --version | tail -n 1)"
  echo "Supabase CLI: ${CLI_VERSION}"
  run_isolated_supabase link --project-ref "${PROJECT_REF}"
  assert_exact_state
  assert_exact_dry_run
}

case "${ACTION}" in
  plan)
    prepare_and_inspect
    write_receipt
    echo "ISOLATED PLAN VERIFIED"
    echo "Pending migrations:"
    printf '%s\n' "${PENDING_VERSIONS}"
    echo "Next: run the approved profile reconciliation in SQL Editor, then run plan again."
    ;;

  apply)
    if [[ "${GRIDEX_ISOLATED_APPLY:-}" != "${APPLY_TOKEN}" ]]; then
      echo "Blocked: explicit isolated staging apply approval is required." >&2
      exit 2
    fi
    prepare_and_inspect
    assert_receipt
    if [[ -z "${PENDING_VERSIONS}" ]]; then
      echo "Nothing to apply. Run post-apply verification."
      exit 0
    fi
    run_isolated_supabase db push
    assert_exact_state
    if [[ -n "${PENDING_VERSIONS}" ]]; then
      echo "BLOCKED: apply returned but target migrations remain pending." >&2
      exit 2
    fi
    echo "EXACT FIVE-MIGRATION TARGET IS APPLIED"
    echo "Run 03_post_apply_verification.sql before any production action."
    ;;

  help|*)
    cat <<'USAGE'
Usage:
  GRIDEX_TARGET_ENVIRONMENT=staging SUPABASE_PROJECT_REF=<staging-ref> \
    ./scripts/apply-canonical-hardening-isolated.sh plan

After the plan is reviewed and the profile reconciliation has passed:
  GRIDEX_TARGET_ENVIRONMENT=staging SUPABASE_PROJECT_REF=<staging-ref> \
    GRIDEX_ISOLATED_APPLY=I_UNDERSTAND_EXACT_FIVE_MIGRATIONS_ONLY \
    ./scripts/apply-canonical-hardening-isolated.sh apply

This script refuses production-labelled targets, validates fixed migration
checksums, creates an isolated migration workdir, accepts only the approved
remote-ledger base plus a contiguous target prefix, and requires dry-run output
to equal the exact remaining target suffix.
USAGE
    ;;
esac
