import { parseSyntheticSpotReview, readSyntheticSpotBody, reviewSyntheticSpotSource, syntheticSpotHttp, syntheticSpotJson } from '@/lib/pricing/syntheticSpotSources'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request, { params }: { params: Promise<{ sourceId: string }> }) {
  return syntheticSpotHttp('write', async scope => {
    const { sourceId } = await params
    const command = parseSyntheticSpotReview(await readSyntheticSpotBody(request))
    return syntheticSpotJson({ data: await reviewSyntheticSpotSource(scope, sourceId, command) })
  })
}
