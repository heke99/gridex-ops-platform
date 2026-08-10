# TDD traceability

Updated: 2026-08-10

| Bug | Requirement | Regression | Red | Green | Verdict |
|---|---|---|---|---|---|
| BUG-001 | REQ-002 | regression_bug_001_reaches_row_1001 | FAIL confirmed | PASS | fixed |
| BUG-002 | REQ-003 | regression_bug_002_invoice_detail_uses_direct_lookup | FAIL confirmed | PASS | fixed |
| BUG-003 | REQ-004 | regression_bug_003_schema_failure_is_503 | FAIL confirmed | PASS | fixed |
| BUG-004 | REQ-007 | regression_bug_004_api_client_reference_is_opaque | FAIL confirmed | PASS | fixed |
| BUG-005 | REQ-005 | regression_bug_005_completion_failure_blocks_success | FAIL confirmed | PASS | fixed |
| BUG-006 | REQ-006 | regression_bug_006_registry_openapi_metadata_parity | FAIL confirmed | PASS | fixed |
| BUG-007 | REQ-006 | regression_bug_007_parity_follows_split_runtime | FAIL confirmed | PASS | fixed |
| BUG-008 | REQ-011 | regression_bug_008_live_migration_tail_is_present | FAIL confirmed | PASS | fixed |
| BUG-009 | REQ-010 | regression_bug_009_webhooks_fail_closed_per_tenant | FAIL confirmed | PASS | fixed |
| BUG-010 | REQ-008 | regression_bug_010_auth_uses_route_cost_rpc | FAIL confirmed | PASS | fixed |
| BUG-011 | REQ-001 | regression_bug_011_serializer_rejects_internal_fields | FAIL confirmed | PASS | fixed |
| BUG-012 | REQ-009 | regression_bug_012_public_contracts_use_projection_and_early_fingerprint | FAIL confirmed | PASS | fixed |
| BUG-013 | REQ-008 | regression_bug_013_identity_uses_canonical_rpc | FAIL confirmed | PASS | fixed |
| BUG-014 | REQ-007 | regression_bug_014_new_tenant_uses_granular_scopes_and_smoke | FAIL confirmed | PASS | fixed |

Final run: `npx vitest run --config quality/vitest.config.ts` — 45/45 passing.
