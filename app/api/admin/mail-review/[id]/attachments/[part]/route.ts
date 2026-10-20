import { createHash } from 'node:crypto'
import { requireAdminApiAccess, jsonError } from '@/lib/admin/apiGuards'
import { supabaseService } from '@/lib/supabase/service'
import { object } from '@/lib/inbound-mail/manualMailReviewQueue'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export async function GET(_request: Request, context: { params: Promise<{ id: string; part: string }> }) {
  const access = await requireAdminApiAccess()
  if (access.response) return access.response
  if (!access.guard.isPlatformAdmin) return jsonError('Endast plattformsadmin kan granska originalbilagor.', 403)
  const { id, part } = await context.params
  if (!/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(id) || !/^\d{1,5}$/.test(part)) return jsonError('Ogiltig bilagereferens.', 400)
  const { data, error } = await supabaseService.from('manual_inbound_messages').select('id,attachments').eq('id', id).maybeSingle()
  if (error) return jsonError('Originalbilagan kunde inte hämtas.', 500)
  if (!data) return jsonError('Mejlet hittades inte.', 404)
  const matching = (Array.isArray(data.attachments) ? data.attachments : []).map(object).filter(a => a.mimePart === Number(part))
  if (!matching.length) return jsonError('Bilagan hittades inte.', 404)
  if (matching.length !== 1) return jsonError('Bilagans originalunderlag är tvetydigt.', 422)
  const a = matching[0]
  if (typeof a.contentBase64 !== 'string' || typeof a.sizeBytes !== 'number' || !Number.isSafeInteger(a.sizeBytes) || a.sizeBytes < 1 || a.sizeBytes > 4 * 1024 * 1024 || a.contentBase64.length > 5592408 || typeof a.sha256 !== 'string') return jsonError('Komplett originalunderlag saknas.', 422)
  const bytes = Buffer.from(a.contentBase64, 'base64')
  if (bytes.toString('base64') !== a.contentBase64 || bytes.length !== a.sizeBytes || createHash('sha256').update(bytes).digest('hex') !== a.sha256) return jsonError('Bilagans originalunderlag kunde inte verifieras.', 422)
  const filename = (typeof a.filename === 'string' ? a.filename : `bilaga-${part}`).replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 120) || `bilaga-${part}`
  return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${filename}"`, 'Content-Security-Policy': "sandbox; default-src 'none'", 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' } })
}
