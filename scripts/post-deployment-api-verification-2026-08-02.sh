#!/usr/bin/env bash
set -euo pipefail
: "${GRIDEX_API_BASE_URL:?Set GRIDEX_API_BASE_URL}"
: "${GRIDEX_API_KEY:?Set GRIDEX_API_KEY}"
: "${EXPECTED_TENANT_REFERENCE:?Set EXPECTED_TENANT_REFERENCE}"
BASE="${GRIDEX_API_BASE_URL%/}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
AUTH=( -H "Authorization: Bearer ${GRIDEX_API_KEY}" -H 'Accept: application/json' )

curl --fail --silent --show-error "${AUTH[@]}" -D "$TMP/context.headers" -o "$TMP/context.json" "$BASE/api/v1/integration/context"
curl --fail --silent --show-error "${AUTH[@]}" -D "$TMP/contracts.headers" -o "$TMP/contracts.json" "$BASE/api/v1/website/public-contracts"
curl --fail --silent --show-error "${AUTH[@]}" -D "$TMP/diagnostics.headers" -o "$TMP/diagnostics.json" "$BASE/api/v1/website/public-contracts/diagnostics"
curl --fail --silent --show-error -D "$TMP/website-openapi.headers" -o "$TMP/website-openapi.json" "$BASE/api/v1/openapi/website-integration-v1.json"
curl --fail --silent --show-error -D "$TMP/customer-openapi.headers" -o "$TMP/customer-openapi.json" "$BASE/api/v1/openapi/customer-portal-v1.json"
curl --fail --silent --show-error -D "$TMP/manifest.headers" -o "$TMP/manifest.json" "$BASE/api/v1/openapi/release-manifest.json"

jq -e --arg tenant "$EXPECTED_TENANT_REFERENCE" '.tenant_reference == $tenant or .data.tenant_reference == $tenant or .meta.tenant_reference == $tenant' "$TMP/context.json" >/dev/null
jq -e --arg tenant "$EXPECTED_TENANT_REFERENCE" '.meta.tenant_reference == $tenant and .meta.contract_schema_version == "2026-08-02.1"' "$TMP/contracts.json" >/dev/null
jq -e '.release_version == "2026-08-02.1" and .website_openapi_version == "2026-08-02.1" and .customer_portal_openapi_version == "2026-08-02.1"' "$TMP/manifest.json" >/dev/null

WEBSITE_SHA="$(sha256sum "$TMP/website-openapi.json" | awk '{print $1}')"
CUSTOMER_SHA="$(sha256sum "$TMP/customer-openapi.json" | awk '{print $1}')"
jq -e --arg sha "$WEBSITE_SHA" '.specifications.website.sha256 == $sha' "$TMP/manifest.json" >/dev/null
jq -e --arg sha "$CUSTOMER_SHA" '.specifications.customer_portal.sha256 == $sha' "$TMP/manifest.json" >/dev/null

grep -qi '^cache-control:.*no-store' "$TMP/contracts.headers"
grep -qi '^cache-control:.*no-store' "$TMP/website-openapi.headers"
grep -qi '^cache-control:.*no-store' "$TMP/manifest.headers"

jq '{tenant_reference:.meta.tenant_reference,contract_schema_version:.meta.contract_schema_version,count:.meta.count,feed_state:.meta.feed_state,offer_references:[.data[].offer_reference]}' "$TMP/contracts.json"
echo "Website OpenAPI SHA-256: $WEBSITE_SHA"
echo "Customer Portal OpenAPI SHA-256: $CUSTOMER_SHA"
echo 'Live API release parity passed.'
