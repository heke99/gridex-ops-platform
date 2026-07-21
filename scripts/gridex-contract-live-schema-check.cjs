#!/usr/bin/env node

const baseUrl = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!baseUrl || !serviceKey) {
  console.error(
    "Contract live-schema check requires SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.",
  );
  process.exit(2);
}

async function main() {
  const response = await fetch(`${baseUrl}/rest/v1/rpc/gridex_verify_contract_schema_alignment`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    console.error("Live contract schema check failed:", payload ?? response.statusText);
    process.exit(1);
  }

  const checks = Array.isArray(payload) ? payload : [payload];
  const failed = checks.filter((check) => check && check.ok === false);
  console.table(checks);
  if (failed.length > 0) {
    console.error(`${failed.length} contract schema alignment check(s) failed.`);
    process.exit(1);
  }
  console.log(`Live contract schema alignment passed (${checks.length} checks).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
