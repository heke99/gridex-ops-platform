# Migration ledger reconciliation, gridex-ops-dev (2026-10-02)

**Project.** `piidsfebjqjmnepdpnas`. The ledger has 341 rows and 648 SQL files in the repo.

## Decision: no `supabase migration repair`

`docs/migration-provenance.md` § Ledger discipline forbids manual changes to `supabase_migrations.schema_migrations` and forbids marking migrations as applied. `migration repair` does exactly that, so the production ledger is left as it is.

The ledger is compact by design: it starts at `20260531075508`, and earlier history is reconstructed in the clean replay through the verified foundation. The replay recreates the ledger from `scripts/gridex-aud-003-main-ledger.json` (snapshot 2026-08-08), not from production directly.

**Consequence:** `supabase db push` must **not** be run against this project. The CLI would try to re-run every repo file whose version is missing from the ledger. Production migrations are applied file by file (MCP `apply_migration`, or SQL with an identical body), and each one is verified with an md5 or object check.

## Mapping, migrations from 2026-10-01 onward

The ledger version is the apply timestamp; the repo version is the file timestamp. The name matches one-to-one.

| Production version | Name | Repo version |
|---|---|---|
| 20261001211709 | ediel_inbound_prodat_source_seal | 20260921171346 |
| 20261001211733 | ediel_inbound_prodat_receive_context | 20260921224255 |
| 20261001211923 | ediel_received_source_ledger | 20260922095911 |
| 20261001212028 | ediel_received_discovery_shape | 20260922105251 |
| 20261001212110 | ediel_received_register_validation | 20260922131136 |
| 20261001212245 | ediel_source_object_decisions | 20260922144906 |
| 20261001212336 | ediel_source_decision_snapshots | 20260922150922 |
| 20261001212430 | ediel_register_message_line_scope | 20260922152602 |
| 20261001212527 | ediel_source_owner_timezone | 20260922175540 |
| 20261001212756 | ediel_reviewed_structural_source | 20260922205926 |
| 20261001212856 | ediel_z06e_context_owner_gate | 20260923074910 |
| 20261001212934 | ediel_utilts_committed_retry_guard | 20260923103000 |
| 20261001213011 | ediel_utilts_ack_plan_reservation | 20260923113000 |
| 20261001213502 | ediel_closure_original_wire_binding | 20260923113014 |
| 20261001214055 | ediel_reviewed_closure_source | 20260923114703 |
| 20261001214210 | ediel_closure_snapshot_expression | 20260923124645 |
| 20261001214413 | ediel_utilts_consumption_binding_v1 | 20260923135706 |
| 20261001214605 | ediel_utilts_bound_sink_authority | 20260923150649 |
| 20261001214737 | ediel_utilts_existing_billing_binding | 20260923154221 |
| 20261001214806 | restore_customer_case_events_atomic_status | 20260923180557 |
| 20261001214933 | ediel_utilts_consumer_content_identity | 20260923191510 |
| 20261001215005 | classify_customer_case_events | 20260923192915 |
| 20261001215103 | ediel_correction_concern_capture | 20260923231731 |
| 20261001215138 | ediel_correction_capture_canonical_permission | 20260924001447 |
| 20261001215150 | company_direct_permission_scope_repair | 20260924003724 |
| 20261001215714 | schema_drift_repair_canonical_columns_20261001 | — (endast produktion, se nedan) |
| 20261001215738 | communication_permission_registry_completion | 20260924003708 |
| 20261001215910 | document_reference_context | 20260924013820 |
| 20261001215918 | customer_read_permission_registry_completion | 20260924021718 |
| 20261001220125 | correction_outbound_dispatch_fence_v1 | 20260924031626 |
| 20261001220209 | correction_process_facts_v1 | 20260924073337 |
| 20261001220320 | correction_process_witness_v1 | 20260924080601 |
| 20261001220410 | correction_process_scope_gap_v2 | 20260924083045 |
| 20261001220455 | correction_process_readset_v1 | 20260924085942 |
| 20261001220529 | correction_process_point_alias_scope_v3 | 20260924111700 |
| 20261001220617 | e035_combined_correction_snapshot | 20260924120822 |
| 20261001220637 | correction_process_archive_dates_v4 | 20260924145224 |
| 20261001220712 | e035_combined_outbound_document_readset | 20260924181019 |
| 20261001220803 | e035_combined_subject_scope | 20260924221000 |
| 20261001220845 | e035_combined_source_concern_scope | 20260925072500 |
| 20261001221003 | e035_combined_historical_alias_scope | 20260925090000 |
| 20261001221041 | e035_combined_source_scope_projection | 20260925094500 |
| 20261001222414 | e035_structural_source_point_projection | 20260925101500 |
| 20261002064334 | e035_source_scope_envelope_uniqueness | 20260925110000 |
| 20261002064403 | e035_source_scope_bgm_order | 20260925113000 |
| 20261002064450 | e035_outbound_unsealed_scope_wildcard | 20260925114500 |
| 20261002064502 | e035_switch_event_owner_binding | 20260925120000 |
| 20261002064513 | case_lifecycle_conditional_columns_repair | 20260925123000 |
| 20261002064519 | customer_case_write_permission_registry_completion | 20260925130000 |
| 20261002064554 | e035_switch_event_historical_scope | 20260925140000 |
| 20261002064613 | e035_switch_event_owner_history | 20260925150000 |
| 20261002064633 | e035_switch_event_uuid_shape | 20260925154500 |
| 20261002064711 | e035_switch_request_point_owner_scope | 20260925163000 |
| 20261002064734 | e035_combined_outbound_raw_candidate_scope | 20260925173000 |
| 20261002064828 | e035_outbound_unknown_wire_fence | 20260925233000 |
| 20261002064919 | e035_outbound_lk_scope_reason | 20260925234000 |
| 20261002065007 | e035_outbound_lk_wire_identity | 20260925235000 |
| 20261002065048 | ediel_ack_route_scope | 20260926173514 |
| 20261002065150 | utilts_ide_qualifier_membership | 20260926213000 |
| 20261002065226 | utilts_internal_storage_error_atomic_hold | 20260927160000 |
| 20261002065238 | support_case_idempotency_unique | 20261001200000 |
| 20261002065320 | customer_contact_change_transaction | 20261001210000 |
| 20261002073700 | tenant_customer_identity_providers | 20261002080000 |

## Discrepancies

- **`schema_drift_repair_canonical_columns_20261001`** exists only in production. It is a drift repair that added 5 columns the canonical migrations assumed: `permissions.category`, `roles.updated_at`, `customer_contacts.created_by/updated_by`, `customer_sites.annual_production_kwh`. Clean replay does not need it, because the columns are created by earlier repo history. No repo file is needed.
- **Repo files 42–44** (`e035_combined_source_scope_projection`, `e035_structural_source_point_projection`, `e035_source_scope_envelope_uniqueness`) were applied as equivalents in production: `ALTER COLUMN ... SET EXPRESSION` instead of DROP/ADD COLUMN, because DROP COLUMN timed out through MCP. The function bodies are identical, and the end state (the generated expression) is the same.
- **`case_lifecycle_conditional_columns_repair` (repo 20260925123000)** and **`customer_case_write_permission_registry_completion`** were applied in the order of the file versions; no discrepancy.
- **`support_case_attachments` (20261002100000)** is not yet applied; it will be applied after PR #433 is merged.
- `supabase/migrations/` contains non-migrations (`Batch 1+2.sql`, `batch 3.sql`, `batch 4+5+6.sql`, `ediel_rules.sql`, `*.snippet.json`). The CLI ignores them because they lack a version prefix. They are left untouched (historical artifacts).

## Re-check

```sql
select version, name from supabase_migrations.schema_migrations
where version >= '20261001000000' order by version;
```
Compare `name` against `ls supabase/migrations | sed 's/^[0-9]*_//'`.
