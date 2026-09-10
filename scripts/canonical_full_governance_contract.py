"""Pinned inputs for the disposable whole-source governance proof."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "supabase" / "migrations"
ORDER_FILE = ROOT / "scripts" / "gridex-aud-003-foundation-order.json"
ADDITIONS_FILE = ROOT / "scripts" / "gridex-aud-003-legacy-foundation.additions.json"

PREFIX_COUNT = 33
PREFIX_PATH_DIGEST = "ca5bba8be8cadae60b5e753addca0a6f4d7d835cf4f96bd3f3d91fb9734a8370"

# Aliases are deliberately ordered.  Do not sort this mapping.
WHOLE_SOURCES = {
    "I": (
        "20260519_customer_intake_contracts_tenant_hardening.sql",
        272,
        "a448184e58e8777c41f8bdefb32e45a1365bd37fd9a8e316065da657e57e19f4",
    ),
    "F": (
        "20260519_final_saas_hardening.sql",
        634,
        "2037dbc535d18d7575820d7f40d2a8ef4848b67060161e6851a01eb15990105e",
    ),
    "D": (
        "20260526_debug_step1_2f_customer_import_foundation.sql",
        275,
        "b2e764f4533f0539af021669831e9077582b1a90a257cbb8564777f42971465a",
    ),
    "6D2": (
        "20260519_batch_6d2_runtime_governance_completion.sql",
        572,
        "b7d9d48b9cd3093b5546b04225f9c6151b0f674d2ae73441d8086f51922de9ab",
    ),
}

EARLY_BOOTSTRAPS = {
    "bootstrap/20260519_companies_primary_contact_email_foundation.sql": (
        "migrations/20260519_final_saas_hardening.sql",
        "9a3be1644f22fb0ea8c3f08cf96d942a8fa645f4b3ae7038e78acaf0346c2c23",
        "complete immutable final SaaS source replay",
    ),
    "bootstrap/20260519_companies_governance_foundation.sql": (
        "migrations/20260519_batch_6d_superadmin_tenant_governance.sql",
        "7e245a6f95321c4fcf3fd0194b2c50a8ea99f9af4cfa05c917741e496ed6a41d",
        "complete immutable 6D source",
    ),
    "bootstrap/20260519_contract_offer_versions_foundation.sql": (
        "migrations/20260519_final_saas_hardening.sql",
        "dfc498aa35f02dcc1b4ab30481f8f52981a8987ccde911c06e4b52541d0c63e6",
        "complete immutable final SaaS source replay",
    ),
    "bootstrap/20260519_contract_offers_lifecycle_foundation.sql": (
        "migrations/20260519_customer_intake_contracts_tenant_hardening.sql",
        "d4d1a4393ca71d8d70896fa9a21e1e4f897053e4a3c55724c833a4e4b378614d",
        "complete immutable customer-intake source replay",
    ),
}

DOWNSTREAM = (
    "bootstrap/20260527_company_memberships_role_key_foundation.sql",
    "migrations/20260520_batch_6e_rbac_tenant_stats_whitelabel.sql",
    "migrations/20260520_batch_6e_fix_rbac_backfill_security.sql",
    "migrations/20260520_batch_6e_hard_platform_roles_only.sql",
)

POLICY_TARGETS = (
    "customers", "customer_contacts", "customer_addresses", "customer_sites",
    "metering_points", "customer_authorization_documents", "customer_documents",
    "customer_contracts", "customer_contract_events", "contract_offers",
    "contract_offer_versions", "powers_of_attorney", "supplier_switch_requests",
    "supplier_switch_events", "grid_owner_data_requests", "customer_operation_tasks",
    "outbound_requests", "ediel_messages", "ediel_message_events", "metering_values",
    "billing_underlays", "partner_exports", "communication_routes",
    "ediel_actor_settings", "ediel_route_profiles", "customer_sync_events",
    "customer_import_batches", "customer_import_rows", "audit_logs",
)
TRIGGER_TARGETS = POLICY_TARGETS[:-1]

F_COMPANY_TARGETS = (
    "access_logs", "audit_logs", "customers", "customer_contacts",
    "customer_addresses", "customer_sites", "metering_points",
    "supplier_switch_requests", "supplier_switch_events", "outbound_requests",
    "customer_contracts", "customer_contract_events", "contract_offers",
    "billing_underlays", "communication_routes", "grid_owner_data_requests",
    "customer_operation_tasks", "customer_documents", "power_of_attorneys",
    "powers_of_attorney", "metering_values", "meter_readings",
)
F_ABSENT = ("access_logs", "power_of_attorneys", "meter_readings")
F_PRESENT = tuple(name for name in F_COMPANY_TARGETS if name not in F_ABSENT)

I_TARGETS = (
    "customers", "customer_contacts", "customer_addresses", "customer_sites",
    "metering_points", "customer_contracts", "customer_contract_events",
    "contract_offers", "powers_of_attorney", "customer_authorization_documents",
    "supplier_switch_requests", "supplier_switch_events", "grid_owner_data_requests",
    "metering_values", "billing_underlays", "partner_exports", "outbound_requests",
    "audit_logs",
)

IMPORT_INDEXES = {
    "customer_import_batches_company_created_idx": "CREATE INDEX customer_import_batches_company_created_idx ON public.customer_import_batches USING btree (company_id, created_at DESC)",
    "customer_import_batches_company_status_created_idx": "CREATE INDEX customer_import_batches_company_status_created_idx ON public.customer_import_batches USING btree (company_id, status, created_at DESC)",
    "customer_import_rows_batch_idx": "CREATE INDEX customer_import_rows_batch_idx ON public.customer_import_rows USING btree (import_batch_id, row_number)",
    "customer_import_rows_company_status_idx": "CREATE INDEX customer_import_rows_company_status_idx ON public.customer_import_rows USING btree (company_id, status)",
    "customer_import_rows_company_status_created_idx": "CREATE INDEX customer_import_rows_company_status_created_idx ON public.customer_import_rows USING btree (company_id, status, created_at DESC)",
    "customer_import_rows_company_batch_idx": "CREATE INDEX customer_import_rows_company_batch_idx ON public.customer_import_rows USING btree (company_id, import_batch_id, row_number)",
    "customer_import_rows_customer_idx": "CREATE INDEX customer_import_rows_customer_idx ON public.customer_import_rows USING btree (company_id, customer_id)",
    "customer_import_rows_company_idx": "CREATE INDEX customer_import_rows_company_idx ON public.customer_import_rows USING btree (company_id)",
}

IMPORT_BATCH_COLUMNS = (
    ("id", "uuid"), ("company_id", "uuid"), ("source_type", "text"),
    ("file_name", "text"), ("status", "text"), ("rows_total", "integer"),
    ("rows_created", "integer"), ("rows_failed", "integer"),
    ("issues", "jsonb"), ("metadata", "jsonb"), ("created_by", "uuid"),
    ("created_at", "timestamptz"), ("imported_at", "timestamptz"),
    ("source_kind", "text"), ("total_rows", "integer"),
    ("created_rows", "integer"), ("failed_rows", "integer"),
    ("warnings", "jsonb"), ("updated_at", "timestamptz"),
)
IMPORT_ROW_COLUMNS = (
    ("id", "uuid"), ("import_batch_id", "uuid"), ("company_id", "uuid"),
    ("row_number", "integer"), ("status", "text"),
    ("customer_id", "uuid"), ("normalized_payload", "jsonb"),
    ("issues", "jsonb"), ("created_at", "timestamptz"),
    ("raw_payload", "jsonb"), ("error_message", "text"),
    ("warnings", "jsonb"), ("parser_confidence", "integer"), ("reviewed_at", "timestamptz"),
    ("reviewed_by", "uuid"), ("resolution", "text"),
    ("possible_existing_customer_id", "uuid"),
    ("duplicate_match_payload", "jsonb"), ("updated_at", "timestamptz"),
)

IMPORT_BATCH_MATRIX = (
    (1,"id","uuid",True,"gen_random_uuid()"), (2,"company_id","uuid",True,None),
    (3,"source_type","text",True,"'manual'::text"), (4,"file_name","text",False,None),
    (5,"status","text",True,"'previewed'::text"), (6,"rows_total","integer",True,"0"),
    (7,"rows_created","integer",True,"0"), (8,"rows_failed","integer",True,"0"),
    (9,"issues","jsonb",True,"'[]'::jsonb"), (10,"metadata","jsonb",True,"'{}'::jsonb"),
    (11,"created_by","uuid",False,None), (12,"created_at","timestamptz",True,"now()"),
    (13,"imported_at","timestamptz",False,None), (14,"source_kind","text",False,None),
    (15,"total_rows","integer",True,"0"), (16,"created_rows","integer",True,"0"),
    (17,"failed_rows","integer",True,"0"), (18,"warnings","jsonb",True,"'[]'::jsonb"),
    (19,"updated_at","timestamptz",True,"now()"),
)
IMPORT_ROW_MATRIX = (
    (1,"id","uuid",True,"gen_random_uuid()"), (2,"import_batch_id","uuid",True,None),
    (3,"company_id","uuid",True,None), (4,"row_number","integer",True,None),
    (5,"status","text",True,"'pending'::text"), (6,"customer_id","uuid",False,None),
    (7,"normalized_payload","jsonb",True,"'{}'::jsonb"), (8,"issues","jsonb",True,"'[]'::jsonb"),
    (9,"created_at","timestamptz",True,"now()"), (10,"raw_payload","jsonb",True,"'{}'::jsonb"),
    (11,"error_message","text",False,None), (12,"warnings","jsonb",True,"'[]'::jsonb"),
    (13,"parser_confidence","integer",False,None), (14,"reviewed_at","timestamptz",False,None),
    (15,"reviewed_by","uuid",False,None), (16,"resolution","text",False,None),
    (17,"possible_existing_customer_id","uuid",False,None),
    (18,"duplicate_match_payload","jsonb",True,"'[]'::jsonb"),
    (19,"updated_at","timestamptz",True,"now()"),
)

BATCH_STATUSES = (
    "previewed", "imported", "partially_imported", "completed", "failed",
)
ROW_STATUSES = (
    "pending", "ready_to_create", "requires_review", "duplicate_warning",
    "missing_fields", "created", "rejected", "failed", "skipped",
    "linked_existing_customer",
)

FUNCTION_SIGNATURES = (
    "gridex_is_current_session_allowed()",
    "gridex_auth_has_any_role(text[])",
    "gridex_user_is_platform_admin()",
    "gridex_company_status_is_writable(uuid)",
    "gridex_user_company_ids()",
    "gridex_can_read_company(uuid)",
    "gridex_can_write_company(uuid)",
    "gridex_user_can_manage_company(uuid)",
)


def read(relative: str) -> str:
    return (ROOT / relative).read_text()


def foundation() -> list[str]:
    return json.loads(ORDER_FILE.read_text())["foundation"]


def prefix() -> list[str]:
    return foundation()[:PREFIX_COUNT]


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def validate() -> dict[str, object]:
    order = foundation()
    additions = json.loads(ADDITIONS_FILE.read_text())
    selected = prefix()
    assert len(selected) == PREFIX_COUNT
    assert selected[-1] == "migrations/20260909123000_canonical_invitation_token_prerequisite.sql"
    order_digest = hashlib.sha256(("\n".join(selected) + "\n").encode()).hexdigest()
    assert order_digest == PREFIX_PATH_DIGEST, order_digest

    source_paths = [f"migrations/{name}" for name, _, _ in WHOLE_SOURCES.values()]
    assert order[PREFIX_COUNT:PREFIX_COUNT + len(source_paths)] == source_paths
    receipts: list[dict[str, object]] = []
    for alias, (name, lines, digest) in WHOLE_SOURCES.items():
        path = MIGRATIONS / name
        actual_lines = len(path.read_text().splitlines())
        actual_digest = sha256(path)
        assert actual_lines == lines, (name, actual_lines)
        assert actual_digest == digest, (name, actual_digest)
        source_path = f"migrations/{name}"
        assert order.count(source_path) == additions["foundation"].count(source_path) == 1
        receipts.append({"alias": alias, "path": f"migrations/{name}", "lines": lines, "sha256": digest})

    for position, (path, (source, digest, purpose)) in enumerate(EARLY_BOOTSTRAPS.items(), 8):
        assert order[position] == path
        meta = additions["derivedBootstrap"][path]
        assert meta["source"] == source
        assert meta["artifactSha256"] == digest == sha256(ROOT / "supabase" / path)
        assert meta.get("preserveSourceReplay") is True
        assert purpose in meta["purpose"]

    downstream_indexes = [order.index(path) for path in DOWNSTREAM]
    assert downstream_indexes == list(range(37, 41)), downstream_indexes
    assert len(order) == 97
    return {
        "sql": "NOT EXECUTED",
        "prefixCount": PREFIX_COUNT,
        "prefixPathSha256": order_digest,
        "wholeSources": receipts,
        "downstream": list(DOWNSTREAM),
        "foundationCount": len(order),
        "canonicalSelectionReviewed": True,
        "finalGates": "OPEN",
    }
