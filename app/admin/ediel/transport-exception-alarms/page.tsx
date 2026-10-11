// masterplan: TR-09, AT-TR-09
import {requireAdminPageAccess} from '@/lib/admin/guards'
import {readEdielTransportExceptionAlarms, type EdielTransportExceptionAlarm} from '@/lib/ediel/transport/exception/administratorAlarms'

export const dynamic = 'force-dynamic'

const caseLabels: Record<string, string> = {
  recipient_certificate_unavailable: 'Mottagarcertifikat saknas (tom X.500-sökning)',
  crl_refresh_failure: 'Spärrlistan kunde inte hämtas (föregående signerade CRL används)',
  temporary_encryption_failure: 'Tillfälligt krypteringsfel',
}

const title = 'Larm för reservförfarande vid överföring'

export default async function TransportExceptionAlarmsPage() {
  const guard = await requireAdminPageAccess({allOf: ['communication.write']})
  if (!guard.companyId) {
    return <main className="p-6"><h1 className="text-2xl font-semibold">{title}</h1><p>Välj ett bolag där du har behörighet att hantera kommunikation.</p></main>
  }
  let alarms: EdielTransportExceptionAlarm[] | null = null
  try {
    alarms = await readEdielTransportExceptionAlarms({companyId: guard.companyId, actorUserId: guard.userId})
  } catch {
    alarms = null
  }
  if (!alarms) {
    // Fail closed: an unreadable feed is never presented as "no alarms".
    return <main className="p-6"><h1 className="text-2xl font-semibold">{title}</h1><p role="alert">Larmen kunde inte läsas med aktuell bolagsbehörighet. Kontrollera behörigheten och försök igen.</p></main>
  }
  return (
    <main className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p>Varje rad är ett godkänt, tidsbegränsat undantag där ett meddelande skickades med reservförfarande. TLS är fortsatt obligatoriskt. Åtgärda orsaken innan undantaget löper ut.</p>
      {alarms.length === 0 ? (
        <p>Inga larm för reservförfarande.</p>
      ) : (
        <ul className="divide-y rounded border" aria-label="Larm för reservförfarande">
          {alarms.map((alarm) => (
            <li key={alarm.id} className="space-y-1 p-3" data-alarm-case={alarm.reserveCase}>
              <p className="font-medium" role={alarm.knownReserveCase ? undefined : 'alert'}>{caseLabels[alarm.reserveCase] ?? `Okänt reservfall: ${alarm.reserveCase}`}</p>
              <p className="text-sm">Larmat {alarm.createdAt}{alarm.validTo ? ` · undantaget gäller till ${alarm.validTo}` : ''}</p>
              <p className="text-sm">Meddelande {alarm.messageId} · ansvarig {alarm.responsibleUserId}</p>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
