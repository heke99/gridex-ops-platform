#!/usr/bin/env bash
set -u

OPS_API_BASE_URL="${OPS_API_BASE_URL:-https://app.gridex.se}"
OPS_API_TOKEN="${OPS_API_TOKEN:-}"
EXTERNAL_CUSTOMER_ID="${EXTERNAL_CUSTOMER_ID:-GRIDEX-WEB-TEST-001}"
EXPECTED_FACILITY_ID="${EXPECTED_FACILITY_ID:-735999888000000112}"

if [ -z "$OPS_API_TOKEN" ]; then
  echo "Missing OPS_API_TOKEN. Example:" >&2
  echo "OPS_API_TOKEN='gdxp_...' EXTERNAL_CUSTOMER_ID='CUSTOMER-123' ./scripts/customer-portal-live-test.sh" >&2
  exit 1
fi

run_get_auth() {
  local name="$1"
  local url="$2"

  echo ""
  echo "=============================="
  echo "$name"
  echo "$url"
  echo "=============================="

  curl -sS -i "$url" \
    -H "Authorization: Bearer $OPS_API_TOKEN" \
    -H "Accept: application/json"
}

run_get_no_auth() {
  local name="$1"
  local url="$2"

  echo ""
  echo "=============================="
  echo "$name"
  echo "$url"
  echo "=============================="

  curl -sS -i "$url" \
    -H "Accept: application/json"
}

run_post_auth() {
  local name="$1"
  local url="$2"
  local body="$3"

  echo ""
  echo "=============================="
  echo "$name"
  echo "$url"
  echo "=============================="

  curl -sS -i -X POST "$url" \
    -H "Authorization: Bearer $OPS_API_TOKEN" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json" \
    -d "$body"
}

echo "GRIDEX CUSTOMER PORTAL API LIVE TEST"
echo "OPS_API_BASE_URL=$OPS_API_BASE_URL"
echo "EXTERNAL_CUSTOMER_ID=$EXTERNAL_CUSTOMER_ID"
echo "EXPECTED_FACILITY_ID=$EXPECTED_FACILITY_ID"

run_get_no_auth "1. Public developer docs" \
  "$OPS_API_BASE_URL/developers/customer-portal-api"

run_post_auth "2. Customer portal sync" \
  "$OPS_API_BASE_URL/api/v1/customer-portal/sync" \
  "{\"external_customer_id\":\"$EXTERNAL_CUSTOMER_ID\"}"

run_get_auth "3. Sites" \
  "$OPS_API_BASE_URL/api/v1/customer/sites?external_customer_id=$EXTERNAL_CUSTOMER_ID"

run_get_auth "4. Contracts" \
  "$OPS_API_BASE_URL/api/v1/customer/contracts?external_customer_id=$EXTERNAL_CUSTOMER_ID"

run_get_auth "5. Invoices" \
  "$OPS_API_BASE_URL/api/v1/customer/invoices?external_customer_id=$EXTERNAL_CUSTOMER_ID"

run_get_auth "6A. Metering values" \
  "$OPS_API_BASE_URL/api/v1/customer/metering-values?external_customer_id=$EXTERNAL_CUSTOMER_ID"

run_get_auth "6B. Metering values from/to" \
  "$OPS_API_BASE_URL/api/v1/customer/metering-values?external_customer_id=$EXTERNAL_CUSTOMER_ID&from=2026-05-01&to=2026-06-01"

run_get_auth "6C. Metering values facility" \
  "$OPS_API_BASE_URL/api/v1/customer/metering-values?external_customer_id=$EXTERNAL_CUSTOMER_ID&facility_id=$EXPECTED_FACILITY_ID"

run_get_auth "7A. Missing external_customer_id should return 400" \
  "$OPS_API_BASE_URL/api/v1/customer/sites"

run_get_no_auth "7B. Missing token should return 401" \
  "$OPS_API_BASE_URL/api/v1/customer/sites?external_customer_id=$EXTERNAL_CUSTOMER_ID"

echo ""
echo "DONE. Revoke/delete temporary API tokens after testing."
