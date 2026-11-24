import 'server-only'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getCustomerPortalContext } from '@/lib/customer-portal/db'
import { formatDate } from '@/lib/customer-portal/format'
import {
  buildPortalDatabasePage,
  decodePortalCursor,
  PortalCursorError,
} from '@/lib/customer-portal/keysetPagination'
import {
  CUSTOMER_VISIBLE_SUPPORT_EVENT_TYPES,
  publicSupportMessage,
  publicSupportStatus,
  SUPPORT_EVENT_TYPES,
} from '@/lib/customer-service/supportConversation'
import { customerMayReadPortalRecords, isPortalCompletionCase, readLinkedPortalCompletion, readPortalCaseSite } from '@/lib/customer-portal/caseProjection'
import { InvalidReadModelResponseError } from '@/lib/read-models/readResult'
import { tenantSelect } from '@/lib/supabase/tenantQuery'
import { isUuid } from '@/lib/validation/uuid'

export const dynamic = 'force-dynamic'

const CASES_PATH = '/portal/arenden'
const HISTORY_LIMIT = 20
const STATUS_LABELS = {
  received: 'Mottaget',
  in_progress: 'Under handläggning',
  resolved: 'Löst',
  closed: 'Avslutat',
}

type CaseScope = { companyId: string; customerId: string; caseId: string }
type EventRow = Parameters<typeof publicSupportMessage>[1]
type Message = ReturnType<typeof publicSupportMessage>
type VisibleEventType = (typeof CUSTOMER_VISIBLE_SUPPORT_EVENT_TYPES)[number]

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function requireAvailableCaseCustomer(scope: CaseScope): Promise<void> {
  if (!await customerMayReadPortalRecords(scope.companyId, scope.customerId)) notFound()
}

async function readPublishedEvents(
  scope: CaseScope,
  types: readonly VisibleEventType[],
  limit: number,
  boundary?: ReturnType<typeof decodePortalCursor>,
): Promise<EventRow[]> {
  let query = tenantSelect(scope.companyId, 'customer_case_events', 'id,company_id,customer_id,customer_case_id,event_type,message,visibility:payload->>visibility,kind:payload->>kind,created_at')
    .eq('customer_id', scope.customerId)
    .eq('customer_case_id', scope.caseId)
    .in('event_type', [...types])
    .eq('payload->>visibility', 'customer')
  if (boundary) {
    query = query.or(`created_at.lt.${boundary.orderValue},and(created_at.eq.${boundary.orderValue},id.lt.${boundary.id})`)
  }

  const { data, error } = await query.order('created_at', { ascending: false })
    .order('id', { ascending: false }).limit(limit)
  if (error) throw error
  if (!Array.isArray(data)) throw new InvalidReadModelResponseError()
  return data.map((row: unknown) => {
    if (!isRecord(row) || row.company_id !== scope.companyId
      || row.customer_id !== scope.customerId || row.customer_case_id !== scope.caseId
      || typeof row.id !== 'string' || !isUuid(row.id) || typeof row.created_at !== 'string' || !row.created_at
      || typeof row.message !== 'string' || typeof row.event_type !== 'string'
      || !types.some(type => type === row.event_type) || row.visibility !== 'customer') {
      throw new InvalidReadModelResponseError()
    }
    return {
      id: row.id,
      customer_case_id: scope.caseId,
      event_type: row.event_type,
      message: row.message,
      payload: { visibility: row.visibility, kind: row.kind },
      created_by: null,
      created_at: row.created_at,
    }
  })
}

function SupportMessage({ item }: { item: Message }) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <strong className="text-sm font-semibold text-slate-900">
          {item.author_type === 'staff' ? 'Supporten' : 'Du'}
        </strong>
        <time dateTime={item.created_at} className="text-sm text-slate-600">{formatDate(item.created_at)}</time>
      </div>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-800">{item.body}</p>
    </div>
  )
}

export default async function PortalCaseConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ caseId: string }>
  searchParams?: Promise<{ cursor?: string | string[] }>
}) {
  const context = await getCustomerPortalContext()
  const { caseId } = await params
  const { cursor } = await searchParams ?? {}
  if (!context.companyId || context.customerIds.length === 0 || !isUuid(caseId) || Array.isArray(cursor)) notFound()
  const { data: row, error } = await tenantSelect(context.companyId, 'customer_cases', 'id,company_id,customer_id,site_id,status,source,reason_category,completion_id:metadata->>completionId,created_at')
    .eq('id', caseId)
    .in('customer_id', context.customerIds)
    .maybeSingle()
  if (error) throw error
  if (!isRecord(row) || row.id !== caseId || row.company_id !== context.companyId
    || typeof row.customer_id !== 'string' || !context.customerIds.includes(row.customer_id)) notFound()

  const scope = { companyId: context.companyId, customerId: row.customer_id, caseId }
  await requireAvailableCaseCustomer(scope)
  const resource = `web_case_conversation:${caseId}`
  let boundary
  try {
    boundary = decodePortalCursor({ ...scope, cursor, resource })
  } catch (failure) {
    if (failure instanceof PortalCursorError) notFound()
    throw failure
  }
  const siteId = typeof row.site_id === 'string' ? row.site_id : null
  const isCompletion = isPortalCompletionCase(typeof row.source === 'string' ? row.source : null,
    typeof row.reason_category === 'string' ? row.reason_category : null)
  const [history, latestStaffRows, completion, site] = await Promise.all([
    readPublishedEvents(scope, CUSTOMER_VISIBLE_SUPPORT_EVENT_TYPES, HISTORY_LIMIT + 1, boundary),
    cursor ? [] : readPublishedEvents(scope, [SUPPORT_EVENT_TYPES.staffReply], 1),
    isCompletion ? readLinkedPortalCompletion({ ...scope, siteId, completionId: row.completion_id }) : null,
    siteId ? readPortalCaseSite(scope.companyId, scope.customerId, siteId) : null,
  ])
  const [currentCase] = await Promise.all([
    tenantSelect(scope.companyId, 'customer_cases', 'id')
      .eq('id', scope.caseId).eq('customer_id', scope.customerId).maybeSingle(),
    requireAvailableCaseCustomer(scope),
  ])
  if (currentCase.error) throw currentCase.error
  if (!isRecord(currentCase.data) || currentCase.data.id !== scope.caseId) notFound()

  const page = buildPortalDatabasePage(history, { ...scope, resource, limit: HISTORY_LIMIT, orderColumn: 'created_at' })
  const latest = latestStaffRows[0] ? publicSupportMessage(scope.companyId, latestStaffRows[0]) : null
  const messages = page.items.map(item => publicSupportMessage(scope.companyId, item))
    .filter(item => item.message_reference !== latest?.message_reference)
  const detailHref = `${CASES_PATH}/${caseId}`
  const status = typeof row.status === 'string' ? row.status : null
  const createdAt = typeof row.created_at === 'string' ? row.created_at : null

  return (
    <div className="space-y-6">
      <Link href={CASES_PATH} className="text-sm font-semibold text-emerald-800">Tillbaka till Mina ärenden</Link>
      <section className="rounded-3xl border border-slate-200 bg-white p-6">
        <h1 className="text-2xl font-bold text-slate-950">{isCompletion ? 'Kompletterade uppgifter' : 'Ärendets konversation'}</h1>
        <p className="mt-2 text-sm text-slate-600">
          {STATUS_LABELS[publicSupportStatus(status)]} · Skapat {formatDate(createdAt)}
        </p>
        {site ? <p className="mt-2 text-sm text-slate-700">Anläggning {site.label}</p> : null}
      </section>

      {completion ? (
        <section className="rounded-3xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-slate-950">Ditt inskick</h2>
          <p className="mt-2 text-sm text-slate-700" role="status">
            {status === 'resolved' || status === 'closed' || status === 'cancelled'
              ? 'Inskicket har sparats och ärendet är avslutat.'
              : 'Inskicket har sparats. Kundservice granskar uppgifterna och kontaktar dig om något mer behövs.'}
          </p>
          {completion.reference ? <p className="mt-2 text-sm text-slate-700">Kvitto {completion.reference}</p> : null}
          <dl className="mt-4 space-y-3 text-sm">
            {completion.fields.map(([name, value]) => (
              <div key={name}><dt className="font-semibold">{name}</dt><dd className="break-words whitespace-pre-wrap">{value}</dd></div>
            ))}
          </dl>
        </section>
      ) : null}

      {!cursor ? (
        <section className="rounded-3xl border border-slate-200 bg-white p-6">
          <h2 className="mb-3 text-lg font-semibold text-slate-950">Senaste svar från supporten</h2>
          {latest ? <SupportMessage item={latest} /> : <p className="text-sm text-slate-600">Inga publicerade svar ännu.</p>}
        </section>
      ) : null}

      {messages.length > 0 ? (
        <section className="rounded-3xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-slate-950">{cursor ? 'Äldre meddelanden' : 'Övriga meddelanden'}</h2>
          <ol className="divide-y divide-slate-200">
            {messages.map(item => <li key={item.message_reference} className="py-3"><SupportMessage item={item} /></li>)}
          </ol>
        </section>
      ) : null}

      {page.page.next_cursor ? (
        <Link href={`${detailHref}?cursor=${encodeURIComponent(page.page.next_cursor)}`} prefetch={false} className="text-sm font-semibold text-emerald-800">
          Visa äldre meddelanden
        </Link>
      ) : null}
    </div>
  )
}
