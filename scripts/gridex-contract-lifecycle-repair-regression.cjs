const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const migration = read("supabase/migrations/20260721123000_contract_lifecycle_unpublish_delete_backfill.sql");
const pgcryptoHotfix = read("supabase/migrations/20260721130000_contract_lifecycle_pgcrypto_search_path_hotfix.sql");
const validToHotfix = read("supabase/migrations/20260721131500_contract_lifecycle_valid_to_qualification_hotfix.sql");
const actions = read("app/admin/contracts/actions.ts");
const page = read("app/admin/contracts/page.tsx");
const tenantActions = read("app/admin/companies/[id]/tenant-platform-actions.ts");
const tenantControls = read("app/admin/companies/[id]/TenantPlatformControls.tsx");
const types = read("lib/customer-contracts/types.ts");
const dbTest = read("scripts/gridex-contract-db-lifecycle-test.sql");
const lifecycleErrors = read("lib/contracts/lifecycleErrors.ts");
const graphMigration = read("supabase/migrations/20260721170000_contract_graph_api_revision_hardening.sql");
const adminRepository = read("lib/contracts/adminRepository.ts");
const adminActions = read("lib/contracts/adminActions.ts");
const deleteControl = read("components/admin/contracts/ContractDeleteControl.tsx");
const channelPublication = read("lib/contracts/channelPublication.ts");

const migrationsDirectory = path.join(root, "supabase/migrations");
const migrationFiles = fs
  .readdirSync(migrationsDirectory)
  .filter((file) => file.endsWith(".sql"))
  .sort((left, right) => left.localeCompare(right));

function normalizeFunctionSignature(signature) {
  return signature
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ",")
    .replace(/\s*=\s*/g, "=")
    .trim()
    .toLowerCase();
}

function finalFunctionDefinitions() {
  const definitions = new Map();
  const pattern = /create\s+or\s+replace\s+function\s+public\.([a-zA-Z0-9_]+)\s*\((.*?)\).*?\bas\s+(\$[A-Za-z0-9_]*\$)(.*?)\3\s*;/gis;
  for (const file of migrationFiles) {
    const source = read(`supabase/migrations/${file}`);
    for (const match of source.matchAll(pattern)) {
      const signature = normalizeFunctionSignature(match[2]);
      definitions.set(`${match[1].toLowerCase()}(${signature})`, {
        name: match[1], signature, file, definition: match[0],
      });
    }
  }
  return definitions;
}

const activeFunctions = finalFunctionDefinitions();
function activeFunction(name, signature) {
  return activeFunctions.get(`${name.toLowerCase()}(${normalizeFunctionSignature(signature)})`);
}

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

includesAll(validToHotfix, [
  "gridex_sync_internal_offer_to_canonical(uuid)",
  "coalesce(ch.valid_to,now())",
  "coalesce(old_channel.valid_to,now())",
  "coalesce(old_publication_version.valid_to,now())",
  "coalesce(pv.valid_to,now())",
  "coalesce(ta.valid_to,current_date)",
  "gridex_backfill_contract_lifecycle(null)",
], "qualified valid_to lifecycle hotfix");
check(!validToHotfix.includes("coalesce(valid_to,now()),updated_at=now()\'\n  \'set status"), "hotfix replacements are explicit");

const activePublish = activeFunction(
  "gridex_publish_contract_channel",
  "p_company_id uuid,p_offer_id uuid,p_channel text,p_actor_user_id uuid",
);
const activeArchive = activeFunction(
  "gridex_archive_contract_product",
  "p_company_id uuid,p_offer_id uuid,p_actor_user_id uuid",
);
check(Boolean(activePublish), "active publish RPC definition found");
check(Boolean(activeArchive), "active archive RPC definition found");
if (activePublish) {
  check(activePublish.file === "20260731152000_public_contract_publication_graph_repair.sql",
    `publish RPC source of truth is repair migration: ${activePublish.file}`);
  includesAll(activePublish.definition, ["old_channel.valid_to", "old_publication_version.valid_to"],
    "active publish RPC qualifies valid_to");
  check(!/coalesce\s*\(\s*valid_to\b/i.test(activePublish.definition),
    "active publish RPC has no unqualified valid_to");
}
if (activeArchive) {
  check(activeArchive.file === "20260727160000_contract_valid_to_active_rpc_repair.sql",
    `archive RPC source of truth is repair migration: ${activeArchive.file}`);
  includesAll(activeArchive.definition, ["ch.valid_to", "pv.valid_to", "ta.valid_to", "contract_already_archived"],
    "active archive RPC qualifies valid_to and stays idempotent");
  check(!/coalesce\s*\(\s*valid_to\b/i.test(activeArchive.definition),
    "active archive RPC has no unqualified valid_to");
}
for (const definition of activeFunctions.values()) {
  check(!/coalesce\s*\(\s*valid_to\b/i.test(definition.definition),
    `final active RPC has no unqualified valid_to: ${definition.name} in ${definition.file}`);
}

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
  "publishContractChannel",
  "unpublishContractChannel",
], "admin actions validate domain results");
includesAll(channelPublication, [
  "gridex_publish_contract_channel",
  "gridex_unpublish_contract_channel",
  "rpc.ok !== true",
  "contract_channel_post_commit_verification_failed",
  "contract_channel_unpublish_verification_failed",
], "canonical channel service rejects false success and verifies committed state");
includesAll(page, [
  "updateTenantContractChannelAction",
  'channel: "internal"',
  'channel: "website"',
  '<option value="active">Aktiv</option>',
  '<option value="paused">Pausad</option>',
  '<option value="ended">Avslutad</option>',
  "website_publication_allowed",
  "removable_system_dependencies",
], "admin UI supports canonical channel-by-channel lifecycle");
includesAll(tenantControls, [
  "listTenantContractProducts",
  "previewContractDelete",
  "ContractDeleteControl",
  "edit_offer=",
  "deletion_preview",
  "contract_view=",
], "tenant card uses the shared canonical repository, preview and route");
includesAll(adminRepository, [
  "gridex_preview_delete_unused_contract_v2",
  "listTenantContractProducts",
], "shared contract admin repository");
includesAll(adminActions, [
  "previewContractDeleteAction",
  "deleteContractPermanentlyAction",
  "archiveContractAction",
], "shared actor-bound contract actions");
includesAll(deleteControl, [
  "Radera permanent",
  "Bekräfta permanent radering",
  "expected_preview_token",
  "Arkivera och dölj",
], "preview-driven delete confirmation control");
check(!tenantControls.includes("&edit=${offer.source_contract_offer_id}"), "legacy edit query parameter removed");
includesAll(tenantActions, [
  "assertLifecycleResult",
  "contractLifecycleError",
  "deleteContractProduct",
  "archiveContractProduct",
], "tenant actions reject false success and delegate to shared canonical mutations");
includesAll(lifecycleErrors, [
  "reason_codes",
  "PUBLICATION_VERSION_LINK_MISMATCH",
  "contract_public_offer_still_referenced",
], "central lifecycle reason map");
includesAll(graphMigration, [
  "gridex_resolve_contract_lifecycle_graph",
  "where legacy_public_contract_offer_id=any(v_public_offer_ids)",
  "contract_public_offer_still_referenced",
], "forward-only graph/FK repair migration");

const repairFunctionStart = graphMigration.indexOf("create or replace function public.gridex_repair_contract_publication_links");
const repairFunctionEnd = graphMigration.indexOf("create or replace function public.gridex_assert_no_public_offer_fk_references", repairFunctionStart);
const repairFunction = graphMigration.slice(repairFunctionStart, repairFunctionEnd);
includesAll(repairFunction, [
  "perform set_config('gridex.version_transition','on',true)",
  "perform set_config('gridex.publication_link_repair','on',true)",
], "locked compatibility repair uses the approved lifecycle transition");

const forwardSyncStart = graphMigration.indexOf("create or replace function public.gridex_public_contract_offer_forward_link_sync");
const forwardSyncEnd = graphMigration.indexOf("drop trigger if exists trg_public_contract_offer_forward_link_sync", forwardSyncStart);
const forwardSync = graphMigration.slice(forwardSyncStart, forwardSyncEnd);
includesAll(forwardSync, [
  "perform set_config('gridex.version_transition','on',true)",
  "perform set_config('gridex.publication_link_repair','on',true)",
], "forward link synchronization can update locked compatibility pointers");

const safeRepairStart = graphMigration.indexOf("-- Safe idempotent repair");
const safeRepairEnd = graphMigration.indexOf("create or replace view public.contract_publication_graph_integrity_v", safeRepairStart);
const safeRepair = graphMigration.slice(safeRepairStart, safeRepairEnd);
includesAll(safeRepair, [
  "perform set_config('gridex.version_transition','on',true)",
  "perform set_config('gridex.publication_link_repair','on',true)",
], "migration data repair can update locked compatibility pointers");
includesAll(types, [
  "can_delete?: boolean",
  "business_blockers?: Record<string, number>",
  "removable_system_dependencies?: Record<string, number>",
  "internal_channel_status:",
  "website_channel_status:",
  "api_channel_status:",
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