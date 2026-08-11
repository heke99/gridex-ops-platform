//app/admin/inbound-mail/[id]/page.tsx
import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import { reprocessInboundEmailAction } from '@/app/admin/inbound-mail/actions'
import InboundManualReviewForm from './InboundManualReviewForm'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ id: string }> }

function codeBlock(value: unknown) {
  if (typeof value === 'string') return value || '—'
  return JSON.stringify(value ?? {}, null, 2)
}

function reviewText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function reviewLabel(...values: unknown[]) {
  for (const value of values) {
    const text = reviewText(value)
    if (text) return text
  }
  return '—'
}

function reviewDate(value: unknown) {
  const text = reviewText(value)
  if (!text) return '—'
  const date = new Date(text)
  if (Number.isNaN(date.getTime())) return reviewLabel(value)
  return new Intl.DateTimeFormat('sv-SE', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Europe/Stockholm',
  }).format(date)
}

export default async function InboundMailDetailPage({ params }: Props) {
  const admin = await requirePlatformAdminAccess()
  const { id } = await params

  const [messageResult, parseResult, matchResult, attachmentResult, jobResult] = await Promise.all([
    supabaseService.from('inbound_email_messages').select('*').eq('id', id).maybeSingle(),
    supabaseService.from('inbound_ediel_parse_results').select('*').eq('inbound_email_message_id', id).order('created_at', { ascending: false }),
    supabaseService.from('inbound_ediel_match_attempts').select('*').eq('inbound_email_message_id', id).order('created_at', { ascending: false }),
    supabaseService.from('inbound_email_attachments').select('*').eq('inbound_email_message_id', id).order('created_at', { ascending: false }),
    supabaseService.from('inbound_processing_jobs').select('*').eq('inbound_email_message_id', id).order('created_at', { ascending: false }),
  ])

  if (messageResult.error) throw messageResult.error
  if (parseResult.error) throw parseResult.error
  if (matchResult.error) throw matchResult.error
  if (attachmentResult.error) throw attachmentResult.error
  if (jobResult.error) throw jobResult.error

  const message = messageResult.data as Record<string, unknown> | null
  const parseRows = (parseResult.data ?? []) as Array<Record<string, unknown>>
  const matchRows = (matchResult.data ?? []) as Array<Record<string, unknown>>
  const attachments = (attachmentResult.data ?? []) as Array<Record<string, unknown>>
  const jobs = (jobResult.data ?? []) as Array<Record<string, unknown>>
  const openReviews = jobs.filter(
    (job) => job.status === 'manual_review' && job.review_resolved_at == null,
  )

  if (!message) {
    return (
      <div>
        <AdminHeader title="Inbound mail saknas" userEmail={admin.email} workspaceMode="platform" />
        <main className="px-6 py-6 sm:px-8">
          <Link href="/admin/inbound-mail" className="text-sm font-semibold text-emerald-800 hover:text-emerald-900">Tillbaka</Link>
          <div className="mt-4 rounded-3xl border border-red-100 bg-white p-6 text-sm text-red-700">Inkommande mail hittades inte.</div>
        </main>
      </div>
    )
  }

  return (
    <div>
      <AdminHeader
        title="Inbound mail"
        subtitle="Teknisk platform-only detaljvy med raw email, EDIFACT, parserresultat, matchningar och jobbstatus."
        userEmail={admin.email}
        workspaceMode="platform"
      />

      <main className="space-y-6 px-6 py-6 sm:px-8">
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/admin/inbound-mail" className="inline-flex rounded-2xl border border-emerald-100 bg-white px-4 py-2 text-sm font-semibold text-emerald-800 shadow-sm shadow-emerald-950/5 hover:bg-emerald-50">
            Tillbaka till Inbound Mail Engine
          </Link>
          <form action={reprocessInboundEmailAction}>
            <input type="hidden" name="id" value={id} />
            <button className="rounded-2xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-emerald-950/10 hover:bg-emerald-800">Processa om</button>
          </form>
        </div>

        {openReviews.length > 0 ? (
          <section className="rounded-3xl border border-amber-200 bg-amber-50/70 p-5 shadow-sm shadow-amber-950/5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-800">Manual review</p>
                <h2 className="mt-1 text-lg font-semibold text-slate-950">Åtgärd krävs innan jobbet kan fortsätta</h2>
                <p className="mt-1 text-sm text-slate-700">Review avslutas i samma inbound-jobb och loggas i audit trail.</p>
              </div>
              <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">{openReviews.length} öppna</span>
            </div>

            <div className="mt-5 space-y-4">
              {openReviews.map((job) => (
                <InboundManualReviewForm
                  key={String(job.id)}
                  jobId={String(job.id)}
                  inboundEmailMessageId={id}
                  reviewOwner={reviewLabel(job.review_owner)}
                  reviewPriority={reviewLabel(job.review_priority)}
                  reviewSla={reviewDate(job.review_sla_due_at)}
                  reviewReason={reviewLabel(job.review_reason_code, job.error_message)}
                />
              ))}
            </div>
          </section>
        ) : null}

        <section className="grid gap-4 md:grid-cols-4">
          <div className="rounded-3xl border border-emerald-100 bg-white p-5 shadow-sm shadow-emerald-950/5 md:col-span-2">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Mail</p>
            <h2 className="mt-2 text-lg font-semibold text-slate-950">{String(message.subject ?? 'Utan ämne')}</h2>
            <p className="mt-2 text-sm text-slate-700">Från: {String(message.from_address ?? '—')}</p>
            <p className="mt-1 text-sm text-slate-700">Till: {String(message.to_address ?? '—')}</p>
          </div>
          <div className="rounded-3xl border border-emerald-100 bg-white p-5 shadow-sm shadow-emerald-950/5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Processing</p>
            <p className="mt-2 text-2xl font-semibold text-slate-950">{String(message.processing_status ?? 'received')}</p>
            <p className="mt-1 text-sm text-slate-700">Match: {String(message.match_status ?? 'not_checked')}</p>
          </div>
          <div className="rounded-3xl border border-emerald-100 bg-white p-5 shadow-sm shadow-emerald-950/5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Rader</p>
            <p className="mt-2 text-2xl font-semibold text-slate-950">{parseRows.length}</p>
            <p className="mt-1 text-sm text-slate-700">Parserresultat</p>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <div className="rounded-3xl border border-emerald-100 bg-white p-5 shadow-sm shadow-emerald-950/5">
            <h2 className="text-lg font-semibold text-slate-950">Raw EDIFACT payload</h2>
            <pre className="mt-4 max-h-[560px] overflow-auto rounded-2xl bg-slate-950 p-4 text-xs leading-5 text-slate-100">{codeBlock(message.raw_edifact_payload)}</pre>
          </div>

          <div className="rounded-3xl border border-emerald-100 bg-white p-5 shadow-sm shadow-emerald-950/5">
            <h2 className="text-lg font-semibold text-slate-950">Raw email</h2>
            <pre className="mt-4 max-h-[560px] overflow-auto rounded-2xl bg-slate-950 p-4 text-xs leading-5 text-slate-100">{codeBlock(message.raw_email)}</pre>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-3">
          <div className="rounded-3xl border border-emerald-100 bg-white p-5 shadow-sm shadow-emerald-950/5">
            <h2 className="text-lg font-semibold text-slate-950">Parserresultat</h2>
            <pre className="mt-4 max-h-[420px] overflow-auto rounded-2xl bg-slate-50 p-4 text-xs leading-5 text-slate-700">{codeBlock(parseRows)}</pre>
          </div>
          <div className="rounded-3xl border border-emerald-100 bg-white p-5 shadow-sm shadow-emerald-950/5">
            <h2 className="text-lg font-semibold text-slate-950">Matchningsförsök</h2>
            <pre className="mt-4 max-h-[420px] overflow-auto rounded-2xl bg-slate-50 p-4 text-xs leading-5 text-slate-700">{codeBlock(matchRows)}</pre>
          </div>
          <div className="rounded-3xl border border-emerald-100 bg-white p-5 shadow-sm shadow-emerald-950/5">
            <h2 className="text-lg font-semibold text-slate-950">Bilagor & jobb</h2>
            <pre className="mt-4 max-h-[420px] overflow-auto rounded-2xl bg-slate-50 p-4 text-xs leading-5 text-slate-700">{codeBlock({ attachments, jobs })}</pre>
          </div>
        </section>
      </main>
    </div>
  )
}
