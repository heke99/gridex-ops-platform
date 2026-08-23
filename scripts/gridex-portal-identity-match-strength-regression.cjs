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

const matchingService = fs.readFileSync("lib/customers/matchingService.ts", "utf8");
assert.match(matchingService, /export type CustomerMatchStrength = 'strong' \| 'weak'/);
assert.doesNotMatch(matchingService, /CustomerMatchStrength = [^\n]*medium/);

const compatibilityMigration = fs.readFileSync(
  "supabase/migrations/20260823201059_normalize_customer_portal_identity_match_strength.sql",
  "utf8",
);
assert.match(compatibilityMigration, /new\.match_strength = 'medium'/);
assert.match(compatibilityMigration, /new\.match_strength := 'weak'/);

const convergenceMigration = fs.readFileSync(
  "supabase/migrations/20260823201716_canonical_customer_portal_match_strength_convergence.sql",
  "utf8",
);
assert.match(convergenceMigration, /set match_strength = 'weak'/);
assert.match(convergenceMigration, /where match_strength = 'medium'/);
assert.match(convergenceMigration, /new\.match_strength := 'weak'/);
assert.match(convergenceMigration, /revoke all on function public\.gridex_normalize_customer_portal_identity_match_strength\(\)/);

const constraintStart = convergenceMigration.indexOf(
  "add constraint customer_portal_identities_match_strength_check",
);
const constraintEnd = convergenceMigration.indexOf("));", constraintStart);
assert.ok(
  constraintStart >= 0 && constraintEnd > constraintStart,
  "canonical customer_portal_identities match-strength constraint must exist",
);
const constraintBlock = convergenceMigration.slice(constraintStart, constraintEnd + 3);
assert.match(constraintBlock, /'strong'::text, 'weak'::text, 'manual'::text/);
assert.doesNotMatch(constraintBlock, /'medium'/);

console.log("portal identity match strength end-to-end regression passed");
