import {
  captureSyntheticSpotSource, readSyntheticSpotBody, readSyntheticSpotSource,
  syntheticSpotHttp, syntheticSpotJson, syntheticSpotOriginalResponse, syntheticSpotUuid,
} from '@/lib/pricing/syntheticSpotSources'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  return syntheticSpotHttp('write', async scope => {
    const key = syntheticSpotUuid(request.headers.get('Idempotency-Key'))
    const result = await captureSyntheticSpotSource(scope, key, await readSyntheticSpotBody(request))
    return syntheticSpotJson({ data: result }, result.replayed ? 200 : 201)
  })
}

export async function GET(request: Request) {
  return syntheticSpotHttp('read', async scope => {
    const url = new URL(request.url)
    const ids = url.searchParams.getAll('id'), keys = url.searchParams.getAll('requestKey')
    const download = url.searchParams.get('download')
    if ([...url.searchParams.keys()].some(key => !['id', 'requestKey', 'download'].includes(key)) || ids.length + keys.length !== 1
      || url.searchParams.getAll('download').length > 1 || download !== null && download !== 'original') {
      return syntheticSpotJson({ error: 'synthetic_spot_source_invalid', code: 'synthetic_spot_source_invalid' }, 400)
    }
    const selector = ids.length ? { sourceId: syntheticSpotUuid(ids[0]) } : { requestKey: syntheticSpotUuid(keys[0]) }
    const result = await readSyntheticSpotSource(scope, selector, download === 'original')
    return result.original ? syntheticSpotOriginalResponse(result.receipt.source_id, result.original) : syntheticSpotJson({ data: result.receipt })
  })
}
