import { canonicalComposite, parseCanonicalEdifactAst } from '@/lib/ediel/core/canonicalEdifactAst'
import { validateEdifactEnvelope } from '@/lib/ediel/core/edifactValidation'
import { findE66GridOwnerDataRequest, matchMeteringPointIdByIdentifier, matchSiteAndCustomerForMeteringPoint } from '@/lib/ediel/matching'
import { assertEdielTenantActor } from '@/lib/ediel/services/authorization'
import { supabaseService } from '@/lib/supabase/service'
import type { EdielEnvironment } from '@/lib/ediel/types'

type E66Reference = {
  environment: EdielEnvironment
  reference: string
  meteringPoint: string
  sender: string
  receiver: string
  senderSubaddress: string | null
  receiverSubaddress: string | null
}

function readE66Reference(ast: ReturnType<typeof parseCanonicalEdifactAst>): E66Reference | null {
  const [message] = ast.messages
  if (ast.messages.length !== 1 || message.family !== 'UTILTS' || message.messageCode !== 'E66') return null
  const unb = ast.segments[0]
  const environment = canonicalComposite(unb, 11, ast.una)[0] === '1' ? 'test' : 'production'
  const unh = message.segments.find(segment => segment.tag === 'UNH')
  if (canonicalComposite(unh, 2, ast.una).join(':') !== 'UTILTS:D:02B:UN:E5SE5A' ||
      ast.applicationReference !== `23-DDQ-E66-${environment === 'test' ? 'T' : 'S'}`) return null
  const transactions = message.utiltsTransactions ?? []
  if (transactions.length !== 1 || !ast.senderEdielId || !ast.receiverEdielId) return null
  const transaction = transactions[0]
  const references = message.segments.filter(segment => segment.tag === 'RFF' && segment.index < transaction.segmentIndex)
    .map(segment => canonicalComposite(segment, 1, ast.una)).filter(([qualifier]) => qualifier === 'ACW')
  const points = transaction.segments.filter(segment => segment.tag === 'LOC' && canonicalComposite(segment, 1, ast.una)[0] === '172')
  const reference = references[0]?.[1]
  const point = canonicalComposite(points[0], 2, ast.una)[0]
  if (references.length !== 1 || references[0].length !== 2 || !reference || reference.length > 70 ||
      points.length !== 1 || !/^\d{18}$/.test(point ?? '')) return null

  return {
    environment,
    reference,
    meteringPoint: point,
    sender: ast.senderEdielId,
    receiver: ast.receiverEdielId,
    senderSubaddress: canonicalComposite(unb, 2, ast.una)[2] || null,
    receiverSubaddress: canonicalComposite(unb, 3, ast.una)[2] || null,
  }
}

export function inspectRetainedEdifactPart(payload: string) {
  const syntax = validateEdifactEnvelope(payload)
  if (!syntax.ok) return { valid: false, issues: syntax.issues.map(issue => issue.message), reference: null } as const
  const reference = readE66Reference(parseCanonicalEdifactAst(payload))
  return { valid: true, issues: [], reference } as const
}

export async function readRetainedEdifactReviewTarget(input: {
  actorUserId: string
  selectedCompanyId: string | null
  mail: Record<string, unknown>
  reference: E66Reference
}): Promise<{ customerId: string; siteId: string } | null> {
  const { mail, reference, actorUserId, selectedCompanyId: companyId } = input
  if (!companyId || mail.company_id !== companyId || mail.environment !== reference.environment ||
      typeof mail.mailbox_id !== 'string') return null

  const { data: mailbox, error: mailboxError } = await supabaseService.from('ediel_mailboxes')
    .select('id,company_id,environment,is_shared_platform_mailbox').eq('id', mail.mailbox_id).eq('company_id', companyId)
    .eq('environment', reference.environment).eq('is_shared_platform_mailbox', false).maybeSingle()
  if (mailboxError) throw mailboxError
  if (!mailbox || mailbox.id !== mail.mailbox_id || mailbox.company_id !== companyId ||
      mailbox.environment !== reference.environment || mailbox.is_shared_platform_mailbox !== false) return null
  await assertEdielTenantActor({ companyId, actorUserId, permission: 'metering.read' })

  const meteringPointId = await matchMeteringPointIdByIdentifier({ companyId, identifiers: [reference.meteringPoint], requireUnique: true })
  if (!meteringPointId) return null
  const { request } = await findE66GridOwnerDataRequest({ companyId, actorUserId, environment: reference.environment,
    reference: reference.reference, hasAmbiguousReferences: false, meteringPointId })
  if (!request?.site_id || !request.customer_id) return null

  const [owner, sent] = await Promise.all([
    matchSiteAndCustomerForMeteringPoint({ meteringPointId, companyId }),
    supabaseService.from('ediel_messages').select('sender_ediel_id,receiver_ediel_id,sender_sub_address,receiver_sub_address')
      .eq('company_id', companyId).eq('environment', reference.environment).eq('grid_owner_data_request_id', request.id)
      .eq('metering_point_id', meteringPointId).eq('direction', 'outbound').eq('message_standard', 'edifact')
      .eq('message_family', 'UTILTS').eq('message_code', 'E73').in('status', ['sent', 'acknowledged'])
      .not('message_sent_at', 'is', null).limit(2),
  ])
  if (sent.error) throw sent.error
  const [original] = sent.data ?? []
  if (sent.data?.length !== 1 || original.sender_ediel_id !== reference.receiver || original.receiver_ediel_id !== reference.sender ||
      (original.sender_sub_address || null) !== reference.receiverSubaddress ||
      (original.receiver_sub_address || null) !== reference.senderSubaddress ||
      owner?.customerId !== request.customer_id || owner.siteId !== request.site_id) return null
  return { customerId: request.customer_id, siteId: request.site_id }
}
