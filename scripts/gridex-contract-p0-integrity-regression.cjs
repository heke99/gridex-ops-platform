/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const failures = [];
let checks = 0;

function check(condition, label) {
  checks += 1;
  if (!condition) failures.push(label);
}

function includesAll(source, values, label) {
  for (const value of values) {
    check(source.includes(value), `${label}: ${value}`);
  }
}

const page = read("app/teckna-avtal/page.tsx");
const actions = read("app/teckna-avtal/actions.ts");
const intake = read("lib/external-contracts/intake.ts");
const legalRoute = read("app/api/v1/website/legal-bundle/route.ts");
const publicContracts = read("lib/website/publicContracts.ts");
const portalBundle = read("app/api/v1/customer/portal-bundle/route.ts");
const adminActions = read("app/admin/contracts/actions.ts");
const adminPage = read("app/admin/contracts/page.tsx");
const repair = read(
  "supabase/migrations/20260727162000_contract_slug_version_integrity_repair.sql",
);
const copyMigration = read(
  "supabase/migrations/20260727163000_contract_offer_copy_command.sql",
);
const exportCenter = read("lib/billing/exportCenter.ts");
const invoiceExportMigration = read(
  "supabase/migrations/20260727164000_canonical_invoice_export_runtime_completion.sql",
);
const websiteQuotes = read("lib/pricing/websiteQuotes.ts");
const customerContractDb = read("lib/customer-contracts/db.ts");
const quoteEventMigration = read(
  "supabase/migrations/20260727165000_quote_and_customer_contract_event_integrity.sql",
);
const websiteApplications = read("lib/website/customerApplications.ts");
const atomicApplicationMigration = read(
  "supabase/migrations/20260727166000_atomic_quote_application_onboarding_commit.sql",
);
const contractStateMigration = read(
  "supabase/migrations/20260727167000_customer_contract_state_machine_and_active_invariant.sql",
);
const customerProfileActions = read(
  "app/admin/customers/[id]/profile-actions.ts",
);
const customerActions = read("app/admin/customers/[id]/actions.ts");
const manifest = JSON.parse(
  read("scripts/migration-history-manifest.json"),
);

includesAll(page, [
  "offer_reference",
  'name="offer_reference"',
  "!companySlug || !offerReference",
], "/teckna-avtal requires a public offer identity");
check(
  !page.includes('name="contract_offer_id"'),
  "/teckna-avtal never exposes an internal offer UUID",
);

includesAll(actions, [
  "input.offerReference",
  "done(status, message",
], "redirect preserves the offer reference and runs outside catch");
check(
  actions.indexOf("done(status, message") > actions.lastIndexOf("} catch"),
  "Next redirect is not swallowed by the action catch block",
);

includesAll(intake, [
  'String(company.status ?? "") !== "active"',
  'String(company.production_status ?? "") !== "live"',
  "!company.live_approved_at",
  "resolveCanonicalPublicOffer",
  "canonical_public_contract_offers_v",
  '.eq("canonical_offer_reference", input.offerReference)',
  'row.publication_status !== "published"',
  "requiredIds.some",
  "contract: null",
  "price_snapshot: null",
  "contract_product_version_id",
  "contract_publication_version_id",
  "legal_bundle_version_id",
], "manual intake is active-tenant and canonical-offer bound");
check(
  !intake.includes('status: "pending_signature"'),
  "manual review intake cannot create an unbound pending-signature contract",
);
check(
  !intake.includes('["active", "onboarding"]'),
  "onboarding tenants cannot accept live contract intake",
);
includesAll(intake, [
  'input.email?.toLowerCase()',
  'input.personalNumber?.replace(/\\D/g, "")',
  "parsed.toISOString().slice(0, 10) === value",
], "idempotency identity and dates are canonicalized");

includesAll(legalRoute, [
  "requireIntegrationApiAccess(request, ['website_legal.read'])",
  "offer_reference_required",
  "buildWebsiteLegalBundle(auth.client, offerReference)",
], "legal bundle requires dedicated scope and exact offer");
check(
  !legalRoute.includes("'website_contracts.read'"),
  "website contract read scope cannot read legal bundles",
);
includesAll(publicContracts, [
  "required_types",
  "present_types",
  "bundle_version",
  "missingTypes.length === 0",
  "contract_product_versions",
  "required_legal_modules",
], "legal completeness is exact-version and offer specific");

includesAll(portalBundle, [
  "REQUIRED_BUNDLE_SECTIONS",
  "requiredWarnings.length > 0 ? 503 : 200",
  "complete: requiredWarnings.length === 0",
  "unavailable_sections",
  "warnings",
], "portal bundle fails closed for mandatory sections");

includesAll(repair, [
  "contract_offer_live_slug_duplicates_block_repair",
  "create unique index contract_offers_company_live_slug_uidx",
  "supersedes_contract_product_version_id",
  "canonical_snapshot_alignment_20260727",
], "forward-only database integrity repair");
includesAll(copyMigration, [
  "gridex_copy_contract_offer_v1",
  "copied_from_contract_offer_id",
  "'status', 'draft'",
  "'lifecycle_status', 'draft'",
  "'internal', 'paused'",
  "'website', 'paused'",
  "'api', 'paused'",
  "gridex_upsert_internal_contract_offer_v2",
], "copy command creates a new unpublished canonical graph");
check(
  !copyMigration.includes("customer_contracts") &&
    !copyMigration.includes("website_contract_quotes") &&
    !copyMigration.includes("customer_contract_signatures"),
  "copy command never copies customer, quote or signature graphs",
);
includesAll(adminActions, [
  "copyContractOfferAction",
  "gridex_copy_contract_offer_v1",
], "admin action uses canonical copy command");
includesAll(adminPage, [
  "Visa historik",
  "Skapa liknande avtal",
  "copyContractOfferAction",
], "terminal offers expose history and copy UI");
includesAll(exportCenter, [
  '"gridex_create_invoice_export_graph_v1"',
  "canonical_invoice_export_item_incomplete",
  "canonical_invoice_export_graph_invalid_response",
  "effectiveIdempotencyKey",
  "canonicalItems",
  "canonicalInvoices",
], "invoice export runtime commits through the canonical graph");
check(
  !exportCenter.includes(
    'supabaseService.rpc("gridex_create_billing_export_run"',
  ),
  "invoice export runtime cannot call the legacy graph directly",
);
includesAll(invoiceExportMigration, [
  "invoice_export_idempotency_payload_mismatch",
  "invoice_export_item_financial_values_required",
  "customer_invoice_financial_values_required",
  "gridex_create_invoice_export_graph_v1_core",
  "gridex_create_billing_export_run",
  "invoice.export_graph.created",
  "insert into public.event_outbox",
], "canonical invoice export is payload-safe and transactionally projected");
includesAll(websiteQuotes, [
  "fullQuoteIntegrityPayload",
  "valid_until: input.validUntil",
  "quote_hash_version: 'v2_full_quote'",
  "quote.quote_hash_version === 'v2_full_quote'",
], "quote hash covers expiry and the complete canonical quote identity");
includesAll(quoteEventMigration, [
  "new.valid_until is distinct from old.valid_until",
  "website_quote_v2_integrity_required",
  "gridex_record_customer_contract_event_v1",
  "signed_event_requires_canonical_signature_evidence",
  "use_gridex_activate_customer_supply_v1",
  "insert into public.customer_contract_events",
  "insert into public.domain_events",
  "insert into public.event_outbox",
], "quote mutation and status-only signature/activation bypasses are blocked");
includesAll(customerContractDb, [
  '"gridex_record_customer_contract_event_v1"',
  "p_derived_ends_at: derivedEndsAt",
  "Kanoniskt avtalsevent saknas i RPC-svaret.",
], "customer contract events use the atomic tenant-scoped command");
check(
  !customerContractDb.includes(
    '.from("customer_contract_events")\n    .insert(',
  ),
  "runtime cannot insert customer contract events outside the canonical command",
);
includesAll(websiteApplications, [
  "quote: input.websiteQuote",
  "quote_hash_version: input.websiteQuote.quote_hash_version",
  "onboardCanonicalWebsiteCustomerGraph",
], "website onboarding sends quote integrity to the canonical commit");
check(
  !websiteApplications.includes("markWebsiteQuoteConsumed"),
  "website application has no pre-commit quote consume call",
);
check(
  !websiteQuotes.includes("markWebsiteQuoteConsumed"),
  "standalone race-sensitive quote consume helper is removed",
);
includesAll(atomicApplicationMigration, [
  "for update",
  "v_quote.valid_until <= now()",
  "website_quote_integrity_mismatch",
  "website_quote_contract_chain_mismatch",
  "website_quote_offer_no_longer_available",
  "gridex_onboard_customer_graph_core(p_command)",
  "set status = 'consumed'",
  "application.quote_committed",
  "insert into public.audit_logs",
  "insert into public.event_outbox",
], "quote consume and canonical website graph commit in one transaction");
includesAll(contractStateMigration, [
  "drop trigger if exists customer_contracts_capture_signed_evidence",
  "customer_contract_transition_not_allowed",
  "customer_contract_signature_evidence_incomplete",
  "customer_contract_activation_requires_supply_graph",
  "customer_contract_terminal_evidence_required",
  "signed_customer_contract_immutable:",
  "active_customer_contract_duplicates_block_repair",
  "customer_contracts_single_active_supply_direction_uidx",
], "customer contract state, immutability and active supply invariant");
check(
  !contractStateMigration.includes("raise notice"),
  "active-contract invariant cannot be skipped with NOTICE",
);
check(
  !websiteApplications.includes(
    '.update({ status: "needs_review", resolution_status:',
  ),
  "readiness review does not invent a customer-contract status",
);
check(
  !customerActions.includes('status: decisionType === "withdrawal" ? "cancelled_by_customer"'),
  "customer withdrawal is a cancellation reason, not a contract status",
);
check(
  !customerProfileActions.includes(
    '.from("customer_contracts")\n      .update({\n        status:',
  ),
  "profile lifecycle actions use the canonical event command",
);
check(
  Array.isArray(manifest.allowedLegacyCollisions?.["20260727150000"]) &&
    manifest.allowedLegacyCollisions["20260727150000"].length === 2,
  "historical migration collision is explicit and exact",
);
check(
  Boolean(
    manifest.files?.[
      "20260727162000_contract_slug_version_integrity_repair.sql"
    ],
  ),
  "forward repair is checksum registered",
);
check(
  Boolean(
    manifest.files?.["20260727163000_contract_offer_copy_command.sql"],
  ),
  "copy command migration is checksum registered",
);
check(
  Boolean(
    manifest.files?.[
      "20260727164000_canonical_invoice_export_runtime_completion.sql"
    ],
  ),
  "invoice export runtime migration is checksum registered",
);
check(
  Boolean(
    manifest.files?.[
      "20260727165000_quote_and_customer_contract_event_integrity.sql"
    ],
  ),
  "quote and customer event migration is checksum registered",
);
check(
  Boolean(
    manifest.files?.[
      "20260727166000_atomic_quote_application_onboarding_commit.sql"
    ],
  ),
  "atomic quote/application migration is checksum registered",
);
check(
  Boolean(
    manifest.files?.[
      "20260727167000_customer_contract_state_machine_and_active_invariant.sql"
    ],
  ),
  "customer contract state migration is checksum registered",
);

if (failures.length) {
  console.error(
    `Contract P0 integrity regression failed (${failures.length}/${checks}):`,
  );
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Contract P0 integrity regression passed (${checks} controls).`);
