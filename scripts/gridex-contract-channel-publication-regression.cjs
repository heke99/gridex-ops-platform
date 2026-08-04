/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
let failed = false;

function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

function check(condition, message) {
  if (condition) console.log(`PASS ${message}`);
  else {
    failed = true;
    console.error(`FAIL ${message}`);
  }
}

const migration = read(
  "supabase/migrations/20260728190000_contract_channel_permission_publication_completion.sql",
);
const adminActions = read("app/admin/contracts/actions.ts");
const adminPage = read("app/admin/contracts/page.tsx");
const twoStepMigration = read("supabase/migrations/20260804093500_contract_publication_two_step_invoice_fee_repair.sql");
const companyControls = read(
  "app/admin/companies/[id]/TenantPlatformControls.tsx",
);
const publicationService = read("lib/contracts/channelPublication.ts");
const mapper = read("lib/customer-contracts/db.ts");
const apiRoute = read("app/api/v1/contracts/route.ts");
const websiteRoute = read(
  "app/api/v1/website/public-contracts/route.ts",
);
const dto = read("lib/external-contracts/publicationDto.ts");
const publicContracts = read("lib/website/publicContracts.ts");
const openapi = JSON.parse(
  read("docs/openapi/website-integration-v1.json"),
);

for (const column of [
  "contract_offer_id",
  "company_id",
  "assignment_id",
  "lifecycle_status",
  "offer_status",
  "assignment_status",
  "internal_sales_allowed",
  "website_publication_allowed",
  "api_publication_allowed",
  "internal_channel_status",
  "website_channel_status",
  "api_channel_status",
  "internal_channel_valid_from",
  "internal_channel_valid_to",
  "website_channel_valid_from",
  "website_channel_valid_to",
  "api_channel_valid_from",
  "api_channel_valid_to",
  "active_publication_version_count",
  "internally_sellable_now",
  "website_available_now",
  "api_available_now",
]) {
  check(
    migration.includes(column),
    `canonical read model exposes ${column}`,
  );
}

check(
  /gridex_set_contract_channel_permission[\s\S]*contract_channel_permission_granted[\s\S]*contract_channel_permission_revoked/.test(
    migration,
  ),
  "grant and revoke are explicit, idempotent audited operations",
);
check(
  /gridex_assert_contract_channel_permission[\s\S]*contract_channel_permission_missing/.test(
    migration,
  ),
  "publish RPC fails closed on missing channel grant",
);
check(
  migration.includes("'contracts.publish.'||v_channel"),
  "publish RPC enforces the granular channel permission",
);
check(
  (
    migration.match(
      /website_publication_allowed=website_publication_allowed or v_channel='website'/g,
    ) ?? []
  ).length === 1 &&
    /update public\.tenant_contract_assignments assignment[\s\S]*set status='active',valid_from=o\.valid_from/.test(
      migration,
    ),
  "forward migration removes publish-time self-grant",
);
check(
  /contract_publication_versions_one_published_per_publication_uidx/.test(
    migration,
  ) && /pg_advisory_xact_lock/.test(migration),
  "publication is protected by transaction lock and one-active-version index",
);
check(
  /gridex_validate_contract_channel_readiness/.test(migration) &&
    /api_contracts\.read/.test(migration) &&
    /external_access_ready/.test(migration),
  "channel readiness separates API publication from external API access",
);
check(
  /Europe\/Stockholm/.test(migration) &&
    !/new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)/.test(publicContracts),
  "calendar validity is owned by the database in Europe/Stockholm",
);
check(
  /contract_publication_version_created/.test(migration) &&
    /contract_channel_published/.test(migration) &&
    /contract_channel_unpublished/.test(migration) &&
    /contract_channel_publish_started/.test(publicationService) &&
    /contract_channel_publish_failed/.test(publicationService),
  "publication audit chain contains start, version, success, failure and unpublish",
);

check(
  /requiredBoolean\([\s\S]*?"website_publication_allowed"[\s\S]*?\)/.test(
    mapper,
  ) &&
    /requiredBoolean\([\s\S]*?"api_publication_allowed"[\s\S]*?\)/.test(
      mapper,
    ) &&
    !/Boolean\(row\.website_publication_allowed\)/.test(mapper),
  "read model throws on missing mandatory booleans",
);
check(
  /publishContractChannelAction/.test(companyControls) &&
    /publishContractChannelAction/.test(adminActions) &&
    /publishContractChannel\(/.test(publicationService),
  "all admin surfaces route channel publication through the canonical action and service",
);
check(
  /Kontrollera readiness och gör internt/.test(adminPage) &&
    /Publicera på hemsidan/.test(adminPage) &&
    !/Publicera i API/.test(adminPage) &&
    !/Ge hemsidebehörighet/.test(adminPage) &&
    /Publicera på hemsidan/.test(companyControls),
  "admin publication UX exposes only internal readiness and website publication",
);
check(
  /The publish RPC is the canonical readiness gate/.test(publicationService) &&
    /gridex_publish_contract_channel/.test(publicationService) &&
    /gridex_canonicalize_publication_invoice_fee_v1/.test(twoStepMigration) &&
    /explicit 0 SEK/.test(twoStepMigration),
  "first website publication materializes its graph and canonical invoice fee atomically",
);

check(
  /mapContractPublicationToPublicDto/.test(apiRoute) &&
    /mapContractPublicationToPublicDto/.test(websiteRoute),
  "website and API use the shared external DTO mapper",
);
check(
  /API_CONTRACT_RESPONSE_SCHEMA_VERSION\s*=\s*WEBSITE_INTEGRATION_CONTRACT_VERSION/.test(dto) &&
    read("lib/integrations/websiteIntegrationContract.ts").includes(
      `WEBSITE_INTEGRATION_CONTRACT_VERSION = '${openapi.info.version}'`,
    ) &&
    /X-Gridex-Contract-Version/.test(apiRoute) &&
    /contract_schema_version/.test(apiRoute),
  "canonical contract version drives DTO, header and response metadata",
);
check(
  !/company_id|contract_product_version_id/.test(
    JSON.stringify(
      Object.keys(
        openapi.components.schemas.ApiPublicContract.properties,
      ),
    ),
  ) &&
    openapi.components.schemas.ApiPublicContract.additionalProperties ===
      false,
  "OpenAPI API DTO has a strict public top-level allowlist",
);

const contractsOperation = openapi.paths["/api/v1/contracts"].get;
check(
  JSON.stringify(contractsOperation["x-required-scopes"]) ===
    JSON.stringify(["api_contracts.read"]),
  "OpenAPI declares api_contracts.read",
);
for (const status of ["401", "403", "410", "423", "429", "500"]) {
  check(
    Boolean(contractsOperation.responses[status]),
    `OpenAPI documents ${status} for GET /api/v1/contracts`,
  );
}

if (failed) process.exit(1);
console.log("Gridex contract channel publication regression passed.");
