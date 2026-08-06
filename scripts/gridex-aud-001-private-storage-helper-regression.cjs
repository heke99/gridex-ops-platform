const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const migrationName = "20260806172000_gridex_aud_001_storage_helper_private_schema.sql";
const migration = read(`supabase/migrations/${migrationName}`);
const expectedChecksum = "ae8274a9a37a1ecf672ae1257ee225619fbc48369aaf929af5f07f63e8241d5f";

assert.equal(
  crypto.createHash("sha256").update(migration).digest("hex"),
  expectedChecksum,
  "AUD-001 private-helper migration checksum drifted",
);
assert.match(migration, /create schema if not exists gridex_private/);
assert.match(migration, /create or replace function gridex_private\.customer_document_path_allows/);
assert.match(migration, /security definer/);
assert.match(migration, /set search_path = public, storage, auth, gridex_private, pg_temp/);
assert.match(migration, /grant usage on schema gridex_private to authenticated, service_role/);
assert.match(migration, /revoke all on schema gridex_private from public, anon/);
assert.match(migration, /gridex_private\.customer_document_path_allows\(name, 'read'\)/);
assert.match(migration, /gridex_private\.customer_document_path_allows\(name, 'write'\)/);
assert.match(migration, /drop function public\.gridex_customer_document_path_allows\(text, text\)/);

const manifest = JSON.parse(read("scripts/migration-history-manifest.additions.json"));
assert.equal(
  manifest.files[migrationName],
  expectedChecksum,
  "migration history manifest must pin the AUD-001 private-helper migration",
);

console.log("GRIDEX-AUD-001 private storage helper regression: PASS");
