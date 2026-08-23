const fs = require("node:fs");
const assert = require("node:assert/strict");

const source = fs.readFileSync("lib/website/customerApplicationCommunication.ts", "utf8");
const start = source.indexOf("    match_strength:");
const end = source.indexOf("    match_method:", start);
assert.ok(start >= 0 && end > start, "portal identity match_strength block must exist");
const block = source.slice(start, end);
assert.match(block, /\? "strong"/);
assert.match(block, /: "medium",/);

const migration = fs.readFileSync(
  "supabase/migrations/20260823201059_normalize_customer_portal_identity_match_strength.sql",
  "utf8",
);
assert.match(migration, /new\.match_strength = 'medium'/);
assert.match(migration, /new\.match_strength := 'weak'/);
assert.doesNotMatch(migration, /add constraint[\s\S]*'medium'/i);

console.log("portal identity match strength compatibility regression passed");
