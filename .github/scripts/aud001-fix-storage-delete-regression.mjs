import fs from "node:fs";

const file = "scripts/gridex-aud-001-customer-document-storage-isolation-regression.sql";
let sql = fs.readFileSync(file, "utf8");
const marker = "begin;\n";
const replacement = `begin;\n\n-- Supabase Storage sets this transaction-local flag before issuing DELETE.\n-- Keeping the protection trigger enabled while setting the same flag exercises\n-- the real DELETE RLS policy without performing unsupported direct deletion.\nselect set_config('storage.allow_delete_query', 'true', true);\n`;

if (!sql.startsWith(marker)) {
  throw new Error("AUD-001 SQL regression no longer starts with begin");
}
if (sql.includes("storage.allow_delete_query")) {
  throw new Error("AUD-001 SQL regression already contains the Storage API delete flag");
}

sql = replacement + sql.slice(marker.length);
fs.writeFileSync(file, sql);
console.log("AUD-001 Storage API delete regression flag added");
