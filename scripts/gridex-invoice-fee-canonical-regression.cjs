const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const must = (condition, message) => {
  if (!condition) throw new Error(message);
  console.log(`✓ ${message}`);
};

const internalAction = read("app/admin/contracts/actions.ts");
const tenantAction = read(
  "app/admin/companies/[id]/tenant-platform-actions.ts",
);
const quote = read("lib/pricing/offerQuote.ts");
const publicContracts = read("lib/website/publicContracts.ts");
const migration = read(
  "supabase/migrations/20260720183000_invoice_fee_canonical_contract_completion.sql",
);
const adminUi = read("app/admin/contracts/page.tsx");
const tenantUi = read("app/admin/companies/[id]/TenantPlatformControls.tsx");
const developerPage = read("app/developers/customer-portal-api/page.tsx");
const openapi = JSON.parse(read("docs/openapi/customer-portal-v1.json"));

must(
  /invoice_fee_sek:\s*canonicalPricingCommand\.invoice_fee_sek/.test(internalAction),
  "internal contract command persists invoice_fee_sek",
);
must(
  /parseCanonicalInvoiceFee/.test(internalAction) &&
    /parseCanonicalInvoiceFee/.test(tenantAction),
  "both admin flows preserve zero and reject missing publication values",
);
must(
  /invoice_fee_sek,/.test(migration) &&
    /invoice_fee_sek=excluded\.invoice_fee_sek/.test(
      migration.replaceAll(" ", ""),
    ),
  "latest internal PostgreSQL command inserts and updates invoice_fee_sek",
);
must(
  /gridex_invoice_fee_readiness/.test(migration) &&
    /invoice_fee_missing/.test(migration) &&
    /invoice_fee_conflict/.test(migration) &&
    /invoice_fee_ambiguous/.test(migration),
  "publication readiness has all invoice fee blocker codes",
);
must(
  /gridex_backfill_invoice_fees/.test(migration) &&
    /contract_invoice_fee_remediation_tasks/.test(migration) &&
    /gridex_publish_contract_version/.test(migration),
  "migration contains idempotent version-safe remediation",
);
must(
  /gridex_contract_offer_company_resolution/.test(migration) &&
    /tenant_context_missing/.test(migration) &&
    /tenant_context_conflict/.test(migration) &&
    /alter column company_id drop not null/.test(migration),
  "legacy offers without company_id are platform-remediated without guessing a tenant",
);
must(
  /when company_id is null then false/.test(migration) &&
    /gridex_user_is_platform_admin/.test(migration),
  "unassigned remediation tasks are visible only to platform admins",
);
must(
  /assessCanonicalInvoiceFee/.test(publicContracts) &&
    /pricing_readiness/.test(publicContracts),
  "public listing and diagnostics validate canonical invoice fee",
);
must(
  /assessCanonicalInvoiceFee/.test(quote) &&
    /component_code/.test(quote) &&
    /amount_inc_vat/.test(quote),
  "quote calculates from canonical snapshot and returns documented lines",
);
must(
  /Fakturaavgift, kr per faktura/.test(adminUi) &&
    /Fakturaavgift, kr per faktura/.test(tenantUi),
  "both admin UIs explain the invoice fee unit",
);
must(
  /Avgiften används alltid i offert, avtal och fakturering/.test(adminUi) &&
    /Avgiften används alltid i offert, avtal och fakturering/.test(tenantUi),
  "admin UIs separate calculation from card visibility",
);
must(
  openapi.info.version === "2026-07-20.2",
  "OpenAPI contract version is 2026-07-20.2",
);
must(
  openapi.paths["/api/v1/website/quote"].post.requestBody.content[
    "application/json"
  ].schema.$ref === "#/components/schemas/WebsiteQuoteRequest",
  "quote request has a strict OpenAPI schema",
);
must(
  openapi.paths["/api/v1/website/quote"].post.responses["200"].content[
    "application/json"
  ].schema.$ref === "#/components/schemas/WebsiteQuoteResponse",
  "quote response has a full OpenAPI schema",
);
must(
  /GET \/public-contracts.*presentations-/s.test(developerPage) &&
    /POST \/api\/v1\/website\/quote/.test(developerPage),
  "developer guide documents public-contracts then quote flow",
);

console.log("Canonical invoice fee regression passed.");
