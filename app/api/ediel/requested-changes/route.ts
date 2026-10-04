import {NextRequest, NextResponse} from 'next/server'
import {z, ZodError} from 'zod'
import {requireAdminApiAccess} from '@/lib/admin/apiGuards'
import {prepareAndQueueProdatRequestedChange} from '@/lib/ediel/flows/prodatRequestedChange'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const headers = {'Cache-Control': 'private, no-store'}
const command = z.object({eventId: z.string().uuid(), preferredRouteId: z.string().uuid().nullable().optional()}).strict()

/** This command selects an already qualified immutable event. It does not
 * establish a death/contract fact or choose the acting tenant/environment. */
export async function POST(request: NextRequest) {
  let authorizationRead = false
  try {
    const access = await requireAdminApiAccess(['communication.write'])
    authorizationRead = true
    if (access.response) {
      access.response.headers.set('Cache-Control', headers['Cache-Control'])
      return access.response
    }
    if (!access.guard.companyId) return NextResponse.json({error: 'Välj ett behörigt bolag.'}, {status: 403, headers})
    const input = command.parse(await request.json())
    const result = await prepareAndQueueProdatRequestedChange({...input, companyId: access.guard.companyId, actorUserId: access.guard.userId})
    if (result.status === 'held') return NextResponse.json(result, {status: 409, headers})
    // Preserve the distinction between durable queueing and an existing result;
    // never expose the source wire/customer facts through a write-only command.
    return NextResponse.json({status: result.status, messageId: result.message.id,
      intentId: result.message.intent_id, outboundRequestId: result.message.outbound_request_id},
      {status: result.status === 'queued' ? 202 : 200, headers})
  } catch (error) {
    if (!authorizationRead) return NextResponse.json({error: 'Behörigheten kunde inte verifieras.'}, {status: 503, headers})
    const invalid = error instanceof ZodError || error instanceof SyntaxError
    return NextResponse.json({error: invalid ? 'Ogiltig ändringsbegäran.' : 'Begäran saknar aktuellt behörigt källunderlag.'},
      {status: invalid ? 400 : 403, headers})
  }
}
