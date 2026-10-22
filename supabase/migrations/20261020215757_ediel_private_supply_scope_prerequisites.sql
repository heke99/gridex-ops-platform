BEGIN;
SET LOCAL search_path=pg_catalog;
SET LOCAL check_function_bodies=on;
-- SQL19: install only the missing private source-scope helpers, never a caller.
-- Exact source bytes are immutable; known-present state is a preserving no-op.
-- Existing qualified interfaces are boundaries, not native/business/legal proof.
DO $sql19_private_supply_cluster$
DECLARE
 targets CONSTANT jsonb := $targets$[
  {
    "name": "gridex_received_sources.other_supply_scope_effect_v1",
    "signature": "gridex_received_sources.other_supply_scope_effect_v1(uuid,uuid,uuid,jsonb,uuid[],uuid)",
    "sha256": "c30e7398338c7b0a39da7220ea62bffa4d8ae0134f1c7d8b272b09e07736e03e",
    "argumentNames": [
      "p_company_id",
      "p_source_message_id",
      "p_actor_user_id",
      "p_scope",
      "p_source_cohort",
      "p_canonical_id"
    ],
    "argumentCount": 6,
    "returnType": "jsonb",
    "language": "plpgsql",
    "securityDefiner": true,
    "volatility": "v",
    "config": [
      "search_path=pg_catalog",
      "TimeZone=UTC"
    ],
    "acl": [
      {
        "grantor": "postgres",
        "grantee": "postgres",
        "privilege": "EXECUTE",
        "grantable": false
      }
    ]
  },
  {
    "name": "gridex_received_sources.require_supply_scope_admission_v1",
    "signature": "gridex_received_sources.require_supply_scope_admission_v1(uuid,uuid,jsonb)",
    "sha256": "f13d05e95f9c89c0aba9332f69ffc73eff266e61f4626cdaa3456e1fa7f6fed8",
    "argumentNames": [
      "c",
      "source_id",
      "scope"
    ],
    "argumentCount": 3,
    "returnType": "uuid",
    "language": "plpgsql",
    "securityDefiner": true,
    "volatility": "v",
    "config": [
      "search_path=pg_catalog"
    ],
    "acl": [
      {
        "grantor": "postgres",
        "grantee": "postgres",
        "privilege": "EXECUTE",
        "grantable": false
      }
    ]
  },
  {
    "name": "gridex_regulated_supply.ground_wire_current_v1",
    "signature": "gridex_regulated_supply.ground_wire_current_v1(uuid,uuid,uuid,timestamp with time zone,jsonb)",
    "sha256": "489a2a1b4d4d0868f762b9416efcc3fa852d384848be779c440a30a0f18d3129",
    "argumentNames": [
      "ground",
      "company",
      "point",
      "effective",
      "own"
    ],
    "argumentCount": 5,
    "returnType": "boolean",
    "language": "plpgsql",
    "securityDefiner": true,
    "volatility": "v",
    "config": [
      "search_path=pg_catalog",
      "TimeZone=UTC"
    ],
    "acl": [
      {
        "grantor": "postgres",
        "grantee": "postgres",
        "privilege": "EXECUTE",
        "grantable": false
      }
    ]
  }
]$targets$::jsonb;
 dependencies CONSTANT jsonb := $dependencies$[
  {
    "name": "gridex_network_registry_sources.network_for_company_v1",
    "signature": "gridex_network_registry_sources.network_for_company_v1(uuid,text,text)",
    "sha256": "a7900a7319397d952d82e98e4becda2e8ad49e910f047d9459d827b99a2ad3ec",
    "argumentNames": [
      "c",
      "network_id",
      "env"
    ],
    "argumentCount": 3,
    "returnType": "jsonb",
    "language": "plpgsql",
    "securityDefiner": true,
    "volatility": "v",
    "config": [
      "search_path=pg_catalog"
    ],
    "acl": [
      {
        "grantee": "postgres",
        "grantor": "postgres",
        "grantable": false,
        "privilege": "EXECUTE"
      }
    ]
  },
  {
    "name": "gridex_received_sources.normal_switch_wire_v1",
    "signature": "gridex_received_sources.normal_switch_wire_v1(text)",
    "sha256": "9f59aeafe6e08daaf996c997efa895121324a04679439cb734a05de09ebe9ee1",
    "argumentNames": [
      "p_raw"
    ],
    "argumentCount": 1,
    "returnType": "jsonb",
    "language": "plpgsql",
    "securityDefiner": false,
    "volatility": "i",
    "config": [
      "search_path=pg_catalog"
    ],
    "acl": [
      {
        "grantee": "postgres",
        "grantor": "postgres",
        "grantable": false,
        "privilege": "EXECUTE"
      }
    ]
  },
  {
    "name": "gridex_received_sources.permission_date_v1",
    "signature": "gridex_received_sources.permission_date_v1(text)",
    "sha256": "bbb646ced1d31b50a9b4b98a49306662575e63fd48d845b50c049cfb30c7fd8c",
    "argumentNames": [
      "p_value"
    ],
    "argumentCount": 1,
    "returnType": "date",
    "language": "plpgsql",
    "securityDefiner": false,
    "volatility": "i",
    "config": [
      "search_path=pg_catalog"
    ],
    "acl": [
      {
        "grantee": "postgres",
        "grantor": "postgres",
        "grantable": false,
        "privilege": "EXECUTE"
      }
    ]
  },
  {
    "name": "gridex_received_sources.permission_time_v1",
    "signature": "gridex_received_sources.permission_time_v1(text)",
    "sha256": "9dd0687315a0b2dac379175794d873d13c0ee4b59a19239ad69fde3d92b5ff81",
    "argumentNames": [
      "p_value"
    ],
    "argumentCount": 1,
    "returnType": "timestamp with time zone",
    "language": "plpgsql",
    "securityDefiner": false,
    "volatility": "i",
    "config": [
      "search_path=pg_catalog"
    ],
    "acl": [
      {
        "grantee": "postgres",
        "grantor": "postgres",
        "grantable": false,
        "privilege": "EXECUTE"
      }
    ]
  },
  {
    "name": "gridex_received_sources.prodat_application_object_accepted_v1",
    "signature": "gridex_received_sources.prodat_application_object_accepted_v1(uuid,uuid,uuid,jsonb)",
    "sha256": "97833c2f9937a5c0d97342982efe23d081a1eb348d85fc04c14f80c61e877df9",
    "argumentNames": [
      "c",
      "source_id",
      "canonical_id",
      "object_scope"
    ],
    "argumentCount": 4,
    "returnType": "boolean",
    "language": "plpgsql",
    "securityDefiner": false,
    "volatility": "v",
    "config": [
      "search_path=pg_catalog"
    ],
    "acl": [
      {
        "grantee": "postgres",
        "grantor": "postgres",
        "grantable": false,
        "privilege": "EXECUTE"
      }
    ]
  },
  {
    "name": "gridex_received_sources.require_prodat_application_objects_v1",
    "signature": "gridex_received_sources.require_prodat_application_objects_v1(uuid,uuid)",
    "sha256": "a03fde41de9db0f7e400ca3a6f5d6c2cbae7c1c5aed5fd61bb7d7722bba1b8aa",
    "argumentNames": [
      "c",
      "source_id"
    ],
    "argumentCount": 2,
    "returnType": "jsonb",
    "language": "plpgsql",
    "securityDefiner": false,
    "volatility": "v",
    "config": [
      "search_path=pg_catalog"
    ],
    "acl": [
      {
        "grantee": "postgres",
        "grantor": "postgres",
        "grantable": false,
        "privilege": "EXECUTE"
      }
    ]
  },
  {
    "name": "gridex_received_sources.sent_source_is_current_v1",
    "signature": "gridex_received_sources.sent_source_is_current_v1(public.ediel_messages)",
    "sha256": "e294b202e0445689bce38e314fb2ff12312ae944d9f91500c27c15877e8d4a3d",
    "argumentNames": [
      "m"
    ],
    "argumentCount": 1,
    "returnType": "boolean",
    "language": "plpgsql",
    "securityDefiner": true,
    "volatility": "v",
    "config": [
      "search_path=pg_catalog"
    ],
    "acl": [
      {
        "grantee": "postgres",
        "grantor": "postgres",
        "grantable": false,
        "privilege": "EXECUTE"
      }
    ]
  },
  {
    "name": "gridex_received_sources.supply_effect_assessment_owns_period_v1",
    "signature": "gridex_received_sources.supply_effect_assessment_owns_period_v1(uuid,uuid,uuid,uuid)",
    "sha256": "d6b2cf64b45879d973963ddf6640daeaf77217e6a89a2c66fb09732ef737f15c",
    "argumentNames": [
      "c",
      "source_id",
      "period_id",
      "canonical_id"
    ],
    "argumentCount": 4,
    "returnType": "boolean",
    "language": "plpgsql",
    "securityDefiner": true,
    "volatility": "v",
    "config": [
      "search_path=pg_catalog"
    ],
    "acl": [
      {
        "grantee": "postgres",
        "grantor": "postgres",
        "grantable": false,
        "privilege": "EXECUTE"
      }
    ]
  },
  {
    "name": "gridex_received_sources.supply_wire_for_period_receipt_v1",
    "signature": "gridex_received_sources.supply_wire_for_period_receipt_v1(uuid,uuid,uuid)",
    "sha256": "e9dd5defb92a7e1a92a0990bdffbca77adebee395ac25d876ce71bba7fda34df",
    "argumentNames": [
      "c",
      "source_id",
      "period_id"
    ],
    "argumentCount": 3,
    "returnType": "jsonb",
    "language": "plpgsql",
    "securityDefiner": true,
    "volatility": "v",
    "config": [
      "search_path=pg_catalog"
    ],
    "acl": [
      {
        "grantee": "postgres",
        "grantor": "postgres",
        "grantable": false,
        "privilege": "EXECUTE"
      }
    ]
  },
  {
    "name": "gridex_regulated_supply.ground_current_v1",
    "signature": "gridex_regulated_supply.ground_current_v1(uuid,uuid,uuid,timestamp with time zone)",
    "sha256": "f74a91b4ed3171bb7f9cbb14bcaccc9d7e9b21e8c0fce52f3fe770d00208ca10",
    "argumentNames": [
      "ground",
      "company",
      "point",
      "effective"
    ],
    "argumentCount": 4,
    "returnType": "boolean",
    "language": "plpgsql",
    "securityDefiner": true,
    "volatility": "v",
    "config": [
      "search_path=pg_catalog",
      "TimeZone=UTC"
    ],
    "acl": [
      {
        "grantee": "postgres",
        "grantor": "postgres",
        "grantable": false,
        "privilege": "EXECUTE"
      }
    ]
  },
  {
    "name": "public.gridex_actor_has_company_permission",
    "signature": "public.gridex_actor_has_company_permission(uuid,uuid,text)",
    "sha256": "253843a6487cbea3a7bb3ac749aae2176462759038f7a1549e5e29ae843329bf",
    "argumentNames": [
      "p_actor_user_id",
      "p_company_id",
      "p_permission"
    ],
    "argumentCount": 3,
    "returnType": "boolean",
    "language": "sql",
    "securityDefiner": true,
    "volatility": "v",
    "config": [
      "search_path=public, pg_temp"
    ],
    "acl": [
      {
        "grantee": "authenticated",
        "grantor": "postgres",
        "grantable": false,
        "privilege": "EXECUTE"
      },
      {
        "grantee": "gridex_ediel_retention_owner",
        "grantor": "postgres",
        "grantable": false,
        "privilege": "EXECUTE"
      },
      {
        "grantee": "postgres",
        "grantor": "postgres",
        "grantable": false,
        "privilege": "EXECUTE"
      },
      {
        "grantee": "service_role",
        "grantor": "postgres",
        "grantable": false,
        "privilege": "EXECUTE"
      }
    ]
  }
]$dependencies$::jsonb;
 required_columns CONSTANT jsonb := $columns$[
 {"name":"gridex_received_sources.normal_supply_activations","columns":[
  ["period_id",["uuid"]],
  ["company_id",["uuid"]],
  ["source_message_id",["uuid"]],
  ["actor_user_id",["uuid"]],
  ["previous_period",["jsonb"]],
  ["resulting_period",["jsonb"]],
  ["result",["jsonb"]],
  ["activated_at",["timestamp with time zone"]]
 ]},
 {"name":"gridex_received_sources.normal_switch_confirmations","columns":[
  ["source_message_id",["uuid"]],
  ["period_id",["uuid"]],
  ["company_id",["uuid"]],
  ["switch_id",["uuid"]],
  ["original_message_id",["uuid"]],
  ["original_payload_hash",["text"]],
  ["contract_id",["uuid"]],
  ["protected_contract_hash",["text"]],
  ["source_object",["jsonb"]],
  ["legal_context",["jsonb"]],
  ["market_start_at",["timestamp with time zone"]],
  ["confirmed_period",["jsonb"]],
  ["confirmed_switch",["jsonb"]],
  ["created_at",["timestamp with time zone"]]
 ]},
 {"name":"gridex_received_sources.object_assessments","columns":[
  ["id",["uuid"]],
  ["source_message_id",["uuid"]],
  ["company_id",["uuid"]],
  ["environment",["text"]],
  ["source_payload_hash",["text"]],
  ["canonical_assessment_id",["uuid"]],
  ["previous_assessment_id",["uuid"]],
  ["facts_text",["text"]],
  ["facts_hash",["text"]],
  ["owner_readsets",["jsonb"]],
  ["created_xid",["xid8"]],
  ["assessed_at",["timestamp with time zone"]]
 ]},
 {"name":"gridex_received_sources.regulated_supply_ground_versions","columns":[
  ["id",["uuid"]],
  ["company_id",["uuid"]],
  ["environment",["text"]],
  ["legal_actor_id",["uuid"]],
  ["dso_actor_id",["uuid"]],
  ["grid_area_code",["text"]],
  ["process",["text"]],
  ["bilateral_agreement_id",["uuid"]],
  ["consumption_supply_period_id",["uuid"]],
  ["source_reference",["text"]],
  ["source_sha256",["text"]],
  ["legal_decision_reference",["text"]],
  ["registry_version",["text"]],
  ["approved_by",["uuid"]],
  ["approved_at",["timestamp with time zone"]],
  ["valid_from",["timestamp with time zone"]],
  ["valid_to",["timestamp with time zone"]],
  ["revoked_at",["timestamp with time zone"]]
 ]},
 {"name":"gridex_received_sources.sources","columns":[
  ["source_message_id",["uuid"]],
  ["company_id",["uuid"]],
  ["environment",["text"]],
  ["origin",["text"]],
  ["message_code",["text"]],
  ["source_received_at",["timestamp with time zone"]],
  ["captured_at",["timestamp with time zone"]],
  ["raw_payload",["text"]],
  ["payload_hash",["text"]],
  ["received_context",["jsonb"]],
  ["scope_point",["text"]],
  ["retention_byte_length",["bigint"]],
  ["retention_purged_at",["timestamp with time zone"]]
 ]},
 {"name":"gridex_received_sources.supply_object_effect_receipts","columns":[
  ["id",["uuid"]],
  ["source_message_id",["uuid"]],
  ["company_id",["uuid"]],
  ["environment",["text"]],
  ["payload_hash",["text"]],
  ["canonical_assessment_id",["uuid"]],
  ["first_line_index",["integer"]],
  ["object_scope",["jsonb"]],
  ["effect_text",["text"]],
  ["effect_hash",["text"]],
  ["applied_at",["timestamp with time zone"]]
 ]},
 {"name":"gridex_received_sources.supply_source_transitions","columns":[
  ["source_message_id",["uuid"]],
  ["company_id",["uuid"]],
  ["payload_hash",["text"]],
  ["source_code",["text"]],
  ["source_objects",["jsonb"]],
  ["previous_states",["jsonb"]],
  ["resulting_states",["jsonb"]],
  ["qualified_switch_ids",["uuid[]"]],
  ["actor_user_id",["uuid"]],
  ["applied_at",["timestamp with time zone"]]
 ]},
 {"name":"gridex_received_sources.validation_assessments","columns":[
  ["id",["uuid"]],
  ["source_message_id",["uuid"]],
  ["company_id",["uuid"]],
  ["environment",["text"]],
  ["source_payload_hash",["text"]],
  ["previous_assessment_id",["uuid"]],
  ["owner",["text"]],
  ["facts_text",["text"]],
  ["facts_hash",["text"]],
  ["assessed_at",["timestamp with time zone"]]
 ]},
 {"name":"public.company_memberships","columns":[
  ["id",["uuid"]],
  ["company_id",["uuid"]],
  ["user_id",["uuid"]],
  ["role",["text"]],
  ["role_id",["uuid"]],
  ["status",["text"]],
  ["is_active",["boolean"]],
  ["invited_email",["text"]],
  ["invited_by",["uuid"]],
  ["joined_at",["timestamp with time zone"]],
  ["created_at",["timestamp with time zone"]],
  ["updated_at",["timestamp with time zone"]],
  ["created_by",["uuid"]],
  ["updated_by",["uuid"]],
  ["membership_role",["text"]],
  ["role_key",["text"]],
  ["invited_at",["timestamp with time zone"]],
  ["accepted_at",["timestamp with time zone"]],
  ["disabled_at",["timestamp with time zone"]],
  ["disabled_by",["uuid"]],
  ["removed_at",["timestamp with time zone"]],
  ["removed_by",["uuid"]],
  ["status_reason",["text"]],
  ["metadata",["jsonb"]],
  ["suspended_at",["timestamp with time zone"]]
 ]},
 {"name":"public.customer_cases","columns":[
  ["id",["uuid"]],
  ["company_id",["uuid"]],
  ["customer_id",["uuid"]],
  ["site_id",["uuid"]],
  ["metering_point_id",["uuid"]],
  ["customer_contract_id",["uuid"]],
  ["supplier_switch_request_id",["uuid"]],
  ["outbound_request_id",["uuid"]],
  ["cancellation_ediel_message_id",["uuid"]],
  ["case_type",["text"]],
  ["status",["text"]],
  ["priority",["text"]],
  ["title",["text"]],
  ["description",["text"]],
  ["reason_category",["text"]],
  ["agreement_channel",["text"]],
  ["is_distance_agreement",["boolean"]],
  ["agreement_created_at",["timestamp with time zone"]],
  ["withdrawal_information_sent_at",["timestamp with time zone"]],
  ["withdrawal_deadline_at",["timestamp with time zone"]],
  ["withdrawal_requested_at",["timestamp with time zone"]],
  ["withdrawal_possible",["boolean"]],
  ["switch_can_be_stopped",["boolean"]],
  ["delivery_start_at",["timestamp with time zone"]],
  ["withdrawal_scenario",["text"]],
  ["cancellation_required",["boolean"]],
  ["cancellation_status",["text"]],
  ["cancellation_reference",["text"]],
  ["billing_blocked",["boolean"]],
  ["billing_manual_review",["boolean"]],
  ["break_fee_flagged",["boolean"]],
  ["customer_contacted_at",["timestamp with time zone"]],
  ["next_action",["text"]],
  ["next_action_due_at",["timestamp with time zone"]],
  ["assigned_to",["uuid"]],
  ["source",["text"]],
  ["metadata",["jsonb"]],
  ["created_by",["uuid"]],
  ["updated_by",["uuid"]],
  ["created_at",["timestamp with time zone"]],
  ["updated_at",["timestamp with time zone"]],
  ["resolved_at",["timestamp with time zone"]],
  ["closed_at",["timestamp with time zone"]],
  ["source_ediel_message_id",["uuid"]],
  ["source_business_process",["text"]],
  ["tenant_visible",["boolean"]],
  ["technical_details_visible_to_tenant",["boolean"]]
 ]},
 {"name":"public.customer_contracts","columns":[
  ["id",["uuid"]],
  ["company_id",["uuid"]],
  ["customer_id",["uuid"]],
  ["site_id",["uuid"]],
  ["metering_point_id",["uuid"]],
  ["customer_site_id",["uuid"]],
  ["contract_offer_id",["uuid"]],
  ["source_type",["text"]],
  ["status",["text"]],
  ["contract_name",["text"]],
  ["contract_type",["text"]],
  ["campaign_name",["text"]],
  ["campaign_code",["text"]],
  ["campaign_version",["text"]],
  ["price_version",["text"]],
  ["terms_version",["text"]],
  ["contract_version",["text"]],
  ["signed_version",["text"]],
  ["terms_signed_version",["text"]],
  ["version_snapshot",["jsonb"]],
  ["start_status",["text"]],
  ["old_supplier_start_at",["date"]],
  ["grid_owner_confirmed_start_at",["date"]],
  ["ediel_confirmed_start_at",["date"]],
  ["export_blocked",["boolean"]],
  ["export_block_reason",["text"]],
  ["price_snapshot",["jsonb"]],
  ["campaign_snapshot",["jsonb"]],
  ["billing_ready_status",["text"]],
  ["billing_blocker_reasons",["jsonb"]],
  ["withdrawal_requested_at",["timestamp with time zone"]],
  ["rejected_reason",["text"]],
  ["fixed_price_ore_per_kwh",["numeric","numeric(12,4)"]],
  ["spot_markup_ore_per_kwh",["numeric","numeric(12,4)"]],
  ["variable_fee_ore_per_kwh",["numeric","numeric(12,4)"]],
  ["monthly_fee_sek",["numeric","numeric(12,4)"]],
  ["green_fee_mode",["text"]],
  ["green_fee_value",["numeric","numeric(12,4)"]],
  ["binding_months",["integer"]],
  ["notice_months",["integer"]],
  ["optional_fee_lines",["jsonb"]],
  ["starts_at",["date","timestamp with time zone"]],
  ["expected_start_at",["date"]],
  ["confirmed_start_at",["date"]],
  ["actual_start_at",["date"]],
  ["start_date_source",["text"]],
  ["ends_at",["date","timestamp with time zone"]],
  ["signed_at",["timestamp with time zone"]],
  ["termination_notice_date",["date","timestamp with time zone"]],
  ["termination_reason",["text"]],
  ["auto_renew_enabled",["boolean"]],
  ["auto_renew_term_months",["integer"]],
  ["override_reason",["text"]],
  ["invoice_recipient",["text"]],
  ["invoice_email",["text"]],
  ["invoice_reference",["text"]],
  ["billing_street",["text"]],
  ["billing_postal_code",["text"]],
  ["billing_city",["text"]],
  ["billing_country",["text"]],
  ["billing_address_same_as_site",["boolean"]],
  ["billing_level",["text"]],
  ["consolidated_invoice",["boolean"]],
  ["metadata",["jsonb"]],
  ["created_at",["timestamp with time zone"]],
  ["updated_at",["timestamp with time zone"]],
  ["created_by",["uuid"]],
  ["updated_by",["uuid"]],
  ["requested_start_mode",["text"]],
  ["calculated_earliest_start_date",["date"]],
  ["price_area_used",["text"]],
  ["grid_area_code_used",["text"]],
  ["resolution_status",["text"]],
  ["onboarding_status",["text"]],
  ["onboarding_issues",["jsonb"]],
  ["requested_start_date",["date"]],
  ["confirmed_start_date",["date"]],
  ["actual_start_date",["date"]],
  ["agreement_channel",["text"]],
  ["contract_number",["text"]],
  ["price_plan_id",["uuid"]],
  ["price_plan_version_id",["uuid"]],
  ["invoice_fee_sek",["numeric"]],
  ["markup_ore_per_kwh",["numeric"]],
  ["contract_price_snapshot_id",["uuid"]],
  ["legal_acceptance_snapshot",["jsonb"]],
  ["legal_readiness_status",["text"]],
  ["legal_readiness_reasons",["jsonb"]],
  ["application_snapshot",["jsonb"]],
  ["website_application_id",["uuid"]],
  ["legal_bundle_id",["uuid"]],
  ["price_book_id",["uuid"]],
  ["snapshot_quality",["text"]],
  ["snapshot_hash",["text"]],
  ["billing_blocked_reason",["text"]],
  ["customer_number",["text"]],
  ["external_customer_id",["text"]],
  ["public_contract_offer_id",["uuid"]],
  ["offer_reference",["text"]],
  ["legal_versions_snapshot",["jsonb"]],
  ["signature_snapshot",["jsonb"]],
  ["signature_snapshot_sha256",["text"]],
  ["signed_ip_hash",["text"]],
  ["signed_user_agent",["text"]],
  ["contract_product_id",["uuid"]],
  ["contract_product_version_id",["uuid"]],
  ["contract_publication_version_id",["uuid"]],
  ["legal_bundle_version_id",["uuid"]],
  ["commercial_snapshot",["jsonb"]],
  ["legal_snapshot",["jsonb"]],
  ["document_sha256",["text"]],
  ["locked_at",["timestamp with time zone"]],
  ["tenant_communication_snapshot",["jsonb"]],
  ["tenant_communication_snapshot_sha256",["text"]],
  ["tenant_legal_party_snapshot",["jsonb"]],
  ["lifecycle_stage",["text"]],
  ["billing_eligible_at",["timestamp with time zone"]],
  ["billing_eligibility_source",["text"]],
  ["quote_reference",["text"]],
  ["energy_direction",["text"]],
  ["ended_at",["timestamp with time zone"]],
  ["status_reason_code",["text"]],
  ["customer_contract_reference",["text"]],
  ["discount_value",["numeric"]],
  ["discount_unit",["text"]],
  ["start_fee_sek",["numeric"]],
  ["admin_fee_sek",["numeric"]],
  ["break_fee_sek",["numeric"]],
  ["vat_rate",["numeric"]],
  ["is_distance_agreement",["boolean"]],
  ["withdrawal_information_sent_at",["timestamp with time zone"]],
  ["withdrawal_deadline_at",["timestamp with time zone"]],
  ["billing_blocked_by_case_id",["uuid"]]
 ]},
 {"name":"public.customer_supply_periods","columns":[
  ["id",["uuid"]],
  ["company_id",["uuid"]],
  ["customer_id",["uuid"]],
  ["metering_point_id",["uuid"]],
  ["contract_id",["uuid"]],
  ["start_date",["date"]],
  ["end_date",["date"]],
  ["source",["text"]],
  ["source_message_id",["uuid"]],
  ["status",["text"]],
  ["created_at",["timestamp with time zone"]],
  ["updated_at",["timestamp with time zone"]],
  ["source_process",["text"]],
  ["source_switch_request_id",["uuid"]],
  ["metadata",["jsonb"]],
  ["actual_start_date",["date"]],
  ["actual_end_date",["date"]],
  ["customer_contract_id",["uuid"]],
  ["market_start_at",["timestamp with time zone"]],
  ["market_end_at",["timestamp with time zone"]],
  ["market_state_version",["bigint"]],
  ["source_end_message_id",["uuid"]]
 ]},
 {"name":"public.customers","columns":[
  ["id",["uuid"]],
  ["company_id",["uuid"]],
  ["customer_type",["text"]],
  ["status",["text"]],
  ["first_name",["text"]],
  ["last_name",["text"]],
  ["full_name",["text"]],
  ["company_name",["text"]],
  ["personal_number",["text"]],
  ["normalized_personal_number",["text"]],
  ["org_number",["text"]],
  ["normalized_org_number",["text"]],
  ["email",["text"]],
  ["normalized_email",["text"]],
  ["phone",["text"]],
  ["normalized_phone",["text"]],
  ["preferred_language",["text"]],
  ["source",["text"]],
  ["customer_number",["text"]],
  ["apartment_number",["text"]],
  ["metadata",["jsonb"]],
  ["created_at",["timestamp with time zone"]],
  ["updated_at",["timestamp with time zone"]],
  ["created_by",["uuid"]],
  ["updated_by",["uuid"]],
  ["identity_number",["text"]],
  ["organization_number",["text"]],
  ["name",["text"]],
  ["onboarding_status",["text"]],
  ["activated_at",["timestamp with time zone"]],
  ["ended_at",["timestamp with time zone"]],
  ["acquisition_channel",["text"]],
  ["campaign_id",["uuid"]],
  ["sales_agent_id",["uuid"]],
  ["partner_id",["uuid"]],
  ["onboarding_issues",["jsonb"]],
  ["next_action",["text"]],
  ["ready_for_billing_at",["timestamp with time zone"]],
  ["intake_status",["text"]],
  ["intake_missing_fields",["jsonb","text[]"]],
  ["intake_quality_score",["integer"]],
  ["intake_warnings",["jsonb","text[]"]],
  ["is_test_data",["boolean"]],
  ["archived_at",["timestamp with time zone"]],
  ["archived_by",["uuid"]],
  ["archive_reason",["text"]],
  ["anonymized_at",["timestamp with time zone"]],
  ["anonymized_by",["uuid"]],
  ["data_retention_note",["text"]],
  ["external_customer_id",["text"]],
  ["customer_reference",["text"]],
  ["billing_street",["text"]],
  ["billing_postal_code",["text"]],
  ["billing_city",["text"]],
  ["billing_country",["text"]],
  ["active_sites",["integer"]],
  ["pending_sites",["integer"]],
  ["blocked_sites",["integer"]],
  ["latest_customer_action",["text"]],
  ["process_summary",["jsonb"]],
  ["invoice_email",["text"]],
  ["billing_profile_revision",["integer"]],
  ["moved_out_at",["date"]],
  ["lifecycle_closed_at",["timestamp with time zone"]],
  ["lifecycle_closed_by",["uuid"]],
  ["lifecycle_status_reason",["text"]],
  ["legal_hold",["boolean"]],
  ["legal_hold_reason",["text"]],
  ["possible_duplicate",["boolean"]],
  ["duplicate_review_status",["text"]],
  ["merge_status",["text"]],
  ["merged_into_customer_id",["uuid"]],
  ["merged_at",["timestamp with time zone"]],
  ["merged_by",["uuid"]]
 ]},
 {"name":"public.ediel_messages","columns":[
  ["id",["uuid"]],
  ["company_id",["uuid"]],
  ["direction",["text"]],
  ["message_standard",["text"]],
  ["message_family",["text"]],
  ["message_code",["text"]],
  ["message_version",["text"]],
  ["process_type",["text"]],
  ["environment",["text"]],
  ["test_flag",["integer"]],
  ["status",["text"]],
  ["transport_type",["text"]],
  ["mailbox",["text"]],
  ["mailbox_message_id",["text"]],
  ["sender_ediel_id",["text"]],
  ["sender_name",["text"]],
  ["sender_sub_address",["text"]],
  ["receiver_ediel_id",["text"]],
  ["receiver_name",["text"]],
  ["receiver_sub_address",["text"]],
  ["sender_email",["text"]],
  ["receiver_email",["text"]],
  ["subject",["text"]],
  ["file_name",["text"]],
  ["mime_type",["text"]],
  ["interchange_reference",["text"]],
  ["external_reference",["text"]],
  ["correlation_reference",["text"]],
  ["transaction_reference",["text"]],
  ["application_reference",["text"]],
  ["original_message_id",["text"]],
  ["original_transaction_id",["text"]],
  ["original_message_code",["text"]],
  ["related_message_id",["uuid"]],
  ["communication_route_id",["uuid"]],
  ["outbound_request_id",["uuid"]],
  ["switch_request_id",["uuid"]],
  ["grid_owner_data_request_id",["uuid"]],
  ["partner_export_id",["uuid"]],
  ["customer_id",["uuid"]],
  ["site_id",["uuid"]],
  ["metering_point_id",["uuid"]],
  ["grid_owner_id",["uuid"]],
  ["raw_payload",["text"]],
  ["parsed_payload",["jsonb"]],
  ["validation_report",["jsonb"]],
  ["requires_contrl",["boolean"]],
  ["requires_aperak",["boolean"]],
  ["contrl_status",["text"]],
  ["aperak_status",["text"]],
  ["utilts_err_status",["text"]],
  ["ack_outcome",["text"]],
  ["syntax_check_status",["text"]],
  ["functional_check_status",["text"]],
  ["failure_reason",["text"]],
  ["message_created_at",["timestamp with time zone"]],
  ["message_received_at",["timestamp with time zone"]],
  ["message_sent_at",["timestamp with time zone"]],
  ["parsed_at",["timestamp with time zone"]],
  ["validated_at",["timestamp with time zone"]],
  ["acknowledged_at",["timestamp with time zone"]],
  ["failed_at",["timestamp with time zone"]],
  ["ack_due_at",["timestamp with time zone"]],
  ["created_at",["timestamp with time zone"]],
  ["updated_at",["timestamp with time zone"]],
  ["created_by",["uuid"]],
  ["updated_by",["uuid"]],
  ["metadata",["jsonb"]],
  ["unb_sender_id",["text"]],
  ["unb_sender_subaddress",["text"]],
  ["unb_receiver_id",["text"]],
  ["unb_receiver_subaddress",["text"]],
  ["message_reference",["text"]],
  ["bgm_code",["text"]],
  ["bgm_reference",["text"]],
  ["tenant_resolution_status",["text"]],
  ["business_match_status",["text"]],
  ["ack_status",["text"]],
  ["processing_status",["text"]],
  ["raw_payload_hash",["text"]],
  ["utilts_subtype",["text"]],
  ["measurement_resolution",["text"]],
  ["backend_automation_status",["text"]],
  ["backend_automation_reason",["text"]],
  ["route_profile_id",["uuid"]],
  ["route_version",["integer"]],
  ["transport_profile_id",["uuid"]],
  ["routing_decision_id",["uuid"]],
  ["routing_snapshot",["jsonb"]],
  ["parsed_unb_sender_ediel_id",["text"]],
  ["parsed_unb_receiver_ediel_id",["text"]],
  ["resolved_company_id",["uuid"]],
  ["resolved_sender_ediel_id",["text"]],
  ["resolved_receiver_ediel_id",["text"]],
  ["receiver_source",["text"]],
  ["resolved_grid_owner_id",["uuid"]],
  ["resolved_counterparty_id",["uuid"]],
  ["dynamic_receiver_strategy",["text"]],
  ["party_id",["uuid"]],
  ["party_address_id",["uuid"]],
  ["transport_security_mode",["text"]],
  ["route_transport_security_mode",["text"]],
  ["was_smime_encrypted",["boolean"]],
  ["expected_receiver_certificate_id",["uuid"]],
  ["cms_expected_receiver_present",["boolean"]],
  ["operation_id",["uuid"]],
  ["grid_owner_information_request_id",["uuid"]],
  ["intent_id",["uuid"]],
  ["message_subtype",["text"]],
  ["business_process",["text"]],
  ["business_state",["text"]],
  ["rule_profile_key",["text"]],
  ["rule_profile_version_id",["uuid"]],
  ["rule_profile_version",["text"]],
  ["rule_pack_checksum",["text"]],
  ["rule_pack_snapshot",["jsonb"]],
  ["canonical_rule_pack_id",["uuid"]],
  ["certificate_profile_id",["uuid"]],
  ["business_date",["date"]],
  ["source_operation_id",["text"]],
  ["immutable_payload_hash",["text"]],
  ["immutable_rendered_at",["timestamp with time zone"]],
  ["execution_context_snapshot",["jsonb"]],
  ["contrl_due_at",["timestamp with time zone"]],
  ["business_response_due_at",["timestamp with time zone"]],
  ["response_overdue_at",["timestamp with time zone"]],
  ["inbound_email_message_id",["uuid"]]
 ]},
 {"name":"public.metering_points","columns":[
  ["id",["uuid"]],
  ["company_id",["uuid"]],
  ["customer_id",["uuid"]],
  ["site_id",["uuid"]],
  ["meter_point_id",["text"]],
  ["metering_point_id",["text"]],
  ["normalized_metering_point_id",["text"]],
  ["site_facility_id",["text"]],
  ["ediel_reference",["text"]],
  ["status",["text"]],
  ["measurement_type",["text"]],
  ["reading_frequency",["text"]],
  ["grid_owner_id",["uuid"]],
  ["price_area_code",["text"]],
  ["start_date",["date"]],
  ["end_date",["date"]],
  ["closed_at",["timestamp with time zone"]],
  ["closed_reason",["text"]],
  ["is_settlement_relevant",["boolean"]],
  ["metadata",["jsonb"]],
  ["created_at",["timestamp with time zone"]],
  ["updated_at",["timestamp with time zone"]],
  ["created_by",["uuid"]],
  ["updated_by",["uuid"]],
  ["customer_site_id",["uuid"]],
  ["grid_area_code",["text"]],
  ["grid_owner_ediel_id",["text"]],
  ["meter_number",["text"]],
  ["settlement_method",["text"]],
  ["product_direction",["text"]],
  ["bidding_zone_code",["text"]],
  ["metering_method",["text"]],
  ["estimated_annual_consumption_kwh",["numeric"]],
  ["consumption_profile_id",["uuid"]],
  ["data_quality_status",["text"]],
  ["verification_status",["text"]],
  ["onboarding_status",["text"]],
  ["onboarding_issues",["jsonb"]],
  ["next_action",["text"]],
  ["facility_data_verified_at",["timestamp with time zone"]],
  ["facility_data_status",["text"]],
  ["facility_data_last_error",["text"]],
  ["facility_data_last_error_code",["text"]],
  ["is_test_data",["boolean"]],
  ["archived_at",["timestamp with time zone"]],
  ["archived_by",["uuid"]],
  ["archive_reason",["text"]],
  ["ediel_metering_point_id",["text"]],
  ["customer_number",["text"]],
  ["external_customer_id",["text"]],
  ["anlage_id",["text"]],
  ["grid_owner_name",["text"]],
  ["price_area",["text"]],
  ["energy_resolution_id",["uuid"]],
  ["resolution_source",["text"]],
  ["resolution_confidence",["numeric(5,4)"]],
  ["resolution_status",["text"]],
  ["resolved_at",["timestamp with time zone"]],
  ["geodata_version",["text"]]
 ]},
 {"name":"public.platform_actor_identifiers","columns":[
  ["id",["uuid"]],
  ["actor_id",["uuid"]],
  ["identifier_type",["text"]],
  ["identifier_value",["text"]],
  ["id_code_qualifier",["text"]],
  ["id_code_responsible",["text"]],
  ["source",["text"]],
  ["is_verified",["boolean"]],
  ["valid_from",["date"]],
  ["valid_to",["date"]],
  ["metadata",["jsonb"]],
  ["created_at",["timestamp with time zone"]],
  ["updated_at",["timestamp with time zone"]]
 ]},
 {"name":"public.supplier_switch_requests","columns":[
  ["id",["uuid"]],
  ["company_id",["uuid"]],
  ["customer_id",["uuid"]],
  ["site_id",["uuid"]],
  ["metering_point_id",["uuid"]],
  ["power_of_attorney_id",["uuid"]],
  ["authorization_document_id",["uuid"]],
  ["request_type",["text"]],
  ["status",["text"]],
  ["requested_start_date",["date"]],
  ["current_supplier_name",["text"]],
  ["current_supplier_org_number",["text"]],
  ["incoming_supplier_name",["text"]],
  ["incoming_supplier_org_number",["text"]],
  ["grid_owner_id",["uuid"]],
  ["price_area_code",["text"]],
  ["validation_snapshot",["jsonb"]],
  ["external_reference",["text"]],
  ["submitted_at",["timestamp with time zone"]],
  ["completed_at",["timestamp with time zone"]],
  ["failed_at",["timestamp with time zone"]],
  ["failure_reason",["text"]],
  ["paused_at",["timestamp with time zone"]],
  ["paused_by",["uuid"]],
  ["pause_reason",["text"]],
  ["lifecycle_blocked",["boolean"]],
  ["lifecycle_block_source",["text"]],
  ["lifecycle_block_id",["uuid"]],
  ["metadata",["jsonb"]],
  ["created_at",["timestamp with time zone"]],
  ["updated_at",["timestamp with time zone"]],
  ["created_by",["uuid"]],
  ["updated_by",["uuid"]],
  ["automation_origin",["text"]],
  ["automation_key",["text"]],
  ["customer_site_id",["uuid"]],
  ["grid_owner_ediel_id",["text"]],
  ["grid_area_code",["text"]],
  ["confirmed_start_date",["date"]],
  ["rff_li_reference",["text"]],
  ["outbound_z03_message_id",["uuid"]],
  ["inbound_z04_message_id",["uuid"]],
  ["rejection_reason_code",["text"]],
  ["rejection_reason_text",["text"]],
  ["operation_id",["uuid"]],
  ["readiness_snapshot",["jsonb"]],
  ["readiness_checked_at",["timestamp with time zone"]],
  ["current_supplier_ediel_id",["text"]],
  ["contract_id",["uuid"]],
  ["customer_contract_id",["uuid"]],
  ["process_type",["text"]],
  ["prodat_variant",["text"]],
  ["prodat_reason",["text"]],
  ["expected_z02_variant",["text"]],
  ["z03_variant",["text"]],
  ["communication_route_id",["uuid"]],
  ["ediel_route_profile_id",["uuid"]],
  ["current_supplier_id",["uuid"]],
  ["current_supplier_unknown",["boolean"]],
  ["current_supplier_contract_status",["text"]],
  ["current_supplier_contract_end_date",["date"]],
  ["current_supplier_notice_period",["text"]],
  ["current_supplier_termination_fee",["numeric"]],
  ["current_supplier_response_status",["text"]]
 ]},
 {"name":"public.tenant_actor_identifiers","columns":[
  ["id",["uuid"]],
  ["company_id",["uuid"]],
  ["environment",["text"]],
  ["actor_id",["uuid"]],
  ["identifier_type",["text"]],
  ["identifier_value",["text"]],
  ["qualifier",["text"]],
  ["subaddress",["text"]],
  ["valid_from",["timestamp with time zone"]],
  ["valid_to",["timestamp with time zone"]]
 ]},
 {"name":"public.tenant_actor_roles","columns":[
  ["id",["uuid"]],
  ["company_id",["uuid"]],
  ["environment",["text"]],
  ["actor_id",["uuid"]],
  ["role_code",["text"]],
  ["valid_from",["timestamp with time zone"]],
  ["valid_to",["timestamp with time zone"]]
 ]},
 {"name":"public.tenant_bilateral_agreements","columns":[
  ["id",["uuid"]],
  ["company_id",["uuid"]],
  ["environment",["text"]],
  ["counterparty_actor_id",["uuid"]],
  ["capability_code",["text"]],
  ["terms",["jsonb"]],
  ["is_enabled",["boolean"]],
  ["valid_from",["timestamp with time zone"]],
  ["valid_to",["timestamp with time zone"]],
  ["source_reference",["text"]]
 ]},
 {"name":"public.tenant_ediel_profiles","columns":[
  ["id",["uuid"]],
  ["company_id",["uuid"]],
  ["environment",["text"]],
  ["market",["text"]],
  ["is_enabled",["boolean"]],
  ["valid_from",["timestamp with time zone"]],
  ["valid_to",["timestamp with time zone"]],
  ["metadata",["jsonb"]]
 ]},
 {"name":"public.user_profiles","columns":[
  ["id",["uuid"]],
  ["email",["text"]],
  ["full_name",["text"]],
  ["created_at",["timestamp with time zone"]],
  ["updated_at",["timestamp with time zone"]],
  ["user_status",["text"]],
  ["auth_email_confirmed_at",["timestamp with time zone"]],
  ["auth_last_sign_in_at",["timestamp with time zone"]],
  ["auth_last_synced_at",["timestamp with time zone"]],
  ["last_invite_sent_at",["timestamp with time zone"]],
  ["last_password_reset_sent_at",["timestamp with time zone"]],
  ["last_confirmation_email_sent_at",["timestamp with time zone"]],
  ["last_auth_email_action",["text"]],
  ["last_auth_email_action_at",["timestamp with time zone"]],
  ["last_auth_email_action_by",["uuid"]],
  ["last_auth_email_message",["text"]]
 ]},
 {"name":"gridex_regulated_supply.artifacts","columns":[
  ["id",["uuid"]],
  ["company_id",["uuid"]],
  ["environment",["text"]],
  ["selector",["jsonb"]],
  ["scope",["jsonb"]],
  ["scope_hash",["text"]],
  ["source_bytes",["bytea"]],
  ["source_hash",["text"]],
  ["mime_type",["text"]],
  ["source_reference",["text"]],
  ["source_version",["text"]],
  ["issuer_receipt",["jsonb"]],
  ["receipt_hash",["text"]],
  ["submitted_by",["uuid"]],
  ["archived_at",["timestamp with time zone"]]
 ]},
 {"name":"gridex_regulated_supply.origins","columns":[
  ["ground_id",["uuid"]],
  ["company_id",["uuid"]],
  ["artifact_id",["uuid"]],
  ["review_id",["uuid"]],
  ["ground_binding",["jsonb"]],
  ["created_at",["timestamp with time zone"]]
 ]}
]$columns$::jsonb;
 names text[];relation_names text[];dependency_names text[];
 x jsonb;col jsonb;f record;rel record;n integer;missing integer:=0;current_acl jsonb;
 before_dependencies jsonb;before_targets jsonb;before_relations jsonb;before_triggers jsonb;before_constraints jsonb;before_namespaces jsonb;before_roles jsonb;before_memberships jsonb;before_defaults jsonb;
 after_value jsonb;
BEGIN
 IF current_user<>'postgres' OR session_user<>'postgres' OR current_setting('check_function_bodies')<>'on'
 THEN RAISE EXCEPTION 'sql19_existing_postgres_install_context_required' USING ERRCODE='42501';END IF;
 SELECT array_agg(value->>'name' ORDER BY value->>'name') INTO names FROM jsonb_array_elements(targets);
 SELECT array_agg(value->>'name' ORDER BY value->>'name') INTO dependency_names FROM jsonb_array_elements(dependencies);
 SELECT array_agg(value->>'name' ORDER BY value->>'name') INTO relation_names FROM jsonb_array_elements(required_columns);
 IF cardinality(names)<>3 OR cardinality(dependency_names)<>11 OR cardinality(relation_names)<>24 THEN RAISE EXCEPTION 'sql19_exact_closed_scope_required';END IF;
 IF EXISTS(SELECT FROM unnest(ARRAY['gridex_received_sources','gridex_regulated_supply']) v(name) LEFT JOIN pg_namespace s ON s.nspname=v.name
  WHERE s.oid IS NULL OR s.nspowner<>'postgres'::regrole OR NOT has_schema_privilege('postgres',s.oid,'USAGE') OR NOT has_schema_privilege('postgres',s.oid,'CREATE')
   OR has_schema_privilege('anon',s.oid,'CREATE') OR has_schema_privilege('authenticated',s.oid,'CREATE') OR has_schema_privilege('service_role',s.oid,'CREATE'))
 THEN RAISE EXCEPTION 'sql19_existing_private_namespace_required' USING ERRCODE='42501';END IF;
 IF EXISTS(SELECT FROM pg_default_acl d WHERE d.defaclrole='postgres'::regrole AND d.defaclobjtype='f'
  AND (d.defaclnamespace=0 OR d.defaclnamespace IN(SELECT oid FROM pg_namespace WHERE nspname IN('gridex_received_sources','gridex_regulated_supply'))))
 THEN RAISE EXCEPTION 'sql19_known_function_creation_defaults_required' USING ERRCODE='42501';END IF;
 -- No dependency is adopted by name alone. Signatures, complete relevant
 -- headers, source bytes and effective ACLs must match the finite contracts.
 FOR x IN SELECT value FROM jsonb_array_elements(dependencies||targets) LOOP
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace s ON s.oid=p.pronamespace WHERE s.nspname||'.'||p.proname=x->>'name';
  IF x->>'name'=ANY(names) AND n=0 THEN missing:=missing+1;CONTINUE;END IF;
  IF n<>1 THEN RAISE EXCEPTION 'sql19_exact_single_function_interface_required:%',x->>'name' USING ERRCODE='42501';END IF;
  SELECT p.*,l.lanname INTO f FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=to_regprocedure(x->>'signature');
  IF NOT FOUND OR f.proowner<>'postgres'::regrole OR f.prokind<>'f' OR f.lanname<>x->>'language'
   OR f.pronargs<>(x->>'argumentCount')::integer OR to_jsonb(f.proargnames) IS DISTINCT FROM x->'argumentNames'
   OR f.proargmodes IS NOT NULL OR f.proallargtypes IS NOT NULL OR f.pronargdefaults<>0 OR f.proargdefaults IS NOT NULL
   OR f.prorettype IS DISTINCT FROM to_regtype(x->>'returnType')::oid
   OR f.prosecdef IS DISTINCT FROM (x->>'securityDefiner')::boolean OR f.provolatile::text<>x->>'volatility' OR f.proparallel<>'u'
   OR f.proisstrict OR f.proleakproof OR f.proretset OR f.procost<>100 OR f.prorows<>0 OR f.provariadic::oid<>0 OR f.prosupport::oid<>0
   OR f.protrftypes IS NOT NULL OR f.probin IS NOT NULL OR f.prosqlbody IS NOT NULL OR to_jsonb(f.proconfig) IS DISTINCT FROM x->'config'
   OR encode(sha256(convert_to(f.prosrc,'UTF8')),'hex') IS DISTINCT FROM x->>'sha256'
   OR has_function_privilege('postgres',f.oid,'EXECUTE') IS NOT TRUE
  THEN RAISE EXCEPTION 'sql19_exact_function_profile_required:%',x->>'name' USING ERRCODE='42501';END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('grantor',a.grantor::regrole::text,'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END,'privilege',a.privilege_type,'grantable',a.is_grantable)
   ORDER BY CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END,a.grantor::regrole::text,a.privilege_type,a.is_grantable),'[]') INTO current_acl
   FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a;
  IF current_acl IS DISTINCT FROM x->'acl' THEN RAISE EXCEPTION 'sql19_exact_function_acl_required:%',x->>'name' USING ERRCODE='42501';END IF;
 END LOOP;
 IF missing NOT IN(0,3) THEN RAISE EXCEPTION 'sql19_uniform_absent_or_exact_cluster_required' USING ERRCODE='42501';END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(required_columns) LOOP
  SELECT c.* INTO rel FROM pg_class c WHERE c.oid=to_regclass(x->>'name');
  IF NOT FOUND OR rel.relkind<>'r' OR rel.relowner<>'postgres'::regrole OR has_table_privilege('postgres',rel.oid,'SELECT') IS NOT TRUE
  THEN RAISE EXCEPTION 'sql19_existing_typed_relation_required:%',x->>'name' USING ERRCODE='42501';END IF;
  FOR col IN SELECT value FROM jsonb_array_elements(x->'columns') LOOP
   IF NOT EXISTS(SELECT FROM pg_attribute a WHERE a.attrelid=rel.oid AND a.attnum>0 AND NOT a.attisdropped AND a.attname=col->>0
    AND to_jsonb(format_type(a.atttypid,a.atttypmod)) IN(SELECT value FROM jsonb_array_elements(col->1)))
   THEN RAISE EXCEPTION 'sql19_known_column_type_required:%.%',x->>'name',col->>0 USING ERRCODE='42501';END IF;
  END LOOP;
 END LOOP;
 IF EXISTS(SELECT FROM unnest(ARRAY['public.customer_cases','public.customer_supply_periods','public.supplier_switch_requests']) v(name)
  WHERE NOT has_table_privilege('postgres',to_regclass(v.name),'INSERT') OR NOT has_table_privilege('postgres',to_regclass(v.name),'UPDATE'))
 THEN RAISE EXCEPTION 'sql19_existing_business_table_owner_capability_required' USING ERRCODE='42501';END IF;
 -- Snapshot actual profiles without normalizing legacy columns, constraints,
 -- triggers, role membership, namespaces or existing function source/config.
 SELECT jsonb_agg(jsonb_build_object('proc',to_jsonb(p),'comment',obj_description(p.oid,'pg_proc')) ORDER BY p.oid) INTO before_dependencies FROM pg_proc p JOIN pg_namespace s ON s.oid=p.pronamespace WHERE s.nspname||'.'||p.proname=ANY(dependency_names);
 SELECT jsonb_agg(jsonb_build_object('proc',to_jsonb(p),'comment',obj_description(p.oid,'pg_proc')) ORDER BY p.oid) INTO before_targets FROM pg_proc p JOIN pg_namespace s ON s.oid=p.pronamespace WHERE s.nspname||'.'||p.proname=ANY(names);
 SELECT jsonb_agg(jsonb_build_object('class',to_jsonb(c),'attributes',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0),'defaults',(SELECT jsonb_agg(to_jsonb(d) ORDER BY d.oid) FROM pg_attrdef d WHERE d.adrelid=c.oid)) ORDER BY c.oid) INTO before_relations FROM pg_class c WHERE c.oid IN(SELECT to_regclass(v) FROM unnest(relation_names)v);
 SELECT jsonb_agg(to_jsonb(t) ORDER BY t.oid) INTO before_triggers FROM pg_trigger t WHERE t.tgrelid IN('public.customer_cases'::regclass,'public.customer_supply_periods'::regclass,'public.supplier_switch_requests'::regclass);
 SELECT jsonb_agg(to_jsonb(c) ORDER BY c.oid) INTO before_constraints FROM pg_constraint c WHERE c.conrelid IN('public.customer_cases'::regclass,'public.customer_supply_periods'::regclass,'public.supplier_switch_requests'::regclass);
 SELECT jsonb_agg(to_jsonb(s) ORDER BY s.oid) INTO before_namespaces FROM pg_namespace s;
 SELECT jsonb_agg(to_jsonb(r)-'rolpassword' ORDER BY r.oid) INTO before_roles FROM pg_roles r;
 SELECT jsonb_agg(to_jsonb(m) ORDER BY m.oid) INTO before_memberships FROM pg_auth_members m;
 SELECT jsonb_agg(to_jsonb(d) ORDER BY d.oid) INTO before_defaults FROM pg_default_acl d;
 IF missing=3 THEN
  EXECUTE $sql19_definition_0$CREATE FUNCTION gridex_received_sources.other_supply_scope_effect_v1(p_company_id uuid, p_source_message_id uuid, p_actor_user_id uuid, p_scope jsonb, p_source_cohort uuid[], p_canonical_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    SET "TimeZone" TO 'UTC'
    AS $$
DECLARE m public.ediel_messages%rowtype;sp public.customer_supply_periods%rowtype;sw public.supplier_switch_requests%rowtype;origin public.ediel_messages%rowtype;
 prior gridex_received_sources.supply_source_transitions%rowtype;ground gridex_received_sources.regulated_supply_ground_versions%rowtype;
 wire jsonb;sender_basis jsonb;original jsonb;own jsonb;entry jsonb;plan jsonb;plans jsonb:='[]';before_states jsonb:='[]';previous_switches jsonb:='[]';after_states jsonb;old jsonb;
 ids uuid[];point public.metering_points%rowtype;consumption public.metering_points%rowtype;legal_actor uuid;dso_actor uuid;
 event_at timestamptz;start_at timestamptz;reason text;period_id uuid;expected_version bigint;qualified boolean;
BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_source_message_id AND company_id=p_company_id FOR UPDATE; IF gridex_received_sources.require_supply_scope_admission_v1(p_company_id,p_source_message_id,p_scope) IS DISTINCT FROM p_canonical_id THEN RAISE EXCEPTION 'supply_scoped_canonical_assessment_changed';END IF; IF jsonb_array_length(gridex_received_sources.require_prodat_application_objects_v1(p_company_id,p_source_message_id)->'objects')>1 THEN m.customer_id:=NULL;m.metering_point_id:=NULL;END IF;
 IF NOT FOUND OR m.direction IS DISTINCT FROM 'inbound' OR m.message_family IS DISTINCT FROM 'PRODAT' OR p_actor_user_id IS NULL THEN RETURN jsonb_build_object('applied',false,'reason','supply_source_unavailable');END IF;
 PERFORM u.id FROM public.user_profiles u WHERE u.id=p_actor_user_id FOR SHARE;
 PERFORM cm.id FROM public.company_memberships cm WHERE cm.company_id=m.company_id AND cm.user_id=p_actor_user_id FOR SHARE;
 IF NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=p_actor_user_id AND u.user_status='active') OR NOT coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,m.company_id,'metering.write'),false)
 OR NOT EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=m.company_id AND cm.user_id=p_actor_user_id AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL) THEN RETURN jsonb_build_object('applied',false,'reason','supply_execution_actor_unqualified');END IF;
 SELECT * INTO prior FROM gridex_received_sources.supply_source_transitions WHERE source_message_id=m.id;
 IF FOUND AND (prior.company_id IS DISTINCT FROM m.company_id OR prior.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')) THEN RAISE EXCEPTION 'supply_replay_conflict';END IF;
 IF NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments v WHERE v.id=p_canonical_id AND v.source_message_id=m.id AND v.company_id=m.company_id AND v.environment=m.environment AND v.source_payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')
 AND v.facts_text::jsonb->>'syntaxDecision'='accepted' AND v.facts_text::jsonb->>'functionalDecision'='accepted' AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=v.id)) THEN RETURN jsonb_build_object('applied',false,'reason','canonical_supply_source_not_accepted');END IF;
 wire:=gridex_received_sources.normal_switch_wire_v1(m.raw_payload);
 IF wire IS NULL OR (wire->>'code' IN ('Z04','Z05')) IS NOT TRUE THEN RETURN jsonb_build_object('applied',false,'reason','supply_wire_unavailable');END IF;
 -- No mixed physical subtype, duplicate point, or partially applied message.
 SELECT o->>'reason' INTO reason FROM jsonb_array_elements(wire->'objects') o LIMIT 1;
 IF nullif(reason,'') IS NULL OR EXISTS(SELECT FROM jsonb_array_elements(wire->'objects') o WHERE o->>'reason' IS DISTINCT FROM reason OR nullif(o->>'point','') IS NULL OR nullif(o->>'li','') IS NULL)
 OR (SELECT count(DISTINCT o->>'point') FROM jsonb_array_elements(wire->'objects') o)<>jsonb_array_length(wire->'objects') THEN RETURN jsonb_build_object('applied',false,'reason','supply_object_scope_unqualified');END IF;
 IF prior.source_message_id IS NOT NULL THEN
  IF wire->>'code'='Z04' AND reason IN('Z26','Z70') AND EXISTS(SELECT FROM jsonb_array_elements(prior.resulting_states) saved WHERE gridex_regulated_supply.ground_current_v1((saved#>>'{metadata,sourceGroundId}')::uuid,m.company_id,(saved->>'metering_point_id')::uuid,(saved->>'market_start_at')::timestamptz) IS NOT TRUE) THEN RETURN jsonb_build_object('applied',false,'reason','regulated_supply_current_ground_required');END IF;
  RETURN jsonb_build_object('applied',true,'idempotent',true,'periods',prior.resulting_states);
 END IF;
 -- Only a first Z05/C restoration requires today's actual sender registry.
 -- Historical recorded outcomes returned above retain their original truth.
 IF wire->>'code'='Z05' AND reason='Z24' THEN
  sender_basis:=gridex_network_registry_sources.network_for_company_v1(m.company_id,wire->>'sender',m.environment);
  IF sender_basis->>'status' IS DISTINCT FROM 'authorized'
   OR sender_basis#>>'{basis,companyId}' IS DISTINCT FROM m.company_id::text
   OR sender_basis#>>'{basis,environment}' IS DISTINCT FROM m.environment
   OR sender_basis#>>'{basis,networkEdielId}' IS DISTINCT FROM wire->>'sender'
   THEN RETURN jsonb_build_object('applied',false,'reason','z05c_current_sender_network_registry_required');END IF;
 END IF;
 -- Only a first Z04/C cancellation requires today's actual sender registry.
 -- Historical recorded outcomes returned above retain their original truth.
 IF wire->>'code'='Z04' AND reason='Z24' THEN
  sender_basis:=gridex_network_registry_sources.network_for_company_v1(m.company_id,wire->>'sender',m.environment);
  IF sender_basis->>'status' IS DISTINCT FROM 'authorized'
   OR sender_basis#>>'{basis,companyId}' IS DISTINCT FROM m.company_id::text
   OR sender_basis#>>'{basis,environment}' IS DISTINCT FROM m.environment
   OR sender_basis#>>'{basis,networkEdielId}' IS DISTINCT FROM wire->>'sender'
   THEN RETURN jsonb_build_object('applied',false,'reason','z04c_current_sender_network_registry_required');END IF;
 END IF;
 PERFORM tp.id FROM public.tenant_ediel_profiles tp WHERE tp.company_id=m.company_id AND tp.environment=m.environment ORDER BY tp.id FOR SHARE;
 PERFORM i.id FROM public.tenant_actor_identifiers i WHERE i.company_id=m.company_id AND i.environment=m.environment ORDER BY i.id FOR SHARE;
 PERFORM r.id FROM public.tenant_actor_roles r WHERE r.company_id=m.company_id AND r.environment=m.environment ORDER BY r.id FOR SHARE;
 IF NOT EXISTS(SELECT FROM public.tenant_ediel_profiles tp WHERE tp.company_id=m.company_id AND tp.environment=m.environment AND tp.market='electricity' AND tp.is_enabled AND tp.valid_from<=m.message_received_at AND (tp.valid_to IS NULL OR m.message_received_at<tp.valid_to)) THEN RETURN jsonb_build_object('applied',false,'reason','supply_tenant_profile_unqualified');END IF;
 SELECT array_agg(DISTINCT i.actor_id) INTO ids FROM public.tenant_actor_identifiers i JOIN public.tenant_actor_roles r ON r.company_id=i.company_id AND r.environment=i.environment AND r.actor_id=i.actor_id
 WHERE i.company_id=m.company_id AND i.environment=m.environment AND i.identifier_type='EdielId' AND i.identifier_value=wire->>'receiver' AND i.valid_from<=m.message_received_at AND (i.valid_to IS NULL OR m.message_received_at<i.valid_to)
 AND r.role_code='electricity_supplier' AND r.valid_from<=m.message_received_at AND (r.valid_to IS NULL OR m.message_received_at<r.valid_to);
 IF coalesce(cardinality(ids),0)<>1 THEN RETURN jsonb_build_object('applied',false,'reason','supply_legal_actor_unqualified');END IF;legal_actor:=ids[1];
 FOR own IN SELECT o FROM jsonb_array_elements(wire->'objects') o ORDER BY o->>'point' LOOP
  event_at:=gridex_received_sources.permission_time_v1(own->>CASE WHEN wire->>'code'='Z04' THEN 'start' ELSE 'end' END);
  IF event_at IS NULL THEN RETURN jsonb_build_object('applied',false,'reason','supply_effective_time_unavailable');END IF;
  IF wire->>'code'='Z04' AND reason IN ('Z26','Z70') THEN
   SELECT array_agg(mp.id ORDER BY mp.id) INTO ids FROM public.metering_points mp WHERE mp.company_id=m.company_id AND mp.ediel_metering_point_id=own->>'point' AND mp.grid_area_code=own->>'gridArea' AND mp.grid_owner_ediel_id=wire->>'sender'
    AND mp.customer_id IS NOT NULL AND (m.customer_id IS NULL OR m.customer_id=mp.customer_id) AND (m.metering_point_id IS NULL OR m.metering_point_id=mp.id);
   IF coalesce(cardinality(ids),0)<>1 THEN RETURN jsonb_build_object('applied',false,'reason','regulated_supply_exact_object_unavailable');END IF;
   SELECT * INTO point FROM public.metering_points WHERE id=ids[1] AND company_id=m.company_id FOR UPDATE;
   PERFORM customer.id FROM public.customers customer WHERE customer.id=point.customer_id AND customer.company_id=m.company_id FOR SHARE;
   IF NOT EXISTS(SELECT FROM public.customers customer WHERE customer.id=point.customer_id AND customer.company_id=m.company_id AND own->>'customerIdentity'=coalesce(nullif(btrim(customer.org_number),''),nullif(btrim(customer.personal_number),''))) THEN RETURN jsonb_build_object('applied',false,'reason','regulated_supply_customer_identity_unqualified');END IF;
   PERFORM ai.id FROM public.platform_actor_identifiers ai WHERE lower(ai.identifier_type) IN ('edielid','ediel_id') AND ai.identifier_value=wire->>'sender' ORDER BY ai.id FOR SHARE;
   SELECT array_agg(DISTINCT ai.actor_id) INTO ids FROM public.platform_actor_identifiers ai WHERE lower(ai.identifier_type) IN ('edielid','ediel_id') AND ai.identifier_value=wire->>'sender' AND ai.is_verified AND (ai.valid_from IS NULL OR ai.valid_from<=(m.message_received_at AT TIME ZONE 'Etc/GMT-1')::date) AND (ai.valid_to IS NULL OR (m.message_received_at AT TIME ZONE 'Etc/GMT-1')::date<=ai.valid_to);
   IF coalesce(cardinality(ids),0)<>1 THEN RETURN jsonb_build_object('applied',false,'reason','regulated_supply_dso_registry_unavailable');END IF;dso_actor:=ids[1];
   PERFORM ba.id FROM public.tenant_bilateral_agreements ba WHERE ba.company_id=m.company_id AND ba.environment=m.environment AND ba.counterparty_actor_id=dso_actor ORDER BY ba.id FOR SHARE;
   PERFORM g.id FROM gridex_received_sources.regulated_supply_ground_versions g WHERE g.company_id=m.company_id AND g.environment=m.environment AND g.legal_actor_id=legal_actor AND g.dso_actor_id=dso_actor AND g.grid_area_code=own->>'gridArea' ORDER BY g.id FOR SHARE;
   SELECT array_agg(g.id ORDER BY g.id) INTO ids FROM gridex_received_sources.regulated_supply_ground_versions g JOIN public.tenant_bilateral_agreements ba ON ba.id=g.bilateral_agreement_id AND ba.company_id=g.company_id AND ba.environment=g.environment AND ba.counterparty_actor_id=g.dso_actor_id
   WHERE g.company_id=m.company_id AND g.environment=m.environment AND g.legal_actor_id=legal_actor AND g.dso_actor_id=dso_actor AND g.grid_area_code=own->>'gridArea' AND g.process=CASE reason WHEN 'Z26' THEN 'assigned_supply' ELSE 'production_receipt_obligation' END
    AND gridex_regulated_supply.ground_wire_current_v1(g.id,m.company_id,point.id,event_at,own) IS TRUE
    AND g.approved_at<=m.message_received_at AND g.revoked_at IS NULL AND g.valid_from<=event_at AND (g.valid_to IS NULL OR event_at<g.valid_to) AND ba.is_enabled AND ba.valid_from<=event_at AND (ba.valid_to IS NULL OR event_at<ba.valid_to) AND ba.source_reference=g.source_reference;
   IF coalesce(cardinality(ids),0)<>1 THEN RETURN jsonb_build_object('applied',false,'reason','regulated_supply_authentic_ground_required');END IF;
   SELECT * INTO ground FROM gridex_received_sources.regulated_supply_ground_versions WHERE id=ids[1] FOR SHARE;
   IF reason='Z70' THEN
    SELECT cp.* INTO consumption FROM public.customer_supply_periods rel JOIN public.metering_points cp ON cp.id=rel.metering_point_id AND cp.company_id=rel.company_id JOIN public.customer_contracts cc ON cc.id=coalesce(rel.customer_contract_id,rel.contract_id) AND cc.company_id=rel.company_id AND cc.customer_id=rel.customer_id
    WHERE rel.id=ground.consumption_supply_period_id AND rel.company_id=m.company_id AND rel.customer_id=point.customer_id AND cp.ediel_metering_point_id=own->>'consumptionPoint' AND cp.product_direction='consumption' AND cc.energy_direction='consumption' AND cc.status IN ('signed','active') AND rel.status IN ('active','confirmed_by_grid_owner')
    AND rel.start_date<=gridex_received_sources.permission_date_v1(own->>'start') AND (rel.end_date IS NULL OR rel.end_date>gridex_received_sources.permission_date_v1(own->>'start')) FOR SHARE OF rel,cp,cc;
    IF NOT FOUND OR point.product_direction IS DISTINCT FROM 'production' THEN RETURN jsonb_build_object('applied',false,'reason','production_obligation_own_consumption_link_required');END IF;
   END IF;
   IF EXISTS(SELECT FROM public.customer_supply_periods p WHERE p.company_id=m.company_id AND p.metering_point_id=point.id AND p.status NOT IN ('cancelled','ended') AND (p.end_date IS NULL OR p.end_date>gridex_received_sources.permission_date_v1(own->>'start'))) THEN RETURN jsonb_build_object('applied',false,'reason','regulated_supply_conflicting_period');END IF;
   period_id:=gen_random_uuid();plans:=plans||jsonb_build_array(jsonb_build_object('kind','regulated','periodId',period_id,'pointId',point.id,'customerId',point.customer_id,'eventAt',event_at,'groundId',ground.id,'object',own));
  ELSIF wire->>'code'='Z04' AND reason='Z24' THEN
   -- Match every cancellation to its sealed, actually sent original Z03.
   SELECT array_agg(s.id ORDER BY s.id) INTO ids FROM public.supplier_switch_requests s JOIN public.ediel_messages z ON z.id=s.outbound_z03_message_id AND z.company_id=s.company_id AND z.environment=m.environment
    WHERE s.company_id=m.company_id AND z.direction='outbound' AND gridex_received_sources.sent_source_is_current_v1(z)
    AND EXISTS(SELECT FROM jsonb_array_elements(gridex_received_sources.normal_switch_wire_v1(z.raw_payload)->'objects') o WHERE o->>'point'=own->>'point' AND o->>'identityAgency'=own->>'identityAgency' AND o->>'li'=own->>'li' AND o->>'customerIdentity'=own->>'customerIdentity' AND o->>'start'=own->>'start' AND o->>'reason' IN ('Z22','Z23'))
    AND gridex_received_sources.normal_switch_wire_v1(z.raw_payload)->>'sender'=wire->>'receiver' AND gridex_received_sources.normal_switch_wire_v1(z.raw_payload)->>'receiver'=wire->>'sender';
   IF coalesce(cardinality(ids),0)<>1 THEN RETURN jsonb_build_object('applied',false,'reason','z04c_exact_original_unavailable');END IF;
   SELECT * INTO sw FROM public.supplier_switch_requests WHERE id=ids[1] AND company_id=m.company_id FOR UPDATE;
   IF coalesce(sw.outbound_z03_message_id=ANY(p_source_cohort),false) IS NOT TRUE THEN RETURN jsonb_build_object('applied',false,'reason','supply_original_cohort_changed');END IF;SELECT * INTO origin FROM public.ediel_messages WHERE id=sw.outbound_z03_message_id AND company_id=m.company_id AND environment=m.environment FOR SHARE;
   original:=coalesce(gridex_received_sources.supply_wire_for_period_receipt_v1(m.company_id,origin.id,sp.id),gridex_received_sources.normal_switch_wire_v1(origin.raw_payload));
   IF NOT FOUND OR origin.direction IS DISTINCT FROM 'outbound' OR gridex_received_sources.sent_source_is_current_v1(origin) IS NOT TRUE
    OR original IS NULL OR original->>'code' IS DISTINCT FROM 'Z03' OR original->>'sender' IS DISTINCT FROM wire->>'receiver' OR original->>'receiver' IS DISTINCT FROM wire->>'sender'
    OR origin.customer_id IS DISTINCT FROM sw.customer_id OR origin.metering_point_id IS DISTINCT FROM sw.metering_point_id OR (m.customer_id IS NOT NULL AND m.customer_id<>sw.customer_id) OR (m.metering_point_id IS NOT NULL AND m.metering_point_id<>sw.metering_point_id)
    OR NOT EXISTS(SELECT FROM jsonb_array_elements(original->'objects') o WHERE o->>'point'=own->>'point' AND o->>'identityAgency'=own->>'identityAgency' AND o->>'li'=own->>'li' AND o->>'customerIdentity'=own->>'customerIdentity' AND o->>'start'=own->>'start' AND o->>'reason' IN ('Z22','Z23'))
    THEN RETURN jsonb_build_object('applied',false,'reason','z04c_locked_original_mismatch');END IF;
   -- A start already cancelled by another own C is a held duplicate.
   IF sw.status='cancelled_before_start' THEN RETURN jsonb_build_object('applied',false,'reason','z04c_start_already_cancelled');END IF;
   -- An executed own start is corrected under review; it is never reversed here.
   IF sw.status='completed' THEN
    IF EXISTS(SELECT FROM gridex_received_sources.supply_object_effect_receipts e WHERE e.company_id=m.company_id AND e.environment=m.environment
     AND e.effect_text::jsonb#>>'{plan,kind}'='executed_start_compensation' AND e.effect_text::jsonb#>>'{plan,executedSwitchId}'=sw.id::text) THEN RETURN jsonb_build_object('applied',false,'reason','z04c_executed_start_compensation_already_recorded');END IF;
    SELECT array_agg(p.id ORDER BY p.id) INTO ids FROM public.customer_supply_periods p
     JOIN gridex_received_sources.normal_switch_confirmations c ON c.period_id=p.id AND c.company_id=p.company_id
     JOIN gridex_received_sources.normal_supply_activations a ON a.period_id=p.id AND a.company_id=p.company_id AND a.source_message_id=c.source_message_id
     WHERE p.company_id=m.company_id AND p.customer_id=sw.customer_id AND p.metering_point_id=sw.metering_point_id AND (p.status IN ('active','ending','ended')) IS TRUE
      AND c.switch_id=sw.id AND c.original_message_id=origin.id AND c.original_payload_hash=origin.immutable_payload_hash AND c.source_message_id=sw.inbound_z04_message_id
      AND p.start_date=gridex_received_sources.permission_date_v1(own->>'start') AND c.market_start_at<=now();
    IF coalesce(cardinality(ids),0)<>1 THEN RETURN jsonb_build_object('applied',false,'reason','z04c_effect_already_executed_compensation_required');END IF;
    SELECT * INTO sp FROM public.customer_supply_periods WHERE id=ids[1] AND company_id=m.company_id FOR SHARE;
    previous_switches:=previous_switches||jsonb_build_array(to_jsonb(sw));
    plans:=plans||jsonb_build_array(jsonb_build_object('kind','executed_start_compensation','switchId',NULL,'periodId',NULL,'disposition','controlled_review',
     'executedSwitchId',sw.id,'executedPeriodId',sp.id,'executedPeriod',to_jsonb(sp),'originalId',origin.id,'originalHash',origin.immutable_payload_hash,
     'confirmationSourceMessageId',sw.inbound_z04_message_id,'siteId',coalesce(sw.site_id,sw.customer_site_id),'caseId',gen_random_uuid(),'object',own));
    CONTINUE;
   END IF;
   IF (sw.status IN ('draft','prepared','queued','sent','submitted','waiting','waiting_for_z04','accepted','cancellation_requested','cancelled_before_start')) IS NOT TRUE THEN RETURN jsonb_build_object('applied',false,'reason','z04c_effect_already_executed_compensation_required');END IF;
   SELECT array_agg(p.id ORDER BY p.id) INTO ids FROM public.customer_supply_periods p WHERE p.company_id=m.company_id AND p.customer_id=sw.customer_id AND p.metering_point_id=sw.metering_point_id AND (p.source_switch_request_id=sw.id OR p.source_message_id=sw.inbound_z04_message_id);
   IF coalesce(cardinality(ids),0)>1 THEN RETURN jsonb_build_object('applied',false,'reason','z04c_conflicting_periods');END IF;
   IF coalesce(cardinality(ids),0)=1 THEN
    SELECT * INTO sp FROM public.customer_supply_periods WHERE id=ids[1] AND company_id=m.company_id FOR UPDATE;
    IF sp.status IS DISTINCT FROM 'confirmed_by_grid_owner' OR sp.customer_id IS DISTINCT FROM sw.customer_id OR sp.metering_point_id IS DISTINCT FROM sw.metering_point_id OR sp.start_date IS DISTINCT FROM gridex_received_sources.permission_date_v1(own->>'start') OR coalesce(sp.market_start_at,sp.start_date::timestamp AT TIME ZONE 'Etc/GMT-1')<=now() THEN RETURN jsonb_build_object('applied',false,'reason','z04c_effect_already_executed_compensation_required');END IF;
    before_states:=before_states||jsonb_build_array(to_jsonb(sp));period_id:=sp.id;
   ELSE period_id:=NULL;END IF;
   previous_switches:=previous_switches||jsonb_build_array(to_jsonb(sw));plans:=plans||jsonb_build_array(jsonb_build_object('kind','cancel_start','periodId',period_id,'switchId',sw.id,'object',own));
  ELSIF wire->>'code'='Z05' AND reason='Z24' THEN
   SELECT array_agg(p.id ORDER BY p.id) INTO ids FROM public.customer_supply_periods p JOIN gridex_received_sources.supply_source_transitions tr ON tr.source_message_id=p.source_end_message_id AND tr.company_id=p.company_id
    JOIN public.ediel_messages z ON z.id=tr.source_message_id AND z.company_id=tr.company_id AND z.environment=m.environment
    WHERE p.company_id=m.company_id AND z.direction='inbound' AND tr.payload_hash=encode(sha256(convert_to(z.raw_payload,'UTF8')),'hex') AND coalesce(gridex_received_sources.supply_wire_for_period_receipt_v1(p.company_id,z.id,p.id),gridex_received_sources.normal_switch_wire_v1(z.raw_payload))->>'sender'=wire->>'sender' AND coalesce(gridex_received_sources.supply_wire_for_period_receipt_v1(p.company_id,z.id,p.id),gridex_received_sources.normal_switch_wire_v1(z.raw_payload))->>'receiver'=wire->>'receiver' AND EXISTS(SELECT FROM jsonb_array_elements(coalesce(gridex_received_sources.supply_wire_for_period_receipt_v1(p.company_id,z.id,p.id),gridex_received_sources.normal_switch_wire_v1(z.raw_payload))->'objects') original_scope WHERE original_scope->>'point'=own->>'point' AND original_scope->>'identityAgency'=own->>'identityAgency')
    AND EXISTS(SELECT FROM jsonb_array_elements(tr.source_objects) o WHERE o->>'point'=own->>'point' AND o->>'li'=own->>'li' AND o->>'end'=own->>'end')
    AND EXISTS(SELECT FROM jsonb_array_elements(tr.resulting_states) state WHERE state->>'id'=p.id::text AND (state->>'market_state_version')::bigint=p.market_state_version AND (state-ARRAY['updated_at','status'])=(to_jsonb(p)-ARRAY['updated_at','status']));
   IF coalesce(cardinality(ids),0)<>1 THEN RETURN jsonb_build_object('applied',false,'reason','z05c_exact_original_ending_unavailable');END IF;
   SELECT * INTO sp FROM public.customer_supply_periods WHERE id=ids[1] AND company_id=m.company_id FOR UPDATE;
   IF coalesce(sp.source_end_message_id=ANY(p_source_cohort),false) IS NOT TRUE THEN RETURN jsonb_build_object('applied',false,'reason','supply_original_cohort_changed');END IF;SELECT * INTO prior FROM gridex_received_sources.supply_source_transitions WHERE source_message_id=sp.source_end_message_id AND company_id=m.company_id;
   SELECT state INTO old FROM jsonb_array_elements(prior.previous_states) state WHERE state->>'id'=sp.id::text;
   IF old IS NULL OR NOT EXISTS(SELECT FROM jsonb_array_elements(prior.resulting_states) saved WHERE saved->>'id'=sp.id::text AND (sp.status=saved->>'status' OR sp.status='ended' AND saved->>'status'='ending' AND sp.market_end_at<=now())) OR EXISTS(SELECT FROM public.customer_supply_periods p WHERE p.company_id=m.company_id AND p.metering_point_id=sp.metering_point_id AND p.id<>sp.id AND p.status NOT IN ('ended','cancelled') AND (p.end_date IS NULL OR p.end_date>sp.start_date)) THEN RETURN jsonb_build_object('applied',false,'reason','z05c_conflicting_continuation');END IF;
   before_states:=before_states||jsonb_build_array(to_jsonb(sp));plans:=plans||jsonb_build_array(jsonb_build_object('kind','restore_end','periodId',sp.id,'previous',old,'object',own));
  ELSIF wire->>'code'='Z05' AND reason IN ('Z22','Z23') THEN
   -- Actual accepted baseline owner ties the physical object to a relationship;
   -- a unique local row or DATE similarity is never sufficient authority.
   SELECT array_agg(p.id ORDER BY p.id) INTO ids FROM public.customer_supply_periods p
    WHERE p.company_id=m.company_id AND p.status IN ('active','confirmed_by_grid_owner','ending') AND p.source_end_message_id IS NULL AND (
     EXISTS(SELECT FROM gridex_received_sources.object_assessments assessment JOIN gridex_received_sources.sources src ON src.source_message_id=assessment.source_message_id AND src.company_id=assessment.company_id AND src.payload_hash=assessment.source_payload_hash
      JOIN public.ediel_messages base ON base.id=src.source_message_id AND base.company_id=src.company_id AND base.environment=src.environment AND base.direction='inbound' AND src.payload_hash=encode(sha256(convert_to(base.raw_payload,'UTF8')),'hex')
      CROSS JOIN LATERAL jsonb_array_elements(assessment.facts_text::jsonb->'objects') object
      WHERE assessment.company_id=p.company_id AND assessment.environment=m.environment AND assessment.source_message_id=p.source_message_id
       AND object->>'disposition'='accepted' AND object#>>'{object,objectId}'=own->>'point' AND object#>>'{object,identityAgency}'='9'
       AND object#>>'{business,supplyPeriodId}'=p.id::text AND object#>>'{business,customerId}'=p.customer_id::text AND object#>>'{business,meteringPointId}'=p.metering_point_id::text
       AND object#>>'{business,owner}' IN ('inbound-z04-switch-confirmation-v1','reviewed-received-structure-v1')
       AND object#>>'{party,parties,legalSender}'=wire->>'sender' AND object#>>'{party,parties,legalReceiver}'=wire->>'receiver'
       AND NOT EXISTS(SELECT FROM gridex_received_sources.object_assessments child WHERE child.previous_assessment_id=assessment.id))
     OR EXISTS(SELECT FROM gridex_received_sources.supply_source_transitions tr JOIN public.ediel_messages base ON base.id=tr.source_message_id AND base.company_id=tr.company_id AND base.environment=m.environment AND base.direction='inbound'
      WHERE tr.company_id=p.company_id AND tr.source_message_id=p.source_message_id AND tr.source_code='Z04' AND tr.payload_hash=encode(sha256(convert_to(base.raw_payload,'UTF8')),'hex')
       AND EXISTS(SELECT FROM jsonb_array_elements(tr.resulting_states) state WHERE state->>'id'=p.id::text AND state->>'customer_id'=p.customer_id::text AND state->>'metering_point_id'=p.metering_point_id::text AND(state#>>'{metadata,sourceObject,point}'=own->>'point' OR state#>>'{metadata,normalSourceBasis,object,point}'=own->>'point'))
       AND EXISTS(SELECT FROM jsonb_array_elements(tr.source_objects) object WHERE object->>'point'=own->>'point' AND object->>'customerIdentity'=own->>'customerIdentity' AND object->>'gridArea'=own->>'gridArea' AND (object->>'reason' IN ('Z26','Z70') OR object->>'reason' IN ('Z22','Z23') AND EXISTS(SELECT FROM gridex_received_sources.supply_object_effect_receipts own_effect WHERE own_effect.company_id=p.company_id AND own_effect.source_message_id=tr.source_message_id AND own_effect.object_scope->>'objectId'=own->>'point' AND own_effect.object_scope->>'identityAgency'=own->>'identityAgency' AND gridex_received_sources.supply_effect_assessment_owns_period_v1(p.company_id,tr.source_message_id,p.id,own_effect.canonical_assessment_id)))))
    );
   IF coalesce(cardinality(ids),0)<>1 THEN RETURN jsonb_build_object('applied',false,'reason','z05_accepted_relationship_baseline_required');END IF;
   SELECT * INTO sp FROM public.customer_supply_periods WHERE id=ids[1] AND company_id=m.company_id FOR UPDATE;
   IF coalesce(sp.source_message_id=ANY(p_source_cohort),false) IS NOT TRUE THEN RETURN jsonb_build_object('applied',false,'reason','supply_original_cohort_changed');END IF;SELECT * INTO origin FROM public.ediel_messages WHERE id=sp.source_message_id AND company_id=m.company_id AND environment=m.environment FOR SHARE;
   original:=coalesce(gridex_received_sources.supply_wire_for_period_receipt_v1(m.company_id,origin.id,sp.id),gridex_received_sources.normal_switch_wire_v1(origin.raw_payload));
   IF original IS NULL OR original->>'code' IS DISTINCT FROM 'Z04' OR original->>'sender' IS DISTINCT FROM wire->>'sender' OR original->>'receiver' IS DISTINCT FROM wire->>'receiver'
    OR NOT EXISTS(SELECT FROM jsonb_array_elements(original->'objects') o WHERE o->>'point'=own->>'point' AND o->>'identityAgency'=own->>'identityAgency' AND o->>'customerIdentity'=own->>'customerIdentity' AND o->>'gridArea'=own->>'gridArea' AND gridex_received_sources.permission_time_v1(o->>'start')<event_at)
    OR (m.customer_id IS NOT NULL AND m.customer_id<>sp.customer_id) OR (m.metering_point_id IS NOT NULL AND m.metering_point_id<>sp.metering_point_id) THEN RETURN jsonb_build_object('applied',false,'reason','z05_original_object_mismatch');END IF;
   before_states:=before_states||jsonb_build_array(to_jsonb(sp));plans:=plans||jsonb_build_array(jsonb_build_object('kind','end','periodId',sp.id,'eventAt',event_at,'object',own));
  ELSE RETURN jsonb_build_object('applied',false,'reason','supply_profile_not_qualified');END IF;
 END LOOP;
 -- All owned objects, current originals and ground records are locked/qualified.
 FOR plan IN SELECT x FROM jsonb_array_elements(plans) x LOOP
  IF plan->>'kind'='regulated' THEN
   INSERT INTO public.customer_supply_periods(id,company_id,customer_id,metering_point_id,start_date,market_start_at,source,source_process,source_message_id,status,market_state_version,metadata)
    VALUES((plan->>'periodId')::uuid,m.company_id,(plan->>'customerId')::uuid,(plan->>'pointId')::uuid,gridex_received_sources.permission_date_v1(plan#>>'{object,start}'),(plan->>'eventAt')::timestamptz,'ediel_qualified_source',CASE reason WHEN 'Z26' THEN 'assigned_supply' ELSE 'production_receipt_obligation' END,m.id,'confirmed_by_grid_owner',1,jsonb_build_object('sourceGroundId',plan->>'groundId','sourceObject',plan->'object','sourceReceivedAt',m.message_received_at));
  ELSIF plan->>'kind'='cancel_start' THEN
   UPDATE public.supplier_switch_requests SET status='cancelled_before_start',inbound_z04_message_id=m.id,completed_at=now(),updated_at=now() WHERE id=(plan->>'switchId')::uuid AND company_id=m.company_id;
   UPDATE public.customer_supply_periods SET status='cancelled',market_state_version=market_state_version+1,updated_at=now(),metadata=coalesce(metadata,'{}')||jsonb_build_object('startCancellationSource',m.id) WHERE id=(plan->>'periodId')::uuid AND company_id=m.company_id;
  ELSIF plan->>'kind'='executed_start_compensation' THEN
   INSERT INTO public.customer_cases(id,company_id,customer_id,site_id,metering_point_id,customer_contract_id,supplier_switch_request_id,case_type,status,priority,title,description,reason_category,next_action,source,metadata,created_by,updated_by,source_ediel_message_id,source_business_process)
    VALUES((plan->>'caseId')::uuid,m.company_id,(plan#>>'{executedPeriod,customer_id}')::uuid,(plan->>'siteId')::uuid,(plan#>>'{executedPeriod,metering_point_id}')::uuid,
     coalesce(plan#>>'{executedPeriod,customer_contract_id}',plan#>>'{executedPeriod,contract_id}')::uuid,(plan->>'executedSwitchId')::uuid,'other','manual_follow_up','high',
     'Annullering efter genomförd leveransstart – korrigera',
     'Nätägaren har annullerat en leveransstart som redan genomförts. Annulleringen är besvarad. Korrigera starten med bibehållen historik och kompensera vid behov.',
     'executed_start_cancellation','Utred och genomför korrigering av den genomförda starten.','ediel_inbound_state_machine',
     jsonb_build_object('review_intent','executed_start_compensation','source_ediel_message_id',m.id,'executed_switch_id',plan->'executedSwitchId','executed_period_id',plan->'executedPeriodId',
      'original_message_id',plan->'originalId','original_payload_hash',plan->'originalHash','confirmation_source_message_id',plan->'confirmationSourceMessageId','object',plan->'object'),
     p_actor_user_id,p_actor_user_id,m.id,'supplier_switch');
  ELSIF plan->>'kind'='end' THEN
   UPDATE public.customer_supply_periods SET end_date=gridex_received_sources.permission_date_v1(plan#>>'{object,end}'),market_end_at=(plan->>'eventAt')::timestamptz,source_end_message_id=m.id,status=CASE WHEN (plan->>'eventAt')::timestamptz<=now() THEN 'ended' ELSE 'ending' END,market_state_version=market_state_version+1,updated_at=now() WHERE id=(plan->>'periodId')::uuid AND company_id=m.company_id;
  ELSIF plan->>'kind'='restore_end' THEN
   UPDATE public.customer_supply_periods SET status=plan#>>'{previous,status}',end_date=(plan#>>'{previous,end_date}')::date,market_end_at=(plan#>>'{previous,market_end_at}')::timestamptz,source_end_message_id=(plan#>>'{previous,source_end_message_id}')::uuid,market_state_version=market_state_version+1,updated_at=now(),metadata=coalesce(metadata,'{}')||jsonb_build_object('endCancellationSource',m.id) WHERE id=(plan->>'periodId')::uuid AND company_id=m.company_id;
  END IF;
 END LOOP;
 SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]'::jsonb) INTO after_states FROM public.customer_supply_periods p WHERE p.company_id=m.company_id AND p.id IN (SELECT (chosen_plan->>'periodId')::uuid FROM jsonb_array_elements(plans) chosen_plan);

 RETURN jsonb_build_object('applied',true,'periods',after_states,'plans',plans,'previousStates',before_states,'previousSwitches',previous_switches,'regulated',wire->>'code'='Z04' AND reason IN ('Z26','Z70'));
END $$;$sql19_definition_0$;
  EXECUTE $sql19_definition_1$CREATE FUNCTION gridex_received_sources.require_supply_scope_admission_v1(c uuid, source_id uuid, scope jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE m public.ediel_messages%rowtype;a gridex_received_sources.validation_assessments%rowtype;application jsonb;
BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE company_id=c AND id=source_id FOR UPDATE;
 application:=gridex_received_sources.require_prodat_application_objects_v1(c,source_id);
 SELECT * INTO a FROM gridex_received_sources.validation_assessments WHERE company_id=c AND source_message_id=source_id AND id=(application->>'assessmentId')::uuid FOR SHARE;
 IF m.id IS NULL OR a.id IS NULL OR a.source_payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') OR a.environment IS DISTINCT FROM m.environment
  OR a.facts_text::jsonb->>'syntaxDecision' IS DISTINCT FROM 'accepted' OR a.facts_text::jsonb->>'functionalDecision' IS DISTINCT FROM 'accepted'
  OR gridex_received_sources.prodat_application_object_accepted_v1(c,source_id,a.id,scope) IS NOT TRUE THEN RAISE EXCEPTION 'supply_own_canonical_application_and_function_required';END IF;
 RETURN a.id;
END$$;$sql19_definition_1$;
  EXECUTE $sql19_definition_2$CREATE FUNCTION gridex_regulated_supply.ground_wire_current_v1(ground uuid, company uuid, point uuid, effective timestamp with time zone, own jsonb) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    SET "TimeZone" TO 'UTC'
    AS $$
DECLARE a gridex_regulated_supply.artifacts%rowtype;BEGIN
 IF gridex_regulated_supply.ground_current_v1(ground,company,point,effective) IS NOT TRUE THEN RETURN false;END IF;
 SELECT archive.* INTO a FROM gridex_regulated_supply.origins o JOIN gridex_regulated_supply.artifacts archive ON archive.id=o.artifact_id AND archive.company_id=o.company_id WHERE o.ground_id=ground AND o.company_id=company;
 RETURN (a.scope->>'point'=own->>'point' AND a.scope->>'identityAgency'=own->>'identityAgency' AND a.scope->>'customerIdentity'=own->>'customerIdentity' AND a.scope->>'gridArea'=own->>'gridArea'
 AND a.scope->>'kind'=CASE own->>'reason' WHEN 'Z26' THEN 'assigned_supply' WHEN 'Z70' THEN 'production_receipt_obligation' END
 AND (a.scope->>'kind'<>'production_receipt_obligation' OR a.scope->>'consumptionPoint'=own->>'consumptionPoint')) IS TRUE;
END$$;$sql19_definition_2$;
  REVOKE ALL ON FUNCTION gridex_received_sources.other_supply_scope_effect_v1(uuid,uuid,uuid,jsonb,uuid[],uuid),gridex_received_sources.require_supply_scope_admission_v1(uuid,uuid,jsonb),gridex_regulated_supply.ground_wire_current_v1(uuid,uuid,uuid,timestamp with time zone,jsonb) FROM PUBLIC,anon,authenticated,service_role;
 END IF;
 -- SQL19_POST_CREATE_PROFILE_CHECK
 FOR x IN SELECT value FROM jsonb_array_elements(targets) LOOP
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace s ON s.oid=p.pronamespace WHERE s.nspname||'.'||p.proname=x->>'name';
  IF n<>1 THEN RAISE EXCEPTION 'sql19_exact_single_function_interface_required:%',x->>'name' USING ERRCODE='42501';END IF;
  SELECT p.*,l.lanname INTO f FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=to_regprocedure(x->>'signature');
  IF NOT FOUND OR f.proowner<>'postgres'::regrole OR f.prokind<>'f' OR f.lanname<>x->>'language'
   OR f.pronargs<>(x->>'argumentCount')::integer OR to_jsonb(f.proargnames) IS DISTINCT FROM x->'argumentNames'
   OR f.proargmodes IS NOT NULL OR f.proallargtypes IS NOT NULL OR f.pronargdefaults<>0 OR f.proargdefaults IS NOT NULL
   OR f.prorettype IS DISTINCT FROM to_regtype(x->>'returnType')::oid
   OR f.prosecdef IS DISTINCT FROM (x->>'securityDefiner')::boolean OR f.provolatile::text<>x->>'volatility' OR f.proparallel<>'u'
   OR f.proisstrict OR f.proleakproof OR f.proretset OR f.procost<>100 OR f.prorows<>0 OR f.provariadic::oid<>0 OR f.prosupport::oid<>0
   OR f.protrftypes IS NOT NULL OR f.probin IS NOT NULL OR f.prosqlbody IS NOT NULL OR to_jsonb(f.proconfig) IS DISTINCT FROM x->'config'
   OR encode(sha256(convert_to(f.prosrc,'UTF8')),'hex') IS DISTINCT FROM x->>'sha256'
   OR has_function_privilege('postgres',f.oid,'EXECUTE') IS NOT TRUE
  THEN RAISE EXCEPTION 'sql19_exact_function_profile_required:%',x->>'name' USING ERRCODE='42501';END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('grantor',a.grantor::regrole::text,'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END,'privilege',a.privilege_type,'grantable',a.is_grantable)
   ORDER BY CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END,a.grantor::regrole::text,a.privilege_type,a.is_grantable),'[]') INTO current_acl
   FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a;
  IF current_acl IS DISTINCT FROM x->'acl' THEN RAISE EXCEPTION 'sql19_exact_function_acl_required:%',x->>'name' USING ERRCODE='42501';END IF;
 END LOOP;
 IF EXISTS(SELECT FROM jsonb_array_elements(targets) target_specs(spec) WHERE has_function_privilege('anon',to_regprocedure(spec->>'signature'),'EXECUTE') OR has_function_privilege('authenticated',to_regprocedure(spec->>'signature'),'EXECUTE') OR has_function_privilege('service_role',to_regprocedure(spec->>'signature'),'EXECUTE')) THEN RAISE EXCEPTION 'sql19_private_owner_only_execution_required' USING ERRCODE='42501';END IF;
 SELECT (SELECT jsonb_agg(jsonb_build_object('proc',to_jsonb(p),'comment',obj_description(p.oid,'pg_proc')) ORDER BY p.oid) FROM pg_proc p JOIN pg_namespace s ON s.oid=p.pronamespace WHERE s.nspname||'.'||p.proname=ANY(dependency_names)) INTO after_value;
 IF after_value IS DISTINCT FROM before_dependencies THEN RAISE EXCEPTION 'sql19_existing_catalog_preservation_required:before_dependencies';END IF;
 SELECT (SELECT jsonb_agg(jsonb_build_object('class',to_jsonb(c),'attributes',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0),'defaults',(SELECT jsonb_agg(to_jsonb(d) ORDER BY d.oid) FROM pg_attrdef d WHERE d.adrelid=c.oid)) ORDER BY c.oid) FROM pg_class c WHERE c.oid IN(SELECT to_regclass(v) FROM unnest(relation_names)v)) INTO after_value;
 IF after_value IS DISTINCT FROM before_relations THEN RAISE EXCEPTION 'sql19_existing_catalog_preservation_required:before_relations';END IF;
 SELECT (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.oid) FROM pg_trigger t WHERE t.tgrelid IN('public.customer_cases'::regclass,'public.customer_supply_periods'::regclass,'public.supplier_switch_requests'::regclass)) INTO after_value;
 IF after_value IS DISTINCT FROM before_triggers THEN RAISE EXCEPTION 'sql19_existing_catalog_preservation_required:before_triggers';END IF;
 SELECT (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.oid) FROM pg_constraint c WHERE c.conrelid IN('public.customer_cases'::regclass,'public.customer_supply_periods'::regclass,'public.supplier_switch_requests'::regclass)) INTO after_value;
 IF after_value IS DISTINCT FROM before_constraints THEN RAISE EXCEPTION 'sql19_existing_catalog_preservation_required:before_constraints';END IF;
 SELECT (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.oid) FROM pg_namespace s) INTO after_value;
 IF after_value IS DISTINCT FROM before_namespaces THEN RAISE EXCEPTION 'sql19_existing_catalog_preservation_required:before_namespaces';END IF;
 SELECT (SELECT jsonb_agg(to_jsonb(r)-'rolpassword' ORDER BY r.oid) FROM pg_roles r) INTO after_value;
 IF after_value IS DISTINCT FROM before_roles THEN RAISE EXCEPTION 'sql19_existing_catalog_preservation_required:before_roles';END IF;
 SELECT (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.oid) FROM pg_auth_members m) INTO after_value;
 IF after_value IS DISTINCT FROM before_memberships THEN RAISE EXCEPTION 'sql19_existing_catalog_preservation_required:before_memberships';END IF;
 SELECT (SELECT jsonb_agg(to_jsonb(d) ORDER BY d.oid) FROM pg_default_acl d) INTO after_value;
 IF after_value IS DISTINCT FROM before_defaults THEN RAISE EXCEPTION 'sql19_existing_catalog_preservation_required:before_defaults';END IF;
 IF missing=0 THEN
 SELECT (SELECT jsonb_agg(jsonb_build_object('proc',to_jsonb(p),'comment',obj_description(p.oid,'pg_proc')) ORDER BY p.oid) FROM pg_proc p JOIN pg_namespace s ON s.oid=p.pronamespace WHERE s.nspname||'.'||p.proname=ANY(names)) INTO after_value;
 IF after_value IS DISTINCT FROM before_targets THEN RAISE EXCEPTION 'sql19_exact_noop_target_preservation_required';END IF;
 END IF;
 RAISE NOTICE 'SQL19 private source cluster installed=%; current caller/native/business/legal acceptance remains separately qualified',missing=3;
END
$sql19_private_supply_cluster$;
COMMIT;
