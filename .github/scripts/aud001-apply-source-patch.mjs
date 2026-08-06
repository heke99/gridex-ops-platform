import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function write(relativePath, content) {
  fs.writeFileSync(path.join(root, relativePath), content);
}

function replaceOnce(content, search, replacement, label) {
  const first = content.indexOf(search);
  if (first === -1) {
    throw new Error(`AUD-001 patch failed: missing ${label}`);
  }
  if (content.indexOf(search, first + search.length) !== -1) {
    throw new Error(`AUD-001 patch failed: ${label} matched more than once`);
  }
  return content.slice(0, first) + replacement + content.slice(first + search.length);
}

function replaceRegexOnce(content, pattern, replacement, label) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const matches = [...content.matchAll(new RegExp(pattern.source, flags))];
  if (matches.length !== 1) {
    throw new Error(`AUD-001 patch failed: ${label} matched ${matches.length} times`);
  }
  return content.replace(pattern, replacement);
}

function patchAdminActions() {
  const file = "app/admin/customers/actions.ts";
  let content = read(file);
  content = replaceOnce(
    content,
    'import { supabaseService } from "@/lib/supabase/service";',
    'import { supabaseService } from "@/lib/supabase/service";\nimport { buildCustomerDocumentStoragePath } from "@/lib/customer-documents/storagePath";',
    `${file} shared path import`,
  );
  content = replaceRegexOnce(
    content,
    /function sanitizeFileName\(value: string\): string \{[\s\S]*?\n\}\n\nfunction buildCustomerDocumentPath\(params: \{[\s\S]*?\n\}\n\n/,
    "",
    `${file} duplicate path helpers`,
  );
  content = replaceOnce(
    content,
    "const filePath = buildCustomerDocumentPath({\n      customerId: params.customerId,",
    "const filePath = buildCustomerDocumentStoragePath({\n      companyId: params.companyId,\n      customerId: params.customerId,",
    `${file} path call`,
  );
  write(file, content);
}

function patchCustomerActions() {
  const file = "app/admin/customers/[id]/actions.ts";
  let content = read(file);
  content = replaceOnce(
    content,
    'import { supabaseService } from "@/lib/supabase/service";',
    'import { supabaseService } from "@/lib/supabase/service";\nimport { buildCustomerDocumentStoragePath } from "@/lib/customer-documents/storagePath";',
    `${file} shared path import`,
  );
  content = replaceRegexOnce(
    content,
    /function sanitizeFileName\(value: string\): string \{[\s\S]*?\n\}\n\nfunction buildCustomerDocumentPath\(params: \{[\s\S]*?\n\}\n\n/,
    "",
    `${file} duplicate path helpers`,
  );
  content = replaceOnce(
    content,
    "const filePath = buildCustomerDocumentPath({\n    customerId,",
    "const filePath = buildCustomerDocumentStoragePath({\n    companyId,\n    customerId,",
    `${file} path call`,
  );
  write(file, content);
}

function patchDocumentActions() {
  const file = "app/admin/customers/[id]/document-actions.ts";
  let content = read(file);
  content = replaceOnce(
    content,
    "import { supabaseService } from '@/lib/supabase/service'",
    "import { supabaseService } from '@/lib/supabase/service'\nimport { buildCustomerDocumentStoragePath } from '@/lib/customer-documents/storagePath'",
    `${file} shared path import`,
  );
  content = replaceRegexOnce(
    content,
    /function sanitizeFileName\(value: string\): string \{[\s\S]*?\n\}\n\nfunction buildCustomerDocumentPath\(params: \{[\s\S]*?\n\}\n\n/,
    "",
    `${file} duplicate path helpers`,
  );
  content = replaceOnce(
    content,
    "const filePath = buildCustomerDocumentPath({\n    customerId,",
    "const filePath = buildCustomerDocumentStoragePath({\n    companyId: actionContext.companyId,\n    customerId,",
    `${file} path call`,
  );
  write(file, content);
}

function patchWebsiteApplications() {
  const file = "lib/website/customerApplications.ts";
  let content = read(file);
  content = replaceOnce(
    content,
    'import { supabaseService } from "@/lib/supabase/service";',
    'import { supabaseService } from "@/lib/supabase/service";\nimport { buildCustomerDocumentStoragePath } from "@/lib/customer-documents/storagePath";',
    `${file} shared path import`,
  );
  content = replaceOnce(
    content,
    "const filePath = `companies/${input.companyId}/customers/${input.customerId}/authorizations/${input.powerOfAttorneyId}.json`;",
    `const filePath = buildCustomerDocumentStoragePath({
      companyId: input.companyId,
      customerId: input.customerId,
      siteId: null,
      documentType: "power_of_attorney",
      fileName: \`\${input.powerOfAttorneyId}.json\`,
      timestampFileName: false,
    });`,
    `${file} website POA path`,
  );
  write(file, content);
}

function patchSignedUrlRoute() {
  const file = "app/api/admin/customer-documents/[documentId]/route.ts";
  let content = read(file);
  content = replaceOnce(
    content,
    "import { supabaseService } from '@/lib/supabase/service'",
    "import { supabaseService } from '@/lib/supabase/service'\nimport { customerDocumentStoragePathMatches } from '@/lib/customer-documents/storagePath'",
    `${file} path validator import`,
  );
  content = replaceOnce(
    content,
    ".select('id, customer_id, company_id, storage_bucket, file_path, file_name')",
    ".select('id, customer_id, company_id, site_id, storage_bucket, file_path, file_name')",
    `${file} site projection`,
  );
  content = replaceOnce(
    content,
    `  if (!document.file_path) {
    return jsonError('Dokumentet saknar lagringsväg', 422)
  }

  const bucket = document.storage_bucket || 'customer-documents'`,
    `  if (!document.file_path) {
    return jsonError('Dokumentet saknar lagringsväg', 422)
  }

  if (!customerDocumentStoragePathMatches(document.file_path, {
    companyId: document.company_id,
    customerId: document.customer_id,
    siteId: document.site_id ?? null,
  })) {
    return jsonError('Dokumentets lagringsväg matchar inte kundens bolag och scope', 422)
  }

  const bucket = document.storage_bucket || 'customer-documents'`,
    `${file} canonical ownership check`,
  );
  write(file, content);
}

function patchMigrationManifest() {
  const file = "scripts/migration-history-manifest.additions.json";
  const parsed = JSON.parse(read(file));
  parsed.files ??= {};
  const migration =
    "20260806165000_gridex_aud_001_customer_document_storage_isolation.sql";
  const checksum =
    "0d51528c3d7dcb8e2bd2c92cb8d83eea9212438232d25bb5422158be43d46d16";
  if (parsed.files[migration] && parsed.files[migration] !== checksum) {
    throw new Error("AUD-001 migration manifest checksum conflict");
  }
  parsed.files[migration] = checksum;
  const ordered = Object.fromEntries(
    Object.entries(parsed.files).sort(([left], [right]) => left.localeCompare(right)),
  );
  write(file, `${JSON.stringify({ files: ordered }, null, 2)}\n`);
}

function patchHardeningWorkflow() {
  const file = ".github/workflows/ops-hardening.yml";
  let content = read(file);
  content = replaceOnce(
    content,
    "      - run: npm run db:migrations:check\n",
    "      - run: npm run db:migrations:check\n      - run: node scripts/gridex-aud-001-customer-document-storage-isolation-regression.cjs\n",
    `${file} regression step`,
  );
  write(file, content);
}

patchAdminActions();
patchCustomerActions();
patchDocumentActions();
patchWebsiteApplications();
patchSignedUrlRoute();
patchMigrationManifest();
patchHardeningWorkflow();

console.log("AUD-001 source patch applied");
