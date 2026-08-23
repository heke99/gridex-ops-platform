const fs = require("node:fs");
const assert = require("node:assert/strict");

const applicationWriter = fs.readFileSync(
  "lib/website/customerApplicationCommunication.ts",
  "utf8",
);
const writerStart = applicationWriter.indexOf("    match_strength:");
const writerEnd = applicationWriter.indexOf("    match_method:", writerStart);
assert.ok(writerStart >= 0 && writerEnd > writerStart, "website portal identity match_strength block must exist");
const writerBlock = applicationWriter.slice(writerStart, writerEnd);
assert.match(writerBlock, /\? "strong"/);
assert.match(writerBlock, /: "weak",/);
assert.doesNotMatch(writerBlock, /"medium"/);

const resolver = fs.readFileSync("lib/customer-portal/customerResolver.ts", "utf8");
assert.match(resolver, /export type PortalMatchStrength = 'strong' \| 'weak' \| 'manual'/);
assert.match(resolver, /if \(strength === 'medium'\) return 'weak'/);
assert.doesNotMatch(resolver, /matchStrength:\s*'medium'/);
assert.doesNotMatch(resolver, /\? 'strong' : 'medium'/);
assert.match(resolver, /match_strength: canonicalPortalMatchStrength\(source\.matchStrength\)/);
assert.match(resolver, /match_strength: 'strong'/);

const migration = fs.readFileSync(
  "supabase/migrations/20260823201059_normalize_customer_portal_identity_match_strength.sql",
  "utf8",
);
assert.match(migration, /new\.match_strength = 'medium'/);
assert.match(migration, /new\.match_strength := 'weak'/);
assert.doesNotMatch(migration, /add constraint[\s\S]*'medium'/i);

console.log("portal identity match strength end-to-end regression passed");
