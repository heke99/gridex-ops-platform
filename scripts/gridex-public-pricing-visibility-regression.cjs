const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const must = (condition, message) => {
  if (!condition) throw new Error(message);
  console.log(`✓ ${message}`);
};

const pricing = read("lib/pricing/contractPricingVersioning.ts");
const api = read("lib/website/publicContracts.ts");
const ui = read("app/admin/contracts/page.tsx");
const actions = read("app/admin/contracts/actions.ts");
const migration = read(
  "supabase/migrations/20260718001000_public_pricing_component_website_visibility.sql",
);
const docs = read("docs/ops-api-customer-intake-facility.md");
const openapi = JSON.parse(read("docs/openapi/customer-portal-v1.json"));

must(/schema_version:\s*5/.test(pricing), "pricing snapshot schema is v5");
must(
  /website_card_visible/.test(pricing),
  "price components carry website visibility",
);
must(
  /quote_breakdown:\s*true/.test(pricing),
  "hidden card fees remain in quote breakdown",
);
must(
  /contract_document:\s*true/.test(pricing),
  "hidden card fees remain in contract documents",
);
must(
  /show_invoice_fee_on_website/.test(ui),
  "admin can toggle invoice fee visibility",
);
must(
  /show_variable_fee_on_website/.test(ui),
  "admin can toggle variable fee visibility",
);
must(
  /websiteCardVisibility/.test(actions),
  "admin visibility is persisted in the versioned snapshot",
);
must(
  /customer_types:\s*customerTypes/.test(api),
  "API expands customer_type both",
);
must(/visibleComponents/.test(api), "API filters public pricing components");
must(
  /schemaVersion\s*<\s*3/.test(api),
  "legacy snapshots retain historic visibility",
);
must(
  /website_card_visible boolean not null default true/.test(migration),
  "database has canonical visibility column",
);
must(
  /price_components_sync_website_visibility/.test(migration),
  "database synchronizes metadata and column",
);
must(
  /Versionslåst synlighet per avgift/.test(docs),
  "integration guide documents visibility semantics",
);
must(
  openapi.components.schemas.PublicContractOffer.properties.customer_types,
  "OpenAPI documents expanded customer types",
);
must(
  openapi.components.schemas.PublicPricingVisibility,
  "OpenAPI documents pricing visibility",
);

console.log("Public pricing visibility regression passed.");
