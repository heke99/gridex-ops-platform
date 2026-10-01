import { getCustomerPortalContext } from "@/lib/customer-portal/db";
import type { CustomerPortalCaseRow } from '@/lib/customer-portal/types'
import { formatDate } from "@/lib/customer-portal/format";
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { randomUUID } from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'
import { currentSupportSession } from '@/lib/customer-operations/supportSession'
import { readCustomerSupportPage, type CustomerSupportCase, type CustomerSupportMessage } from '@/lib/customer-cases/customerRead'
import { publicReference } from '@/lib/integrations/publicReferences'
import { readPortalCasePublicationsPage } from '@/lib/customer-cases/portalCasePublicationsPage'
import SupportActionForm from '@/lib/customer-cases/SupportActionForm'
import { readSupportAttachments } from '@/lib/customer-cases/attachments'
import { createPortalSupportCaseAction, createPortalSupportCaseFallbackAction, replyPortalSupportCaseAction, replyPortalSupportCaseFallbackAction, uploadPortalSupportAttachmentAction, uploadPortalSupportAttachmentFallbackAction } from './actions'

export const dynamic = "force-dynamic";

function tone(status: string) {
  if (["resolved", "closed", "done"].includes(String(status)))
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "waiting_for_customer")
    return "border-red-200 bg-red-50 text-red-800";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

export default async function PortalCasesPage({ searchParams }: { searchParams?: Promise<{ customer?: string; case_reference?: string; cursor?: string; messages_cursor?: string; attachments_cursor?: string }> }) {
  const context = await getCustomerPortalContext();
  const params = await searchParams
  if (params?.customer && !context.customerIds.includes(params.customer)) notFound()
  const customerId = params?.customer || context.customerIds[0]
  const actor = context.companyId && customerId ? await currentSupportSession('portal') : null
  const readContext = context.companyId && customerId && actor ? { companyId: context.companyId, customerId, actor } : null
  const [supportPage, account, conversation] = await Promise.all([
    readContext ? readCustomerSupportPage(readContext, { limit: 25, cursor: params?.cursor }) : null,
    readContext && actor ? supabaseService.from('customer_portal_accounts').select('role').eq('company_id', readContext.companyId).eq('customer_id', customerId).eq('user_id', actor.userId).eq('status', 'active').eq('is_active', true).maybeSingle() : null,
    readContext && params?.case_reference
      ? readCustomerSupportPage(readContext, { reference: params.case_reference, limit: 25, cursor: params.messages_cursor }) : null,
  ])
  if (account?.error) throw account.error
  const canWrite = account?.data?.role === 'owner'
  const supportCases = (supportPage?.items ?? []) as CustomerSupportCase[]
  const conversationCaseReference = conversation?.case?.case_reference
  const publications = readContext ? await readPortalCasePublicationsPage(readContext, [
    ...supportCases.map(item => item.case_reference), ...(conversationCaseReference ? [conversationCaseReference] : []),
  ]) : new Map<string, CustomerPortalCaseRow>()
  const conversationPublication = conversationCaseReference ? publications.get(conversationCaseReference) : undefined
  const attachments = readContext && params?.case_reference
    ? await readSupportAttachments(readContext, { reference: params.case_reference, limit: 25, cursor: params.attachments_cursor }) : null
  function href(extra: Record<string, string> = {}) { return `/portal/arenden?${new URLSearchParams({ ...(customerId ? { customer: customerId } : {}), ...extra })}` }

  return (
    <div className="space-y-6">
      <section className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-3xl font-bold tracking-tight text-slate-950">
          Mina ärenden
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
          Skapa ett ärende och fortsätt samtalet med kundservice. Här visas också kundservices publicerade svar.
        </p>
      </section>

      {context.customers.length > 1 ? <form method="get" className="flex flex-wrap items-end gap-3"><label className="grid gap-1 text-sm">Kundkonto<select name="customer" defaultValue={customerId} className="min-h-11 rounded-xl border border-slate-300 px-3 py-2">{context.customers.map(customer => <option key={customer.id} value={customer.id}>{customer.customer_number ?? customer.full_name ?? customer.id}</option>)}</select></label><button type="submit" className="min-h-11 rounded-xl border border-slate-300 px-4 py-2 font-semibold">Visa kundkonto</button></form> : null}

      {canWrite && customerId ? <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Nytt ärende</h2>
        <SupportActionForm action={createPortalSupportCaseAction} fallbackAction={createPortalSupportCaseFallbackAction} initialKey={randomUUID()} submitLabel="Skicka ärende" className="mt-4 space-y-3">
          <input type="hidden" name="customer_id" value={customerId} />
          <label className="grid gap-1 text-sm">Rubrik<input name="title" required maxLength={180} className="min-w-0 rounded-xl border border-slate-300 px-3 py-2" /></label>
          <label className="grid gap-1 text-sm">Meddelande<textarea name="body" required maxLength={8000} rows={4} className="min-w-0 rounded-xl border border-slate-300 px-3 py-2" /></label>
          <p className="text-xs text-slate-600">Bilagor kan lämnas privat när du har skapat ärendet. De ligger i karantän och kan inte öppnas innan säkerhetskontrollen är ansluten.</p>
        </SupportActionForm>
      </section> : <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">Detta kundkonto har läsbehörighet. Du kan läsa publicerade ärenden och meddelanden.</p>}

      {conversation?.case ? <section className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold">{conversation.case.title}</h2><p className="text-sm text-slate-600">Revision {conversation.case.revision} · {conversation.case.status}</p>
        {conversationPublication ? <p className="text-xs text-slate-600">Aktuell kundsynlig sammanfattning: {conversationPublication.channel === 'phone' ? 'Telefonsammanfattning' : 'Handläggning i OPS'} · Författarreferens {publicReference('support_staff', context.companyId ?? '', conversationPublication.author_user_id)}</p> : null}
        {(conversation.items as CustomerSupportMessage[]).map(message => <article key={message.message_reference} className="rounded-xl border border-slate-200 p-4"><p className="text-xs font-semibold text-slate-600">{message.author_kind === 'staff' ? <>Kundservice{message.author_reference ? <> · Författarreferens {message.author_reference}</> : null}</> : 'Du'} · {message.channel === 'phone' ? 'Telefonsammanfattning' : message.channel} · {formatDate(message.created_at)}</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{message.body}</p></article>)}
        {!conversation.items.length ? <p className="text-sm text-slate-600">Inga meddelanden på denna sida.</p> : null}
        {conversation.page.next_cursor ? <Link className="text-sm font-semibold underline" href={href({ case_reference: params!.case_reference!, messages_cursor: conversation.page.next_cursor })}>Äldre meddelanden</Link> : null}
        {params?.messages_cursor ? <Link className="text-sm font-semibold underline" href={href({ case_reference: params.case_reference! })}>Senaste meddelanden</Link> : null}
        {canWrite && conversation.case.status !== 'closed' ? <SupportActionForm action={replyPortalSupportCaseAction} fallbackAction={replyPortalSupportCaseFallbackAction} initialKey={randomUUID()} expectedRevision={conversation.case.revision} submitLabel="Skicka meddelande" className="space-y-3"><input type="hidden" name="customer_id" value={customerId} /><input type="hidden" name="case_reference" value={conversation.case.case_reference} /><label className="grid gap-1 text-sm">Fortsätt samma ärende<textarea name="body" required maxLength={8000} rows={4} className="rounded-xl border border-slate-300 px-3 py-2" /></label></SupportActionForm> : <p className="text-sm text-slate-600">Ärendet är avslutat eller ditt konto har läsbehörighet.</p>}
        <section className="space-y-3 border-t border-slate-200 pt-4"><h3 className="font-semibold">Privata bilagor</h3>
          {attachments?.items.map(item => <article key={item.attachment_reference} className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm"><p className="font-semibold">{item.file_name}</p><p>{item.media_type} · {item.byte_size} byte · Mottagen i privat karantän</p><p className="mt-1">Kan inte öppnas innan säkerhetskontrollen är ansluten.</p></article>)}
          {!attachments?.items.length ? <p className="text-sm text-slate-600">Inga bilagor på denna sida.</p> : null}
          {attachments?.page.next_cursor ? <Link className="text-sm underline" href={href({ case_reference: conversation.case.case_reference, attachments_cursor: attachments.page.next_cursor })}>Äldre bilagor</Link> : null}
          {params?.attachments_cursor ? <Link className="text-sm underline" href={href({ case_reference: conversation.case.case_reference })}>Senaste bilagor</Link> : null}
          {canWrite && conversation.case.status !== 'closed' ? <SupportActionForm action={uploadPortalSupportAttachmentAction} fallbackAction={uploadPortalSupportAttachmentFallbackAction} initialKey={randomUUID()} expectedRevision={conversation.case.revision} submitLabel="Lämna privat bilaga" className="space-y-3"><input type="hidden" name="customer_id" value={customerId} /><input type="hidden" name="case_reference" value={conversation.case.case_reference} /><label className="grid gap-1 text-sm">Fil (PDF, PNG, JPEG eller text, högst 5 MiB)<input name="file" type="file" required accept="application/pdf,image/png,image/jpeg,text/plain" className="min-w-0 rounded-xl border border-slate-300 p-2" /></label></SupportActionForm> : null}
        </section>
      </section> : null}

      <section className="space-y-4">
        {supportCases.filter(item => item.case_reference !== conversationCaseReference).map(supportCase => {
          const item = publications.get(supportCase.case_reference)
          return item ? (
          <article
            key={item.id}
            className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
          >
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">
                  {item.public_title}
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  Publicerat {formatDate(item.published_at)} · {item.channel === 'phone' ? 'Telefonsammanfattning' : 'Handläggning i OPS'} · Författarreferens {publicReference('support_staff', context.companyId ?? '', item.author_user_id)}
                </p>
              </div>
              <span
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${tone(item.public_status)}`}
              >
                {item.public_status === "waiting_for_customer" ? "Väntar på dig" : item.public_status === "resolved" ? "Löst" : item.public_status === "closed" ? "Avslutat" : "Öppet"}
              </span>
            </div>
            <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-700">{item.public_body}</p>
            <p className="mt-3"><Link className="text-sm font-semibold underline" href={href({ case_reference: supportCase.case_reference })}>Fortsätt samma ärende</Link></p>
          </article>
          ) : <article key={supportCase.case_reference} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-lg font-semibold">{supportCase.title}</h2><p className="mt-2 text-sm text-slate-600">Revision {supportCase.revision} · {supportCase.status} · {formatDate(supportCase.created_at)}</p><p className="mt-3"><Link className="text-sm font-semibold underline" href={href({ case_reference: supportCase.case_reference })}>Läs och fortsätt ärendet</Link></p></article>
        })}
        {supportPage?.page.next_cursor ? <Link className="text-sm font-semibold underline" href={href({ cursor: supportPage.page.next_cursor })}>Fler ärenden</Link> : null}
        {params?.cursor ? <Link className="text-sm font-semibold underline" href={href()}>Senaste ärenden</Link> : null}

        {supportCases.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
            Du har inga ärenden på denna sida.
          </div>
        ) : null}
      </section>
    </div>
  );
}
