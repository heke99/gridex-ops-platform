import { SEND_CONTRACT_SIGNATURE_REQUIREMENT, SIGNATURE_COMPANY_NOT_OPERATIONAL } from './policy'
import { canSendSignatureForCompany } from '@/lib/tenant/governance'
import Link from 'next/link'
import { randomUUID } from 'node:crypto'
import { isPlatformAdminContext, requireAdminPageAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import {
  assertContractTenant,
  loadCustomerTenantContext,
} from '@/lib/tenant/entityGuards'
import { sendContractSignatureLinkAction } from './actions'
import { contractHasValidSigningSite, SIGNING_LINK_SITE_REQUIRED_MESSAGE } from '@/lib/customer-contracts/autoSendSigningLink'
import { formatStatusLabel } from '@/lib/ui/format'
import { canPresentAdminAction } from '@/lib/admin/actionPresentation'

export const dynamic = 'force-dynamic'

type SignatureRequestDelivery =
  | 'queued' | 'processing' | 'sent' | 'delivered' | 'failed'
  | 'delivery_uncertain' | 'cancelled' | 'blocked' | 'complained'
  | 'unknown' | 'unavailable'

const signatureEvent = 'contract.signature_requested'
type SignatureHistoryScope = { companyId: string; customerId: string; contractId: string }
type TransportStatus = { status: string | null; provider_message_id: string | null }

function communicationOutcome(log: TransportStatus): SignatureRequestDelivery {
  switch (log.status) {
    case 'sent':
    case 'delivered':
    case 'complained':
      return log.provider_message_id ? log.status : 'unknown'
    case 'failed':
    case 'bounced':
      return 'failed'
    case 'cancelled':
      return 'cancelled'
    case 'blocked':
      return 'blocked'
    default:
      return 'unknown'
  }
}

function deliveryOutcome(log: TransportStatus, queue: TransportStatus | undefined): SignatureRequestDelivery {
  if (!queue) return communicationOutcome(log)
  // A provider callback can finish a send whose queue write was interrupted.
  if (log.provider_message_id && log.provider_message_id === queue.provider_message_id) {
    if (log.status === 'delivered') return 'delivered'
    if (log.status === 'bounced' || log.status === 'failed') return 'failed'
    if (log.status === 'complained') return 'complained'
  }
  switch (queue.status) {
    case 'queued':
    case 'processing':
    case 'sent':
    case 'failed':
    case 'delivery_uncertain':
    case 'cancelled':
      return queue.status
    case 'blocked_tenant_state':
      return 'blocked'
    default:
      return 'unknown'
  }
}

/** Call after the standard company, customer and contract read guard. */
async function readSignatureRequestDelivery(scope: SignatureHistoryScope, requestIds: readonly string[]) {
  const status = new Map<string, SignatureRequestDelivery>()
  if (requestIds.length === 0) return status
  const limit = 2 * requestIds.length + 1
  const logResult = await supabaseService.from('communication_logs')
    .select('id,status,provider_message_id,signature_request_id:metadata->>signature_request_id', { count: 'exact' })
    .eq('company_id', scope.companyId)
    .eq('customer_id', scope.customerId)
    .eq('contract_id', scope.contractId)
    .eq('event_key', signatureEvent)
    .in('metadata->>signature_request_id', requestIds)
    .limit(limit)
  const logs = logResult.data
  if (logResult.error || !Array.isArray(logs) || logs.length !== logResult.count
    || logs.some(log => !log || typeof log.id !== 'string' || !requestIds.includes(log.signature_request_id))) {
    for (const id of requestIds) status.set(id, 'unavailable')
    return status
  }

  const singleLogs = requestIds.flatMap(id => {
    const matches = logs.filter(log => log.signature_request_id === id)
    return matches.length === 1 ? matches : []
  })
  if (singleLogs.length === 0) return status

  const logIds = singleLogs.map(log => log.id)
  const queueResult = await supabaseService.from('tenant_email_outbox')
    .select('communication_log_id,status,provider_message_id', { count: 'exact' })
    .eq('company_id', scope.companyId)
    .eq('customer_id', scope.customerId)
    .eq('email_type', signatureEvent)
    .in('communication_log_id', logIds)
    .limit(limit)
  const queue = queueResult.data
  if (queueResult.error || !Array.isArray(queue) || queue.length !== queueResult.count
    || queue.some(row => !row?.communication_log_id || !logIds.includes(row.communication_log_id))) {
    for (const log of singleLogs) status.set(log.signature_request_id, 'unavailable')
    return status
  }
  for (const log of singleLogs) {
    const matches = queue.filter(row => row.communication_log_id === log.id)
    status.set(log.signature_request_id, matches.length > 1 ? 'unknown' : deliveryOutcome(log, matches[0]))
  }
  return status
}

const deliveryCopy: Record<SignatureRequestDelivery, { label: string; next?: string }> = {
  queued: { label: 'Köat' },
  processing: { label: 'Bearbetas', next: 'Leveransen är ännu obekräftad.' },
  sent: { label: 'Skickat' },
  delivered: { label: 'Levererat' },
  failed: { label: 'Misslyckat', next: 'Kontrollera den aktuella länkens status innan du skapar en ny.' },
  delivery_uncertain: { label: 'Osäker leverans', next: 'Be driftansvarig kontrollera utskicket innan en ny länk skapas.' },
  cancelled: { label: 'Avbrutet' },
  blocked: { label: 'Blockerat', next: 'Be driftansvarig kontrollera varför utskicket är blockerat.' },
  complained: { label: 'Klagomål registrerat' },
  unknown: { label: 'Obekräftad leveransstatus', next: 'Kontrollera utskicket innan en ny länk skapas.' },
  unavailable: { label: 'Leveransstatus gick inte att läsa' },
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('sv-SE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Stockholm',
  }).format(date)
}

export default async function ContractSignatureAdminPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; contractId: string }>
  searchParams: Promise<{ sent?: string; error?: string; notice?: string; warning?: string }>
}) {
  const { id: customerId, contractId } = await params
  const query = await searchParams
  const access = await requireAdminPageAccess({ anyOf: ['contracts.write', 'contracts.read'] })
  const { companyId } = await loadCustomerTenantContext(customerId, access)
  await assertContractTenant({ companyId, customerId, contractId })
  const canWrite = await canPresentAdminAction(SEND_CONTRACT_SIGNATURE_REQUIREMENT)

  const [{ data: customer, error: customerError }, { data: contract, error: contractError }, { data: requests, error: requestError }] =
    await Promise.all([
      supabaseService
        .from('customers')
        .select('full_name,company_name,email,customer_number')
        .eq('id', customerId)
        .eq('company_id', companyId)
        .single(),
      supabaseService
        .from('customer_contracts')
        .select('id,contract_name,contract_number,status,signed_at,starts_at,offer_reference,signature_snapshot_sha256')
        .eq('id', contractId)
        .eq('customer_id', customerId)
        .eq('company_id', companyId)
        .single(),
      supabaseService
        .from('customer_contract_signature_requests')
        .select('id,recipient_email,channel,expires_at,sent_at,used_at,revoked_at,created_at')
        .eq('customer_contract_id', contractId)
        .eq('company_id', companyId)
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(10),
    ])
  if (customerError) throw customerError
  if (contractError) throw contractError
  if (requestError) throw requestError

  const history = requests ?? []
  const deliveries = await readSignatureRequestDelivery({ companyId, customerId, contractId }, history.map(request => request.id))
  const canOpenDeliveryReview = isPlatformAdminContext(access)
  const historyPath = `/admin/customers/${customerId}/contracts/${contractId}/signature#signeringshistorik`

  const canAttemptSend = ['draft', 'pending_signature', 'signature_failed'].includes(contract.status) && !contract.signed_at
  const siteReady = canAttemptSend ? await contractHasValidSigningSite({ companyId, customerId, contractId }) : true
  const companyCanSend = !canWrite || !canAttemptSend || await canSendSignatureForCompany(companyId)
  const canPrepare = canWrite && canAttemptSend && siteReady && companyCanSend
  // The history is bounded. Resolve the exact replacement target separately.
  const previous = canPrepare ? await supabaseService.from('customer_contract_signature_requests')
    .select('id').eq('company_id', companyId).eq('customer_id', customerId)
    .eq('customer_contract_id', contractId).is('revoked_at', null).is('used_at', null).limit(2) : null
  const canSend = canPrepare && !previous?.error && Boolean(previous?.data && previous.data.length <= 1)
  const expectedRequestId = previous?.data?.[0]?.id

  const customerName = customer.full_name ?? customer.company_name ?? customer.email ?? customer.customer_number

  return (
    <main className="mx-auto max-w-4xl space-y-5 px-4 py-8">
      <div>
        <Link href={`/admin/customers/${customerId}?tab=contracts#contracts`} className="text-sm font-medium text-slate-600 hover:text-slate-950">
          ← Tillbaka till kundkortet
        </Link>
      </div>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="text-sm text-slate-500">Online-signering</div>
        <h1 className="mt-1 text-2xl font-semibold text-slate-950">{contract.contract_name}</h1>
        <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div><span className="text-slate-500">Kund:</span> {customerName}</div>
          <div><span className="text-slate-500">Kundnummer:</span> {customer.customer_number ?? '—'}</div>
          <div><span className="text-slate-500">Avtalsnummer:</span> {contract.contract_number ?? '—'}</div>
          <div><span className="text-slate-500">Status:</span> {formatStatusLabel(contract.status)}</div>
          <div><span className="text-slate-500">Planerad start:</span> {formatDateTime(contract.starts_at)}</div>
          <div><span className="text-slate-500">Signerat:</span> {formatDateTime(contract.signed_at)}</div>
        </div>
      </section>

      {query.sent === '1' ? (
        <p className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-800">
          Följ mejlets aktuella leveransstatus i <a href="#signeringshistorik" className="font-medium underline">signeringshistoriken</a>.
        </p>
      ) : null}
      {query.notice ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          {query.notice}
        </div>
      ) : null}
      {query.warning ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {query.warning}
        </div>
      ) : null}
      {query.error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          {query.error}
        </div>
      ) : null}

      {!siteReady ? (
        <div role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {SIGNING_LINK_SITE_REQUIRED_MESSAGE}
        </div>
      ) : null}
      {canPrepare && !canSend ? (
        <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          Det går inte att fastställa vilken signeringslänk som kan ersättas. Kontrollera signeringshistoriken innan du fortsätter.
        </p>
      ) : null}
      {canSend ? (
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Skicka signeringslänk</h2>
          <p className="mt-2 text-sm leading-6 text-slate-700">
            Kunden får en säker engångslänk. På signeringssidan visas den frysta pris- och villkorsversionen och kunden signerar genom att trycka på en enda knapp.
          </p>
          <form action={sendContractSignatureLinkAction} className="mt-5 space-y-4">
            <input type="hidden" name="customer_id" value={customerId} />
            <input type="hidden" name="contract_id" value={contractId} />
            <input type="hidden" name="signature_command_id" value={randomUUID()} />
            <input type="hidden" name="expected_signature_request_id" value={expectedRequestId ?? ''} />
            <label className="grid gap-1 text-sm">
              <span className="font-medium text-slate-700">Mottagarens e-post</span>
              <input
                type="email"
                name="recipient_email"
                required
                defaultValue={customer.email ?? ''}
                className="rounded-2xl border border-slate-300 px-4 py-3"
              />
            </label>
            <button className="w-full rounded-2xl bg-emerald-700 px-5 py-3 font-semibold text-white hover:bg-emerald-800">
              {contract.status === 'pending_signature' ? 'Skicka ny signeringslänk' : 'Skicka signeringslänk'}
            </button>
          </form>
        </section>
      ) : (
        <section className="rounded-3xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="font-semibold">Ingen manuell signering är möjlig</h2>
          <p className="mt-2 text-sm text-slate-700">
            {!canWrite
              ? 'En behörig handläggare behöver skicka signeringslänken. Du kan följa avtalet och signeringshistoriken här.'
              : contract.signed_at
              ? 'Avtalet är redan signerat och signeringsbeviset är låst.'
              : !companyCanSend
              ? SIGNATURE_COMPANY_NOT_OPERATIONAL
              : !siteReady
                ? 'Välj och spara rätt anläggning på kundkortets avtal för att kunna skicka signeringslänken.'
                : 'Avtalet kan inte skickas för signering i nuvarande livscykelstatus.'}
          </p>
        </section>
      )}

      <section id="signeringshistorik" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Signeringshistorik</h2>
          {history.length > 0 ? (
            <form action={historyPath} method="get">
              <button type="submit" className="text-sm font-medium text-slate-700 underline">Läs om leveransstatus</button>
            </form>
          ) : null}
        </div>
        <div className="mt-4 space-y-3">
          {history.length === 0 ? (
            <p className="text-sm text-slate-600">Ingen signeringslänk har skapats ännu.</p>
          ) : (
            history.map((request) => {
              const delivery = deliveries.get(request.id) ?? 'unknown'
              const copy = deliveryCopy[delivery]
              return (
                <div key={request.id} className="rounded-2xl border border-slate-200 p-4 text-sm">
                  <div className="font-medium">{request.recipient_email}</div>
                  <div className="mt-1 text-slate-600">
                    Skapad {formatDateTime(request.created_at)} · giltig till {formatDateTime(request.expires_at)}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {request.used_at
                      ? `Använd ${formatDateTime(request.used_at)}`
                      : request.revoked_at
                        ? `Återkallad ${formatDateTime(request.revoked_at)}`
                        : request.sent_at
                          ? `Utskick begärt ${formatDateTime(request.sent_at)}`
                          : 'Skapad men ännu inte markerad som skickad'}
                  </div>
                  <div className="mt-2 font-medium text-slate-800">Mejl: {copy.label}</div>
                  {copy.next ? <p className="mt-1 text-xs text-slate-600">{copy.next}</p> : null}
                  {canOpenDeliveryReview && delivery === 'delivery_uncertain' ? (
                    <Link href="/admin/system-health" className="mt-2 inline-block text-xs font-medium text-slate-700 underline">
                      Öppna systemhälsan
                    </Link>
                  ) : null}
                </div>
              )
            })
          )}
        </div>
      </section>
    </main>
  )
}
