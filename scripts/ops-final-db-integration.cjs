/*
 * Live read-only contract test. It intentionally performs no writes unless an
 * isolated tenant fixture is supplied by CI. This catches missing migrations,
 * health RPCs and configuration drift against the deployed Supabase project.
 */
const assert = require('node:assert/strict')

const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '')
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
if (!url || !key) {
  console.error('OPS integration requires SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.')
  process.exit(2)
}

async function rpc(name, body = {}) {
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  let data
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  assert.equal(response.ok, true, `${name} failed: ${response.status} ${text}`)
  return data
}

;(async () => {
  const health = await rpc('gridex_ops_health_checks_v2')
  assert.ok(Array.isArray(health), 'health RPC must return rows')
  const keys = new Set(health.map((row) => row.check_key))
  for (const keyName of [
    'route:receiver_or_mailbox_missing',
    'route:required_receiver_subaddress_missing',
    'workflow:missing_atomic_commit_marker',
  ]) assert.ok(keys.has(keyName), `missing live health key: ${keyName}`)
  console.log(`ops final DB integration passed (${health.length} health rows)`)
})().catch((error) => { console.error(error); process.exit(1) })
