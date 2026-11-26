import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const project = 'aaaaaaaaaaaaaaaaaaaa'
const company = '00000000-0000-4000-8000-000000000100'
const actor = '00000000-0000-4000-8000-000000000200'
const offer = '00000000-0000-4000-8000-000000000300'
const baseUrl = `https://${project}.supabase.co`

function runRoundtrip(overrides: Record<string, string> = {}, rejectCompany = false) {
  const preloader = `
    const baseUrl = ${JSON.stringify(baseUrl)};
    const offer = ${JSON.stringify(offer)};
    const company = ${JSON.stringify(company)};
    let payload;
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(input);
      const body = init.body ? JSON.parse(init.body) : null;
      const path = url.pathname;
      console.log('fixture request: ' + JSON.stringify({ origin: url.origin, path, query: Object.fromEntries(url.searchParams), body, redirect: init.redirect }));
      if (url.origin !== baseUrl || init.redirect !== 'error') throw new Error('Unknown synthetic destination');
      if (path === '/rest/v1/rpc/gridex_upsert_internal_contract_offer_v2') {
        payload = body.p_payload;
        return Response.json({ ok: true, company_id: ${rejectCompany ? 'null' : 'company'}, offer: { id: offer } });
      }
      if (path === '/rest/v1/canonical_internal_contract_offers_v') {
        return Response.json([{ ...payload, id: offer, company_id: company, contract_product_id: 'product', contract_product_version_id: 'version', version_series_id: 'series', currently_sellable: false }]);
      }
      if (path === '/rest/v1/rpc/gridex_delete_unused_contract') return Response.json({ ok: true });
      throw new Error('Unknown synthetic request');
    };
  `
  const env = {
    SUPABASE_URL: baseUrl,
    SUPABASE_SERVICE_ROLE_KEY: 'synthetic-fixture-key',
    GRIDEX_CONTRACT_TEST_COMPANY_ID: company,
    GRIDEX_CONTRACT_TEST_ACTOR_ID: actor,
    GRIDEX_E2E_STAGING_PROJECT_REF: project,
    GRIDEX_CONTRACT_TEST_CONFIRM_STAGING: 'YES',
    ...overrides,
  }
  const result = spawnSync(process.execPath, [
    '--experimental-strip-types',
    '--import', `data:text/javascript;base64,${Buffer.from(preloader).toString('base64')}`,
    'scripts/gridex-contract-staging-roundtrip.mjs',
  ], { cwd: process.cwd(), env, encoding: 'utf8', timeout: 15_000 })
  const requests = result.stdout?.split('\n').flatMap(line =>
    line.startsWith('fixture request: ') ? [JSON.parse(line.slice('fixture request: '.length))] : [],
  ) ?? []
  return { ...result, requests }
}

describe('staging contract roundtrip guarded writer', () => {
  it('uses the guarded draft writer, exact tenant read and ordinary cleanup only', () => {
    const result = runRoundtrip()
    expect(result.status, result.stderr).toBe(0)
    expect(result.requests.map(request => request.path)).toEqual([
      '/rest/v1/rpc/gridex_upsert_internal_contract_offer_v2',
      '/rest/v1/canonical_internal_contract_offers_v',
      '/rest/v1/rpc/gridex_delete_unused_contract',
    ])
    expect(result.requests[0].body).toMatchObject({
      p_company_id: company, p_actor_user_id: actor, p_offer_id: null,
      p_payload: {
        lifecycle_status: 'draft', energy_direction: 'consumption',
        channels: { internal: 'paused', website: 'paused', api: 'paused' },
        pricing_model: expect.any(String), monthly_fee_sek: 49.75,
      },
      p_pricing_snapshot: { energy_direction: 'consumption' },
    })
    expect(result.requests[1].query).toMatchObject({ id: `eq.${offer}`, company_id: `eq.${company}` })
    expect(result.requests[2].body).toEqual({ p_company_id: company, p_actor_user_id: actor, p_offer_id: offer })
  })

  it.each([
    { VERCEL_ENV: 'production' },
    { GRIDEX_CONTRACT_TEST_CONFIRM_STAGING: 'NO' },
    { SUPABASE_URL: 'https://other.example.invalid' },
    { GRIDEX_CONTRACT_TEST_COMPANY_ID: 'invalid-company' },
    { GRIDEX_CONTRACT_TEST_ACTOR_ID: 'invalid-actor' },
  ])('rejects an unapproved target or malformed identifiers before calling any port (%j)', overrides => {
    const result = runRoundtrip(overrides)
    expect(result.status).toBe(2)
    expect(result.requests).toEqual([])
  })

  it('stops without reading or deleting when the receipt cannot confirm the staging tenant', () => {
    const result = runRoundtrip({}, true)
    expect(result.status).toBe(1)
    expect(result.requests.map(request => request.path)).toEqual(['/rest/v1/rpc/gridex_upsert_internal_contract_offer_v2'])
  })
})
