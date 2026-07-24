#!/usr/bin/env node
const fs = require('node:fs')
const website = JSON.parse(fs.readFileSync('docs/openapi/website-integration-v1.json', 'utf8'))
const failures = []
const current = website.paths?.['/api/v1/website/market-price/current']?.post
const currentExample = current?.responses?.['200']?.content?.['application/json']?.example
if (!currentExample?.data) failures.push('Current market-price response example is missing.')
for (const field of [
  'provider', 'resolution_id', 'price_area', 'reference_type', 'resolution',
  'time_start', 'time_end', 'price_sek_per_kwh', 'price_ore_per_kwh',
  'price_ex_vat_sek_per_kwh', 'price_ex_vat_ore_per_kwh', 'source_as_of', 'next_update_at',
]) {
  if (!(field in (currentExample?.data ?? {}))) failures.push(`Current market-price example missing ${field}.`)
}
const quoteExample = website.paths?.['/api/v1/website/quote']?.post?.responses?.['201']?.content?.['application/json']?.example
const marketReference = quoteExample?.data?.market_reference
for (const field of [
  'price_sek_per_kwh', 'price_ore_per_kwh', 'requested_days', 'included_days',
  'source_as_of', 'generated_at', 'stale_after', 'effective_stale_at', 'fallback_used',
]) {
  if (!(field in (marketReference ?? {}))) failures.push(`Quote market_reference example missing ${field}.`)
}
if (marketReference && marketReference.price_ore_per_kwh !== marketReference.price_sek_per_kwh * 100) {
  failures.push('Quote market_reference SEK/öre example conversion is inconsistent.')
}
const schema = website.components?.schemas?.MarketReference
for (const field of schema?.required ?? []) {
  if (!(field in (schema.properties ?? {}))) failures.push(`MarketReference required field ${field} has no property schema.`)
}
if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'))
  process.exit(1)
}
console.log('API documentation examples OK.')
