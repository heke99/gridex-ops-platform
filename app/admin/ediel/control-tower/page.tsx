import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requirePermissionServer } from '@/lib/auth/requirePermissionServer'
import { getCanonicalAckState } from '@/lib/ediel/ack'
import {
  listDuplicateAckCandidates,
  listEdielMessages,
  listOverdueAckMessages,
  listRuleAmbiguities,
} from '@/lib/ediel/db'

export const dynamic = 'force-dynamic'

function tone(value: 'green' | 'yellow' | 'red' | 'slate' | 'blue'): string {
  if (value === 'green') return 'border-green-200 bg-green-50 text-green-700'
  if (value === 'yellow') return 'border-yellow-200 bg-yellow-50 text-yellow-700'
  if (value === 'red') return 'border-red-200 bg-red-50 text-red-700'
  if (value === 'blue') return 'border-blue-200 bg-blue-50 text-blue-700'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function ackTone(state: string): string {
  if (
    state === 'ack_overdue' ||
    state === 'failed' ||
    state === 'contrl_failed' ||
    state === 'aperak_received_negative'
  ) {
    return tone('red')
  }

  if (
    state === 'awaiting_contrl' ||
    state === 'awaiting_aperak' ||
    state === 'in_progress'
  ) {
    return tone('yellow')
  }

  if (
    state === 'contrl_received' ||
    state === 'aperak_received_positive' ||
    state === 'utilts_err_received' ||
    state === 'no_ack_required'
  ) {
    return tone('green')
  }

  return tone('slate')
}

function statusTone(status: string): string {
  if (status === 'failed') return tone('red')
  if (status === 'queued' || status === 'prepared') return tone('yellow')
  if (status === 'sent' || status === 'parsed' || status === 'validated') return tone('blue')
  return tone('green')
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('sv-SE')
}

function ackLabel(state: string): string {
  if (state === 'awaiting_contrl') return 'Väntar på CONTRL'
  if (state === 'contrl_received') return 'CONTRL mottagen/skickad'
  if (state === 'contrl_failed') return 'CONTRL fel'
  if (state === 'awaiting_aperak') return 'Väntar på APERAK'
  if (state === 'aperak_received_positive') return 'Positiv APERAK'
  if (state === 'aperak_received_negative') return 'Negativ APERAK'
  if (state === 'utilts_err_received') return 'UTILTS felkvittens'
  if (state === 'ack_overdue') return 'Försenad kvittens'
  if (state === 'no_ack_required') return 'Ingen kvittens krävs'
  if (state === 'failed') return 'Fel'
  return 'Pågår'
}

function ackHelpText(state: string): string {
  if (state === 'awaiting_contrl') {
    return 'Syntaxkvittens saknas fortfarande. Kontrollera om mottagande part skickat CONTRL.'
  }
  if (state === 'awaiting_aperak') {
    return 'Applikationskvittens saknas fortfarande. Skicka inte ny kvittens automatiskt; följ upp mot motparten.'
  }
  if (state === 'ack_overdue') {
    return '30-minutersgränsen har passerat. Öppna meddelandet och eskalera manuellt eller kontrollera mailbox.'
  }
  if (state === 'aperak_received_negative' || state === 'utilts_err_received') {
    return 'Motparten har avvisat eller markerat fel. Öppna källmeddelandet och läs events/validering.'
  }
  if (state === 'no_ack_required') {
    return 'Reglerna säger att detta meddelande inte behöver ack i runtime.'
  }
  return 'Statusen kommer från canonical ack-state, inte från en enskild UI-flagga.'
}

function AckBadge({ state }: { state: string }) {
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${ackTone(state)}`}>
      {ackLabel(state)}
    </span>
  )
}

export default async function AdminEdielControlTowerPage() {
  await requirePermissionServer('operations.read')

  const [recentMessages, overdueMessages, duplicateAckCandidates, ruleAmbiguities] =
    await Promise.all([
      listEdielMessages({ limit: 20 }),
      listOverdueAckMessages({ limit: 50 }),
      listDuplicateAckCandidates(),
      listRuleAmbiguities(),
    ])

  const inboundCount = recentMessages.filter((row) => row.direction === 'inbound').length
  const outboundCount = recentMessages.filter((row) => row.direction === 'outbound').length
  const failedRecentCount = recentMessages.filter((row) => row.status === 'failed').length
  const activeAlertCount = overdueMessages.length + duplicateAckCandidates.length + ruleAmbiguities.length

  return (
    <div className="space-y-6">
      <AdminHeader
        title="Ediel Control Tower"
        subtitle="Driftvy för kvittenser, dublettskydd, regelkonflikter och senaste Ediel-trafik."
      />

      <section className="rounded-2xl border border-blue-200 bg-blue-50 p-5 text-sm text-blue-900">
        <h2 className="text-base font-semibold">Så ska sidan användas</h2>
        <p className="mt-2 max-w-4xl">
          Börja alltid med röda varningar. Försenad kvittens betyder att 30 minuter har passerat.
          Dublettskydd betyder att samma källa riskerar flera CONTRL/APERAK. Regelkonflikt betyder
          att versionstabellen inte är entydig för runtime.
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-4 xl:grid-cols-7">
        <article className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-500">Aktiva varningar</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{activeAlertCount}</p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-500">Senaste meddelanden</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{recentMessages.length}</p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-500">Inbound</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{inboundCount}</p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-500">Outbound</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{outboundCount}</p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-500">Försenade kvittenser</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{overdueMessages.length}</p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-500">Ack-dubletter</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{duplicateAckCandidates.length}</p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-500">Failed senaste</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{failedRecentCount}</p>
        </article>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">Försenade kvittenser</h2>
          <p className="mt-1 text-sm text-slate-500">
            Detta är driftslistan. Den ska inte autoskapa nya kvittenser; den ska hjälpa admin att följa upp.
          </p>
        </div>

        {overdueMessages.length === 0 ? (
          <div className="px-5 py-6 text-sm text-slate-500">Inga försenade kvittenser just nu.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Meddelande</th>
                  <th className="px-4 py-3 font-medium">Ack-state</th>
                  <th className="px-4 py-3 font-medium">Deadline</th>
                  <th className="px-4 py-3 font-medium">Vad betyder det?</th>
                  <th className="px-4 py-3 font-medium">Åtgärd</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {overdueMessages.map((row) => {
                  const canonicalState = getCanonicalAckState(row)
                  const state = String(canonicalState)
                  return (
                    <tr key={row.id}>
                      <td className="px-4 py-3 align-top">
                        <div className="font-medium text-slate-900">
                          {row.message_family} {row.message_code}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {row.direction} · {row.message_version || 'utan version'} · {row.status}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <AckBadge state={state} />
                        <div className="mt-2 space-y-1 text-xs text-slate-500">
                          <div>CONTRL: {row.contrl_status ?? '—'}</div>
                          <div>APERAK: {row.aperak_status ?? '—'}</div>
                          <div>UTILTS_ERR: {row.utilts_err_status ?? '—'}</div>
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top text-xs text-slate-500">
                        {formatDate(row.ack_due_at)}
                      </td>
                      <td className="px-4 py-3 align-top text-xs text-slate-600">
                        {ackHelpText(state)}
                      </td>
                      <td className="px-4 py-3 align-top text-xs">
                        <Link
                          href={`/admin/ediel/messages/${row.id}`}
                          className="font-medium text-slate-700 underline-offset-2 hover:underline"
                        >
                          Öppna och hantera
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <article className="rounded-2xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-base font-semibold text-slate-900">Dublettskydd ack</h2>
            <p className="mt-1 text-sm text-slate-500">
              Ska normalt vara tom. Om något visas här finns mer än en CONTRL/APERAK/UTILTS_ERR för samma källmeddelande.
            </p>
          </div>
          {duplicateAckCandidates.length === 0 ? (
            <div className="px-5 py-6 text-sm text-slate-500">Inga ack-dubletter hittades.</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {duplicateAckCandidates.map((row) => (
                <li key={`${row.related_message_id}-${row.message_family}`} className="px-5 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="font-medium text-slate-900">
                        {row.message_family} för källa {row.related_message_id}
                      </div>
                      <div className="mt-1 text-sm text-slate-500">
                        {row.duplicate_count} kvittenser hittades. Kontrollera historiken och stoppa vidare autoskick.
                      </div>
                    </div>
                    <Link
                      href={`/admin/ediel/messages/${row.related_message_id}`}
                      className="text-sm font-medium text-slate-700 underline-offset-2 hover:underline"
                    >
                      Öppna källa
                    </Link>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {row.message_ids.map((messageId) => (
                      <Link
                        key={messageId}
                        href={`/admin/ediel/messages/${messageId}`}
                        className="rounded-full border border-slate-200 px-2.5 py-1 text-xs text-slate-600 underline-offset-2 hover:bg-slate-50 hover:underline"
                      >
                        {messageId}
                      </Link>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-base font-semibold text-slate-900">Regelkonflikter</h2>
            <p className="mt-1 text-sm text-slate-500">
              Runtime ska kunna välja exakt en aktiv regel per family, code, standard och riktning.
            </p>
          </div>
          {ruleAmbiguities.length === 0 ? (
            <div className="px-5 py-6 text-sm text-slate-500">Inga regelkonflikter hittades.</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {ruleAmbiguities.map((row) => (
                <li key={`${row.message_family}-${row.message_code}-${row.message_standard}-${row.direction}`} className="px-5 py-4">
                  <div className="font-medium text-slate-900">
                    {row.message_family} {row.message_code}
                  </div>
                  <div className="mt-1 text-sm text-slate-500">
                    {row.message_standard} · {row.direction} · {row.active_rule_count} aktiva regler
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    Åtgärd: stäng av överlappande regel eller sätt valid_to så current och previous-valid blir tydliga.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {row.version_codes.map((version) => (
                      <span key={version} className="rounded-full border border-slate-200 px-2.5 py-1 text-xs text-slate-600">
                        {version}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </article>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">Senaste trafik</h2>
          <p className="mt-1 text-sm text-slate-500">Senaste Ediel-meddelanden med svensk ack-förklaring.</p>
        </div>

        {recentMessages.length === 0 ? (
          <div className="px-5 py-6 text-sm text-slate-500">Inga Ediel-meddelanden hittades ännu.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Skapad</th>
                  <th className="px-4 py-3 font-medium">Meddelande</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Ack-state</th>
                  <th className="px-4 py-3 font-medium">Referenser</th>
                  <th className="px-4 py-3 font-medium">Öppna</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recentMessages.map((row) => {
                  const state = String(getCanonicalAckState(row))
                  return (
                    <tr key={row.id}>
                      <td className="px-4 py-3 align-top text-xs text-slate-500">{formatDate(row.created_at)}</td>
                      <td className="px-4 py-3 align-top">
                        <div className="font-medium text-slate-900">
                          {row.message_family} {row.message_code}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {row.direction} · {row.message_version || 'utan version'}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${statusTone(row.status)}`}>
                          {row.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <AckBadge state={state} />
                        <p className="mt-2 max-w-xs text-xs text-slate-500">{ackHelpText(state)}</p>
                      </td>
                      <td className="px-4 py-3 align-top text-xs text-slate-500">
                        <div>External: {row.external_reference ?? '—'}</div>
                        <div>Transaction: {row.transaction_reference ?? '—'}</div>
                        <div>Interchange: {row.interchange_reference ?? '—'}</div>
                      </td>
                      <td className="px-4 py-3 align-top text-xs">
                        <Link href={`/admin/ediel/messages/${row.id}`} className="font-medium text-slate-700 underline-offset-2 hover:underline">
                          Öppna
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
