const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
const checks = []
const ok = (condition, message) => {
  if (!condition) throw new Error(`FAIL: ${message}`)
  checks.push(message)
}

const legacy = read('supabase/migrations/20260712100000_gridex_end_to_end_integrity_hardening.sql')
const newer = read('supabase/migrations/20260713150000_api_performance_tenant_hardening.sql')
const repair = read('supabase/migrations/20260717235500_integration_api_rate_limiter_canonical_repair.sql')
const auth = read('lib/integrations/apiAuth.ts')
const route = read('app/api/v1/website/public-contracts/route.ts')

ok(legacy.includes('bucket_start') && legacy.includes('company_id uuid not null'), 'legacy bucket schema is documented by the regression')
ok(newer.includes('window_started_at') && newer.includes('route text not null'), 'newer route-aware bucket schema is documented by the regression')
ok(newer.includes('create table if not exists public.integration_api_rate_limit_buckets'), 'the historical CREATE TABLE IF NOT EXISTS collision remains detectable')
ok(repair.includes('drop table if exists public.integration_api_rate_limit_buckets'), 'repair rebuilds the ephemeral conflicting table')
for (const column of ['api_client_id', 'company_id', 'route', 'window_started_at', 'request_count', 'updated_at']) {
  ok(repair.includes(`('${column}')`) || repair.includes(`${column} `), `repair asserts canonical column ${column}`)
}
ok(repair.includes('primary key (api_client_id, route, window_started_at)'), 'canonical primary key is per API client, route and window')
ok(repair.includes("to_regprocedure('public.integration_api_rate_limit_check(uuid,text,integer,integer)')"), 'migration asserts the effective RPC exists')
ok(repair.includes("create or replace function public.gridex_consume_api_rate_limit"), 'legacy rate-limit RPC remains as a compatibility wrapper')
ok(auth.includes("outcome: 'unavailable'"), 'runtime distinguishes limiter infrastructure failure')
ok(auth.includes("code: 'api_rate_limiter_unavailable'"), 'runtime returns 503-specific limiter error code')
ok(auth.includes("status: 503"), 'limiter infrastructure failures no longer become false 429 responses')
ok(auth.includes("code: 'rate_limited'"), 'real quota exhaustion still returns rate_limited')
ok(route.includes("headers.set('Retry-After'"), 'public contracts returns Retry-After on real 429')
ok(route.includes("'X-RateLimit-Limit'"), 'public contracts exposes rate-limit limit metadata')
ok(route.includes("'X-RateLimit-Remaining'"), 'public contracts exposes remaining quota metadata')

console.log(`gridex-rate-limit-schema-repair-regression: ${checks.length} checks passed`)
