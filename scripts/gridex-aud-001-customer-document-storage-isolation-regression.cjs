const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const builderPath = "lib/customer-documents/storagePath.ts";
const migrationPath =
  "supabase/migrations/20260806165000_gridex_aud_001_customer_document_storage_isolation.sql";
const builder = read(builderPath);
const migration = read(migrationPath);

const expectedChecksum =
  "0d51528c3d7dcb8e2bd2c92cb8d83eea9212438232d25bb5422158be43d46d16";
assert.equal(
  crypto.createHash("sha256").update(migration).digest("hex"),
  expectedChecksum,
  "AUD-001 migration checksum drifted",
);

assert.match(
  builder,
  /companies\/\$\{companyId\}\/customers\/\$\{customerId\}\/\$\{scope\}\/\$\{params\.documentType\}\/\$\{fileName\}/,
  "shared path builder must emit the canonical seven-segment key",
);
assert.match(
  builder,
  /parseCustomerDocumentStoragePath/,
  "shared path builder must expose canonical parsing",
);
assert.match(
  builder,
  /customerDocumentStoragePathMatches/,
  "shared path builder must expose ownership matching",
);

const uploadConsumers = [
  "app/admin/customers/actions.ts",
  "app/admin/customers/[id]/actions.ts",
  "app/admin/customers/[id]/document-actions.ts",
  "lib/website/customerApplications.ts",
];

for (const consumer of uploadConsumers) {
  const source = read(consumer);
  assert.match(
    source,
    /buildCustomerDocumentStoragePath/,
    `${consumer} must use the shared path builder`,
  );
  assert.doesNotMatch(
    source,
    /function buildCustomerDocumentPath/,
    `${consumer} must not define a local path builder`,
  );
  assert.doesNotMatch(
    source,
    /\/authorizations\/\$\{/,
    `${consumer} must not emit the legacy website authorization path`,
  );
}

const website = read("lib/website/customerApplications.ts");
assert.match(
  website,
  /timestampFileName:\s*false/,
  "website POA retry must retain a deterministic object key",
);
assert.match(
  website,
  /documentType:\s*"power_of_attorney"/,
  "website POA path must include the canonical document type",
);

const signedUrlRoute = read(
  "app/api/admin/customer-documents/[documentId]/route.ts",
);
assert.match(
  signedUrlRoute,
  /customerDocumentStoragePathMatches\(document\.file_path/,
  "signed URL flow must validate path ownership before service-role signing",
);
assert.ok(
  signedUrlRoute.indexOf("customerDocumentStoragePathMatches(document.file_path") <
    signedUrlRoute.indexOf(".createSignedUrl(document.file_path"),
  "signed URL ownership validation must happen before URL creation",
);

for (const policy of [
  "customer_documents_storage_read",
  "customer_documents_storage_insert",
  "customer_documents_storage_update",
  "customer_documents_storage_delete",
  "customer_documents_storage_service_role_all",
]) {
  assert.match(migration, new RegExp(`create policy ${policy}\\b`));
}
assert.match(
  migration,
  /gridex_customer_document_path_allows\(name, 'read'\)/,
);
assert.match(
  migration,
  /gridex_customer_document_path_allows\(name, 'write'\)/,
);
assert.match(
  migration,
  /coalesce\(array_length\(v_parts, 1\), 0\) <> 7/,
  "legacy and malformed paths must fail closed",
);
assert.match(
  migration,
  /c\.id = v_customer_id\s+and c\.company_id = v_company_id/,
  "customer and company in the path must match the database",
);
assert.match(
  migration,
  /cs\.id = v_site_id\s+and cs\.customer_id = v_customer_id\s+and cs\.company_id = v_company_id/,
  "site scope in the path must match company and customer",
);

const manifest = JSON.parse(
  read("scripts/migration-history-manifest.additions.json"),
);
assert.equal(
  manifest.files[
    "20260806165000_gridex_aud_001_customer_document_storage_isolation.sql"
  ],
  expectedChecksum,
  "migration history manifest must pin the AUD-001 migration",
);

console.log("GRIDEX-AUD-001 storage isolation regression: PASS");
