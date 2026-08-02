const fs = require('node:fs')
const registry = JSON.parse(fs.readFileSync('lib/integrations/public-api-error-registry.json', 'utf8'))
const required = [
  'missing_api_token','invalid_api_token','api_token_expired','api_client_inactive',
  'api_scope_missing','api_ip_not_allowed','api_origin_not_allowed','rate_limited',
  'api_rate_limit_invalid','api_rate_limiter_unavailable','api_auth_unavailable',
  'tenant_not_operationally_ready','tenant_paused','tenant_closed','platform_schema_not_ready',
  'PUBLIC_CONTRACT_FEED_INCONSISTENT','PUBLICATION_GRAPH_INCONSISTENT','PUBLIC_CONTRACT_SCHEMA_INVALID',
]
const errors=[]
for (const code of required) if (!registry[code]) errors.push(`registry missing ${code}`)
for (const [code,def] of Object.entries(registry)) {
  if (!Number.isInteger(def.http_status)) errors.push(`${code}: http_status invalid`)
  if (typeof def.public_message !== 'string' || !def.public_message) errors.push(`${code}: public_message missing`)
  if (typeof def.retryable !== 'boolean') errors.push(`${code}: retryable invalid`)
  if (typeof def.security_sensitive !== 'boolean') errors.push(`${code}: security_sensitive invalid`)
  if (!Array.isArray(def.routes) || def.routes.length === 0) errors.push(`${code}: routes missing`)
}
for (const file of ['docs/openapi/website-integration-v1.json','docs/openapi/customer-portal-v1.json']) {
  const spec=JSON.parse(fs.readFileSync(file,'utf8'))
  const codes=spec['x-error-codes'] ?? []
  for (const code of Object.keys(registry)) if (!codes.includes(code)) errors.push(`${file}: missing ${code}`)
  for (const code of codes) if (!registry[code]) errors.push(`${file}: undocumented registry source for ${code}`)
}
if (errors.length) { console.error(errors.join('\n')); process.exit(1) }
console.log(`Public API error registry parity OK (${Object.keys(registry).length} codes).`)
