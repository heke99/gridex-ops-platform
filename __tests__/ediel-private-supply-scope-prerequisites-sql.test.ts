// masterplan: DB-05
// SQL19 actual installer/three private helpers in PGlite. Immutable fd4 source
// bodies and typed column ports are inline, never read from mutable GEN/schema.
// Existing callee fixtures use check_function_bodies=off ONLY during bootstrap:
// their full transitive authority/relations are not reproduced or executed here.
// Installer runs with checking restored. Semantic output ports are replaced
// only AFTER installer catalog assertions. No native/provider/legal acceptance.
import {afterEach,describe,expect,it} from 'vitest'
import {PGlite} from '@electric-sql/pglite'
import {existsSync,readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'

const migration=new URL('../supabase/migrations/20261020215757_ediel_private_supply_scope_prerequisites.sql',import.meta.url)
const digest=(v:string)=>createHash('sha256').update(v).digest('hex')
const quote=(v:string)=>'"'+v.replaceAll('"','""')+'"'
const qualify=(v:string)=>v.split('.').map(quote).join('.')
const tables:Record<string,readonly (readonly [string,string])[]>={
 "gridex_received_sources.normal_supply_activations": [
  ["period_id", "uuid"],
  ["company_id", "uuid"],
  ["source_message_id", "uuid"],
  ["actor_user_id", "uuid"],
  ["previous_period", "jsonb"],
  ["resulting_period", "jsonb"],
  ["result", "jsonb"],
  ["activated_at", "timestamp with time zone"]
 ],
 "gridex_received_sources.normal_switch_confirmations": [
  ["source_message_id", "uuid"],
  ["period_id", "uuid"],
  ["company_id", "uuid"],
  ["switch_id", "uuid"],
  ["original_message_id", "uuid"],
  ["original_payload_hash", "text"],
  ["contract_id", "uuid"],
  ["protected_contract_hash", "text"],
  ["source_object", "jsonb"],
  ["legal_context", "jsonb"],
  ["market_start_at", "timestamp with time zone"],
  ["confirmed_period", "jsonb"],
  ["confirmed_switch", "jsonb"],
  ["created_at", "timestamp with time zone"]
 ],
 "gridex_received_sources.object_assessments": [
  ["id", "uuid"],
  ["source_message_id", "uuid"],
  ["company_id", "uuid"],
  ["environment", "text"],
  ["source_payload_hash", "text"],
  ["canonical_assessment_id", "uuid"],
  ["previous_assessment_id", "uuid"],
  ["facts_text", "text"],
  ["facts_hash", "text"],
  ["owner_readsets", "jsonb"],
  ["created_xid", "xid8"],
  ["assessed_at", "timestamp with time zone"]
 ],
 "gridex_received_sources.regulated_supply_ground_versions": [
  ["id", "uuid"],
  ["company_id", "uuid"],
  ["environment", "text"],
  ["legal_actor_id", "uuid"],
  ["dso_actor_id", "uuid"],
  ["grid_area_code", "text"],
  ["process", "text"],
  ["bilateral_agreement_id", "uuid"],
  ["consumption_supply_period_id", "uuid"],
  ["source_reference", "text"],
  ["source_sha256", "text"],
  ["legal_decision_reference", "text"],
  ["registry_version", "text"],
  ["approved_by", "uuid"],
  ["approved_at", "timestamp with time zone"],
  ["valid_from", "timestamp with time zone"],
  ["valid_to", "timestamp with time zone"],
  ["revoked_at", "timestamp with time zone"]
 ],
 "gridex_received_sources.sources": [
  ["source_message_id", "uuid"],
  ["company_id", "uuid"],
  ["environment", "text"],
  ["origin", "text"],
  ["message_code", "text"],
  ["source_received_at", "timestamp with time zone"],
  ["captured_at", "timestamp with time zone"],
  ["raw_payload", "text"],
  ["payload_hash", "text"],
  ["received_context", "jsonb"],
  ["scope_point", "text"],
  ["retention_byte_length", "bigint"],
  ["retention_purged_at", "timestamp with time zone"]
 ],
 "gridex_received_sources.supply_object_effect_receipts": [
  ["id", "uuid"],
  ["source_message_id", "uuid"],
  ["company_id", "uuid"],
  ["environment", "text"],
  ["payload_hash", "text"],
  ["canonical_assessment_id", "uuid"],
  ["first_line_index", "integer"],
  ["object_scope", "jsonb"],
  ["effect_text", "text"],
  ["effect_hash", "text"],
  ["applied_at", "timestamp with time zone"]
 ],
 "gridex_received_sources.supply_source_transitions": [
  ["source_message_id", "uuid"],
  ["company_id", "uuid"],
  ["payload_hash", "text"],
  ["source_code", "text"],
  ["source_objects", "jsonb"],
  ["previous_states", "jsonb"],
  ["resulting_states", "jsonb"],
  ["qualified_switch_ids", "uuid[]"],
  ["actor_user_id", "uuid"],
  ["applied_at", "timestamp with time zone"]
 ],
 "gridex_received_sources.validation_assessments": [
  ["id", "uuid"],
  ["source_message_id", "uuid"],
  ["company_id", "uuid"],
  ["environment", "text"],
  ["source_payload_hash", "text"],
  ["previous_assessment_id", "uuid"],
  ["owner", "text"],
  ["facts_text", "text"],
  ["facts_hash", "text"],
  ["assessed_at", "timestamp with time zone"]
 ],
 "public.company_memberships": [
  ["id", "uuid"],
  ["company_id", "uuid"],
  ["user_id", "uuid"],
  ["role", "text"],
  ["role_id", "uuid"],
  ["status", "text"],
  ["is_active", "boolean"],
  ["invited_email", "text"],
  ["invited_by", "uuid"],
  ["joined_at", "timestamp with time zone"],
  ["created_at", "timestamp with time zone"],
  ["updated_at", "timestamp with time zone"],
  ["created_by", "uuid"],
  ["updated_by", "uuid"],
  ["membership_role", "text"],
  ["role_key", "text"],
  ["invited_at", "timestamp with time zone"],
  ["accepted_at", "timestamp with time zone"],
  ["disabled_at", "timestamp with time zone"],
  ["disabled_by", "uuid"],
  ["removed_at", "timestamp with time zone"],
  ["removed_by", "uuid"],
  ["status_reason", "text"],
  ["metadata", "jsonb"],
  ["suspended_at", "timestamp with time zone"]
 ],
 "public.customer_cases": [
  ["id", "uuid"],
  ["company_id", "uuid"],
  ["customer_id", "uuid"],
  ["site_id", "uuid"],
  ["metering_point_id", "uuid"],
  ["customer_contract_id", "uuid"],
  ["supplier_switch_request_id", "uuid"],
  ["outbound_request_id", "uuid"],
  ["cancellation_ediel_message_id", "uuid"],
  ["case_type", "text"],
  ["status", "text"],
  ["priority", "text"],
  ["title", "text"],
  ["description", "text"],
  ["reason_category", "text"],
  ["agreement_channel", "text"],
  ["is_distance_agreement", "boolean"],
  ["agreement_created_at", "timestamp with time zone"],
  ["withdrawal_information_sent_at", "timestamp with time zone"],
  ["withdrawal_deadline_at", "timestamp with time zone"],
  ["withdrawal_requested_at", "timestamp with time zone"],
  ["withdrawal_possible", "boolean"],
  ["switch_can_be_stopped", "boolean"],
  ["delivery_start_at", "timestamp with time zone"],
  ["withdrawal_scenario", "text"],
  ["cancellation_required", "boolean"],
  ["cancellation_status", "text"],
  ["cancellation_reference", "text"],
  ["billing_blocked", "boolean"],
  ["billing_manual_review", "boolean"],
  ["break_fee_flagged", "boolean"],
  ["customer_contacted_at", "timestamp with time zone"],
  ["next_action", "text"],
  ["next_action_due_at", "timestamp with time zone"],
  ["assigned_to", "uuid"],
  ["source", "text"],
  ["metadata", "jsonb"],
  ["created_by", "uuid"],
  ["updated_by", "uuid"],
  ["created_at", "timestamp with time zone"],
  ["updated_at", "timestamp with time zone"],
  ["resolved_at", "timestamp with time zone"],
  ["closed_at", "timestamp with time zone"],
  ["source_ediel_message_id", "uuid"],
  ["source_business_process", "text"],
  ["tenant_visible", "boolean"],
  ["technical_details_visible_to_tenant", "boolean"]
 ],
 "public.customer_contracts": [
  ["id", "uuid"],
  ["company_id", "uuid"],
  ["customer_id", "uuid"],
  ["site_id", "uuid"],
  ["metering_point_id", "uuid"],
  ["customer_site_id", "uuid"],
  ["contract_offer_id", "uuid"],
  ["source_type", "text"],
  ["status", "text"],
  ["contract_name", "text"],
  ["contract_type", "text"],
  ["campaign_name", "text"],
  ["campaign_code", "text"],
  ["campaign_version", "text"],
  ["price_version", "text"],
  ["terms_version", "text"],
  ["contract_version", "text"],
  ["signed_version", "text"],
  ["terms_signed_version", "text"],
  ["version_snapshot", "jsonb"],
  ["start_status", "text"],
  ["old_supplier_start_at", "date"],
  ["grid_owner_confirmed_start_at", "date"],
  ["ediel_confirmed_start_at", "date"],
  ["export_blocked", "boolean"],
  ["export_block_reason", "text"],
  ["price_snapshot", "jsonb"],
  ["campaign_snapshot", "jsonb"],
  ["billing_ready_status", "text"],
  ["billing_blocker_reasons", "jsonb"],
  ["withdrawal_requested_at", "timestamp with time zone"],
  ["rejected_reason", "text"],
  ["fixed_price_ore_per_kwh", "numeric"],
  ["spot_markup_ore_per_kwh", "numeric"],
  ["variable_fee_ore_per_kwh", "numeric"],
  ["monthly_fee_sek", "numeric"],
  ["green_fee_mode", "text"],
  ["green_fee_value", "numeric"],
  ["binding_months", "integer"],
  ["notice_months", "integer"],
  ["optional_fee_lines", "jsonb"],
  ["starts_at", "date"],
  ["expected_start_at", "date"],
  ["confirmed_start_at", "date"],
  ["actual_start_at", "date"],
  ["start_date_source", "text"],
  ["ends_at", "date"],
  ["signed_at", "timestamp with time zone"],
  ["termination_notice_date", "date"],
  ["termination_reason", "text"],
  ["auto_renew_enabled", "boolean"],
  ["auto_renew_term_months", "integer"],
  ["override_reason", "text"],
  ["invoice_recipient", "text"],
  ["invoice_email", "text"],
  ["invoice_reference", "text"],
  ["billing_street", "text"],
  ["billing_postal_code", "text"],
  ["billing_city", "text"],
  ["billing_country", "text"],
  ["billing_address_same_as_site", "boolean"],
  ["billing_level", "text"],
  ["consolidated_invoice", "boolean"],
  ["metadata", "jsonb"],
  ["created_at", "timestamp with time zone"],
  ["updated_at", "timestamp with time zone"],
  ["created_by", "uuid"],
  ["updated_by", "uuid"],
  ["requested_start_mode", "text"],
  ["calculated_earliest_start_date", "date"],
  ["price_area_used", "text"],
  ["grid_area_code_used", "text"],
  ["resolution_status", "text"],
  ["onboarding_status", "text"],
  ["onboarding_issues", "jsonb"],
  ["requested_start_date", "date"],
  ["confirmed_start_date", "date"],
  ["actual_start_date", "date"],
  ["agreement_channel", "text"],
  ["contract_number", "text"],
  ["price_plan_id", "uuid"],
  ["price_plan_version_id", "uuid"],
  ["invoice_fee_sek", "numeric"],
  ["markup_ore_per_kwh", "numeric"],
  ["contract_price_snapshot_id", "uuid"],
  ["legal_acceptance_snapshot", "jsonb"],
  ["legal_readiness_status", "text"],
  ["legal_readiness_reasons", "jsonb"],
  ["application_snapshot", "jsonb"],
  ["website_application_id", "uuid"],
  ["legal_bundle_id", "uuid"],
  ["price_book_id", "uuid"],
  ["snapshot_quality", "text"],
  ["snapshot_hash", "text"],
  ["billing_blocked_reason", "text"],
  ["customer_number", "text"],
  ["external_customer_id", "text"],
  ["public_contract_offer_id", "uuid"],
  ["offer_reference", "text"],
  ["legal_versions_snapshot", "jsonb"],
  ["signature_snapshot", "jsonb"],
  ["signature_snapshot_sha256", "text"],
  ["signed_ip_hash", "text"],
  ["signed_user_agent", "text"],
  ["contract_product_id", "uuid"],
  ["contract_product_version_id", "uuid"],
  ["contract_publication_version_id", "uuid"],
  ["legal_bundle_version_id", "uuid"],
  ["commercial_snapshot", "jsonb"],
  ["legal_snapshot", "jsonb"],
  ["document_sha256", "text"],
  ["locked_at", "timestamp with time zone"],
  ["tenant_communication_snapshot", "jsonb"],
  ["tenant_communication_snapshot_sha256", "text"],
  ["tenant_legal_party_snapshot", "jsonb"],
  ["lifecycle_stage", "text"],
  ["billing_eligible_at", "timestamp with time zone"],
  ["billing_eligibility_source", "text"],
  ["quote_reference", "text"],
  ["energy_direction", "text"],
  ["ended_at", "timestamp with time zone"],
  ["status_reason_code", "text"],
  ["customer_contract_reference", "text"],
  ["discount_value", "numeric"],
  ["discount_unit", "text"],
  ["start_fee_sek", "numeric"],
  ["admin_fee_sek", "numeric"],
  ["break_fee_sek", "numeric"],
  ["vat_rate", "numeric"],
  ["is_distance_agreement", "boolean"],
  ["withdrawal_information_sent_at", "timestamp with time zone"],
  ["withdrawal_deadline_at", "timestamp with time zone"],
  ["billing_blocked_by_case_id", "uuid"]
 ],
 "public.customer_supply_periods": [
  ["id", "uuid"],
  ["company_id", "uuid"],
  ["customer_id", "uuid"],
  ["metering_point_id", "uuid"],
  ["contract_id", "uuid"],
  ["start_date", "date"],
  ["end_date", "date"],
  ["source", "text"],
  ["source_message_id", "uuid"],
  ["status", "text"],
  ["created_at", "timestamp with time zone"],
  ["updated_at", "timestamp with time zone"],
  ["source_process", "text"],
  ["source_switch_request_id", "uuid"],
  ["metadata", "jsonb"],
  ["actual_start_date", "date"],
  ["actual_end_date", "date"],
  ["customer_contract_id", "uuid"],
  ["market_start_at", "timestamp with time zone"],
  ["market_end_at", "timestamp with time zone"],
  ["market_state_version", "bigint"],
  ["source_end_message_id", "uuid"]
 ],
 "public.customers": [
  ["id", "uuid"],
  ["company_id", "uuid"],
  ["customer_type", "text"],
  ["status", "text"],
  ["first_name", "text"],
  ["last_name", "text"],
  ["full_name", "text"],
  ["company_name", "text"],
  ["personal_number", "text"],
  ["normalized_personal_number", "text"],
  ["org_number", "text"],
  ["normalized_org_number", "text"],
  ["email", "text"],
  ["normalized_email", "text"],
  ["phone", "text"],
  ["normalized_phone", "text"],
  ["preferred_language", "text"],
  ["source", "text"],
  ["customer_number", "text"],
  ["apartment_number", "text"],
  ["metadata", "jsonb"],
  ["created_at", "timestamp with time zone"],
  ["updated_at", "timestamp with time zone"],
  ["created_by", "uuid"],
  ["updated_by", "uuid"],
  ["identity_number", "text"],
  ["organization_number", "text"],
  ["name", "text"],
  ["onboarding_status", "text"],
  ["activated_at", "timestamp with time zone"],
  ["ended_at", "timestamp with time zone"],
  ["acquisition_channel", "text"],
  ["campaign_id", "uuid"],
  ["sales_agent_id", "uuid"],
  ["partner_id", "uuid"],
  ["onboarding_issues", "jsonb"],
  ["next_action", "text"],
  ["ready_for_billing_at", "timestamp with time zone"],
  ["intake_status", "text"],
  ["intake_missing_fields", "text[]"],
  ["intake_quality_score", "integer"],
  ["intake_warnings", "text[]"],
  ["is_test_data", "boolean"],
  ["archived_at", "timestamp with time zone"],
  ["archived_by", "uuid"],
  ["archive_reason", "text"],
  ["anonymized_at", "timestamp with time zone"],
  ["anonymized_by", "uuid"],
  ["data_retention_note", "text"],
  ["external_customer_id", "text"],
  ["customer_reference", "text"],
  ["billing_street", "text"],
  ["billing_postal_code", "text"],
  ["billing_city", "text"],
  ["billing_country", "text"],
  ["active_sites", "integer"],
  ["pending_sites", "integer"],
  ["blocked_sites", "integer"],
  ["latest_customer_action", "text"],
  ["process_summary", "jsonb"],
  ["invoice_email", "text"],
  ["billing_profile_revision", "integer"],
  ["moved_out_at", "date"],
  ["lifecycle_closed_at", "timestamp with time zone"],
  ["lifecycle_closed_by", "uuid"],
  ["lifecycle_status_reason", "text"],
  ["legal_hold", "boolean"],
  ["legal_hold_reason", "text"],
  ["possible_duplicate", "boolean"],
  ["duplicate_review_status", "text"],
  ["merge_status", "text"],
  ["merged_into_customer_id", "uuid"],
  ["merged_at", "timestamp with time zone"],
  ["merged_by", "uuid"]
 ],
 "public.ediel_messages": [
  ["id", "uuid"],
  ["company_id", "uuid"],
  ["direction", "text"],
  ["message_standard", "text"],
  ["message_family", "text"],
  ["message_code", "text"],
  ["message_version", "text"],
  ["process_type", "text"],
  ["environment", "text"],
  ["test_flag", "integer"],
  ["status", "text"],
  ["transport_type", "text"],
  ["mailbox", "text"],
  ["mailbox_message_id", "text"],
  ["sender_ediel_id", "text"],
  ["sender_name", "text"],
  ["sender_sub_address", "text"],
  ["receiver_ediel_id", "text"],
  ["receiver_name", "text"],
  ["receiver_sub_address", "text"],
  ["sender_email", "text"],
  ["receiver_email", "text"],
  ["subject", "text"],
  ["file_name", "text"],
  ["mime_type", "text"],
  ["interchange_reference", "text"],
  ["external_reference", "text"],
  ["correlation_reference", "text"],
  ["transaction_reference", "text"],
  ["application_reference", "text"],
  ["original_message_id", "text"],
  ["original_transaction_id", "text"],
  ["original_message_code", "text"],
  ["related_message_id", "uuid"],
  ["communication_route_id", "uuid"],
  ["outbound_request_id", "uuid"],
  ["switch_request_id", "uuid"],
  ["grid_owner_data_request_id", "uuid"],
  ["partner_export_id", "uuid"],
  ["customer_id", "uuid"],
  ["site_id", "uuid"],
  ["metering_point_id", "uuid"],
  ["grid_owner_id", "uuid"],
  ["raw_payload", "text"],
  ["parsed_payload", "jsonb"],
  ["validation_report", "jsonb"],
  ["requires_contrl", "boolean"],
  ["requires_aperak", "boolean"],
  ["contrl_status", "text"],
  ["aperak_status", "text"],
  ["utilts_err_status", "text"],
  ["ack_outcome", "text"],
  ["syntax_check_status", "text"],
  ["functional_check_status", "text"],
  ["failure_reason", "text"],
  ["message_created_at", "timestamp with time zone"],
  ["message_received_at", "timestamp with time zone"],
  ["message_sent_at", "timestamp with time zone"],
  ["parsed_at", "timestamp with time zone"],
  ["validated_at", "timestamp with time zone"],
  ["acknowledged_at", "timestamp with time zone"],
  ["failed_at", "timestamp with time zone"],
  ["ack_due_at", "timestamp with time zone"],
  ["created_at", "timestamp with time zone"],
  ["updated_at", "timestamp with time zone"],
  ["created_by", "uuid"],
  ["updated_by", "uuid"],
  ["metadata", "jsonb"],
  ["unb_sender_id", "text"],
  ["unb_sender_subaddress", "text"],
  ["unb_receiver_id", "text"],
  ["unb_receiver_subaddress", "text"],
  ["message_reference", "text"],
  ["bgm_code", "text"],
  ["bgm_reference", "text"],
  ["tenant_resolution_status", "text"],
  ["business_match_status", "text"],
  ["ack_status", "text"],
  ["processing_status", "text"],
  ["raw_payload_hash", "text"],
  ["utilts_subtype", "text"],
  ["measurement_resolution", "text"],
  ["backend_automation_status", "text"],
  ["backend_automation_reason", "text"],
  ["route_profile_id", "uuid"],
  ["route_version", "integer"],
  ["transport_profile_id", "uuid"],
  ["routing_decision_id", "uuid"],
  ["routing_snapshot", "jsonb"],
  ["parsed_unb_sender_ediel_id", "text"],
  ["parsed_unb_receiver_ediel_id", "text"],
  ["resolved_company_id", "uuid"],
  ["resolved_sender_ediel_id", "text"],
  ["resolved_receiver_ediel_id", "text"],
  ["receiver_source", "text"],
  ["resolved_grid_owner_id", "uuid"],
  ["resolved_counterparty_id", "uuid"],
  ["dynamic_receiver_strategy", "text"],
  ["party_id", "uuid"],
  ["party_address_id", "uuid"],
  ["transport_security_mode", "text"],
  ["route_transport_security_mode", "text"],
  ["was_smime_encrypted", "boolean"],
  ["expected_receiver_certificate_id", "uuid"],
  ["cms_expected_receiver_present", "boolean"],
  ["operation_id", "uuid"],
  ["grid_owner_information_request_id", "uuid"],
  ["intent_id", "uuid"],
  ["message_subtype", "text"],
  ["business_process", "text"],
  ["business_state", "text"],
  ["rule_profile_key", "text"],
  ["rule_profile_version_id", "uuid"],
  ["rule_profile_version", "text"],
  ["rule_pack_checksum", "text"],
  ["rule_pack_snapshot", "jsonb"],
  ["canonical_rule_pack_id", "uuid"],
  ["certificate_profile_id", "uuid"],
  ["business_date", "date"],
  ["source_operation_id", "text"],
  ["immutable_payload_hash", "text"],
  ["immutable_rendered_at", "timestamp with time zone"],
  ["execution_context_snapshot", "jsonb"],
  ["contrl_due_at", "timestamp with time zone"],
  ["business_response_due_at", "timestamp with time zone"],
  ["response_overdue_at", "timestamp with time zone"],
  ["inbound_email_message_id", "uuid"]
 ],
 "public.metering_points": [
  ["id", "uuid"],
  ["company_id", "uuid"],
  ["customer_id", "uuid"],
  ["site_id", "uuid"],
  ["meter_point_id", "text"],
  ["metering_point_id", "text"],
  ["normalized_metering_point_id", "text"],
  ["site_facility_id", "text"],
  ["ediel_reference", "text"],
  ["status", "text"],
  ["measurement_type", "text"],
  ["reading_frequency", "text"],
  ["grid_owner_id", "uuid"],
  ["price_area_code", "text"],
  ["start_date", "date"],
  ["end_date", "date"],
  ["closed_at", "timestamp with time zone"],
  ["closed_reason", "text"],
  ["is_settlement_relevant", "boolean"],
  ["metadata", "jsonb"],
  ["created_at", "timestamp with time zone"],
  ["updated_at", "timestamp with time zone"],
  ["created_by", "uuid"],
  ["updated_by", "uuid"],
  ["customer_site_id", "uuid"],
  ["grid_area_code", "text"],
  ["grid_owner_ediel_id", "text"],
  ["meter_number", "text"],
  ["settlement_method", "text"],
  ["product_direction", "text"],
  ["bidding_zone_code", "text"],
  ["metering_method", "text"],
  ["estimated_annual_consumption_kwh", "numeric"],
  ["consumption_profile_id", "uuid"],
  ["data_quality_status", "text"],
  ["verification_status", "text"],
  ["onboarding_status", "text"],
  ["onboarding_issues", "jsonb"],
  ["next_action", "text"],
  ["facility_data_verified_at", "timestamp with time zone"],
  ["facility_data_status", "text"],
  ["facility_data_last_error", "text"],
  ["facility_data_last_error_code", "text"],
  ["is_test_data", "boolean"],
  ["archived_at", "timestamp with time zone"],
  ["archived_by", "uuid"],
  ["archive_reason", "text"],
  ["ediel_metering_point_id", "text"],
  ["customer_number", "text"],
  ["external_customer_id", "text"],
  ["anlage_id", "text"],
  ["grid_owner_name", "text"],
  ["price_area", "text"],
  ["energy_resolution_id", "uuid"],
  ["resolution_source", "text"],
  ["resolution_confidence", "numeric(5,4)"],
  ["resolution_status", "text"],
  ["resolved_at", "timestamp with time zone"],
  ["geodata_version", "text"]
 ],
 "public.platform_actor_identifiers": [
  ["id", "uuid"],
  ["actor_id", "uuid"],
  ["identifier_type", "text"],
  ["identifier_value", "text"],
  ["id_code_qualifier", "text"],
  ["id_code_responsible", "text"],
  ["source", "text"],
  ["is_verified", "boolean"],
  ["valid_from", "date"],
  ["valid_to", "date"],
  ["metadata", "jsonb"],
  ["created_at", "timestamp with time zone"],
  ["updated_at", "timestamp with time zone"]
 ],
 "public.supplier_switch_requests": [
  ["id", "uuid"],
  ["company_id", "uuid"],
  ["customer_id", "uuid"],
  ["site_id", "uuid"],
  ["metering_point_id", "uuid"],
  ["power_of_attorney_id", "uuid"],
  ["authorization_document_id", "uuid"],
  ["request_type", "text"],
  ["status", "text"],
  ["requested_start_date", "date"],
  ["current_supplier_name", "text"],
  ["current_supplier_org_number", "text"],
  ["incoming_supplier_name", "text"],
  ["incoming_supplier_org_number", "text"],
  ["grid_owner_id", "uuid"],
  ["price_area_code", "text"],
  ["validation_snapshot", "jsonb"],
  ["external_reference", "text"],
  ["submitted_at", "timestamp with time zone"],
  ["completed_at", "timestamp with time zone"],
  ["failed_at", "timestamp with time zone"],
  ["failure_reason", "text"],
  ["paused_at", "timestamp with time zone"],
  ["paused_by", "uuid"],
  ["pause_reason", "text"],
  ["lifecycle_blocked", "boolean"],
  ["lifecycle_block_source", "text"],
  ["lifecycle_block_id", "uuid"],
  ["metadata", "jsonb"],
  ["created_at", "timestamp with time zone"],
  ["updated_at", "timestamp with time zone"],
  ["created_by", "uuid"],
  ["updated_by", "uuid"],
  ["automation_origin", "text"],
  ["automation_key", "text"],
  ["customer_site_id", "uuid"],
  ["grid_owner_ediel_id", "text"],
  ["grid_area_code", "text"],
  ["confirmed_start_date", "date"],
  ["rff_li_reference", "text"],
  ["outbound_z03_message_id", "uuid"],
  ["inbound_z04_message_id", "uuid"],
  ["rejection_reason_code", "text"],
  ["rejection_reason_text", "text"],
  ["operation_id", "uuid"],
  ["readiness_snapshot", "jsonb"],
  ["readiness_checked_at", "timestamp with time zone"],
  ["current_supplier_ediel_id", "text"],
  ["contract_id", "uuid"],
  ["customer_contract_id", "uuid"],
  ["process_type", "text"],
  ["prodat_variant", "text"],
  ["prodat_reason", "text"],
  ["expected_z02_variant", "text"],
  ["z03_variant", "text"],
  ["communication_route_id", "uuid"],
  ["ediel_route_profile_id", "uuid"],
  ["current_supplier_id", "uuid"],
  ["current_supplier_unknown", "boolean"],
  ["current_supplier_contract_status", "text"],
  ["current_supplier_contract_end_date", "date"],
  ["current_supplier_notice_period", "text"],
  ["current_supplier_termination_fee", "numeric"],
  ["current_supplier_response_status", "text"]
 ],
 "public.tenant_actor_identifiers": [
  ["id", "uuid"],
  ["company_id", "uuid"],
  ["environment", "text"],
  ["actor_id", "uuid"],
  ["identifier_type", "text"],
  ["identifier_value", "text"],
  ["qualifier", "text"],
  ["subaddress", "text"],
  ["valid_from", "timestamp with time zone"],
  ["valid_to", "timestamp with time zone"]
 ],
 "public.tenant_actor_roles": [
  ["id", "uuid"],
  ["company_id", "uuid"],
  ["environment", "text"],
  ["actor_id", "uuid"],
  ["role_code", "text"],
  ["valid_from", "timestamp with time zone"],
  ["valid_to", "timestamp with time zone"]
 ],
 "public.tenant_bilateral_agreements": [
  ["id", "uuid"],
  ["company_id", "uuid"],
  ["environment", "text"],
  ["counterparty_actor_id", "uuid"],
  ["capability_code", "text"],
  ["terms", "jsonb"],
  ["is_enabled", "boolean"],
  ["valid_from", "timestamp with time zone"],
  ["valid_to", "timestamp with time zone"],
  ["source_reference", "text"]
 ],
 "public.tenant_ediel_profiles": [
  ["id", "uuid"],
  ["company_id", "uuid"],
  ["environment", "text"],
  ["market", "text"],
  ["is_enabled", "boolean"],
  ["valid_from", "timestamp with time zone"],
  ["valid_to", "timestamp with time zone"],
  ["metadata", "jsonb"]
 ],
 "public.user_profiles": [
  ["id", "uuid"],
  ["email", "text"],
  ["full_name", "text"],
  ["created_at", "timestamp with time zone"],
  ["updated_at", "timestamp with time zone"],
  ["user_status", "text"],
  ["auth_email_confirmed_at", "timestamp with time zone"],
  ["auth_last_sign_in_at", "timestamp with time zone"],
  ["auth_last_synced_at", "timestamp with time zone"],
  ["last_invite_sent_at", "timestamp with time zone"],
  ["last_password_reset_sent_at", "timestamp with time zone"],
  ["last_confirmation_email_sent_at", "timestamp with time zone"],
  ["last_auth_email_action", "text"],
  ["last_auth_email_action_at", "timestamp with time zone"],
  ["last_auth_email_action_by", "uuid"],
  ["last_auth_email_message", "text"]
 ],
 "gridex_regulated_supply.artifacts": [
  ["id", "uuid"],
  ["company_id", "uuid"],
  ["environment", "text"],
  ["selector", "jsonb"],
  ["scope", "jsonb"],
  ["scope_hash", "text"],
  ["source_bytes", "bytea"],
  ["source_hash", "text"],
  ["mime_type", "text"],
  ["source_reference", "text"],
  ["source_version", "text"],
  ["issuer_receipt", "jsonb"],
  ["receipt_hash", "text"],
  ["submitted_by", "uuid"],
  ["archived_at", "timestamp with time zone"]
 ],
 "gridex_regulated_supply.origins": [
  ["ground_id", "uuid"],
  ["company_id", "uuid"],
  ["artifact_id", "uuid"],
  ["review_id", "uuid"],
  ["ground_binding", "jsonb"],
  ["created_at", "timestamp with time zone"]
 ]
}
const existingInterfaces=[
{name:"gridex_network_registry_sources.network_for_company_v1",signature:"gridex_network_registry_sources.network_for_company_v1(uuid,text,text)",hash:"a7900a7319397d952d82e98e4becda2e8ad49e910f047d9459d827b99a2ad3ec",definition:String.raw`CREATE FUNCTION gridex_network_registry_sources.network_for_company_v1(c uuid, network_id text, env text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $_$
DECLARE a gridex_network_registry_sources.artifacts%rowtype;basis jsonb;n int;
BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 LOCK TABLE gridex_network_registry_sources.artifacts,gridex_network_registry_sources.reviews,gridex_network_registry_sources.origins,gridex_network_registry_sources.issuer_keys,gridex_network_registry_sources.representations,gridex_network_registry_sources.revocations IN SHARE MODE;
 IF (env IN('test','production')) IS NOT TRUE OR coalesce(network_id,'')!~'^[0-9]{5}$' THEN RAISE EXCEPTION 'network_registry_company_environment_required';END IF;
 SELECT count(*) INTO n FROM gridex_network_registry_sources.origins version JOIN gridex_network_registry_sources.artifacts artifact ON artifact.id=version.artifact_id WHERE version.company_id=c AND version.environment=env AND artifact.claims->>'networkEdielId'=network_id AND NOT EXISTS(SELECT FROM gridex_network_registry_sources.origins child WHERE child.previous_version_id=version.id);
 IF n<>1 THEN RETURN jsonb_build_object('status','held','blocker','ai_bi_network_registry_version_unqualified');END IF;
 SELECT artifact.* INTO a FROM gridex_network_registry_sources.origins version JOIN gridex_network_registry_sources.artifacts artifact ON artifact.id=version.artifact_id WHERE version.company_id=c AND version.environment=env AND artifact.claims->>'networkEdielId'=network_id AND NOT EXISTS(SELECT FROM gridex_network_registry_sources.origins child WHERE child.previous_version_id=version.id) FOR SHARE OF artifact;
 basis:=gridex_network_registry_sources.current_v1(a);IF basis IS NULL THEN RETURN jsonb_build_object('status','held','blocker','ai_bi_network_registry_current_source_unqualified');END IF;RETURN jsonb_build_object('status','authorized','basis',basis);
END$_$;`},{name:"gridex_received_sources.normal_switch_wire_v1",signature:"gridex_received_sources.normal_switch_wire_v1(text)",hash:"9f59aeafe6e08daaf996c997efa895121324a04679439cb734a05de09ebe9ee1",definition:String.raw`CREATE FUNCTION gridex_received_sources.normal_switch_wire_v1(p_raw text) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE w jsonb:=gridex_received_sources.supply_wire_v1(p_raw);tokens jsonb:=gridex_received_sources.closure_wire_tokens_v2(p_raw);
 own jsonb;lin jsonb;objects jsonb:='[]';seen text[]:=ARRAY[]::text[];key text;
BEGIN
 IF w IS NULL OR tokens IS NULL THEN RETURN NULL;END IF;
 FOR own IN SELECT o FROM jsonb_array_elements(w->'objects') o LOOP
  SELECT t INTO lin FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='LIN' AND t#>>'{elements,1,0}'=own->>'line';
  IF lin IS NULL OR lin#>>'{elements,3,0}' IS DISTINCT FROM own->>'point' THEN RETURN NULL;END IF;
  key:=jsonb_build_array(own->>'point',lin#>>'{elements,3,3}')::text;
  IF key=ANY(seen) THEN CONTINUE;END IF;
  seen:=array_append(seen,key);
  objects:=objects||jsonb_build_array(own||jsonb_build_object('identityAgency',lin#>>'{elements,3,3}',
   'registerCount',(SELECT count(*) FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='LIN' AND t#>>'{elements,3,0}'=own->>'point' AND t#>>'{elements,3,3}'=lin#>>'{elements,3,3}')));
 END LOOP;
 RETURN w||jsonb_build_object('objects',objects);
END $$;`},{name:"gridex_received_sources.permission_date_v1",signature:"gridex_received_sources.permission_date_v1(text)",hash:"bbb646ced1d31b50a9b4b98a49306662575e63fd48d845b50c049cfb30c7fd8c",definition:String.raw`CREATE FUNCTION gridex_received_sources.permission_date_v1(p_value text) RETURNS date
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'pg_catalog'
    AS $_$
DECLARE result date;
BEGIN
 IF p_value IS NULL THEN RETURN NULL; END IF;
 IF p_value !~ '^[0-9]{8}([0-9]{4}([+-][0-9]{4})?)?$' THEN RETURN NULL; END IF;
 result:=to_date(substr(p_value,1,8),'YYYYMMDD');
 IF to_char(result,'YYYYMMDD')<>substr(p_value,1,8) THEN RETURN NULL; END IF;
 RETURN result;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $_$;`},{name:"gridex_received_sources.permission_time_v1",signature:"gridex_received_sources.permission_time_v1(text)",hash:"9dd0687315a0b2dac379175794d873d13c0ee4b59a19239ad69fde3d92b5ff81",definition:String.raw`CREATE FUNCTION gridex_received_sources.permission_time_v1(p_value text) RETURNS timestamp with time zone
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'pg_catalog'
    AS $_$
DECLARE result timestamptz; value text;
BEGIN
 IF p_value IS NULL OR p_value !~ '^[0-9]{12}$' OR gridex_received_sources.permission_date_v1(p_value) IS NULL THEN RETURN NULL; END IF;
 value:=substr(p_value,1,4)||'-'||substr(p_value,5,2)||'-'||substr(p_value,7,2)||'T'||substr(p_value,9,2)||':'||substr(p_value,11,2)||':00+01:00';
 result:=value::timestamptz;
 RETURN result;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $_$;`},{name:"gridex_received_sources.prodat_application_object_accepted_v1",signature:"gridex_received_sources.prodat_application_object_accepted_v1(uuid,uuid,uuid,jsonb)",hash:"97833c2f9937a5c0d97342982efe23d081a1eb348d85fc04c14f80c61e877df9",definition:String.raw`CREATE FUNCTION gridex_received_sources.prodat_application_object_accepted_v1(c uuid, source_id uuid, canonical_id uuid, object_scope jsonb) RETURNS boolean
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE facet jsonb;
BEGIN
 facet:=gridex_received_sources.require_prodat_application_objects_v1(c,source_id);
 RETURN facet->>'headerDecision'='accepted' AND facet->>'assessmentId'=canonical_id::text
  AND EXISTS(SELECT FROM jsonb_array_elements(facet->'objects')e WHERE e->>'applicationDecision'='accepted' AND e-'applicationDecision'-'reasonCodes'=object_scope);
END $$;`},{name:"gridex_received_sources.require_prodat_application_objects_v1",signature:"gridex_received_sources.require_prodat_application_objects_v1(uuid,uuid)",hash:"a03fde41de9db0f7e400ca3a6f5d6c2cbae7c1c5aed5fd61bb7d7722bba1b8aa",definition:String.raw`CREATE FUNCTION gridex_received_sources.require_prodat_application_objects_v1(c uuid, source_id uuid) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE m public.ediel_messages%rowtype;a gridex_received_sources.validation_assessments%rowtype;f gridex_received_sources.prodat_application_facets%rowtype;r gridex_received_sources.prodat_response_facets%rowtype;basis jsonb;
BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=source_id AND company_id=c FOR SHARE;
 IF m.id IS NULL OR m.direction IS DISTINCT FROM 'inbound' OR m.message_family IS DISTINCT FROM 'PRODAT' THEN RAISE EXCEPTION 'prodat_application_original_owner_unavailable';END IF;
 SELECT v.* INTO a FROM gridex_received_sources.validation_assessments v WHERE v.company_id=c AND v.source_message_id=source_id AND v.environment=m.environment
  AND v.source_payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=v.id)
  AND v.xmin::text::numeric<>mod(pg_current_xact_id()::text::numeric,4294967296) FOR SHARE;
 SELECT * INTO f FROM gridex_received_sources.prodat_application_facets WHERE assessment_id=a.id AND company_id=c AND source_message_id=source_id AND environment=m.environment AND source_payload_hash=a.source_payload_hash;
 SELECT * INTO r FROM gridex_received_sources.prodat_response_facets WHERE assessment_id=a.id;
 IF a.id IS NULL OR f.assessment_id IS NULL OR a.owner IS DISTINCT FROM 'canonical-runtime-with-registry-v1' OR a.facts_hash IS DISTINCT FROM encode(sha256(convert_to(a.facts_text,'UTF8')),'hex')
  OR f.application_facts_hash IS DISTINCT FROM encode(sha256(convert_to(f.application_facts_text,'UTF8')),'hex') OR NOT coalesce(gridex_received_sources.validate_prodat_application_v2(c,source_id,m.raw_payload,a.facts_text::jsonb,f.application_facts_text::jsonb,r.response_facts_text::jsonb,(SELECT sf.function_facts_text::jsonb FROM gridex_received_sources.prodat_source_function_facets sf WHERE sf.assessment_id=a.id AND sf.company_id=c AND sf.source_message_id=source_id AND sf.environment=m.environment AND sf.source_payload_hash=a.source_payload_hash AND sf.function_facts_hash=encode(sha256(convert_to(sf.function_facts_text,'UTF8')),'hex'))),false) THEN RAISE EXCEPTION 'prodat_application_original_owner_unavailable';END IF;
 basis:=gridex_ediel_source_rules.require_v1(c,source_id);
 IF a.facts_text::jsonb->'rulePackEvidence' IS DISTINCT FROM jsonb_build_object('profileKey',basis->'profileKey','messageProfileId',basis->'messageProfileId','rulePackId',basis->'rulePackId','sourceHash',basis->'sourceHash','version',basis->'version',
  'snapshot',jsonb_build_object('rulePack',basis#>'{snapshot,rulePack}','messageProfile',basis#>'{snapshot,messageProfile}','guideSources',basis#>'{snapshot,guideSources}')) THEN RAISE EXCEPTION 'prodat_application_original_rule_witness_mismatch';END IF;
 RETURN f.application_facts_text::jsonb||jsonb_build_object('assessmentId',a.id);
END $$;`},{name:"gridex_received_sources.sent_source_is_current_v1",signature:"gridex_received_sources.sent_source_is_current_v1(ediel_messages)",hash:"e294b202e0445689bce38e314fb2ff12312ae944d9f91500c27c15877e8d4a3d",definition:String.raw`CREATE FUNCTION gridex_received_sources.sent_source_is_current_v1(m public.ediel_messages) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
BEGIN
 IF m.direction IS DISTINCT FROM 'outbound' OR (m.status IN('sent','acknowledged')) IS NOT TRUE OR m.message_sent_at IS NULL OR m.immutable_rendered_at IS NULL OR m.immutable_payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RETURN false;END IF;
 -- The shared private provider journal supplies actual acceptance. A positive
 -- ACK projection does not approve a supply or manufacture a sent original.
 RETURN gridex_ediel_transport.accepted_source_basis_v1(m) IS NOT NULL;
END $$;`},{name:"gridex_received_sources.supply_effect_assessment_owns_period_v1",signature:"gridex_received_sources.supply_effect_assessment_owns_period_v1(uuid,uuid,uuid,uuid)",hash:"d6b2cf64b45879d973963ddf6640daeaf77217e6a89a2c66fb09732ef737f15c",definition:String.raw`CREATE FUNCTION gridex_received_sources.supply_effect_assessment_owns_period_v1(c uuid, source_id uuid, period_id uuid, canonical_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE r gridex_received_sources.supply_object_effect_receipts%rowtype;m public.ediel_messages%rowtype;
BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=source_id AND company_id=c;
 SELECT stored.* INTO r FROM gridex_received_sources.supply_object_effect_receipts stored WHERE stored.company_id=c AND stored.source_message_id=source_id AND stored.canonical_assessment_id=canonical_id AND stored.environment=m.environment
  AND stored.xmin::text::numeric<>mod(pg_current_xact_id()::text::numeric,4294967296)
  AND stored.payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') AND stored.effect_hash=encode(sha256(convert_to(stored.effect_text,'UTF8')),'hex')
  AND EXISTS(SELECT FROM jsonb_array_elements(stored.effect_text::jsonb->'resultingStates')state WHERE state->>'id'=period_id::text);
 RETURN r.id IS NOT NULL AND r.effect_text::jsonb->>'owner'='inbound-supply-object-v1' AND r.effect_text::jsonb->'object'=r.object_scope
  AND EXISTS(SELECT FROM gridex_received_sources.supply_source_transitions tr WHERE tr.company_id=c AND tr.source_message_id=source_id AND tr.payload_hash=r.payload_hash AND EXISTS(SELECT FROM jsonb_array_elements(tr.resulting_states)state WHERE state->>'id'=period_id::text AND r.effect_text::jsonb->'resultingStates'@>jsonb_build_array(state)));
END$$;`},{name:"gridex_received_sources.supply_wire_for_period_receipt_v1",signature:"gridex_received_sources.supply_wire_for_period_receipt_v1(uuid,uuid,uuid)",hash:"e9dd5defb92a7e1a92a0990bdffbca77adebee395ac25d876ce71bba7fda34df",definition:String.raw`CREATE FUNCTION gridex_received_sources.supply_wire_for_period_receipt_v1(c uuid, source_id uuid, period_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE m public.ediel_messages%rowtype;r gridex_received_sources.supply_object_effect_receipts%rowtype;wire jsonb;BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=source_id AND company_id=c;
 SELECT e.* INTO r FROM gridex_received_sources.supply_object_effect_receipts e WHERE e.company_id=c AND e.source_message_id=source_id AND e.environment=m.environment
  AND e.xmin::text::numeric<>mod(pg_current_xact_id()::text::numeric,4294967296)
  AND e.payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') AND e.effect_hash=encode(sha256(convert_to(e.effect_text,'UTF8')),'hex')
  AND EXISTS(SELECT FROM jsonb_array_elements(e.effect_text::jsonb->'resultingStates')state WHERE state->>'id'=period_id::text);
 IF r.id IS NULL OR r.effect_text::jsonb->>'owner' IS DISTINCT FROM 'inbound-supply-object-v1' OR r.effect_text::jsonb->'object' IS DISTINCT FROM r.object_scope THEN RETURN NULL;END IF;
 wire:=gridex_received_sources.supply_wire_for_scope_v1(m.raw_payload,r.object_scope);
 IF wire#>'{objects,0}' IS DISTINCT FROM r.effect_text::jsonb->'wire' THEN RETURN NULL;END IF;RETURN wire;
END$$;`},{name:"gridex_regulated_supply.ground_current_v1",signature:"gridex_regulated_supply.ground_current_v1(uuid,uuid,uuid,timestamp with time zone)",hash:"f74a91b4ed3171bb7f9cbb14bcaccc9d7e9b21e8c0fce52f3fe770d00208ca10",definition:String.raw`CREATE FUNCTION gridex_regulated_supply.ground_current_v1(ground uuid, company uuid, point uuid, effective timestamp with time zone) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    SET "TimeZone" TO 'UTC'
    AS $$
DECLARE o gridex_regulated_supply.origins%rowtype;a gridex_regulated_supply.artifacts%rowtype;r gridex_regulated_supply.reviews%rowtype;g gridex_received_sources.regulated_supply_ground_versions%rowtype;scope jsonb;
BEGIN
 PERFORM gridex_regulated_supply.lock_graph_v1();
 SELECT * INTO o FROM gridex_regulated_supply.origins WHERE ground_id=ground AND company_id=company;
 SELECT * INTO a FROM gridex_regulated_supply.artifacts WHERE id=o.artifact_id AND company_id=company;SELECT * INTO r FROM gridex_regulated_supply.reviews WHERE id=o.review_id AND artifact_id=a.id AND company_id=company;
 SELECT * INTO g FROM gridex_received_sources.regulated_supply_ground_versions WHERE id=ground AND company_id=company;
 IF o.ground_id IS NULL OR a.id IS NULL OR r.decision IS DISTINCT FROM 'approved' OR r.reviewer_user_id=a.submitted_by OR gridex_regulated_supply.actor_v1(company,r.reviewer_user_id,'review') IS NOT TRUE
 OR g.revoked_at IS NOT NULL OR (to_jsonb(g)-'revoked_at') IS DISTINCT FROM o.ground_binding OR g.approved_by IS DISTINCT FROM r.reviewer_user_id OR g.approved_at IS DISTINCT FROM r.reviewed_at
 OR a.scope->>'meteringPointId' IS DISTINCT FROM point::text OR (a.scope->>'startAt')::timestamptz IS DISTINCT FROM effective OR gridex_regulated_supply.receipt_current_v1(a) IS NOT TRUE THEN RETURN false;END IF;
 scope:=gridex_regulated_supply.scope_v1(company,a.selector);RETURN scope IS NOT NULL AND scope=a.scope;
END$$;`},{name:"public.gridex_actor_has_company_permission",signature:"public.gridex_actor_has_company_permission(uuid,uuid,text)",hash:"253843a6487cbea3a7bb3ac749aae2176462759038f7a1549e5e29ae843329bf",definition:String.raw`CREATE FUNCTION public.gridex_actor_has_company_permission(p_actor_user_id uuid, p_company_id uuid, p_permission text) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select (p_actor_user_id is not null AND EXISTS(SELECT FROM public.permissions catalog WHERE catalog.key=p_permission AND catalog.is_active) and p_company_id is not null
  and exists(
    select 1 from auth.users u
    where u.id = p_actor_user_id and u.deleted_at is null
      and (u.banned_until is null or u.banned_until <= clock_timestamp())
  )
  and (
    exists(
      select 1 from public.admin_users au
      where au.user_id = p_actor_user_id
        and coalesce(au.is_active, true)
        and lower(coalesce(au.role, '')) in ('super_admin', 'superadmin', 'platform_superadmin')
    )
    or exists(
      select 1
      from public.user_roles ur left join public.roles r on r.id = ur.role_id
      where ur.user_id = p_actor_user_id and ur.company_id is null
        and coalesce(ur.status, 'active') = 'active' and coalesce(ur.is_active, true)
        and lower(coalesce(ur.role, r.key, r.name, '')) in ('super_admin', 'superadmin', 'platform_superadmin')
    )
    or (
      exists(
        select 1 from public.company_memberships cm
        join public.companies c on c.id = cm.company_id
        where cm.user_id = p_actor_user_id and cm.company_id = p_company_id
          and coalesce(cm.status, 'active') = 'active' and coalesce(cm.is_active, true)
          and coalesce(c.is_active, true)
          and coalesce(c.status, 'active') not in ('archived', 'suspended', 'pending_deletion', 'deleted')
      )
      and p_permission = any(
        public.gridex_get_user_permissions_in_company(p_actor_user_id, p_company_id)
      )
    )
  )
  ) and not exists(
    select 1 from public.user_permissions d left join public.permissions p on p.id=d.permission_id
    where d.user_id=p_actor_user_id and (d.company_id is null or d.company_id=p_company_id)
      and d.is_active and d.status='active' and d.effect='deny'
      and coalesce(nullif(d.permission_key,''),p.key)=p_permission
  ) and not exists(
    select 1 from public.user_permission_overrides d
    where d.user_id=p_actor_user_id and (d.company_id is null or d.company_id=p_company_id)
      and d.is_active and d.effect='deny' and d.permission_key=p_permission
      and (d.valid_from is null or d.valid_from<=clock_timestamp()) and (d.valid_to is null or clock_timestamp()<d.valid_to)
  )
$$;`}
] as const
let db:PGlite|undefined
afterEach(async()=>{await db?.close();db=undefined})
async function bootstrap(){
 db=new PGlite()
 await db.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE ROLE gridex_ediel_retention_owner;CREATE SCHEMA gridex_network_registry_sources;CREATE SCHEMA gridex_received_sources;CREATE SCHEMA gridex_regulated_supply;')
 for(const [name,cols]of Object.entries(tables))await db.exec('CREATE TABLE '+qualify(name)+'('+cols.map(([col,type])=>quote(col)+' '+type).join(',')+')')
 await db.exec('SET check_function_bodies=off')
 for(const f of existingInterfaces){
  await db.exec(f.definition)
  await db.exec('REVOKE ALL ON FUNCTION '+f.signature+' FROM PUBLIC')
  if(f.name==='public.gridex_actor_has_company_permission')await db.exec('GRANT EXECUTE ON FUNCTION '+f.signature+' TO authenticated,service_role,gridex_ediel_retention_owner')
 }
 await db.exec('SET check_function_bodies=on')
 for(const f of existingInterfaces)expect((await db.query<{hash:string}>("SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') hash FROM pg_proc WHERE oid=$1::regprocedure",[f.signature])).rows[0].hash).toBe(f.hash)
}
async function apply(){
 // RED executes real SQL against the absent helper, not an ENOENT assertion.
 if(existsSync(migration))await db!.exec(readFileSync(migration,'utf8'))
}
async function groundPort(){
 await db!.exec(`CREATE OR REPLACE FUNCTION gridex_regulated_supply.ground_current_v1(ground uuid,company uuid,point uuid,effective timestamptz) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$BEGIN RETURN false;END$$;`)
}

const targets=[
 {signature:'gridex_received_sources.other_supply_scope_effect_v1(uuid,uuid,uuid,jsonb,uuid[],uuid)',hash:'c30e7398338c7b0a39da7220ea62bffa4d8ae0134f1c7d8b272b09e07736e03e',config:['search_path=pg_catalog','TimeZone=UTC']},
 {signature:'gridex_received_sources.require_supply_scope_admission_v1(uuid,uuid,jsonb)',hash:'f13d05e95f9c89c0aba9332f69ffc73eff266e61f4626cdaa3456e1fa7f6fed8',config:['search_path=pg_catalog']},
 {signature:'gridex_regulated_supply.ground_wire_current_v1(uuid,uuid,uuid,timestamp with time zone,jsonb)',hash:'489a2a1b4d4d0868f762b9416efcc3fa852d384848be779c440a30a0f18d3129',config:['search_path=pg_catalog','TimeZone=UTC']},
] as const
const company='00000000-0000-4000-8000-000000000001',message='00000000-0000-4000-8000-000000000002',assessment='00000000-0000-4000-8000-000000000003',ground='00000000-0000-4000-8000-000000000004',point='00000000-0000-4000-8000-000000000005',archive='00000000-0000-4000-8000-000000000006'
async function catalog(){
 return(await db!.query<{v:Record<string,unknown>}>(`SELECT jsonb_build_object(
 'functions',(SELECT jsonb_agg(jsonb_build_object('proc',to_jsonb(p),'comment',obj_description(p.oid,'pg_proc')) ORDER BY p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('public','gridex_received_sources','gridex_regulated_supply','gridex_network_registry_sources')),
 'columns',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attrelid,a.attnum) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE a.attnum>0 AND n.nspname IN('public','gridex_received_sources','gridex_regulated_supply')),
 'triggers',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.oid) FROM pg_trigger t),
 'constraints',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.oid) FROM pg_constraint c),
 'roles',(SELECT jsonb_agg(to_jsonb(r)-'rolpassword' ORDER BY r.oid) FROM pg_roles r),
 'memberships',(SELECT jsonb_agg(to_jsonb(m) ORDER BY m.oid) FROM pg_auth_members m),
 'namespaces',(SELECT jsonb_agg(to_jsonb(n) ORDER BY n.oid) FROM pg_namespace n),
 'defaults',(SELECT jsonb_agg(to_jsonb(d) ORDER BY d.oid) FROM pg_default_acl d)) v`)).rows[0].v
}
async function rejectAtomically(pattern:RegExp,sql=readFileSync(migration,'utf8')){
 const before=await catalog()
 await expect(db!.exec(sql)).rejects.toThrow(pattern)
 await db!.exec('ROLLBACK')
 expect(await catalog()).toEqual(before)
}
async function assertTargets(){
 for(const t of targets){
  const a=(await db!.query<{body:string;definer:boolean;config:string[];owner:string;anon:boolean;authenticated:boolean;service:boolean;acl:unknown[]}>(`SELECT encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') body,p.prosecdef definer,p.proconfig config,p.proowner::regrole::text owner,
   has_function_privilege('anon',p.oid,'EXECUTE') anon,has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated,has_function_privilege('service_role',p.oid,'EXECUTE') service,
   (SELECT jsonb_agg(jsonb_build_object('grantee',a.grantee::regrole::text,'grantor',a.grantor::regrole::text,'privilege',a.privilege_type,'grantable',a.is_grantable)) FROM aclexplode(p.proacl)a) acl
   FROM pg_proc p WHERE p.oid=$1::regprocedure`,[t.signature])).rows[0]
  expect(a).toEqual({body:t.hash,definer:true,config:[...t.config],owner:'postgres',anon:false,authenticated:false,service:false,acl:[{grantee:'postgres',grantor:'postgres',privilege:'EXECUTE',grantable:false}]})
 }
}
async function poisonBody(signature:string){
 const x=(await db!.query<{body:string;definition:string}>("SELECT prosrc body,pg_get_functiondef(oid) definition FROM pg_proc WHERE oid=$1::regprocedure",[signature])).rows[0]
 await db!.exec(x.definition.replace(x.body,()=>x.body+'\n-- explicit unknown source control\n'))
}
async function protectedOutputPorts(){
 // These ports are introduced only after the real installer succeeds. They do
 // not qualify real canonical acceptance/current signed regulated ground.
 await db!.exec(`CREATE TEMP TABLE sql19_application_output(facet jsonb);
 CREATE TEMP TABLE sql19_ground_output(current boolean);
 INSERT INTO sql19_ground_output VALUES(false);
 CREATE OR REPLACE FUNCTION gridex_received_sources.require_prodat_application_objects_v1(c uuid,source_id uuid) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$DECLARE v jsonb;BEGIN SELECT facet INTO v FROM pg_temp.sql19_application_output;IF v IS NULL THEN RAISE EXCEPTION 'finite_application_output_required';END IF;RETURN v;END$$;
 CREATE OR REPLACE FUNCTION gridex_regulated_supply.ground_current_v1(ground uuid,company uuid,point uuid,effective timestamptz) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$BEGIN RETURN coalesce((SELECT current FROM pg_temp.sql19_ground_output LIMIT 1),false);END$$;`)
}
const own={point:'POINT',identityAgency:'9',customerIdentity:'5566778899',gridArea:'AREA',reason:'Z26'}
async function seedAdmission(){
 const raw='inert synthetic source bytes',facet={assessmentId:assessment,headerDecision:'accepted',objects:[{...own,applicationDecision:'accepted',reasonCodes:[]}]}
 await db!.query("INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_family,raw_payload) VALUES($1,$2,'test','inbound','PRODAT',$3)",[message,company,raw])
 await db!.query("INSERT INTO gridex_received_sources.validation_assessments(id,company_id,source_message_id,environment,source_payload_hash,facts_text) VALUES($1,$2,$3,'test',$4,$5)",[assessment,company,message,digest(raw),JSON.stringify({syntaxDecision:'accepted',functionalDecision:'accepted'})])
 await db!.query('INSERT INTO pg_temp.sql19_application_output VALUES($1)',[facet])
}
async function admit(scope:unknown=own){return(await db!.query<{v:string}>('SELECT gridex_received_sources.require_supply_scope_admission_v1($1,$2,$3) v',[company,message,scope])).rows[0].v}
async function businessRows(){return(await db!.query<{v:unknown}>(`SELECT jsonb_build_object('cases',(SELECT jsonb_agg(to_jsonb(t)) FROM public.customer_cases t),'periods',(SELECT jsonb_agg(to_jsonb(t)) FROM public.customer_supply_periods t),'switches',(SELECT jsonb_agg(to_jsonb(t)) FROM public.supplier_switch_requests t))v`)).rows[0].v}
async function wireGround(scope:unknown=own){return(await db!.query<{v:boolean}>('SELECT gridex_regulated_supply.ground_wire_current_v1($1,$2,$3,now(),$4)v',[ground,company,point,scope])).rows[0].v}
const actor='00000000-0000-4000-8000-000000000008',legalActor='00000000-0000-4000-8000-000000000009',customer='00000000-0000-4000-8000-000000000010',original='00000000-0000-4000-8000-000000000011',switchId='00000000-0000-4000-8000-000000000012'
const cancellation={...own,reason:'Z24',li:'LI',start:'202610200000'}
async function seedCancellationPorts(){
 // Explicit finite external outputs, installed after the real SQL19 admission.
 // Real sender-registry/legal permission/sent-seal and wire parsing remain out
 // of scope. The actual c30e correlation/cohort/compensation guards execute.
 await protectedOutputPorts();await seedAdmission()
 await db!.exec(`CREATE TEMP TABLE sql19_wire_output(raw text,wire jsonb);
 CREATE TEMP TABLE sql19_sent_output(id uuid);
 CREATE OR REPLACE FUNCTION gridex_received_sources.normal_switch_wire_v1(p_raw text) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$BEGIN RETURN (SELECT wire FROM pg_temp.sql19_wire_output WHERE raw=p_raw);END$$;
 CREATE OR REPLACE FUNCTION gridex_received_sources.sent_source_is_current_v1(m public.ediel_messages) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN RETURN EXISTS(SELECT FROM pg_temp.sql19_sent_output WHERE id=m.id);END$$;
 CREATE OR REPLACE FUNCTION public.gridex_actor_has_company_permission(p_actor_user_id uuid,p_company_id uuid,p_permission text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$BEGIN RETURN p_actor_user_id='${actor}'::uuid AND p_company_id='${company}'::uuid AND p_permission='metering.write';END$$;
 CREATE OR REPLACE FUNCTION gridex_network_registry_sources.network_for_company_v1(c uuid,network_id text,env text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN IF c='${company}'::uuid AND network_id='11111' AND env='test' THEN RETURN jsonb_build_object('status','authorized','basis',jsonb_build_object('companyId',c,'environment',env,'networkEdielId',network_id));END IF;RETURN NULL;END$$;`)
 await db!.query('UPDATE pg_temp.sql19_application_output SET facet=$1',[{assessmentId:assessment,headerDecision:'accepted',objects:[{...cancellation,applicationDecision:'accepted',reasonCodes:[]}]}])
 await db!.query("UPDATE public.ediel_messages SET message_received_at='2026-10-20T00:00:00Z',customer_id=$1,metering_point_id=$2",[customer,point])
 await db!.query("INSERT INTO public.user_profiles(id,user_status)VALUES($1,'active')",[actor])
 await db!.query("INSERT INTO public.company_memberships(id,user_id,company_id,status,is_active,accepted_at)VALUES($1,$1,$2,'active',true,'2026-01-01')",[actor,company])
 await db!.query("INSERT INTO public.tenant_ediel_profiles(company_id,environment,market,is_enabled,valid_from)VALUES($1,'test','electricity',true,'2026-01-01')",[company])
 await db!.query("INSERT INTO public.tenant_actor_identifiers(company_id,environment,actor_id,identifier_type,identifier_value,valid_from)VALUES($1,'test',$2,'EdielId','22222','2026-01-01')",[company,legalActor])
 await db!.query("INSERT INTO public.tenant_actor_roles(company_id,environment,actor_id,role_code,valid_from)VALUES($1,'test',$2,'electricity_supplier','2026-01-01')",[company,legalActor])
 await db!.query("INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_family,raw_payload,customer_id,metering_point_id)VALUES($1,$2,'test','outbound','PRODAT','finite original',$3,$4)",[original,company,customer,point])
 await db!.query("INSERT INTO public.supplier_switch_requests(id,company_id,customer_id,metering_point_id,outbound_z03_message_id,status)VALUES($1,$2,$3,$4,$5,'completed')",[switchId,company,customer,point,original])
 await db!.query('INSERT INTO pg_temp.sql19_sent_output VALUES($1)',[original])
 await db!.query('INSERT INTO pg_temp.sql19_wire_output VALUES($1,$2),($3,$4)',['inert synthetic source bytes',{code:'Z04',sender:'11111',receiver:'22222',objects:[cancellation]},'finite original',{code:'Z03',sender:'22222',receiver:'11111',objects:[{...cancellation,reason:'Z22'}]}])
}
async function applyCancellation(cohort:string[]=[original]){return(await db!.query<{v:unknown}>('SELECT gridex_received_sources.other_supply_scope_effect_v1($1,$2,$3,$4,$5::uuid[],$6)v',[company,message,actor,cancellation,cohort,assessment])).rows[0].v}
describe.sequential('SQL19 exact private supply prerequisite cluster',()=>{
 it('keeps a finite noncurrent-ground output control operational before invoking the new helper',async()=>{
  await bootstrap();await groundPort()
  expect((await db!.query<{v:boolean}>("SELECT gridex_regulated_supply.ground_current_v1(NULL,NULL,NULL,NULL) v")).rows[0].v).toBe(false)
 })
 it('installs the closed helper so a noncurrent ground is rejected without a business effect',async()=>{
  await bootstrap();await apply();await groundPort()
  expect((await db!.query<{v:boolean}>("SELECT gridex_regulated_supply.ground_wire_current_v1(NULL,NULL,NULL,NULL,'{}') v")).rows[0].v).toBe(false)
 })

 it('atomically installs exactly three private functions and no caller, preserving existing catalogs on repeated no-op',async()=>{
  await bootstrap()
  await db!.exec(`CREATE FUNCTION public.sql19_fixture_marker() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;END$$;`)
  for(const table of ['customer_cases','customer_supply_periods','supplier_switch_requests'])await db!.exec('CREATE TRIGGER sql19_fixture_marker BEFORE INSERT OR UPDATE OR DELETE ON public.'+table+' FOR EACH ROW EXECUTE FUNCTION public.sql19_fixture_marker()')
  const before=await catalog();await apply();await assertTargets()
  const after=await catalog()
  for(const key of ['columns','triggers','constraints','roles','memberships','namespaces','defaults'])expect(after[key]).toEqual(before[key])
  expect((after.functions as unknown[]).length-(before.functions as unknown[]).length).toBe(3)
  expect((await db!.query<{v:boolean}>("SELECT to_regprocedure('public.ediel_apply_supply_source_v1(uuid,uuid,uuid)') IS NULL v")).rows[0].v).toBe(true)
  await db!.exec(`COMMENT ON FUNCTION gridex_received_sources.require_supply_scope_admission_v1(uuid,uuid,jsonb) IS 'preserved known target comment'`)
  const known=await catalog();await apply();expect(await catalog()).toEqual(known)
 })
 it.each([
  ['missing dependency',"DROP FUNCTION gridex_received_sources.permission_time_v1(text)",/exact_single_function/],
  ['dependency overload',"CREATE FUNCTION gridex_received_sources.permission_time_v1(integer) RETURNS timestamptz LANGUAGE plpgsql AS $$BEGIN RETURN NULL;END$$",/exact_single_function/],
  ['dependency header',"ALTER FUNCTION gridex_received_sources.normal_switch_wire_v1(text) SECURITY DEFINER",/exact_function_profile/],
  ['dependency path',"ALTER FUNCTION gridex_received_sources.permission_date_v1(text) SET search_path=public",/exact_function_profile/],
  ['dependency ACL',"GRANT EXECUTE ON FUNCTION gridex_received_sources.permission_date_v1(text) TO authenticated",/exact_function_acl/],
  ['missing rowtype',"DROP TABLE gridex_received_sources.regulated_supply_ground_versions",/existing_typed_relation/],
  ['missing column',"ALTER TABLE public.customer_supply_periods DROP COLUMN market_state_version",/known_column_type/],
  ['unknown type',"ALTER TABLE public.customer_cases ALTER COLUMN metadata TYPE text USING metadata::text",/known_column_type/],
  ['creation default',"ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO service_role",/known_function_creation_defaults/],
  ['low privilege namespace CREATE',"GRANT CREATE ON SCHEMA gridex_received_sources TO authenticated",/existing_private_namespace/],
  ['unknown target signature',"CREATE FUNCTION gridex_received_sources.other_supply_scope_effect_v1(text) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN RETURN NULL;END$$",/exact_function_profile/],
 ] as const)('refuses %s before any partial cluster or unrelated catalog change',async(_name,mutation,pattern)=>{
  await bootstrap();await db!.exec(mutation);await rejectAtomically(pattern)
 })
 it('refuses a changed dependency body by its actual hash',async()=>{await bootstrap();await poisonBody('gridex_received_sources.permission_date_v1(text)');await rejectAtomically(/exact_function_profile/)})
 it.each([
  ['security mode',`ALTER FUNCTION ${targets[0].signature} SECURITY INVOKER`,/exact_function_profile/],
  ['path',`ALTER FUNCTION ${targets[0].signature} SET search_path=public`,/exact_function_profile/],
  ['time zone',`ALTER FUNCTION ${targets[2].signature} SET timezone='Europe/Stockholm'`,/exact_function_profile/],
  ['ACL',`GRANT EXECUTE ON FUNCTION ${targets[0].signature} TO service_role`,/exact_function_acl/],
  ['overload','CREATE FUNCTION gridex_received_sources.other_supply_scope_effect_v1(text) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN RETURN NULL;END$$',/exact_single_function/],
 ] as const)('refuses an existing target with changed %s without repair',async(_name,mutation,pattern)=>{await bootstrap();await apply();await db!.exec(mutation);await rejectAtomically(pattern)})
 it('refuses an unknown existing target body without replacing it',async()=>{await bootstrap();await apply();await poisonBody(targets[0].signature);await rejectAtomically(/exact_function_profile/)})
 it('refuses a foreign target owner without owner changes',async()=>{await bootstrap();await apply();await db!.exec('CREATE ROLE sql19_foreign_owner;GRANT CREATE ON SCHEMA gridex_received_sources TO sql19_foreign_owner;ALTER FUNCTION '+targets[0].signature+' OWNER TO sql19_foreign_owner');await rejectAtomically(/exact_function_profile/)})
 it.each([1,2])('refuses mixed target state with %s missing helpers',async missing=>{await bootstrap();await apply();for(const t of targets.slice(0,missing))await db!.exec('DROP FUNCTION '+t.signature);await rejectAtomically(/uniform_absent_or_exact/)})
 it('refuses a non-postgres current actor and restores no extra capability',async()=>{
  await bootstrap();await db!.exec('SET ROLE service_role');await rejectAtomically(/existing_postgres_install_context/);await db!.exec('RESET ROLE')
 })
 it('accepts the specifically qualified public type epochs and preserves their actual shapes',async()=>{
  await bootstrap();await db!.exec('ALTER TABLE public.customer_contracts ALTER COLUMN starts_at TYPE timestamptz USING starts_at::timestamptz;ALTER TABLE public.customers ALTER COLUMN intake_missing_fields TYPE jsonb USING to_jsonb(intake_missing_fields)')
  const before=await catalog();await apply();expect((await catalog()).columns).toEqual(before.columns);await assertTargets()
 })
 it.each([
  ['target profile',`ALTER FUNCTION ${targets[0].signature} SET search_path=public;`,/exact_function_profile/],
  ['column','ALTER TABLE public.customer_cases ADD COLUMN sql19_injected_drift text;',/catalog_preservation/],
  ['membership','GRANT service_role TO authenticated;',/catalog_preservation/],
  ['unrelated namespace','CREATE SCHEMA sql19_injected_namespace;',/catalog_preservation/],
 ] as const)('rolls back all three creations when a post-create %s is fault-injected',async(_name,injection,pattern)=>{
  await bootstrap();const sql=readFileSync(migration,'utf8');expect(sql.split('-- SQL19_POST_CREATE_PROFILE_CHECK')).toHaveLength(2)
  await rejectAtomically(pattern,sql.replace('-- SQL19_POST_CREATE_PROFILE_CHECK',injection+'\n -- SQL19_POST_CREATE_PROFILE_CHECK'))
 })
 it('uses actual admission and source/object predicates with a finite protected canonical-output port',async()=>{
  await bootstrap();await apply();await protectedOutputPorts();await seedAdmission();expect(await admit()).toBe(assessment)
  await expect(admit({...own,point:'FOREIGN'})).rejects.toThrow('supply_own_canonical_application_and_function_required')
 })
 it.each([
  ['raw hash',"UPDATE public.ediel_messages SET raw_payload='changed'"],
  ['environment',"UPDATE gridex_received_sources.validation_assessments SET environment='production'"],
  ['syntax',`UPDATE gridex_received_sources.validation_assessments SET facts_text='{"syntaxDecision":"rejected","functionalDecision":"accepted"}'`],
  ['function',`UPDATE gridex_received_sources.validation_assessments SET facts_text='{"syntaxDecision":"accepted","functionalDecision":"rejected"}'`],
  ['assessment',`UPDATE pg_temp.sql19_application_output SET facet=jsonb_set(facet,'{assessmentId}','"00000000-0000-4000-8000-000000000099"')`],
 ] as const)('rejects detached admission %s and leaves business rows unchanged',async(_name,mutation)=>{
  await bootstrap();await apply();await protectedOutputPorts();await seedAdmission();await db!.exec(mutation);const before=await businessRows();await expect(admit()).rejects.toThrow('supply_own_canonical_application_and_function_required');expect(await businessRows()).toEqual(before)
 })
 it('keeps the actual c30e caller held after successful scoped admission when the actor is unavailable',async()=>{
  await bootstrap();await apply();await protectedOutputPorts();await seedAdmission();const before=await businessRows()
  const result=(await db!.query<{v:unknown}>('SELECT gridex_received_sources.other_supply_scope_effect_v1($1,$2,NULL,$3,ARRAY[]::uuid[],$4)v',[company,message,own,assessment])).rows[0].v
  expect(result).toEqual({applied:false,reason:'supply_source_unavailable'});expect(await businessRows()).toEqual(before)
 })
 it('retains the exact original cohort guard after finite current-source and actor outputs',async()=>{
  await bootstrap();await apply();await seedCancellationPorts();const before=await businessRows()
  expect(await applyCancellation([])).toEqual({applied:false,reason:'supply_original_cohort_changed'});expect(await businessRows()).toEqual(before)
 })
 it('refuses a changed locked original customer without selecting another supply relation',async()=>{
  await bootstrap();await apply();await seedCancellationPorts();await db!.query('UPDATE public.ediel_messages SET customer_id=$1 WHERE id=$2',[actor,original]);const before=await businessRows()
  expect(await applyCancellation()).toEqual({applied:false,reason:'z04c_locked_original_mismatch'});expect(await businessRows()).toEqual(before)
 })
 it('holds an executed start without its exact confirmation/activation instead of reversing it',async()=>{
  await bootstrap();await apply();await seedCancellationPorts();const before=await businessRows()
  expect(await applyCancellation()).toEqual({applied:false,reason:'z04c_effect_already_executed_compensation_required'});expect(await businessRows()).toEqual(before)
 })
 it('refuses a second compensation for the same executed switch',async()=>{
  await bootstrap();await apply();await seedCancellationPorts()
  await db!.query("INSERT INTO gridex_received_sources.supply_object_effect_receipts(company_id,environment,effect_text)VALUES($1,'test',$2)",[company,JSON.stringify({plan:{kind:'executed_start_compensation',executedSwitchId:switchId}})])
  const before=await businessRows();expect(await applyCancellation()).toEqual({applied:false,reason:'z04c_executed_start_compensation_already_recorded'});expect(await businessRows()).toEqual(before)
 })
 it('requires current archived ground and all exact scope bindings through the actual ground-wire helper',async()=>{
  await bootstrap();await apply();await protectedOutputPorts();expect(await wireGround()).toBe(false)
  await db!.exec('UPDATE pg_temp.sql19_ground_output SET current=true');expect(await wireGround()).toBe(false)
  await db!.query('INSERT INTO gridex_regulated_supply.origins(ground_id,company_id,artifact_id)VALUES($1,$2,$3)',[ground,company,archive])
  await db!.query('INSERT INTO gridex_regulated_supply.artifacts(id,company_id,scope)VALUES($1,$2,$3)',[archive,company,{...own,kind:'assigned_supply'}]);expect(await wireGround()).toBe(true)
  for(const key of ['point','identityAgency','customerIdentity','gridArea'])expect(await wireGround({...own,[key]:'FOREIGN'})).toBe(false)
  expect(await wireGround({...own,reason:'Z70'})).toBe(false)
  await db!.query('UPDATE gridex_regulated_supply.artifacts SET scope=$1',[{...own,kind:'production_receipt_obligation',consumptionPoint:'CONSUMPTION'}])
  expect(await wireGround({...own,reason:'Z70',consumptionPoint:'CONSUMPTION'})).toBe(true)
  expect(await wireGround({...own,reason:'Z70',consumptionPoint:'FOREIGN'})).toBe(false)
 })
})
