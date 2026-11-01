import { createSyntheticPricingCompany, readSyntheticCompanyBody, readSyntheticPricingCompany, syntheticCompanyHttp, syntheticCompanyJson, syntheticCompanyUuid } from '@/lib/pricing/syntheticPricingCompanies'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  return syntheticCompanyHttp(async actorId => {
    const key = syntheticCompanyUuid(request.headers.get('Idempotency-Key'))
    const result = await createSyntheticPricingCompany(actorId, key, await readSyntheticCompanyBody(request))
    return syntheticCompanyJson({ data: result }, result.replayed ? 200 : 201)
  })
}
export async function GET(request: Request) {
  return syntheticCompanyHttp(async actorId => {
    const params = new URL(request.url).searchParams
    if (params.getAll('requestKey').length !== 1 || [...params.keys()].some(key => key !== 'requestKey')) {
      return syntheticCompanyJson({ error: 'synthetic_pricing_company_invalid', code: 'synthetic_pricing_company_invalid' }, 400)
    }
    return syntheticCompanyJson({ data: await readSyntheticPricingCompany(actorId, syntheticCompanyUuid(params.get('requestKey'))) })
  })
}
