import Link from 'next/link'
import { notFound } from 'next/navigation'
import { readReconciliationAttempt } from '@/lib/ediel/outbox/readReconciliationAttempt'

const dispositions = {
  not_recorded: 'Ingen matchande post i transportjournalen.',
  ambiguous: 'Flera journalposter matchar. Försöket behöver manuell avstämning.',
  prepared: 'Försöket förbereddes. Inget transportinträde är dokumenterat.',
  entered: 'Försöket gick in i transporten. Kontrollera utfallet i journalen.',
  provider_accepted: 'SMTP accepterade försöket. Mottagarleverans och affärssvar avstäms separat.',
} as const

export const dynamic = 'force-dynamic'

export default async function EdielOutboxAttemptPage({ params }: {
  params: Promise<{ id: string; attemptId: string }>
}) {
  const attempt = await readReconciliationAttempt(await params)
  if (!attempt) notFound()
  if (!Object.hasOwn(dispositions, attempt.journalStatus)) throw new Error('ediel_outbox_reconciliation_attempt_invalid')
  const state = dispositions[attempt.journalStatus as keyof typeof dispositions]
  return <main className="space-y-3 p-6">
    <Link href="/admin/ediel/outbox#avstamningsbehov" prefetch={false} className="underline">Tillbaka till utkorgen</Link>
    <h1 className="text-xl font-semibold">Sändningsförsök</h1>
    <p>{state}</p>
    <dl>
      <dt>Köförsök</dt><dd>{attempt.attemptId}</dd>
      {attempt.journalId ? <><dt>Transportjournalens ID</dt><dd>{attempt.journalId}</dd></> : null}
      {attempt.enteredAt ? <><dt>Transportinträde</dt><dd>{attempt.enteredAt}</dd></> : null}
      {attempt.observedAt ? <><dt>Observerat utfall</dt><dd>{attempt.observedAt}</dd></> : null}
    </dl>
  </main>
}
