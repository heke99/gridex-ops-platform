#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')

function replaceOnce(file, from, to) {
  const source = fs.readFileSync(file, 'utf8')
  if (!source.includes(from)) {
    throw new Error(`Expected patch anchor not found in ${file}: ${from.slice(0, 120)}`)
  }
  const next = source.replace(from, to)
  if (next === source) throw new Error(`Patch made no change in ${file}`)
  fs.writeFileSync(file, next)
}

function assertAbsent(file, value) {
  const source = fs.readFileSync(file, 'utf8')
  if (source.includes(value)) throw new Error(`Forbidden value remains in ${file}: ${value}`)
}

const quoteFile = 'lib/pricing/websiteQuotes.ts'
replaceOnce(
  quoteFile,
  `function quoteLifetimeMinutes(): number {\n  const configured = Number(process.env.WEBSITE_QUOTE_VALIDITY_MINUTES ?? '15')\n  if (!Number.isFinite(configured)) return 15\n  return Math.min(Math.max(Math.trunc(configured), 5), 120)\n}\n`,
  `// V1 keeps valid_until on the wire for backwards compatibility and immutable\n// audit hashing. It is not a customer-price expiry. New website quotes use a\n// stable far-future value while business availability is enforced separately.\nexport const NON_EXPIRING_WEBSITE_QUOTE_VALID_UNTIL = '9999-12-31T23:59:59.999Z'\n`,
)
replaceOnce(
  quoteFile,
  `  const validUntil = new Date(Date.now() + quoteLifetimeMinutes() * 60_000).toISOString()`,
  `  const validUntil = NON_EXPIRING_WEBSITE_QUOTE_VALID_UNTIL`,
)
replaceOnce(
  quoteFile,
  `  if (new Date(quote.valid_until).getTime() <= Date.now() || quote.status === 'expired') {\n    await supabaseService\n      .from('website_contract_quotes')\n      .update({ status: 'expired', updated_at: new Date().toISOString() })\n      .eq('id', quote.id)\n      .eq('status', 'active')\n    throw new WebsiteQuoteValidationError({ message: 'Quote har gått ut. Hämta ett nytt pris.', code: 'quote_expired', status: 422 })\n  }`,
  `  // Legacy rows may have been marked expired by the retired technical TTL.\n  // Time alone must never invalidate a customer-visible website price.\n  if (quote.status === 'expired') {\n    const { error: reactivationError } = await supabaseService\n      .from('website_contract_quotes')\n      .update({ status: 'active', updated_at: new Date().toISOString() })\n      .eq('id', quote.id)\n      .eq('status', 'expired')\n    if (reactivationError) throw reactivationError\n    quote.status = 'active'\n  }`,
)
replaceOnce(
  quoteFile,
  `      canonicalResolution = await loadQuoteEnergyResolution({\n        client: input.client,\n        resolutionId: input.resolutionId,\n      })`,
  `      canonicalResolution = await loadQuoteEnergyResolution({\n        client: input.client,\n        resolutionId: input.resolutionId,\n        // The resolution timestamp is freshness metadata for new calculations.\n        // An already-issued immutable quote remains valid after it passes.\n        allowExpired: true,\n      })`,
)
assertAbsent(quoteFile, 'WEBSITE_QUOTE_VALIDITY_MINUTES')
assertAbsent(quoteFile, "code: 'quote_expired'")

const resolutionFile = 'lib/energy/resolutionBinding.ts'
replaceOnce(
  resolutionFile,
  `const MIN_POSTAL_CENTROID_PRICE_ASSURANCE_CONFIDENCE = 0.7\n`,
  `const MIN_POSTAL_CENTROID_PRICE_ASSURANCE_CONFIDENCE = 0.7\nconst NON_EXPIRING_RESOLUTION_COMPATIBILITY_TIMESTAMP = '9999-12-31T23:59:59.999Z'\n`,
)
replaceOnce(
  resolutionFile,
  `async function loadEnergyResolutionForPurpose(input: {\n  client: IntegrationApiClient\n  resolutionId: string\n  purpose: ResolutionPurpose\n  now?: Date\n}): Promise<BoundEnergyResolution> {`,
  `async function loadEnergyResolutionForPurpose(input: {\n  client: IntegrationApiClient\n  resolutionId: string\n  purpose: ResolutionPurpose\n  now?: Date\n  /** Ignore elapsed freshness only when validating an already-issued immutable quote. */\n  allowExpired?: boolean\n}): Promise<BoundEnergyResolution> {`,
)
replaceOnce(
  resolutionFile,
  `    expiresAt: data.expires_at,\n    now,`,
  `    expiresAt: input.allowExpired\n      ? NON_EXPIRING_RESOLUTION_COMPATIBILITY_TIMESTAMP\n      : data.expires_at,\n    now,`,
)
replaceOnce(
  resolutionFile,
  `export function loadQuoteEnergyResolution(input: {\n  client: IntegrationApiClient\n  resolutionId: string\n  now?: Date\n}): Promise<BoundEnergyResolution> {`,
  `export function loadQuoteEnergyResolution(input: {\n  client: IntegrationApiClient\n  resolutionId: string\n  now?: Date\n  allowExpired?: boolean\n}): Promise<BoundEnergyResolution> {`,
)

const templateFile = 'app/developers/customer-portal-api/template.tsx'
replaceOnce(
  templateFile,
  `            API contract <strong>{WEBSITE_INTEGRATION_CONTRACT_VERSION}</strong> is unchanged. Quote freshness,\n            commercial price validity and final invoice settlement are separate concepts.`,
  `            API contract <strong>{WEBSITE_INTEGRATION_CONTRACT_VERSION}</strong> is unchanged. Customer-visible website\n            prices do not expire because time passes; commercial availability and final invoice settlement are separate concepts.`,
)
replaceOnce(
  templateFile,
  `              <code>valid_until</code> is the checkout quote snapshot lifetime. It is used to validate or renew the\n              quote before submission; it is not an end date for the customer&apos;s electricity price or agreement.`,
  `              <code>valid_until</code> remains in V1 for wire compatibility and immutable audit evidence. Gridex does\n              not use it as a customer-price expiry and an issued website quote is not rejected because that timestamp passes.`,
)

const semanticsTest = '__tests__/pricing-settlement-semantics.test.ts'
replaceOnce(
  semanticsTest,
  `  it('keeps the current API contract while separating quote TTL from commercial validity', () => {`,
  `  it('keeps the current API contract while making customer website quotes non-expiring', () => {`,
)

const migrations = fs.readdirSync('supabase/migrations')
  .filter((name) => /^\d{14}_non_expiring_website_quotes\.sql$/.test(name))
  .sort()
if (migrations.length !== 1) {
  throw new Error(`Expected exactly one generated non-expiring quote migration, got ${migrations.join(', ')}`)
}
const migrationName = migrations[0]
const migrationPath = path.join('supabase/migrations', migrationName)
const migrationSql = `-- Website prices shown to customers do not expire because wall-clock time passes.\n-- Keep valid_until as immutable V1 compatibility/audit metadata only.\n\nbegin;\n\n-- Recover rows that were marked expired exclusively by the retired website quote TTL.\nupdate public.website_contract_quotes\nset status = 'active',\n    updated_at = now()\nwhere status = 'expired'\n  and consumed_at is null\n  and consumed_application_id is null;\n\n-- The current atomic website onboarding function must keep all tenant, integrity,\n-- publication and idempotency checks while removing only the elapsed-time rejection.\ndo $migration$\ndeclare\n  v_definition text;\n  v_expiry_block text := $needle$  if v_quote.valid_until <= now() then\n    raise exception using\n      errcode = '23514',\n      message = 'website_quote_expired';\n  end if;\n$needle$;\nbegin\n  select pg_get_functiondef(\n    'public.gridex_onboard_customer_graph_quote_commit_v2(jsonb)'::regprocedure\n  ) into v_definition;\n\n  if strpos(v_definition, v_expiry_block) = 0 then\n    raise exception 'non_expiring_quote_patch_anchor_missing';\n  end if;\n\n  execute replace(v_definition, v_expiry_block, '');\nend\n$migration$;\n\ncomment on column public.website_contract_quotes.valid_until is\n  'V1 compatibility and immutable audit metadata. Website customer quotes do not expire solely because this timestamp passes.';\n\ncommit;\n`
fs.writeFileSync(migrationPath, migrationSql)

const manifestPath = 'scripts/supabase-types-manifest.json'
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
manifest.latest_migration = migrationName
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

const testPath = '__tests__/non-expiring-website-quotes.test.ts'
fs.writeFileSync(testPath, `import { readFileSync, readdirSync } from 'node:fs'\nimport { describe, expect, it } from 'vitest'\n\nconst read = (path: string) => readFileSync(path, 'utf8')\n\ndescribe('non-expiring customer website quotes', () => {\n  it('keeps V1 valid_until as compatibility metadata without elapsed-time rejection', () => {\n    const quotes = read('lib/pricing/websiteQuotes.ts')\n    const resolution = read('lib/energy/resolutionBinding.ts')\n    const route = read('app/api/v1/website/quote/validate/route.ts')\n    const template = read('app/developers/customer-portal-api/template.tsx')\n    const migration = readdirSync('supabase/migrations')\n      .filter((name) => /_non_expiring_website_quotes\\.sql$/.test(name))\n      .sort()\n      .at(-1)\n    expect(migration).toBeTruthy()\n    const sql = read(\`supabase/migrations/\${migration}\`)\n\n    expect(quotes).toContain("NON_EXPIRING_WEBSITE_QUOTE_VALID_UNTIL = '9999-12-31T23:59:59.999Z'")\n    expect(quotes).not.toContain('WEBSITE_QUOTE_VALIDITY_MINUTES')\n    expect(quotes).not.toContain("code: 'quote_expired'")\n    expect(quotes).toContain("if (quote.status === 'expired')")\n    expect(quotes).toContain('allowExpired: true')\n    expect(resolution).toContain('allowExpired?: boolean')\n    expect(route).toContain('valid_until: quote.valid_until')\n    expect(template).toContain('does not use it as a customer-price expiry')\n    expect(sql).toContain("message = 'website_quote_expired'")\n    expect(sql).toContain("execute replace(v_definition, v_expiry_block, '')")\n    expect(sql).toContain("where status = 'expired'")\n  })\n})\n`)

console.log(`Patched non-expiring website quotes; migration ${migrationName}`)
