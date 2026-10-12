-- Read-only release preflight: actual native existence and ACLs, not test results.
-- Run against the explicitly selected OPS project only. No business RPC is invoked.
-- Presence alone does not prove the effective body matches current source.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '20s';
WITH required(name) AS (VALUES
    ('ediel_archive_ai_purpose_source_v1'),
    ('ediel_archive_bilateral_customer_source_v1'),
    ('ediel_archive_bilateral_prodat_ground_v1'),
    ('ediel_archive_network_registry_source_v1'),
    ('ediel_archive_regulated_supply_ground_v1'),
    ('ediel_archive_requested_change_source_v1'),
    ('ediel_archive_requested_customer_change_v1'),
    ('ediel_archive_signed_brp_declaration_v1'),
    ('ediel_archive_supply_rescission_v1'),
    ('ediel_beneficiary_series_page_v1'),
    ('ediel_bilateral_prodat_ground_scope_v1'),
    ('ediel_brp_change_source_v1'),
    ('ediel_brp_responsibility_history_v1'),
    ('ediel_claim_beneficiary_exports_v1'),
    ('ediel_current_retention_session_v1'),
    ('ediel_customer_record_tombstones_v1'),
    ('ediel_production_contract_source_v1'),
    ('ediel_queue_beneficiary_export_v1'),
    ('ediel_read_ai_purpose_source_v1'),
    ('ediel_read_beneficiary_export_v1'),
    ('ediel_read_bilateral_customer_source_v1'),
    ('ediel_read_bilateral_prodat_ground_v1'),
    ('ediel_read_dsn_source_observations_v1'),
    ('ediel_read_fresh_business_incident_v1'),
    ('ediel_read_network_registry_source_v1'),
    ('ediel_read_regulated_supply_ground_v1'),
    ('ediel_read_requested_change_artifact_v1'),
    ('ediel_read_requested_customer_change_v1'),
    ('ediel_read_signed_brp_declaration_v1'),
    ('ediel_read_supply_rescission_artifact_v1'),
    ('ediel_regulated_supply_ground_scope_v1'),
    ('ediel_report_fresh_business_incident_v1'),
    ('ediel_requested_customer_change_queue_basis_v1'),
    ('ediel_require_contract_records_available_v1'),
    ('ediel_require_customer_record_available_v1'),
    ('ediel_require_invoice_file_copy_available_v1'),
    ('ediel_require_portal_retention_access_v1'),
    ('ediel_require_source_bytes_available_v1'),
    ('ediel_review_ai_purpose_source_v1'),
    ('ediel_review_bilateral_customer_source_v1'),
    ('ediel_review_bilateral_prodat_ground_v1'),
    ('ediel_review_network_registry_source_v1'),
    ('ediel_review_regulated_supply_ground_v1'),
    ('ediel_review_requested_change_artifact_v1'),
    ('ediel_review_requested_customer_change_v1'),
    ('ediel_review_signed_brp_declaration_v1'),
    ('ediel_review_supply_rescission_v1'),
    ('ediel_revoke_network_registry_source_v1'),
    ('ediel_revoke_signed_brp_declaration_v1'),
    ('ediel_service_administration_read_v1'),
    ('ediel_signed_brp_declaration_scope_v1'),
    ('ediel_supply_rescission_scope_v1')
)
SELECT required.name,
       p.oid IS NULL AS missing,
       pg_get_function_identity_arguments(p.oid) AS identity_arguments,
       p.prosecdef AS security_definer,
       CASE WHEN p.oid IS NOT NULL THEN has_function_privilege('service_role', p.oid, 'EXECUTE') END AS service_execute,
       CASE WHEN p.oid IS NOT NULL THEN has_function_privilege('anon', p.oid, 'EXECUTE') END AS anon_execute,
       CASE WHEN p.oid IS NOT NULL THEN has_function_privilege('authenticated', p.oid, 'EXECUTE') END AS authenticated_execute,
       CASE WHEN p.oid IS NOT NULL THEN md5(pg_get_functiondef(p.oid)) END AS effective_definition_md5
FROM required
LEFT JOIN pg_namespace n ON n.nspname = 'public'
LEFT JOIN pg_proc p ON p.pronamespace = n.oid AND p.proname = required.name
ORDER BY required.name, identity_arguments;
COMMIT;
