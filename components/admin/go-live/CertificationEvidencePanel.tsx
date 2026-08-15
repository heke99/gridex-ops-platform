import {
  REQUIRED_PRODUCTION_EVIDENCE,
  isEdielCertificationEvidenceApproved,
  type EdielCertificationEvidenceRecord,
} from '@/lib/ediel/certificationEvidence'
import { saveCertificationEvidenceAction } from '@/app/admin/platform/go-live/actions'

function formatDate(value: string | null | undefined) {
  if (!value) return '–'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('sv-SE')
}

function currentFor(
  records: EdielCertificationEvidenceRecord[],
  evidenceType: string,
) {
  return records.find((row) => row.evidence_type === evidenceType) ?? null
}

export function CertificationEvidencePanel({
  companyId,
  records,
  verifiedAt,
  pilotRequired,
}: {
  companyId: string
  records: EdielCertificationEvidenceRecord[]
  verifiedAt: number
  pilotRequired: boolean
}) {
  const approved = new Set(
    records
      .filter((row) => isEdielCertificationEvidenceApproved(row, verifiedAt))
      .map((row) => row.evidence_type),
  )
  const requiredNow = pilotRequired
    ? REQUIRED_PRODUCTION_EVIDENCE
    : REQUIRED_PRODUCTION_EVIDENCE.filter((type) => type !== 'LIMITED_PILOT')
  const missingCount = requiredNow.filter((type) => !approved.has(type)).length

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
            Production-evidens
          </p>
          <h2 className="mt-2 text-xl font-black text-slate-950">
            Externa tester & pilotbevis
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-700">
            Production får inte aktiveras genom en manuell genväg. Varje obligatoriskt
            bevis måste ha en extern referens, en spårbar dokument-/bevisreferens och ett
            verkligt testdatum innan superadmin kan attestera det. LIMITED_PILOT blir
            obligatorisk först efter den första verkliga production-sändningen; därefter
            stoppas fortsatt drift tills pilotutfallet är attesterat. Utgången eller
            ofullständig evidens visas inte som godkänd.
          </p>
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs font-bold ${missingCount === 0 ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
          {missingCount === 0 ? 'Alla bevis godkända' : `${missingCount} bevis saknas`}
        </span>
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        {REQUIRED_PRODUCTION_EVIDENCE.map((evidenceType) => {
          const current = currentFor(records, evidenceType)
          const isApproved = current ? isEdielCertificationEvidenceApproved(current, verifiedAt) : false
          const isRequiredNow = evidenceType !== 'LIMITED_PILOT' || pilotRequired
          return (
            <details
              key={evidenceType}
              className={`rounded-2xl border p-5 ${isApproved ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50'}`}
              open={isRequiredNow && !isApproved}
            >
              <summary className="cursor-pointer list-none">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-black text-slate-950">{evidenceType}</div>
                    <div className="mt-1 text-xs font-semibold text-slate-600">
                      {current ? `${current.status} · ${formatDate(current.updated_at)}` : 'Ingen evidens registrerad'}
                    </div>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${isApproved ? 'bg-emerald-700 text-white' : 'bg-slate-200 text-slate-800'}`}>
                    {isApproved ? 'Godkänd' : !isRequiredNow ? 'Efter första live-send' : current ? 'Ej giltig' : 'Saknas'}
                  </span>
                </div>
              </summary>

              {current ? (
                <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3 text-xs leading-5 text-slate-700">
                  <div><strong>Extern referens:</strong> {current.external_reference ?? '–'}</div>
                  <div><strong>Bevisreferens:</strong> {current.evidence_document_reference ?? '–'}</div>
                  <div><strong>Testad:</strong> {formatDate(current.tested_at)}</div>
                  <div><strong>Godkänd:</strong> {formatDate(current.approved_at)}</div>
                  <div><strong>Giltig till:</strong> {formatDate(current.valid_until)}</div>
                </div>
              ) : null}

              {isRequiredNow ? (
              <form action={saveCertificationEvidenceAction} className="mt-4 grid gap-3">
                <input type="hidden" name="company_id" value={companyId} />
                <input type="hidden" name="evidence_type" value={evidenceType} />
                <input type="hidden" name="evidence_status" value="passed" />
                <label className="grid gap-1 text-xs font-bold text-slate-700">
                  Extern referens
                  <input
                    name="external_reference"
                    defaultValue={current?.external_reference ?? ''}
                    placeholder="Portaltest, ärende-ID eller officiell referens"
                    className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium"
                    required
                  />
                </label>
                <label className="grid gap-1 text-xs font-bold text-slate-700">
                  Dokument-/bevisreferens
                  <input
                    name="evidence_document_reference"
                    defaultValue={current?.evidence_document_reference ?? ''}
                    placeholder="Lagrad rapport, dokument-ID eller evidence package"
                    className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium"
                    required
                  />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1 text-xs font-bold text-slate-700">
                    Testdatum
                    <input
                      type="datetime-local"
                      name="tested_at"
                      className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium"
                      required
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-bold text-slate-700">
                    Giltig till, valfritt
                    <input
                      type="datetime-local"
                      name="valid_until"
                      className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium"
                    />
                  </label>
                </div>
                <label className="grid gap-1 text-xs font-bold text-slate-700">
                  Bekräftelse
                  <input
                    name="confirmation"
                    placeholder="APPROVE EVIDENCE"
                    className="rounded-xl border border-amber-300 bg-white px-3 py-2 text-sm font-medium"
                    required
                  />
                </label>
                <button className="justify-self-start rounded-xl bg-slate-950 px-4 py-2 text-xs font-black text-white hover:bg-slate-800">
                  Attestera verklig evidens
                </button>
              </form>
              ) : (
                <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs font-semibold leading-5 text-blue-900">
                  Pilotbevis kan attesteras först efter att den första riktiga production-sändningen har skickats.
                </div>
              )}
            </details>
          )
        })}
      </div>
    </section>
  )
}
