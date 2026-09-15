#!/usr/bin/env python3
"""Require every final replay check to be JSON true; never accept printed status.

This validates one bounded, schema-only psql JSON result. It does not establish
SQL execution, migration provenance, generated types, or production readiness.
"""
from __future__ import annotations

import json
import sys

MAX_BYTES = 16 * 1024
REQUIRED_CHECKS = (
    'companies_ok', 'metering_permissions_ok', 'price_plans_ok',
    'price_plan_versions_ok', 'contract_products_ok',
    'contract_product_versions_ok', 'contract_price_options_ok',
    'contract_price_option_area_prices_ok', 'portfolios_ok',
    'portfolio_monthly_settlements_ok', 'integration_api_clients_ok',
    'website_customer_applications_ok', 'canonical_migration_manifest_ok',
    'contract_platform_readiness_ok', 'contract_platform_readiness_internal_ok',
    'contract_platform_readiness_internal_executes_ok',
    'ediel_message_intents_ok', 'company_capabilities_ok',
)


def unique_keys(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('DUPLICATE_CHECK_KEY')
        result[key] = value
    return result


def validate(raw: str) -> None:
    """Reject false, NULL, type coercions, incomplete results and contract drift."""
    if not isinstance(raw, str) or len(raw.encode('utf-8')) > MAX_BYTES:
        raise ValueError('CHECK_PAYLOAD_TOO_LARGE')
    try:
        result = json.loads(raw, object_pairs_hook=unique_keys)
    except json.JSONDecodeError:
        raise ValueError('INVALID_CHECK_JSON') from None
    if not isinstance(result, dict) or set(result) != set(REQUIRED_CHECKS):
        raise ValueError('CHECK_CONTRACT_MISMATCH')
    failed = [key for key in REQUIRED_CHECKS if result[key] is not True]
    if failed:
        # Names are from a fixed allowlist. Never print raw database responses.
        raise ValueError('REQUIRED_CHECK_FAILED: ' + ','.join(failed))


def main() -> int:
    try:
        raw = sys.stdin.buffer.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES:
            raise ValueError('CHECK_PAYLOAD_TOO_LARGE')
        validate(raw.decode('utf-8'))
    except (ValueError, UnicodeError):
        print('FAIL required replay checks; invalid, missing or non-true result', file=sys.stderr)
        return 1
    print('PASS required replay checks: 18/18 true; not full replay acceptance')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
