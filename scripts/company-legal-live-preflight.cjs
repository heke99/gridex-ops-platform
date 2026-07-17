#!/usr/bin/env node
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceKey) {
  console.error('Live preflight requires SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.')
  process.exit(2)
}

async function main() {
  const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/gridex_company_legal_contract_runtime_health`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      'content-type': 'application/json',
    },
    body: '{}',
  })

  const body = await response.text()
  if (!response.ok) {
    console.error(`Live preflight RPC failed (${response.status}): ${body}`)
    process.exit(1)
  }

  let health
  try {
    health = JSON.parse(body)
  } catch {
    console.error(`Live preflight returned invalid JSON: ${body}`)
    process.exit(1)
  }

  if (!health?.ok) {
    console.error('Live company/legal/contract runtime is not ready:', JSON.stringify(health, null, 2))
    process.exit(1)
  }

  console.log('Live company/legal/contract runtime preflight passed:', JSON.stringify(health, null, 2))
}

main().catch((error) => {
  console.error('Live preflight failed:', error)
  process.exit(1)
})
