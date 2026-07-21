const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const migration = read("supabase/migrations/20260721123000_contract_lifecycle_unpublish_delete_backfill.sql");
const pgcryptoHotfix = read("supabase/migrations/20260721130000_contract_lifecycle_pgcrypto_search_path_hotfix.sql");
const actions = read("app/admin/contracts/actions.ts");
const page = read("app/admin/contracts/page.tsx");
const tenantActions = read("app/admin/companies/[id]/tenant-platform-actions.ts");
const tenantControls = read("app/admin/companies/[id]/TenantPlatformControls.tsx");
const types = read("lib/customer-contracts/types.ts");
const dbTest = read("scripts/gridex-contract-db-lifecycle-test.sql");

const failures = [];
let checks = 0;
const check = (condition, label) => {
  checks += 1;
  if (!condition) failures.push(label);
};
const includesAll = (source, terms, label) => {
  for (const term of terms) check(source.includes(term), `${label}: ${term}`);
};

includesAll(migration, [
  "gridex.version_transition",
  "immutable_version_content_changed",
  "create or replace function public.gridex_unpublish_contract_channel",
  "create or replace function public.gridex_archive_contract_product",
  "create or replace function public.gridex_publish_contract_channel",
], "controlled lifecycle transitions");

const unpublishStart = migration.indexOf("create or replace function public.gridex_unpublish_contract_channel");
const unpublishEnd = migration.indexOf("create or replace function public.gridex_pause_contract_channels", unpublishStart);
const unpublish = migration.slice(unpublishStart, unpublishEnd);
check(unpublish.includes("perform set_config('gridex.version_transition','on',true)"), "unpublish activates lifecycle transition");
check(!unpublish.includes("website_publication_allowed=false"), "unpublish preserves website permission");
check(!unpublish.includes("internal_sales_allowed=false"), "unpublish preserves internal permission");
includesAll(unpublish, [
  "'changed',false",
  "'already_unpublished',true",
  "'affected_channels'",
  "'affected_publication_versions'",
  "'affected_public_offers'",
], "truthful unpublish result");

includesAll(migration, [
  "gridex_contract_business_usage_counts",
  "gridex_contract_system_dependency_counts",
  "business_blockers",
  "removable_system_dependencies",
  "shared_or_unsafe_dependencies",
  "reason_codes",
  "'can_delete'",
], "business usage is separated from removable system data");
check(!migration.includes("locked_product_versions>0 or v_locked_publication_versions>0"), "locked technical versions no longer block deletion by themselves");

includesAll(pgcryptoHotfix, [
  "gridex_sync_internal_offer_to_canonical(uuid)",
  "gridex_publish_contract_channel(uuid,uuid,text,uuid)",
  "gridex_backfill_contract_lifecycle(uuid)",
  "pg_extension",
  "alter function",
  "search_path = public",
  "gridex_backfill_contract_lifecycle(null)",
], "pgcrypto runtime search path hotfix");

includesAll(migration, [
  "contract_lifecycle_backfill_issues",
  "gridex_backfill_contract_lifecycle",
  "gridex_verify_contract_lifecycle_backfill",
  "select public.gridex_backfill_contract_lifecycle(null)",
  "PUBLIC_OFFER_SOURCE_AMBIGUOUS",
  "INCOMPLETE_CANONICAL_MAPPING",
], "idempotent canonical backfill and verification");
includesAll(migration, [
  "internal_channel_status",
  "website_channel_status",
  "api_channel_status",
  "active_publication_version_count",
], "canonical view exposes permission and runtime channel state");

includesAll(actions, [
  "unpublishContractChannelAction",
  "ContractLifecycleRpcResult",
  "contractLifecycleFailure",
  "result.changed === false",
], "admin actions validate domain results");
includesAll(page, [
  "Avpublicera från hemsida",
  "Avpublicera från API",
  "Pausa intern försäljning",
  "website_publication_allowed",
  "removable_system_dependencies",
], "admin UI supports channel-by-channel lifecycle");
includesAll(tenantControls, [
  "canonical_internal_contract_offers_v",
  "edit_offer=",
  "disabled={!canDelete}",
  "deletion_preview",
], "tenant card uses same canonical preview and route");
check(!tenantControls.includes("&edit=${offer.source_contract_offer_id}"), "legacy edit query parameter removed");
includesAll(tenantActions, [
  "assertLifecycleResult",
  "result.changed === false",
  "reason_codes",
], "tenant actions reject false success");
includesAll(types, [
  "can_delete?: boolean",
  "business_blockers?: Record<string, number>",
  "removable_system_dependencies?: Record<string, number>",
  "website_channel_status?",
], "shared TypeScript contract includes lifecycle response");
includesAll(dbTest, [
  "gridex_unpublish_contract_channel",
  "gridex_delete_unused_contract",
], "database lifecycle roundtrip covers unpublish and delete");

if (failures.length) {
  console.error(`Contract lifecycle repair regression failed (${failures.length}/${checks}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`Contract lifecycle repair regression passed (${checks} checks).`);
