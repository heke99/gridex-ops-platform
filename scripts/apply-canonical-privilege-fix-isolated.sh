#!/usr/bin/env bash

set -euo pipefail

readonly ACTION="${1:-help}"
readonly PROJECT_REF="${SUPABASE_PROJECT_REF:-}"
readonly TARGET_ENVIRONMENT="${GRIDEX_TARGET_ENVIRONMENT:-staging}"
readonly APPLY_TOKEN="I_UNDERSTAND_EXACT_ONE_PRIVILEGE_FIX"
readonly CLI_PACKAGE="${GRIDEX_SUPABASE_CLI_PACKAGE:-supabase@2.111.0}"
readonly NPM_CACHE_DIR="${GRIDEX_NPM_CACHE_DIR:-/tmp/gridex-supabase-npx}"
readonly RECEIPT_FILE=".gridex-isolated-privilege-fix-plan"
readonly TARGET_VERSION="20260802180000"
readonly TARGET_FILE="supabase/migrations/20260802180000_canonical_provisioning_privilege_convergence.sql"
readonly TARGET_HASH="da32e713b3f3d4b34abefa381f8fac200f133f1ef4fe43892b333f60c9b03eeb"

readonly APPROVED_REMOTE_VERSIONS='20260531075508
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
20260802012000
20260802013000
20260802014000
20260802015000
20260802160000
20260802170000'

ISOLATED_WORKDIR=""
CLI_VERSION=""
STATE_FINGERPRINT=""
TARGET_PENDING=""

cleanup() {
  local temp_root="${TMPDIR:-/tmp}"
  temp_root="${temp_root%/}"
  if [[ -n "${ISOLATED_WORKDIR}" && -d "${ISOLATED_WORKDIR}" ]]; then
    case "${ISOLATED_WORKDIR}" in
      "${temp_root}"/gridex-isolated-privilege-fix.*)
        rm -rf -- "${ISOLATED_WORKDIR}"
        ;;
      *)
        echo "Refusing to remove unexpected temporary path: ${ISOLATED_WORKDIR}" >&2
        ;;
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

require_staging_target() {
  local normalized
  [[ -n "${PROJECT_REF}" ]] || {
    echo "SUPABASE_PROJECT_REF is required." >&2
    exit 2
  }
  normalized="$(printf '%s' "${TARGET_ENVIRONMENT}" | LC_ALL=C tr '[:upper:]' '[:lower:]')"
  case "${normalized}" in
    production|prod|live)
      echo "Refusing to operate on a production-labelled target." >&2
      exit 2
      ;;
  esac
}

verify_source() {
  local actual
  [[ -f "${TARGET_FILE}" ]] || {
    echo "Missing required migration: ${TARGET_FILE}" >&2
    exit 2
  }
  actual="$(shasum -a 256 "${TARGET_FILE}" | awk '{print $1}')"
  [[ "${actual}" == "${TARGET_HASH}" ]] || {
    echo "Checksum mismatch for ${TARGET_FILE}" >&2
    echo "Expected: ${TARGET_HASH}" >&2
    echo "Actual:   ${actual}" >&2
    exit 2
  }
}

prepare_workdir() {
  local version temp_root
  temp_root="${TMPDIR:-/tmp}"
  temp_root="${temp_root%/}"
  ISOLATED_WORKDIR="$(mktemp -d "${temp_root}/gridex-isolated-privilege-fix.XXXXXX")"
  mkdir -p "${ISOLATED_WORKDIR}/supabase/migrations"

  printf '%s\n' '[db]' 'major_version = 17' '' '[db.seed]' 'enabled = false' \
    > "${ISOLATED_WORKDIR}/supabase/config.toml"

  printf '%s\n' "${APPROVED_REMOTE_VERSIONS}" | while IFS= read -r version; do
    printf '%s\n' '-- Existing remote-ledger anchor; intentionally empty.' \
      > "${ISOLATED_WORKDIR}/supabase/migrations/${version}_remote_ledger_anchor.sql"
  done
  cp "${TARGET_FILE}" "${ISOLATED_WORKDIR}/supabase/migrations/"
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

assert_state() {
  local list_output remote pending expected_remote
  list_output="$(run_isolated_supabase migration list 2>&1)" || {
    printf '%s\n' "${list_output}" >&2
    exit 2
  }
  printf '%s\n' "${list_output}"
  remote="$(printf '%s\n' "${list_output}" | extract_remote_versions)"
  pending="$(printf '%s\n' "${list_output}" | extract_pending_versions)"

  if printf '%s\n' "${remote}" | grep -qx "${TARGET_VERSION}"; then
    expected_remote="$(printf '%s\n%s\n' "${APPROVED_REMOTE_VERSIONS}" "${TARGET_VERSION}" | LC_ALL=C sort -u)"
    TARGET_PENDING=""
  else
    expected_remote="$(printf '%s\n' "${APPROVED_REMOTE_VERSIONS}" | LC_ALL=C sort -u)"
    TARGET_PENDING="${TARGET_VERSION}"
  fi

  [[ "${remote}" == "${expected_remote}" ]] || {
    echo "BLOCKED: remote ledger is not the exact approved state." >&2
    diff -u <(printf '%s\n' "${expected_remote}") <(printf '%s\n' "${remote}") || true
    exit 2
  }
  [[ "${pending}" == "${TARGET_PENDING}" ]] || {
    echo "BLOCKED: pending migrations are not the exact privilege fix." >&2
    diff -u <(printf '%s\n' "${TARGET_PENDING}") <(printf '%s\n' "${pending}") || true
    exit 2
  }

  STATE_FINGERPRINT="$({
    printf 'project_ref=%s\nremote=%s\npending=%s\nhash=%s\n' \
      "${PROJECT_REF}" "${remote}" "${pending}" "${TARGET_HASH}"
  } | shasum -a 256 | awk '{print $1}')"
}

assert_dry_run() {
  local output versions
  [[ -n "${TARGET_PENDING}" ]] || return 0
  output="$(run_isolated_supabase db push --dry-run 2>&1)" || {
    printf '%s\n' "${output}" >&2
    exit 2
  }
  printf '%s\n' "${output}"
  versions="$(printf '%s\n' "${output}" | grep -Eo '[0-9]{14}' | LC_ALL=C sort -u)"
  [[ "${versions}" == "${TARGET_VERSION}" ]] || {
    echo "BLOCKED: dry-run did not contain exactly ${TARGET_VERSION}." >&2
    exit 2
  }
}

prepare_and_inspect() {
  require_staging_target
  verify_source
  prepare_workdir
  CLI_VERSION="$(run_supabase --version | tail -n 1)"
  echo "Supabase CLI: ${CLI_VERSION}"
  run_isolated_supabase link --project-ref "${PROJECT_REF}"
  assert_state
  assert_dry_run
}

write_receipt() {
  printf 'PROJECT_REF=%s\nCLI_VERSION=%s\nSTATE_FINGERPRINT=%s\n' \
    "${PROJECT_REF}" "${CLI_VERSION}" "${STATE_FINGERPRINT}" > "${RECEIPT_FILE}"
  chmod 600 "${RECEIPT_FILE}"
}

assert_receipt() {
  [[ -f "${RECEIPT_FILE}" ]] || {
    echo "BLOCKED: run plan first." >&2
    exit 2
  }
  [[ "$(sed -n 's/^PROJECT_REF=//p' "${RECEIPT_FILE}")" == "${PROJECT_REF}" \
    && "$(sed -n 's/^CLI_VERSION=//p' "${RECEIPT_FILE}")" == "${CLI_VERSION}" \
    && "$(sed -n 's/^STATE_FINGERPRINT=//p' "${RECEIPT_FILE}")" == "${STATE_FINGERPRINT}" ]] || {
    echo "BLOCKED: plan receipt no longer matches. Run plan again." >&2
    exit 2
  }
}

case "${ACTION}" in
  plan)
    prepare_and_inspect
    write_receipt
    echo "ISOLATED ONE-MIGRATION PLAN VERIFIED"
    echo "Pending migration: ${TARGET_PENDING:-none}"
    ;;
  apply)
    [[ "${GRIDEX_ISOLATED_APPLY:-}" == "${APPLY_TOKEN}" ]] || {
      echo "Blocked: exact one-migration approval token is required." >&2
      exit 2
    }
    prepare_and_inspect
    assert_receipt
    [[ -n "${TARGET_PENDING}" ]] || {
      echo "Privilege correction is already applied."
      exit 0
    }
    run_isolated_supabase db push
    assert_state
    [[ -z "${TARGET_PENDING}" ]] || {
      echo "BLOCKED: target migration remains pending." >&2
      exit 2
    }
    echo "EXACT ONE-MIGRATION PRIVILEGE FIX IS APPLIED"
    echo "Run 04_post_privilege_fix_verification.sql."
    ;;
  help|*)
    echo "Usage: $0 plan|apply"
    ;;
esac
