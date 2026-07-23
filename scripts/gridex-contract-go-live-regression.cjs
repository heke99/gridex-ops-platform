const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const migration = read("supabase/migrations/20260720233000_contract_product_lifecycle_go_live_completion.sql");
const actions = read("app/admin/contracts/actions.ts");
const tenantActions = read("app/admin/companies/[id]/tenant-platform-actions.ts");
const tenantControls = read("app/admin/companies/[id]/TenantPlatformControls.tsx");
const stagingRoundtrip = read("scripts/gridex-contract-staging-roundtrip.mjs");
const dbLifecycleTest = read("scripts/gridex-contract-db-lifecycle-test.sql");
const liveSchemaCheck = read("scripts/gridex-contract-live-schema-check.cjs");
const page = read("app/admin/contracts/page.tsx");
const form = read("components/admin/contracts/ContractOfferAdminForm.tsx");
const schema = read("lib/contracts/adminContractSchema.ts");
const db = read("lib/customer-contracts/db.ts");
const runtime = read("lib/website/customerApplications.ts");
const openapi = JSON.parse(read("docs/openapi/customer-portal-v1.json"));

const failures = [];
let checks = 0;
function check(condition, label) {
  checks += 1;
  if (!condition) failures.push(label);
}
function includesAll(source, terms, label) {
  for (const term of terms) check(source.includes(term), `${label}: ${term}`);
}

includesAll(migration, [
  "version_series_id",
  "product_code='contract:'||o.version_series_id::text",
  "gridex_sync_internal_offer_to_canonical",
  "gridex_validate_contract_readiness",
  "gridex_publish_internal_contract_version",
  "gridex_publish_contract_channel",
], "single canonical product series and channels");

includesAll(migration, [
  "lifecycle_status='superseded'",
  "created_new_version",
  "locked_at",
  "contract.version.created",
], "immutable versioning");

includesAll(migration, [
  "contract_offers_one_open_draft_per_series_uidx",
  "contract_series_open_draft_exists",
  "currently published predecessor stays sellable",
  "contract_draft_save_requires_draft_or_ready",
  "gridex_publish_internal_contract_version",
  "contract_pricing_identity_changed_during_publish",
  "coalesce(p_pricing_snapshot,'{}'::jsonb)-'lifecycle_status'",
  "coalesce(o.commercial_snapshot,'{}'::jsonb)-'lifecycle_status'",
], "draft successor stays isolated until explicit identity-preserving publication");

includesAll(migration, [
  "gridex_pause_contract_channels",
  "gridex_archive_contract_product",
  "tenant_contract_channels",
  "contract_publications",
  "public_contract_offers",
], "canonical pause/archive propagation");
includesAll(migration, [
  "archived_contract_requires_new_version",
  "series_offer.version_series_id=o.version_series_id",
], "archive is series-wide and intentionally irreversible");

includesAll(migration, [
  "gridex_preview_delete_unused_contract",
  "gridex_delete_unused_contract",
  "gridex_cleanup_unused_contract_drafts",
  "unused_contract_delete_blocked",
  "successor_offers",
  "contract_product_version_id=o.contract_product_version_id",
  "locked_publication_versions",
  "contract_price_snapshots",
  "customer_invoices",
  "billing_underlay_items",
  "legacy_public_contract_offer_id=null",
  "contract_publication_version_id=null",
], "safe exact-version dependency-aware deletion");
check(
  migration.indexOf("delete from public.public_contract_offers", migration.indexOf("create or replace function public.gridex_delete_unused_contract")) <
    migration.indexOf("delete from public.contract_publication_versions", migration.indexOf("create or replace function public.gridex_delete_unused_contract")),
  "delete order breaks circular public-offer/publication FK before version deletion",
);

includesAll(migration, [
  "gridex_enforce_contract_availability_and_capacity",
  "pg_advisory_xact_lock",
  "contract_capacity_reached",
  "contract_channel_not_available",
], "atomic validity and customer capacity");

includesAll(migration, [
  "preventing a sales outage",
  "old_channel.channel=v_channel",
  "ch.channel='internal'",
  "predecessor.contract_product_version_id",
  "contract_version_not_locked",
], "channel-specific zero-downtime version handover");

includesAll(migration, [
  "tenant_go_live_not_ready",
  "fixed_price_missing",
  "price_areas_missing",
  "duplicate_price_areas",
  "invalid_discount_configuration",
  "invalid_discount_percent",
  "negative_contract_fee_not_allowed",
], "shared publication and direct-RPC validation gate");

includesAll(migration, [
  "contracts.create",
  "contracts.edit_draft",
  "contracts.create_version",
  "contracts.publish",
  "contracts.pause",
  "contracts.archive",
  "contracts.delete_unused",
  "pricing.write",
  "pricing.publish",
], "fine-grained RBAC");

includesAll(schema, [
  "lifecycle_status",
  "discount_months",
  "automatic_renewal_term_months",
  "power_of_attorney_mode",
  "parseStructuredOptionalFees",
  "Prisandelarna måste tillsammans bli exakt 100 procent",
], "shared form schema");

includesAll(form, [
  "Skapa canonical avtalsutkast",
  "editableLifecycle",
  "Redo för publiceringskontroll",
  "Prisversion",
  "readOnly",
  "discount_months",
  "automatic_renewal_term_months",
  "power_of_attorney_mode",
  "optional_fee_lines",
  "max_customers",
], "complete admin form");

includesAll(page, [
  "Visa arkiverade",
  "Radera oanvänt utkast permanent",
  "Publicera på hemsida",
  "Publicera i API",
  "Pausa alla aktiva kanaler för denna version",
  "deletion_preview",
  "Kundförhandsgranskning och versionsskillnad",
  "contractVersionDiff",
  "publishContractVersionAction",
  "Arkivering är irreversibel",
], "explicit lifecycle, preview and version comparison UX");

includesAll(actions, [
  "requireContractPermissionAction",
  "gridex_publish_internal_contract_version",
  "gridex_publish_contract_channel",
  "gridex_cleanup_unused_contract_drafts",
  "revalidateContractSurfaces",
  "public-contracts:",
  "quote-contracts:",
], "server permission and cache contract");
check(!/from\("tenant_contract_channels"\)[\s\S]{0,120}\.upsert/.test(actions), "channel UI cannot bypass canonical publication RPC");
check(!form.includes('<option value="published">'), "form cannot publish by changing a status field");
check(schema.includes("CONTRACT_EDITABLE_LIFECYCLE_STATUSES"), "shared schema only accepts draft/ready from editable form");
check(actions.includes("/api/v1/website/public-contracts"), "contract mutations invalidate website public-contract surface");
check(migration.includes("recommended_action','archive'"), "blocked permanent deletion explicitly recommends archive");
check(!migration.includes("fallback','archive'"), "permanent deletion never silently archives");

includesAll(tenantActions, [
  "gridex_publish_contract_channel",
  "gridex_unpublish_contract_channel",
  "gridex_remove_internal_contract_offer",
  "source_contract_offer_id",
  "requireContractPermissionAction",
], "company page uses canonical channel commands");
check(!tenantActions.includes("normalizeContractPricing"), "company page cannot create a parallel price model");
check(!tenantActions.includes("gridex_publish_contract_version"), "company page cannot create a parallel public product");
includesAll(tenantControls, [
  "Publicera canonical avtal på hemsidan",
  "source_contract_offer_id",
  "Aktivera webbkanal för vald version",
  "Avpublicera endast webbkanalen",
], "company page canonical channel UX");

includesAll(migration, [
  "controlled canonical backfill",
  "perform set_config('gridex.public_offer_write','on',true);",
  "Legacy-to-canonical attachment updates published compatibility rows",
], "published legacy backfills use controlled immutability bypass");

includesAll(migration, [
  "when 'spot' then 'variable_monthly'",
  "when 'variable_spot' then 'variable_monthly'",
  "when 'hourly_spot' then 'variable_hourly'",
  "when 'variable_quarterly' then 'variable_hourly'",
], "legacy public contract types map to canonical internal types");

includesAll(migration, [
  "check(vat_rate is null or (vat_rate>=0 and vat_rate<=1))",
  "if v_vat_rate>1 and v_vat_rate<=100 then v_vat_rate:=v_vat_rate/100; end if;",
  "when r.vat_rate>1 and r.vat_rate<=100 then r.vat_rate/100",
  "alter column vat_rate set default 0.25",
  "legacy_public_offer_vat_rate_invalid",
], "VAT is normalized from admin percent input to canonical fractional storage");

includesAll(migration, [
  "drop constraint if exists contract_offers_default_binding_months_check",
  "drop constraint if exists contract_offers_default_notice_months_check",
  "contract_offers_months_nonnegative_check",
  "default_binding_months>=0",
  "default_notice_months>=0",
], "binding and notice month schema drift is normalized to nonnegative canonical semantics");

includesAll(migration, [
  "automatic_renewal,automatic_renewal_term_months",
  "legacy_public_offer_requires_canonical_republication",
  "r.metadata->>'automatic_renewal_term_months'",
  "nullif(r.binding_months,0)",
], "legacy automatic renewal is only retained when a positive renewal term can be resolved");

includesAll(migration, [
  "gridex_guard_canonical_public_offer",
  "if new.source_contract_offer_id is null",
  "canonical_contract_source_required",
  "canonical_contract_publication_required",
  "legacy_public_offer_requires_canonical_republication",
  "gridex_unpublish_contract_channel",
  "v_version_number",
  "A previous loop iteration may already have created the canonical source",
], "legacy public offers cannot bypass canonical source");


includesAll(stagingRoundtrip, [
  "gridex_upsert_internal_contract_offer",
  "canonical_internal_contract_offers_v",
  "gridex_delete_unused_contract",
  "GRIDEX_CONTRACT_TEST_CONFIRM_STAGING",
], "staging database field roundtrip");
includesAll(dbLifecycleTest, [
  "begin;",
  "gridex_publish_internal_contract_version",
  "gridex_publish_contract_channel",
  "gridex_unpublish_contract_channel",
  "predecessor_was_replaced_before_successor_publication",
  "gridex_delete_unused_contract",
  "predecessor_website_channel_was_closed_too_early",
  "predecessor_not_superseded_after_website_handover",
  "successor_public_offer_not_active_after_handover",
  "archive_did_not_close_entire_series",
  "rollback;",
], "transactional full database lifecycle roundtrip");

includesAll(liveSchemaCheck, [
  "gridex_verify_contract_schema_alignment",
  "SUPABASE_SERVICE_ROLE_KEY",
], "live schema drift gate");

check(db.includes('.not("lifecycle_status", "in", "(archived,superseded)")'), "archived/superseded hidden by default");
check(runtime.includes('code: "offer_reference_mismatch"'), "canonical API mismatch code");
check(runtime.includes('legacy_code: "offer_selector_mismatch"'), "legacy error code retained only as compatibility detail");
check(openapi.info.version === "2026-07-23.1", "OpenAPI current version");
check(JSON.stringify(openapi).includes("offer_reference_mismatch"), "OpenAPI documents canonical mismatch code");

includesAll(migration, [
  "gridex_verify_contract_schema_alignment",
  "canonical_internal_contract_offers_v",
  "readiness",
  "deletion_preview",
  "currently_sellable",
], "release drift and round-trip surfaces");

if (failures.length) {
  console.error(`Contract go-live regression failed (${failures.length}/${checks}).`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`Contract go-live regression passed (${checks} controls).`);
