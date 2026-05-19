import AdminHeader from '@/components/admin/AdminHeader'
import { requirePermissionServer } from '@/lib/auth/requirePermissionServer'
import {
  EDIEL_INSTRUCTION_SPECS,
  buildInstructionCoverage,
  instructionStatusLabel,
  type EdielInstructionStatus,
} from '@/lib/ediel/specRegistry'

export const dynamic = 'force-dynamic'

type InstructionSpecRow = (typeof EDIEL_INSTRUCTION_SPECS)[number]

function tone(status: EdielInstructionStatus): string {
  if (status === 'runtime_ready') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (status === 'runtime_partial') return 'border-amber-200 bg-amber-50 text-amber-700'
  if (status === 'documented_not_enabled') return 'border-slate-200 bg-slate-50 text-slate-700'
  return 'border-emerald-200 bg-emerald-50 text-emerald-700'
}

function cardTone(status: EdielInstructionStatus): string {
  if (status === 'runtime_ready') return 'border-emerald-200 bg-emerald-50'
  if (status === 'runtime_partial') return 'border-amber-200 bg-amber-50'
  if (status === 'documented_not_enabled') return 'border-slate-200 bg-white'
  return 'border-emerald-200 bg-emerald-50'
}

function getPreviousVersion(spec: InstructionSpecRow): string {
  return 'previousVersion' in spec && spec.previousVersion ? spec.previousVersion : '—'
}

function getValidFrom(spec: InstructionSpecRow): string {
  return spec.validFrom ?? '—'
}

function getAckDeadline(spec: InstructionSpecRow): string {
  return spec.ackDeadlineMinutes ? `${spec.ackDeadlineMinutes} min` : '—'
}

export default async function AdminEdielAnvisningarPage() {
  await requirePermissionServer('operations.read')

  const coverage = buildInstructionCoverage()
  const readyCount = EDIEL_INSTRUCTION_SPECS.filter(
    (spec) => spec.status === 'runtime_ready'
  ).length
  const partialCount = EDIEL_INSTRUCTION_SPECS.filter(
    (spec) => spec.status === 'runtime_partial'
  ).length
  const parkedCount = EDIEL_INSTRUCTION_SPECS.filter(
    (spec) => spec.status === 'documented_not_enabled' || spec.status === 'future_scope'
  ).length

  return (
    <div className="space-y-6">
      <AdminHeader
        title="Ediel anvisningskarta"
        subtitle="Praktisk driftvy över vilka anvisningar som är runtime-scope, delvis klara, parkerade eller senare scope. Den här sidan är till för att bygga klart systemet, inte för self-test."
      />

      <section className="grid gap-4 md:grid-cols-4">
        <article className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-500">Totalt mappade regler</p>
          <p className="mt-2 text-3xl font-semibold text-slate-950">
            {EDIEL_INSTRUCTION_SPECS.length}
          </p>
        </article>

        <article className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm text-emerald-700">Runtime-klara</p>
          <p className="mt-2 text-3xl font-semibold text-emerald-900">{readyCount}</p>
        </article>

        <article className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm text-amber-700">Delvis klara</p>
          <p className="mt-2 text-3xl font-semibold text-amber-900">{partialCount}</p>
        </article>

        <article className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm text-emerald-700">Parkerade/senare</p>
          <p className="mt-2 text-3xl font-semibold text-emerald-900">{parkedCount}</p>
        </article>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-slate-950">Vad ska vara klart först?</h2>

        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            <div className="font-semibold">1. Kärnflöden</div>
            <p className="mt-1">
              PRODAT Z03/Z05/Z09, UTILTS E66, CONTRL, APERAK, UTILTS_ERR och
              AI/BI-listor.
            </p>
          </div>

          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <div className="font-semibold">2. Delvis klara regler</div>
            <p className="mt-1">
              Z04/Z06/Z10, E73/E30/S02 behöver full fältmappning innan vi kallar dem
              färdiga.
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            <div className="font-semibold">3. Inte blanda in nu</div>
            <p className="mt-1">
              DELFOR, QUOTES och eSett XML ligger dokumenterade men ska inte blockera
              Gridex elhandelsplattform nu.
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {coverage.map((group) => (
          <article key={group.key} className={`rounded-2xl border p-4 ${cardTone(group.status)}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-950">{group.label}</h2>
                <p className="mt-1 text-sm text-slate-600">{group.note}</p>
              </div>

              <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${tone(group.status)}`}>
                {instructionStatusLabel(group.status)}
              </span>
            </div>

            <div className="mt-4 grid grid-cols-4 gap-2 text-center text-xs">
              <div className="rounded-xl bg-white/70 p-2">
                <div className="text-slate-500">Totalt</div>
                <div className="text-lg font-semibold text-slate-950">{group.total}</div>
              </div>

              <div className="rounded-xl bg-white/70 p-2">
                <div className="text-slate-500">Klara</div>
                <div className="text-lg font-semibold text-emerald-800">
                  {group.runtimeReady}
                </div>
              </div>

              <div className="rounded-xl bg-white/70 p-2">
                <div className="text-slate-500">Delvis</div>
                <div className="text-lg font-semibold text-amber-800">{group.partial}</div>
              </div>

              <div className="rounded-xl bg-white/70 p-2">
                <div className="text-slate-500">Senare</div>
                <div className="text-lg font-semibold text-emerald-800">
                  {group.documentedNotEnabled + group.futureScope}
                </div>
              </div>
            </div>
          </article>
        ))}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-950">Regel för regel</h2>
          <p className="mt-1 text-sm text-slate-500">
            Den här tabellen visar vad systemet ska behandla som aktivt runtime-scope
            och vad som medvetet ligger utanför just nu.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Family / kod</th>
                <th className="px-4 py-3 font-medium">Version</th>
                <th className="px-4 py-3 font-medium">Ack</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Källa</th>
                <th className="px-4 py-3 font-medium">Notering</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {EDIEL_INSTRUCTION_SPECS.map((spec) => (
                <tr key={`${spec.family}-${spec.code}-${spec.standard}`}>
                  <td className="px-4 py-3 align-top">
                    <div className="font-medium text-slate-950">
                      {spec.family} {spec.code}
                    </div>
                    <div className="text-xs text-slate-500">
                      {spec.standard} · {spec.direction}
                    </div>
                  </td>

                  <td className="px-4 py-3 align-top text-slate-700">
                    <div>{spec.currentVersion}</div>
                    <div className="text-xs text-slate-500">
                      Giltig från: {getValidFrom(spec)}
                    </div>
                    <div className="text-xs text-slate-500">
                      Föregående: {getPreviousVersion(spec)}
                    </div>
                  </td>

                  <td className="px-4 py-3 align-top text-xs text-slate-600">
                    <div>CONTRL: {spec.requiresContrl ? 'Ja' : 'Nej'}</div>
                    <div>APERAK: {spec.requiresAperak ? 'Ja' : 'Nej'}</div>
                    <div>Negativ respons: {spec.supportsNegativeResponse ? 'Ja' : 'Nej'}</div>
                    <div>Deadline: {getAckDeadline(spec)}</div>
                  </td>

                  <td className="px-4 py-3 align-top">
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${tone(spec.status)}`}>
                      {instructionStatusLabel(spec.status)}
                    </span>
                  </td>

                  <td className="px-4 py-3 align-top text-xs text-slate-500">
                    <div className="font-medium text-slate-700">{spec.sourceTitle}</div>
                    <div>{spec.sourceVersion}</div>
                    <div>{spec.sourceDate}</div>
                  </td>

                  <td className="px-4 py-3 align-top text-sm text-slate-600">
                    {spec.operationalNote}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}