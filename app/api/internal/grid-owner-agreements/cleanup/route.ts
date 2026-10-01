import { timingSafeEqual } from 'node:crypto'
import { agreementCleanupInput, processAgreementCleanup } from '@/lib/routes/gridOwnerAgreementCleanup'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const json = (value: unknown, status: number) => Response.json(value, { status, headers: {
  'cache-control': 'private, no-store, max-age=0', 'x-content-type-options': 'nosniff',
} })
const denied = (error: string, status: number) => json({ error }, status)
async function boundedBody(request: Request) {
  const declared = request.headers.get('content-length')
  if (!request.body || !/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '') ||
    (declared && (!/^\d+$/.test(declared) || Number(declared) > 512))) throw new Error('invalid_request')
  const reader = request.body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  const deadline = Date.now() + 5000
  try {
    while (true) {
      if (Date.now() >= deadline) throw new Error('invalid_request')
      let timer: ReturnType<typeof setTimeout> | undefined
      const next = await Promise.race([reader.read(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('invalid_request')), Math.max(1, deadline - Date.now()))
      })]).finally(() => clearTimeout(timer))
      if (next.done) break
      size += next.value.byteLength
      if (size > 512) throw new Error('invalid_request')
      chunks.push(next.value)
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) as unknown
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
}
export async function POST(request: Request) {
  if (request.method !== 'POST') return denied('method_not_allowed', 405)
  const expected = process.env.GRIDEX_AGREEMENT_CLEANUP_SECRET
  if (!expected || Buffer.byteLength(expected) < 32 || Buffer.byteLength(expected) > 256) return denied('agreement_cleanup_unconfigured', 503)
  const header = request.headers.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (token.length > 256) return denied('unauthorized', 401)
  const supplied = Buffer.from(token), configured = Buffer.from(expected)
  if (supplied.byteLength !== configured.byteLength || !timingSafeEqual(supplied, configured)) return denied('unauthorized', 401)
  let input
  try {
    if (new URL(request.url).search) throw new Error('invalid_request')
    input = agreementCleanupInput.safeParse(await boundedBody(request))
    if (!input.success) return denied('invalid_agreement_cleanup', 422)
  } catch { return denied('invalid_agreement_cleanup', 422) }
  try { return json({ result: await processAgreementCleanup(input.data) }, 202) }
  catch { return denied('agreement_cleanup_unavailable', 503) }
}
